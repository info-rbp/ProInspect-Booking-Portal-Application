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
  createService,
  ensureSeedData,
  findBookingByToken,
  getBooking,
  getService,
  getSettings,
  listBookings,
  listBookingsWithAccessSecrets,
  listServices,
  newBookingId,
  releaseScheduleLocks,
  reorderServices,
  saveBooking,
  ScheduleLockConflictError,
  updateBooking,
  updateService,
} from './src/server/store.js';
import {
  calendarIsConfigured,
  createEvent,
  deleteEvent,
  freeBusy,
  getCalendarId,
} from './src/server/calendar.js';
import {
  sanitizeBookingAccess,
  sanitizeBookingProperty,
} from './src/server/bookingValidation.js';
import {
  addressValidationMode,
  autocompleteAustralianAddress,
  validateAustralianAddress,
} from './src/server/addressValidation.js';
import {
  accessEncryptionIsConfigured,
  encryptAccessSecrets,
} from './src/server/accessSecrets.js';
import {
  bookingEmailIsConfigured,
  sendBookingConfirmationEmail,
} from './src/server/email.js';


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

function rateLimitClientKey(req: Request): string {
  if (process.env.CLOUDFLARE_APPLICATION_ID) {
    const cloudflareIp = req.headers['cf-connecting-ip'];
    if (typeof cloudflareIp === 'string' && cloudflareIp.trim()) {
      return cloudflareIp.trim();
    }

    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
      return forwardedFor.split(',')[0].trim();
    }
  }

  return req.ip || req.socket.remoteAddress || 'unknown';
}

function rateLimit(options: { windowMs: number; max: number; prefix: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const clientKey = rateLimitClientKey(req);
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

const SERVICE_ICON_NAMES = new Set([
  'ClipboardCheck',
  'FileSpreadsheet',
  'LogOut',
  'Building2',
  'Wrench',
  'Users',
  'ShieldCheck',
  'HelpCircle',
  'KeyRound',
  'CalendarClock',
  'Home',
  'Briefcase',
]);

function slugifyServiceId(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function integerInRange(
  value: unknown,
  minimum: number,
  maximum: number
): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return null;
  }
  return parsed;
}

function sanitizeServiceConfiguration(
  input: unknown,
  options: { existingId?: string; fallbackOrder: number }
): { service?: InspectionService; error?: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'Service configuration is required.' };
  }

  const value = input as Record<string, unknown>;
  const name = normalizeText(value.name, 100);
  const publicDescription = normalizeText(value.publicDescription, 500);
  const requestedId = normalizeText(value.id, 64);
  const id = options.existingId || slugifyServiceId(requestedId || name);

  if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    return {
      error: 'Service ID must contain only lowercase letters, numbers and hyphens.',
    };
  }

  if (name.length < 2) {
    return { error: 'Service name must contain at least 2 characters.' };
  }

  if (publicDescription.length < 10) {
    return { error: 'Service description must contain at least 10 characters.' };
  }

  const duration = integerInRange(value.duration, 15, 480);
  const bufferBefore = integerInRange(value.bufferBefore, 0, 180);
  const bufferAfter = integerInRange(value.bufferAfter, 0, 180);
  const minimumNoticeHours = integerInRange(value.minimumNoticeHours, 0, 720);
  const maxFutureBookingDays = integerInRange(value.maxFutureBookingDays, 1, 365);
  const order = integerInRange(value.order ?? options.fallbackOrder, 1, 9999);

  if (
    duration === null ||
    bufferBefore === null ||
    bufferAfter === null ||
    minimumNoticeHours === null ||
    maxFutureBookingDays === null ||
    order === null
  ) {
    return {
      error:
        'Duration, buffers, notice period, booking horizon and display order must be whole numbers within the permitted ranges.',
    };
  }

  if (duration % 15 !== 0) {
    return { error: 'Service duration must be in 15-minute increments.' };
  }

  if (bufferBefore % 5 !== 0 || bufferAfter % 5 !== 0) {
    return { error: 'Service buffers must be in 5-minute increments.' };
  }

  if (typeof value.active !== 'boolean' || typeof value.publiclyBookable !== 'boolean') {
    return { error: 'Active and publicly bookable settings must be explicitly selected.' };
  }

  const badge = normalizeText(value.badge, 40);
  const iconName = normalizeText(value.iconName, 64) || 'ClipboardCheck';
  const calendarId = normalizeText(value.calendarId, 256);

  if (!SERVICE_ICON_NAMES.has(iconName)) {
    return { error: 'The selected service icon is not supported.' };
  }

  return {
    service: {
      id,
      name,
      publicDescription,
      duration,
      bufferBefore,
      bufferAfter,
      minimumNoticeHours,
      maxFutureBookingDays,
      active: value.active,
      publiclyBookable: value.publiclyBookable,
      order,
      iconName,
      ...(badge ? { badge } : {}),
      ...(calendarId ? { calendarId } : {}),
    },
  };
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

function publicBaseUrl(req: Request): string {
  const configured = process.env.APP_URL?.trim().replace(/\/$/, '');
  if (configured) return configured;

  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol =
    typeof forwardedProto === 'string' && forwardedProto.trim()
      ? forwardedProto.split(',')[0].trim()
      : req.protocol;
  const host = req.get('host');

  return host ? `${protocol}://${host}` : '';
}

function publicBookingView(
  booking: BookingRecord,
  includeManagementToken = false,
  managementUrl?: string
) {
  return {
    bookingReference: booking.bookingReference,
    ...(includeManagementToken ? { managementToken: booking.managementToken } : {}),
    ...(managementUrl ? { managementUrl } : {}),
    serviceName: booking.serviceName,
    status: booking.status,
    readinessStatus: booking.readinessStatus || 'ready',
    confirmationEmailStatus: booking.confirmationEmail?.status,
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
    bookingEmailConfigured: bookingEmailIsConfigured(),
    sensitiveAccessEncryptionConfigured: accessEncryptionIsConfigured(),
    addressValidationMode: addressValidationMode(),
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

app.get('/api/address/autocomplete', availabilityRateLimit, async (req, res) => {
  try {
    const input = typeof req.query.input === 'string' ? req.query.input.trim() : '';
    if (input.length < 3) return res.json({ suggestions: [] });

    const suggestions = await autocompleteAustralianAddress(input);
    return res.json({ suggestions });
  } catch (error) {
    console.error('Address autocomplete failed:', error);
    return res.status(503).json({
      error: 'Address suggestions are temporarily unavailable. You can continue entering the address manually.',
    });
  }
});

app.post('/api/address/validate', availabilityRateLimit, async (req, res) => {
  try {
    const result = await validateAustralianAddress({
      formattedAddress:
        typeof req.body?.formattedAddress === 'string'
          ? req.body.formattedAddress
          : undefined,
      property:
        req.body?.property && typeof req.body.property === 'object'
          ? req.body.property
          : undefined,
    });

    return res.json({ result });
  } catch (error) {
    console.error('Address validation failed:', error);
    return res.status(503).json({
      error: 'Address validation is temporarily unavailable. Please try again shortly.',
    });
  }
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

    const propertyValidation = sanitizeBookingProperty(property);
    if (!propertyValidation.property) {
      return res.status(400).json({
        error: propertyValidation.error || 'Valid property details are required.',
      });
    }

    const accessValidation = sanitizeBookingAccess(access);
    if (!accessValidation.access || !accessValidation.readinessStatus) {
      return res.status(400).json({
        error: accessValidation.error || 'Valid property access information is required.',
      });
    }

    let validatedProperty = propertyValidation.property;

    if (addressValidationMode() !== 'off') {
      try {
        const addressResult = await validateAustralianAddress({
          property: validatedProperty,
        });

        if (!addressResult.verified) {
          return res.status(400).json({
            error:
              addressResult.message ||
              'The property address could not be verified. Review the address and try again.',
            addressValidation: addressResult,
          });
        }

        const canonicalState =
          addressResult.state &&
          ['WA', 'NSW', 'VIC', 'QLD', 'SA', 'TAS', 'ACT', 'NT'].includes(
            addressResult.state.toUpperCase()
          )
            ? addressResult.state.toUpperCase()
            : validatedProperty.state;

        validatedProperty = {
          ...validatedProperty,
          streetAddress:
            addressResult.streetAddress || validatedProperty.streetAddress,
          unit: addressResult.unit || validatedProperty.unit,
          suburb: addressResult.suburb || validatedProperty.suburb,
          state: canonicalState,
          postcode: addressResult.postcode || validatedProperty.postcode,
          addressVerification: {
            status: 'verified',
            formattedAddress: addressResult.formattedAddress,
            placeId: addressResult.placeId,
            latitude: addressResult.latitude,
            longitude: addressResult.longitude,
            validationGranularity: addressResult.validationGranularity,
            possibleNextAction: addressResult.possibleNextAction,
            addressComplete: addressResult.addressComplete,
            validatedAt: new Date().toISOString(),
          },
        };
      } catch (error) {
        if (addressValidationMode() === 'required') {
          console.error('Required address validation failed:', error);
          return res.status(503).json({
            error:
              'The property address could not be verified right now. Please try again shortly.',
          });
        }

        console.warn('Optional address validation unavailable:', error);
        validatedProperty = {
          ...validatedProperty,
          addressVerification: {
            status: 'unverified',
            validatedAt: new Date().toISOString(),
          },
        };
      }
    } else {
      validatedProperty = {
        ...validatedProperty,
        addressVerification: {
          status: 'unverified',
          validatedAt: new Date().toISOString(),
        },
      };
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
      property: validatedProperty,
      access: accessValidation.access,
      readinessStatus: accessValidation.readinessStatus,
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

    let encryptedAccessSecrets;
    if (accessValidation.secrets) {
      if (!accessEncryptionIsConfigured()) {
        await releaseScheduleLocks(bookingId).catch(() => undefined);
        lockedBookingId = null;
        return res.status(503).json({
          error:
            'Secure storage for lockbox or alarm details is temporarily unavailable. Please contact ProInspect or choose another access method.',
        });
      }

      encryptedAccessSecrets = encryptAccessSecrets(
        bookingId,
        accessValidation.secrets
      );
    }

    const calendarResult = await createEvent(booking, resolvedCalendarId);
    calendarEventId = calendarResult.eventId;
    booking.calendarEventId = calendarEventId;
    booking.calendarHtmlLink = calendarResult.htmlLink;

    try {
      await saveBooking(booking, encryptedAccessSecrets);
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

    const baseUrl = publicBaseUrl(req);
    const managementUrl = `${baseUrl}/manage/${encodeURIComponent(
      booking.managementToken
    )}`;
    const emailResult = await sendBookingConfirmationEmail({
      booking,
      managementUrl,
    });
    booking.confirmationEmail = {
      status: emailResult.status,
      attemptedAt: new Date().toISOString(),
      ...(emailResult.providerMessageId
        ? { providerMessageId: emailResult.providerMessageId }
        : {}),
      ...(emailResult.error
        ? { error: emailResult.error.slice(0, 500) }
        : {}),
    };

    await updateBooking(booking.id, {
      confirmationEmail: booking.confirmationEmail,
    }).catch((emailStatusError) => {
      console.error(
        'Failed to persist booking confirmation-email status:',
        emailStatusError
      );
    });

    if (emailResult.status === 'failed') {
      console.error(
        `Booking ${booking.bookingReference} was created but its confirmation email failed:`,
        emailResult.error
      );
    }

    return res.status(201).json({
      success: true,
      booking: publicBookingView(booking, true, managementUrl),
      message:
        emailResult.status === 'sent'
          ? 'Booking confirmed successfully. A confirmation email has been sent.'
          : 'Booking confirmed successfully. Keep the secure management link shown on screen.',
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

    const managementUrl = `${publicBaseUrl(req)}/manage/${encodeURIComponent(token)}`;
    return res.json({ booking: publicBookingView(booking, false, managementUrl) });
  } catch (error) {
    console.error('Public booking lookup failed:', error);
    return res.status(500).json({ error: 'Unable to retrieve this booking.' });
  }
});

app.post('/api/bookings/manage/:token/cancel', manageRateLimit, async (req, res) => {
  try {
    const token = req.params.token;
    if (!/^pi_[A-Za-z0-9_-]{24,}$/.test(token)) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    const booking = await findBookingByToken(token);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    if (booking.status === 'cancelled') {
      const managementUrl = `${publicBaseUrl(req)}/manage/${encodeURIComponent(token)}`;
      return res.json({
        success: true,
        booking: publicBookingView(booking, false, managementUrl),
      });
    }

    if (booking.status === 'completed') {
      return res.status(409).json({ error: 'Completed bookings cannot be cancelled.' });
    }

    if (new Date(booking.appointment.start).getTime() <= Date.now()) {
      return res.status(409).json({
        error: 'This appointment has already started. Contact ProInspect for assistance.',
      });
    }

    if (booking.calendarEventId) {
      const service = await getService(booking.serviceId);
      await deleteEvent(
        booking.calendarEventId,
        booking.calendarId || service?.calendarId
      );
    }

    const updated = await updateBooking(booking.id, { status: 'cancelled' });
    if (!updated) {
      throw new Error('Booking disappeared while cancellation was being processed.');
    }

    const managementUrl = `${publicBaseUrl(req)}/manage/${encodeURIComponent(token)}`;
    return res.json({
      success: true,
      booking: publicBookingView(updated, false, managementUrl),
    });
  } catch (error) {
    console.error('Public booking cancellation failed:', error);
    return res.status(500).json({
      error: 'The booking could not be cancelled. Please contact ProInspect.',
    });
  }
});

app.get('/api/admin/session', requireAdmin, (_req, res) => {
  return res.json({ authorised: true });
});

app.get('/api/admin/bookings', requireAdmin, async (_req, res) => {
  try {
    const bookings = await listBookingsWithAccessSecrets();
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

app.post('/api/admin/services', requireAdmin, async (req, res) => {
  try {
    const existingServices = await listServices(false);
    const nextOrder =
      existingServices.reduce((highest, service) => Math.max(highest, service.order || 0), 0) + 1;
    const parsed = sanitizeServiceConfiguration(
      {
        ...(req.body || {}),
        order: nextOrder,
      },
      {
        fallbackOrder: nextOrder,
      }
    );

    if (!parsed.service) {
      return res.status(400).json({ error: parsed.error || 'Invalid service configuration.' });
    }

    const created = await createService(parsed.service);
    return res.status(201).json({ success: true, service: created });
  } catch (error) {
    if (error instanceof Error && error.message === 'SERVICE_ALREADY_EXISTS') {
      return res.status(409).json({
        error: 'A service with this ID already exists. Choose a different service name or ID.',
      });
    }

    console.error('Admin service creation failed:', error);
    return res.status(500).json({ error: 'Unable to create service.' });
  }
});

app.patch('/api/admin/services/:id', requireAdmin, async (req, res) => {
  try {
    const serviceId = req.params.id;
    const existing = await getService(serviceId);

    if (!existing) {
      return res.status(404).json({ error: 'Service not found.' });
    }

    const parsed = sanitizeServiceConfiguration(
      {
        ...existing,
        ...(req.body || {}),
        id: existing.id,
        order: existing.order,
      },
      {
        existingId: existing.id,
        fallbackOrder: existing.order,
      }
    );

    if (!parsed.service) {
      return res.status(400).json({ error: parsed.error || 'Invalid service configuration.' });
    }

    const updated = await updateService(serviceId, parsed.service);
    return res.json({ success: true, service: updated });
  } catch (error) {
    console.error('Admin service update failed:', error);
    return res.status(500).json({ error: 'Unable to update service.' });
  }
});

app.post('/api/admin/services/reorder', requireAdmin, async (req, res) => {
  try {
    const rawServiceIds: unknown = req.body?.serviceIds;

    if (
      !Array.isArray(rawServiceIds) ||
      rawServiceIds.some((id: unknown) => typeof id !== 'string')
    ) {
      return res.status(400).json({
        error: 'Service order must be supplied as a list of service IDs.',
      });
    }

    const serviceIds = rawServiceIds as string[];
    const currentServices = await listServices(false);
    const currentIds = new Set(currentServices.map((service) => service.id));
    const suppliedIds = new Set(serviceIds);

    if (
      serviceIds.length !== currentServices.length ||
      suppliedIds.size !== serviceIds.length ||
      serviceIds.some((id) => !currentIds.has(id))
    ) {
      return res.status(400).json({
        error: 'The reorder request must include every current service exactly once.',
      });
    }

    const services = await reorderServices(serviceIds);
    return res.json({ success: true, services });
  } catch (error) {
    console.error('Admin service reorder failed:', error);
    return res.status(500).json({ error: 'Unable to reorder services.' });
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
