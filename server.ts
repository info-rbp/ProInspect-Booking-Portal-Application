import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import {
  formatAustralianDate,
  formatAustralianTime,
  getPerthDateKey,
} from './src/utils/dateTime.js';
import type { AccessDetails, BookingRecord, BusinessSettings, InspectionService, PropertyType } from './src/types/booking.js';
import { adminAuth, adminDb } from './src/server/firebaseAdmin.js';
import {
  acquireScheduleLocks,
  activeBookingsForDate,
  bookingReferenceExists,
  ensureSeedData,
  findBookingByToken,
  getBooking,
  getService,
  getSettings,
  listBookings,
  listServices,
  newBookingId,
  releaseScheduleLocks,
  saveBooking,
  ScheduleLockConflictError,
  updateBooking,
} from './src/server/store.js';
import {
  calendarIsConfigured,
  createEvent,
  deleteEvent,
  freeBusy,
  getCalendarId,
} from './src/server/calendar.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const TIMEZONE = 'Australia/Perth';
const PERTH_OFFSET = '+08:00';
const SLOT_INTERVAL_MINUTES = 15;

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));

type RateBucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();

function rateLimit(options: { windowMs: number; max: number; prefix: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const clientKey = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${options.prefix}:${clientKey}`;
    const current = rateBuckets.get(key);

    if (!current || current.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (current.count >= options.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        error: 'Too many requests. Please wait a moment and try again.',
      });
    }

    current.count += 1;
    return next();
  };
}

const availabilityRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  prefix: 'availability',
});

const bookingRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  prefix: 'booking',
});

const manageRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: 30,
  prefix: 'manage',
});

function parseAdminEmails(): Set<string> {
  const configured = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return new Set([
    'info@remotebusinesspartner.com.au',
    'info@proinspect.systems',
    ...configured,
  ]);
}

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Administrator authentication is required.' });
    }

    const idToken = authHeader.slice(7).trim();
    const decoded = await adminAuth.verifyIdToken(idToken, true);
    const email = (decoded.email || '').trim().toLowerCase();

    if (!email || decoded.email_verified !== true) {
      return res.status(403).json({ error: 'A verified administrator account is required.' });
    }

    const configuredAdmins = parseAdminEmails();
    let authorised = configuredAdmins.has(email);

    if (!authorised) {
      const adminUser = await adminDb.collection('adminUsers').doc(decoded.uid).get();
      const data = adminUser.exists ? adminUser.data() : null;
      authorised =
        Boolean(data) &&
        data?.active !== false &&
        (!data?.email || String(data.email).trim().toLowerCase() === email);
    }

    if (!authorised) {
      return res.status(403).json({ error: 'This account is not authorised for ProInspect administration.' });
    }

    res.locals.admin = { uid: decoded.uid, email };
    return next();
  } catch (error) {
    console.error('Admin authentication failed:', error);
    return res.status(401).json({ error: 'Administrator session is invalid or has expired.' });
  }
}

function isoForPerth(dateKey: string, minutesAfterMidnight: number): string {
  const hours = Math.floor(minutesAfterMidnight / 60);
  const minutes = minutesAfterMidnight % 60;
  return `${dateKey}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00${PERTH_OFFSET}`;
}

function dayKeyForDate(dateKey: string): keyof BusinessSettings['operatingHours'] {
  const date = new Date(`${dateKey}T12:00:00${PERTH_OFFSET}`);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'long',
  }).format(date).toLowerCase();

  return weekday as keyof BusinessSettings['operatingHours'];
}

function minutesFromClock(clock: string): number {
  const [hours, minutes] = clock.split(':').map(Number);
  return hours * 60 + minutes;
}

function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T12:00:00${PERTH_OFFSET}`);
  return !Number.isNaN(parsed.getTime()) && getPerthDateKey(parsed) === value;
}

function isValidEmail(value: unknown): boolean {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function normalizeText(value: unknown, maxLength = 1000): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

const PROPERTY_TYPES: PropertyType[] = [
  'House',
  'Apartment / Unit',
  'Townhouse',
  'Commercial',
  'Retail',
  'Office',
  'Industrial',
  'Strata / Common Property',
  'Other',
];

function sanitizeAccess(input: unknown): AccessDetails | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, any>;
  const method = value.method;

  if (!['tenant', 'meet_onsite', 'keys_agency', 'keys_proinspect', 'lockbox', 'vacant', 'other'].includes(method)) {
    return null;
  }

  const base: AccessDetails = {
    method,
    specialInstructions: normalizeText(value.specialInstructions, 2000) || undefined,
  };

  if (method === 'tenant') {
    const tenant = value.tenant || {};
    const noticeIssued = ['yes', 'no', 'pending'].includes(tenant.noticeIssued)
      ? tenant.noticeIssued
      : 'pending';

    if (!normalizeText(tenant.tenantName, 100) || !normalizeText(tenant.tenantPhone, 50)) {
      return null;
    }

    base.tenant = {
      tenantName: normalizeText(tenant.tenantName, 100),
      tenantPhone: normalizeText(tenant.tenantPhone, 50),
      tenantEmail: normalizeText(tenant.tenantEmail, 120) || undefined,
      noticeIssued,
      noticeDate: normalizeText(tenant.noticeDate, 20) || undefined,
      accessRestrictions: normalizeText(tenant.accessRestrictions, 1000) || undefined,
    };
  }

  if (method === 'meet_onsite') {
    const contact = value.meetOnsite || {};
    if (!normalizeText(contact.contactName, 100) || !normalizeText(contact.contactPhone, 50)) {
      return null;
    }

    base.meetOnsite = {
      contactName: normalizeText(contact.contactName, 100),
      contactPhone: normalizeText(contact.contactPhone, 50),
      relationship: normalizeText(contact.relationship, 100),
      specialInstructions: normalizeText(contact.specialInstructions, 1000) || undefined,
    };
  }

  if (method === 'keys_agency') {
    const agency = value.agencyKeys || {};
    if (!normalizeText(agency.agencyName, 120) || !normalizeText(agency.collectionAddress, 200)) {
      return null;
    }

    base.agencyKeys = {
      agencyName: normalizeText(agency.agencyName, 120),
      collectionAddress: normalizeText(agency.collectionAddress, 200),
      keyReference: normalizeText(agency.keyReference, 100) || undefined,
      keyInstructions: normalizeText(agency.keyInstructions, 1000) || undefined,
      returnInstructions: normalizeText(agency.returnInstructions, 1000) || undefined,
    };
  }

  if (method === 'keys_proinspect') {
    const keys = value.proInspectKeys || {};
    base.proInspectKeys = {
      keyReference: normalizeText(keys.keyReference, 100) || undefined,
      additionalInstructions: normalizeText(keys.additionalInstructions, 1000) || undefined,
    };
  }

  if (method === 'lockbox') {
    const lockbox = value.lockbox || {};
    if (!normalizeText(lockbox.location, 200) || !normalizeText(lockbox.code, 100)) {
      return null;
    }

    base.lockbox = {
      location: normalizeText(lockbox.location, 200),
      instructions: normalizeText(lockbox.instructions, 1000) || undefined,
      code: normalizeText(lockbox.code, 100),
    };
  }

  if (method === 'vacant') {
    const vacant = value.vacant || {};
    if (!normalizeText(vacant.accessInstructions, 1000)) return null;

    base.vacant = {
      accessInstructions: normalizeText(vacant.accessInstructions, 1000),
      securityAlarm: normalizeText(vacant.securityAlarm, 500) || undefined,
    };
  }

  if (method === 'other') {
    const other = value.other || {};
    if (!normalizeText(other.instructions, 1000)) return null;
    base.other = {
      instructions: normalizeText(other.instructions, 1000),
    };
  }

  return base;
}

function generateManagementToken(): string {
  return `pi_${randomBytes(24).toString('base64url')}`;
}

async function generateBookingReference(start: Date): Promise<string> {
  const datePart = getPerthDateKey(start).replace(/-/g, '');

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = String(Math.floor(1000 + Math.random() * 9000));
    const reference = `PI-${datePart}-${suffix}`;
    if (!(await bookingReferenceExists(reference))) return reference;
  }

  return `PI-${datePart}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function serviceCalendarId(service: InspectionService): string {
  return getCalendarId(service.calendarId);
}

function candidateConflicts(
  candidateStart: Date,
  candidateEnd: Date,
  busyStart: Date,
  busyEnd: Date,
  candidateBufferBeforeMinutes: number,
  candidateBufferAfterMinutes: number,
  busyBufferBeforeMinutes = 0,
  busyBufferAfterMinutes = 0
): boolean {
  const candidateBufferedStart = new Date(
    candidateStart.getTime() - candidateBufferBeforeMinutes * 60_000
  );
  const candidateBufferedEnd = new Date(
    candidateEnd.getTime() + candidateBufferAfterMinutes * 60_000
  );
  const busyBufferedStart = new Date(
    busyStart.getTime() - busyBufferBeforeMinutes * 60_000
  );
  const busyBufferedEnd = new Date(
    busyEnd.getTime() + busyBufferAfterMinutes * 60_000
  );

  return candidateBufferedStart < busyBufferedEnd && candidateBufferedEnd > busyBufferedStart;
}

function dateWithinServiceWindow(dateKey: string, service: InspectionService, now = new Date()): boolean {
  const todayKey = getPerthDateKey(now);
  const max = new Date(now.getTime() + service.maxFutureBookingDays * 24 * 60 * 60_000);
  const maxDateKey = getPerthDateKey(max);
  return dateKey >= todayKey && dateKey <= maxDateKey;
}

async function calendarConflictForSlot(
  service: InspectionService,
  startIso: string,
  endIso: string
): Promise<boolean> {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const queryStart = new Date(start.getTime() - service.bufferBefore * 60_000).toISOString();
  const queryEnd = new Date(end.getTime() + service.bufferAfter * 60_000).toISOString();

  const busy = await freeBusy({
    timeMin: queryStart,
    timeMax: queryEnd,
    timezone: TIMEZONE,
    calendarId: serviceCalendarId(service),
  });

  return busy.some((interval) =>
    candidateConflicts(
      start,
      end,
      new Date(interval.start),
      new Date(interval.end),
      service.bufferBefore,
      service.bufferAfter
    )
  );
}

async function localConflictForSlot(
  dateKey: string,
  service: InspectionService,
  startIso: string,
  endIso: string
): Promise<boolean> {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const bookings = await activeBookingsForDate(dateKey);
  const serviceRules = await Promise.all(
    bookings.map((booking) => getService(booking.serviceId))
  );

  return bookings.some((booking, index) => {
    const existingRules = serviceRules[index];
    const existingBufferBefore =
      booking.appointment.bufferBeforeMinutes ?? existingRules?.bufferBefore ?? 0;
    const existingBufferAfter =
      booking.appointment.bufferAfterMinutes ?? existingRules?.bufferAfter ?? 0;

    return candidateConflicts(
      start,
      end,
      new Date(booking.appointment.start),
      new Date(booking.appointment.end),
      service.bufferBefore,
      service.bufferAfter,
      existingBufferBefore,
      existingBufferAfter
    );
  });
}

function publicBookingView(booking: BookingRecord, includeManagementToken = false) {
  return {
    bookingReference: booking.bookingReference,
    ...(includeManagementToken ? { managementToken: booking.managementToken } : {}),
    serviceName: booking.serviceName,
    status: booking.status,
    property: {
      streetAddress: booking.property.streetAddress,
      unit: booking.property.unit || '',
      suburb: booking.property.suburb,
      state: booking.property.state,
      postcode: booking.property.postcode,
      propertyType: booking.property.propertyType,
      customerName: booking.property.customerName,
      customerEmail: booking.property.customerEmail,
    },
    access: {
      method: booking.access.method,
    },
    appointment: booking.appointment,
  };
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    calendarConfigured: calendarIsConfigured(),
    timezone: TIMEZONE,
  });
});

app.get('/api/services', async (_req, res) => {
  try {
    const services = await listServices(true);
    const publicServices = services.map(({ calendarId: _calendarId, ...service }) => service);
    res.json({ services: publicServices });
  } catch (error) {
    console.error('Failed to load services:', error);
    res.status(500).json({ error: 'Unable to load booking services.' });
  }
});

app.get('/api/settings', async (_req, res) => {
  try {
    const settings = await getSettings();
    res.json({
      settings: {
        timezone: settings.timezone,
        locale: settings.locale,
        operatingHours: settings.operatingHours,
        minimumNoticeHours: settings.minimumNoticeHours,
        maxFutureBookingDays: settings.maxFutureBookingDays,
        calendarConnected: calendarIsConfigured(),
      },
    });
  } catch (error) {
    console.error('Failed to load settings:', error);
    res.status(500).json({ error: 'Unable to load booking settings.' });
  }
});

app.get('/api/calendar/status', (_req, res) => {
  res.json({
    connected: calendarIsConfigured(),
    provider: 'Google Calendar API',
    timezone: TIMEZONE,
  });
});

app.get('/api/calendar/availability', availabilityRateLimit, async (req, res) => {
  try {
    const { date, serviceId } = req.query;

    if (!isValidDateKey(date) || typeof serviceId !== 'string') {
      return res.status(400).json({ error: 'A valid date and serviceId are required.' });
    }

    const [service, settings] = await Promise.all([
      getService(serviceId),
      getSettings(),
    ]);

    if (!service || !service.active || !service.publiclyBookable) {
      return res.status(404).json({ error: 'The selected service is not available for public booking.' });
    }

    if (!calendarIsConfigured()) {
      return res.status(503).json({ error: 'Online scheduling is temporarily unavailable.' });
    }

    if (!dateWithinServiceWindow(date, service)) {
      return res.json({
        date,
        slots: [],
        message: 'This date is outside the available booking period. Please choose another date.',
      });
    }

    const dayKey = dayKeyForDate(date);
    const operatingHours = settings.operatingHours[dayKey];

    if (!operatingHours?.active) {
      return res.json({
        date,
        slots: [],
        message: 'No appointments are available on this date. Please choose another date.',
      });
    }

    const openMinutes = minutesFromClock(operatingHours.open);
    const closeMinutes = minutesFromClock(operatingHours.close);
    const noticeHours = Math.max(settings.minimumNoticeHours || 0, service.minimumNoticeHours || 0);
    const earliestStart = Date.now() + noticeHours * 60 * 60_000;

    const dayStart = `${date}T00:00:00${PERTH_OFFSET}`;
    const dayEnd = `${date}T23:59:59${PERTH_OFFSET}`;

    const [calendarBusy, localBookings] = await Promise.all([
      freeBusy({
        timeMin: dayStart,
        timeMax: dayEnd,
        timezone: TIMEZONE,
        calendarId: serviceCalendarId(service),
      }),
      activeBookingsForDate(date),
    ]);
    const localServiceRules = await Promise.all(
      localBookings.map((booking) => getService(booking.serviceId))
    );

    const busyIntervals = [
      ...calendarBusy.map((item) => ({
        start: new Date(item.start),
        end: new Date(item.end),
        bufferBefore: 0,
        bufferAfter: 0,
      })),
      ...localBookings.map((booking, index) => ({
        start: new Date(booking.appointment.start),
        end: new Date(booking.appointment.end),
        bufferBefore:
          booking.appointment.bufferBeforeMinutes ??
          localServiceRules[index]?.bufferBefore ??
          0,
        bufferAfter:
          booking.appointment.bufferAfterMinutes ??
          localServiceRules[index]?.bufferAfter ??
          0,
      })),
    ];

    const slots = [];

    for (
      let startMinutes = openMinutes;
      startMinutes + service.duration <= closeMinutes;
      startMinutes += SLOT_INTERVAL_MINUTES
    ) {
      const startIso = isoForPerth(date, startMinutes);
      const endIso = isoForPerth(date, startMinutes + service.duration);
      const start = new Date(startIso);
      const end = new Date(endIso);

      if (start.getTime() < earliestStart) continue;

      const conflict = busyIntervals.some((busy) =>
        candidateConflicts(
          start,
          end,
          busy.start,
          busy.end,
          service.bufferBefore,
          service.bufferAfter,
          busy.bufferBefore,
          busy.bufferAfter
        )
      );

      if (!conflict) {
        slots.push({
          start: startIso,
          end: endIso,
          displayTime: formatAustralianTime(start),
          displayDate: formatAustralianDate(start),
          dateKey: date,
        });
      }
    }

    return res.json({
      date,
      slots,
      message:
        slots.length === 0
          ? 'No appointments are available on this date. Please choose another date.'
          : undefined,
    });
  } catch (error) {
    console.error('Availability error:', error);
    return res.status(503).json({
      error: 'Unable to confirm Google Calendar availability right now. Please try again shortly.',
    });
  }
});

app.post('/api/bookings/create', bookingRateLimit, async (req, res) => {
  let calendarEventId: string | undefined;
  let lockedBookingId: string | null = null;

  try {
    const { serviceId, property, access, appointment } = req.body || {};

    if (!serviceId || !property || !access || !appointment?.start) {
      return res.status(400).json({ error: 'Missing mandatory booking information.' });
    }

    if (
      !normalizeText(property.streetAddress, 150) ||
      !normalizeText(property.suburb, 100) ||
      !/^\d{4}$/.test(normalizeText(property.postcode, 4))
    ) {
      return res.status(400).json({ error: 'A complete Australian property address is required.' });
    }

    if (
      !normalizeText(property.customerName, 100) ||
      !isValidEmail(property.customerEmail) ||
      !normalizeText(property.customerPhone, 50)
    ) {
      return res.status(400).json({ error: 'Valid booking contact details are required.' });
    }

    const sanitizedAccess = sanitizeAccess(access);
    if (!sanitizedAccess) {
      return res.status(400).json({ error: 'Valid property access information is required.' });
    }

    const [service, settings] = await Promise.all([
      getService(String(serviceId)),
      getSettings(),
    ]);

    if (!service || !service.active || !service.publiclyBookable) {
      return res.status(400).json({ error: 'The selected service is not available for public booking.' });
    }

    if (!calendarIsConfigured()) {
      return res.status(503).json({ error: 'Online scheduling is temporarily unavailable.' });
    }

    const requestedStart = new Date(appointment.start);
    if (Number.isNaN(requestedStart.getTime())) {
      return res.status(400).json({ error: 'Invalid appointment start time.' });
    }

    const dateKey = getPerthDateKey(requestedStart);
    const canonicalStartIso = requestedStart.toISOString();
    const canonicalEnd = new Date(requestedStart.getTime() + service.duration * 60_000);
    const canonicalEndIso = canonicalEnd.toISOString();

    if (!dateWithinServiceWindow(dateKey, service)) {
      return res.status(400).json({ error: 'The requested appointment is outside the available booking period.' });
    }

    const noticeHours = Math.max(settings.minimumNoticeHours || 0, service.minimumNoticeHours || 0);
    if (requestedStart.getTime() - Date.now() < noticeHours * 60 * 60_000) {
      return res.status(409).json({
        error: `This service requires at least ${noticeHours} hours' notice. Please choose another time.`,
        conflict: true,
      });
    }

    const dayKey = dayKeyForDate(dateKey);
    const hours = settings.operatingHours[dayKey];

    if (!hours?.active) {
      return res.status(409).json({
        error: 'That date is not available for this service. Please choose another date.',
        conflict: true,
      });
    }

    const localStartText = new Intl.DateTimeFormat('en-GB', {
      timeZone: TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(requestedStart);
    const localStartMinutes = minutesFromClock(localStartText);
    const localEndMinutes = localStartMinutes + service.duration;
    const dayOpenMinutes = minutesFromClock(hours.open);
    const dayCloseMinutes = minutesFromClock(hours.close);
    const isCanonicalSlot =
      requestedStart.getUTCSeconds() === 0 &&
      requestedStart.getUTCMilliseconds() === 0 &&
      (localStartMinutes - dayOpenMinutes) % SLOT_INTERVAL_MINUTES === 0;

    if (!isCanonicalSlot) {
      return res.status(409).json({
        error: 'That appointment is not a valid booking slot. Please select one of the available times shown.',
        conflict: true,
      });
    }

    if (
      localStartMinutes < dayOpenMinutes ||
      localEndMinutes > dayCloseMinutes
    ) {
      return res.status(409).json({
        error: 'That appointment falls outside operating hours. Please choose another time.',
        conflict: true,
      });
    }

    const [calendarConflict, localConflict] = await Promise.all([
      calendarConflictForSlot(service, canonicalStartIso, canonicalEndIso),
      localConflictForSlot(dateKey, service, canonicalStartIso, canonicalEndIso),
    ]);

    if (calendarConflict || localConflict) {
      return res.status(409).json({
        error: 'That appointment has just become unavailable. Please select another time.',
        conflict: true,
      });
    }

    const bookingId = newBookingId();
    lockedBookingId = bookingId;

    try {
      await acquireScheduleLocks({
        bookingId,
        calendarId: serviceCalendarId(service),
        start: canonicalStartIso,
        end: canonicalEndIso,
        bufferBeforeMinutes: service.bufferBefore,
        bufferAfterMinutes: service.bufferAfter,
      });
    } catch (error) {
      if (error instanceof ScheduleLockConflictError) {
        return res.status(409).json({
          error: 'That appointment is currently being confirmed by another customer. Please select another time.',
          conflict: true,
        });
      }
      throw error;
    }

    const [postLockCalendarConflict, postLockLocalConflict] = await Promise.all([
      calendarConflictForSlot(service, canonicalStartIso, canonicalEndIso),
      localConflictForSlot(dateKey, service, canonicalStartIso, canonicalEndIso),
    ]);

    if (postLockCalendarConflict || postLockLocalConflict) {
      await releaseScheduleLocks(bookingId);
      lockedBookingId = null;
      return res.status(409).json({
        error: 'That appointment has just become unavailable. Please select another time.',
        conflict: true,
      });
    }

    const bookingReference = await generateBookingReference(requestedStart);
    const now = new Date().toISOString();

    const resolvedCalendarId = serviceCalendarId(service);
    const booking: BookingRecord = {
      id: bookingId,
      bookingReference,
      managementToken: generateManagementToken(),
      serviceId: service.id,
      serviceName: service.name,
      calendarId: resolvedCalendarId,
      property: {
        streetAddress: normalizeText(property.streetAddress, 150),
        unit: normalizeText(property.unit, 50),
        suburb: normalizeText(property.suburb, 100),
        state: normalizeText(property.state, 10) || 'WA',
        postcode: normalizeText(property.postcode, 4),
        propertyType: PROPERTY_TYPES.includes(property.propertyType)
          ? property.propertyType
          : 'Other',
        clientName: normalizeText(property.clientName, 100),
        clientReference: normalizeText(property.clientReference, 100),
        customerName: normalizeText(property.customerName, 100),
        customerEmail: normalizeText(property.customerEmail, 120),
        customerPhone: normalizeText(property.customerPhone, 50),
      },
      access: sanitizedAccess,
      appointment: {
        start: requestedStart.toISOString(),
        end: canonicalEnd.toISOString(),
        dateKey,
        dateString: formatAustralianDate(requestedStart),
        timeString: formatAustralianTime(requestedStart),
        durationMinutes: service.duration,
        bufferBeforeMinutes: service.bufferBefore,
        bufferAfterMinutes: service.bufferAfter,
        timezone: TIMEZONE,
      },
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
    };

    const calendarResult = await createEvent(booking, resolvedCalendarId);
    calendarEventId = calendarResult.eventId;
    booking.calendarEventId = calendarEventId;
    booking.calendarHtmlLink = calendarResult.htmlLink;

    try {
      await saveBooking(booking);
    } catch (firestoreError) {
      await deleteEvent(calendarEventId, resolvedCalendarId).catch((rollbackError) => {
        console.error('Failed to roll back calendar event after Firestore failure:', rollbackError);
      });
      throw firestoreError;
    }

    await releaseScheduleLocks(bookingId).catch((releaseError) => {
      console.error('Failed to release completed booking locks:', releaseError);
    });
    lockedBookingId = null;

    return res.status(201).json({
      success: true,
      booking: publicBookingView(booking, true),
      message: 'Booking confirmed successfully.',
    });
  } catch (error) {
    if (lockedBookingId) {
      await releaseScheduleLocks(lockedBookingId).catch((releaseError) => {
        console.error('Failed to release booking locks after error:', releaseError);
      });
    }

    console.error('Booking creation failed:', error);
    return res.status(500).json({
      error: 'The booking could not be confirmed. No appointment has been saved. Please try again.',
    });
  }
});

app.get('/api/bookings/manage/:token', manageRateLimit, async (req, res) => {
  try {
    const token = req.params.token;
    if (!/^pi_[A-Za-z0-9_-]{24,}$/.test(token)) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    const booking = await findBookingByToken(token);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    return res.json({ booking: publicBookingView(booking) });
  } catch (error) {
    console.error('Public booking lookup failed:', error);
    return res.status(500).json({ error: 'Unable to retrieve this booking.' });
  }
});

app.get('/api/admin/session', requireAdmin, (_req, res) => {
  return res.json({ authorised: true });
});

app.get('/api/admin/bookings', requireAdmin, async (_req, res) => {
  try {
    const bookings = await listBookings();
    return res.json({ bookings });
  } catch (error) {
    console.error('Admin bookings load failed:', error);
    return res.status(500).json({ error: 'Unable to load bookings.' });
  }
});

app.get('/api/admin/services', requireAdmin, async (_req, res) => {
  try {
    const services = await listServices(false);
    return res.json({ services });
  } catch (error) {
    console.error('Admin services load failed:', error);
    return res.status(500).json({ error: 'Unable to load services.' });
  }
});

app.get('/api/admin/settings', requireAdmin, async (_req, res) => {
  try {
    const settings = await getSettings();
    return res.json({
      settings: {
        ...settings,
        calendarConnected: calendarIsConfigured(),
      },
    });
  } catch (error) {
    console.error('Admin settings load failed:', error);
    return res.status(500).json({ error: 'Unable to load settings.' });
  }
});

app.patch('/api/admin/bookings/:id', requireAdmin, async (req, res) => {
  try {
    const booking = await getBooking(req.params.id);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    const status = req.body?.status;
    const adminNotes =
      req.body?.adminNotes === undefined
        ? undefined
        : normalizeText(req.body.adminNotes, 2000);

    if (status && !['confirmed', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid booking status.' });
    }

    if (booking.status === 'cancelled' && status && status !== 'cancelled') {
      return res.status(409).json({
        error: 'Cancelled bookings cannot be reactivated. Create a new booking instead.',
      });
    }

    if (status === 'cancelled' && booking.status !== 'cancelled' && booking.calendarEventId) {
      const service = await getService(booking.serviceId);
      await deleteEvent(
        booking.calendarEventId,
        booking.calendarId || service?.calendarId
      );
    }

    const updated = await updateBooking(booking.id, {
      ...(status ? { status } : {}),
      ...(adminNotes !== undefined ? { adminNotes } : {}),
    });

    return res.json({ success: true, booking: updated });
  } catch (error) {
    console.error('Admin booking update failed:', error);
    return res.status(500).json({ error: 'Unable to update booking.' });
  }
});

async function startServer() {
  await ensureSeedData();

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`ProInspect Booking Hub server running on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start ProInspect Booking Hub:', error);
  process.exitCode = 1;
});
