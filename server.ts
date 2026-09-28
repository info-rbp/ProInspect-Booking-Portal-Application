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
import type {
  BookingRecord,
  BusinessSettings,
  InspectionService,
  ServiceCategory,
} from './src/types/booking.js';
import type {
  ClientPropertyRole,
  ClientType,
  ClientUserRecord,
  PortalAudience,
  TenantDocumentCategory,
  TenantInspection,
  TenantRequestCreateInput,
  TenantRequestPriority,
  TenantRequestStatus,
  TenantRequestType,
  TenantUserRecord,
} from './src/types/tenant.js';
import type {
  ClientRequestStatus,
  DocumentRequestStatus,
  PaymentStatus,
  WorkOrderStatus,
} from './src/types/platform.js';
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
import {
  addTenantRequestAttachment,
  createClient,
  createClientPropertyLink,
  createClientUser,
  createTenancy,
  createTenantDocumentRecord,
  createTenantInspection,
  createTenantProperty,
  createTenantRequest,
  createTenantUser,
  findAndLinkClientUser,
  findAndLinkTenantUser,
  getClientDocumentForUser,
  getClientPortalDashboard,
  getTenantDocumentForUser,
  getTenantPortalDashboard,
  getTenantRequestAttachmentForUser,
  getTenantUserById,
  getTenantRequestForUser,
  getTenancyById,
  listAdminTenantPortal,
  updateTenantRequestAdmin,
  updateTenantUserAdmin,
  updateTenancyAdmin,
} from './src/server/tenantStore.js';
import {
  deleteTenantFile,
  saveTenantDocumentFile,
  saveTenantRequestAttachment,
  signedTenantFileUrl,
  tenantStorageIsConfigured,
} from './src/server/tenantFiles.js';
import {
  sendTenantRequestReceiptEmail,
  sendTenantRequestStatusEmail,
  tenantPortalEmailIsConfigured,
} from './src/server/tenantEmail.js';
import {
  buildUnifiedClientDashboard,
  createApproval,
  createClientRequestRecord,
  createContractor,
  createWorkOrder,
  listAdminOperations,
  listAuditEvents,
  markNotificationRead,
  respondApproval,
  updateClientRequestRecord,
  updatePaymentStatus,
  updateWorkOrder,
  writeAuditEvent,
} from './src/server/platformStore.js';
import {
  createDocumentRequest,
  getDocumentProduct,
  listDocumentProducts,
  updateDocumentRequest,
} from './src/server/documentStore.js';

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

const tenantRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: 60,
  prefix: 'tenant',
});

const tenantWriteRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  prefix: 'tenant-write',
});

const clientRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: 60,
  prefix: 'client',
});

const tenantFileBody = express.raw({
  type: () => true,
  limit: '20mb',
});

const reportFileBody = express.raw({
  type: () => true,
  limit: '30mb',
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
    let role = authorised ? 'super_admin' : 'operations_officer';

    if (!authorised) {
      const adminUser = await adminDb.collection('adminUsers').doc(decoded.uid).get();
      const data = adminUser.exists ? adminUser.data() : null;
      authorised =
        Boolean(data) &&
        data?.active !== false &&
        (!data?.email || String(data.email).trim().toLowerCase() === email);
      if (authorised && data?.role) role = String(data.role);
    }

    if (!authorised) {
      return res.status(403).json({ error: 'This account is not authorised for ProInspect administration.' });
    }

    const permissionMap: Record<string, string[]> = {
      super_admin: ['*'],
      operations_manager: ['bookings','services','clients','tenants','operations','documents','payments','settings','audit'],
      operations_officer: ['bookings','clients','tenants','operations','documents'],
      inspector: ['bookings','operations','documents'],
      maintenance_coordinator: ['operations','clients','tenants','documents'],
      document_administrator: ['documents','clients','operations'],
      read_only: ['bookings','clients','tenants','operations','documents','audit'],
    };
    const permissions = permissionMap[role] || permissionMap.operations_officer;

    res.locals.admin = { uid: decoded.uid, email, role, permissions };
    return next();
  } catch (error) {
    console.error('Admin authentication failed:', error);
    return res.status(401).json({ error: 'Administrator session is invalid or has expired.' });
  }
}

async function requireTenant(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Tenant authentication is required.' });
    }

    const idToken = authHeader.slice(7).trim();
    const decoded = await adminAuth.verifyIdToken(idToken, true);
    const email = (decoded.email || '').trim().toLowerCase();

    if (!email || decoded.email_verified !== true) {
      return res.status(403).json({ error: 'A verified tenant email address is required.' });
    }

    const tenant = await findAndLinkTenantUser({
      uid: decoded.uid,
      email,
    });

    if (!tenant) {
      return res.status(403).json({
        error: 'This email address is not linked to an active ProInspect tenancy.',
      });
    }

    res.locals.tenant = tenant;
    return next();
  } catch (error) {
    console.error('Tenant authentication failed:', error);
    return res.status(401).json({ error: 'Tenant session is invalid or has expired.' });
  }
}

async function requireClient(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Client authentication is required.' });
    }

    const idToken = authHeader.slice(7).trim();
    const decoded = await adminAuth.verifyIdToken(idToken, true);
    const email = (decoded.email || '').trim().toLowerCase();

    if (!email || decoded.email_verified !== true) {
      return res.status(403).json({ error: 'A verified client email address is required.' });
    }

    const clientUser = await findAndLinkClientUser({
      uid: decoded.uid,
      email,
    });

    if (!clientUser) {
      return res.status(403).json({
        error: 'This email address is not linked to an active ProInspect client account.',
      });
    }

    res.locals.clientUser = clientUser;
    return next();
  } catch (error) {
    console.error('Client authentication failed:', error);
    return res.status(401).json({ error: 'Client session is invalid or has expired.' });
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

const SERVICE_CATEGORIES = new Set<ServiceCategory>([
  'residential',
  'commercial',
  'strata-building',
]);

function isServiceCategory(value: unknown): value is ServiceCategory {
  return (
    typeof value === 'string' &&
    SERVICE_CATEGORIES.has(value as ServiceCategory)
  );
}

const TENANT_REQUEST_TYPES = new Set<TenantRequestType>([
  'maintenance',
  'emergency_maintenance',
  'pet',
  'modification',
  'occupant',
  'inspection_access',
  'lease',
  'vacate',
  'complaint',
  'keys_access',
  'other',
]);

const TENANT_REQUEST_PRIORITIES = new Set<TenantRequestPriority>([
  'normal',
  'urgent',
  'emergency',
]);

const TENANT_REQUEST_STATUSES = new Set<TenantRequestStatus>([
  'submitted',
  'under_review',
  'action_required',
  'approved',
  'declined',
  'in_progress',
  'completed',
  'closed',
]);

const CLIENT_TYPES = new Set<ClientType>([
  'landlord',
  'agency',
  'commercial_landlord',
  'strata_company',
  'asset_manager',
  'other',
]);

const CLIENT_PROPERTY_ROLES = new Set<ClientPropertyRole>([
  'owner',
  'landlord',
  'managing_agent',
  'asset_manager',
  'strata_manager',
  'other',
]);

const PORTAL_AUDIENCES = new Set<PortalAudience>([
  'tenant',
  'client',
  'staff',
]);

const TENANT_DOCUMENT_CATEGORIES = new Set<TenantDocumentCategory>([
  'tenancy_agreement',
  'property_condition_report',
  'inspection_report',
  'bond',
  'inspection_notice',
  'rent_notice',
  'breach_notice',
  'variation',
  'pet_modification',
  'termination',
  'maintenance',
  'quote',
  'invoice',
  'compliance',
  'property_report',
  'owner_statement',
  'correspondence',
  'other',
]);

const TENANT_INSPECTION_TYPES = new Set<TenantInspection['type']>([
  'routine',
  'entry',
  'exit',
  'maintenance',
  'other',
]);

function sanitizeTenantRequestInput(input: unknown): {
  request?: TenantRequestCreateInput;
  error?: string;
} {
  if (!input || typeof input !== 'object') {
    return { error: 'Request details are required.' };
  }

  const value = input as Record<string, unknown>;
  const tenancyId = normalizeText(value.tenancyId, 128);
  const requestType = normalizeText(value.requestType, 64) as TenantRequestType;
  const title = normalizeText(value.title, 160);
  const details = normalizeText(value.details, 5000);
  const priority = (normalizeText(value.priority, 32) || 'normal') as TenantRequestPriority;
  const preferredAccessNotes = normalizeText(value.preferredAccessNotes, 1000);

  if (!tenancyId) return { error: 'Select a tenancy.' };
  if (!TENANT_REQUEST_TYPES.has(requestType)) return { error: 'Select a valid request type.' };
  if (title.length < 3) return { error: 'Request title must contain at least 3 characters.' };
  if (details.length < 5) return { error: 'Provide some details about the request.' };
  if (!TENANT_REQUEST_PRIORITIES.has(priority)) return { error: 'Select a valid priority.' };

  const payload: Record<string, string | number | boolean | null> = {};
  if (value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload)) {
    for (const [key, raw] of Object.entries(value.payload as Record<string, unknown>)) {
      const safeKey = key.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
      if (!safeKey) continue;
      if (typeof raw === 'string') payload[safeKey] = raw.trim().slice(0, 1000);
      else if (typeof raw === 'number' && Number.isFinite(raw)) payload[safeKey] = raw;
      else if (typeof raw === 'boolean' || raw === null) payload[safeKey] = raw;
    }
  }

  return {
    request: {
      tenancyId,
      requestType,
      title,
      details,
      priority,
      accessPermission: typeof value.accessPermission === 'boolean' ? value.accessPermission : undefined,
      preferredAccessNotes: preferredAccessNotes || undefined,
      payload,
    },
  };
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
  const categories = Array.isArray(value.categories)
    ? Array.from(
        new Set(
          value.categories.filter(isServiceCategory)
        )
      )
    : [];
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

  if (categories.length === 0) {
    return {
      error: 'Select at least one service category: Residential, Commercial or Strata / Building.',
    };
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
      categories,
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
    ...(booking.serviceCategory ? { serviceCategory: booking.serviceCategory } : {}),
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

app.post('/api/integrations/reports', reportFileBody, async (req, res) => {
  let savedPath: string | null = null;
  try {
    const expected = process.env.REPORT_INGEST_TOKEN?.trim();
    const supplied = normalizeText(req.headers['x-report-ingest-token'], 500);
    if (!expected || !supplied || supplied !== expected) {
      return res.status(401).json({ error:'Report integration authentication failed.' });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error:'Report file is required.' });
    }

    const propertyId = normalizeText(req.headers['x-property-id'],128);
    const title = normalizeText(req.headers['x-document-title'],180);
    const fileName = normalizeText(req.headers['x-file-name'],180);
    const category = normalizeText(req.headers['x-document-category'],80) as TenantDocumentCategory;
    const tenancyId = normalizeText(req.headers['x-tenancy-id'],128) || undefined;
    const bookingId = normalizeText(req.headers['x-booking-id'],128) || undefined;
    const audiences = normalizeText(req.headers['x-document-audiences'],100)
      .split(',').map((v)=>v.trim()).filter((v):v is PortalAudience => ['client','tenant','staff'].includes(v));

    if (!propertyId || !title || !fileName || !['property_condition_report','inspection_report','property_report'].includes(category)) {
      return res.status(400).json({ error:'Property, title, file name and supported report category are required.' });
    }

    const stored = await saveTenantDocumentFile({
      propertyId,
      tenancyId,
      fileName,
      contentType: req.headers['content-type'] || 'application/pdf',
      bytes: req.body,
    });
    savedPath = stored.storagePath;

    const document = await createTenantDocumentRecord({
      propertyId,
      tenancyId,
      audiences: audiences.length ? audiences : ['client'],
      title,
      category,
      fileName: stored.fileName,
      contentType: stored.contentType,
      size: stored.size,
      storagePath: stored.storagePath,
      uploadedBy:'report-generator',
    });

    await writeAuditEvent({
      entityType:'document',
      entityId:document.id,
      action:'report_ingested',
      summary:`Report ${document.title} received from Report Generator.`,
      actor:{ type:'integration', id:'report-generator' },
      propertyId,
      tenancyId,
      metadata: bookingId ? { bookingId } : undefined,
    });

    return res.status(201).json({ success:true, document });
  } catch (error) {
    if (savedPath) await deleteTenantFile(savedPath).catch(()=>undefined);
    console.error('Report ingest failed:', error);
    return res.status(500).json({ error:'Unable to ingest report.' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    calendarConfigured: calendarIsConfigured(),
    bookingEmailConfigured: bookingEmailIsConfigured(),
    sensitiveAccessEncryptionConfigured: accessEncryptionIsConfigured(),
    addressValidationMode: addressValidationMode(),
    tenantStorageConfigured: tenantStorageIsConfigured(),
    tenantPortalEmailConfigured: tenantPortalEmailIsConfigured(),
    reportIngestConfigured: Boolean(process.env.REPORT_INGEST_TOKEN?.trim()),
    paymentCheckoutConfigured: Boolean(process.env.PAYMENT_CHECKOUT_BASE_URL?.trim()),
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

app.get('/api/document-products', async (_req, res) => {
  try {
    const documents = await listDocumentProducts(true);
    return res.json({ documents });
  } catch (error) {
    console.error('Document catalogue load failed:', error);
    return res.status(500).json({ error: 'Unable to load document products.' });
  }
});

app.post('/api/document-requests', bookingRateLimit, async (req, res) => {
  try {
    const documentId = normalizeText(req.body?.documentId, 128);
    const category = normalizeText(req.body?.documentCategory, 40) as ServiceCategory;
    const details = req.body?.details || {};
    const product = await getDocumentProduct(documentId);

    if (!product || !product.active || !product.publiclyRequestable || !product.categories.includes(category)) {
      return res.status(400).json({ error: 'The selected document is not available.' });
    }

    const requesterName = normalizeText(details.customerName, 160);
    const requesterEmail = normalizeText(details.customerEmail, 254).toLowerCase();
    const requesterPhone = normalizeText(details.customerPhone, 40);
    const streetAddress = normalizeText(details.streetAddress, 180);
    const suburb = normalizeText(details.suburb, 100);
    const state = normalizeText(details.state, 10).toUpperCase();
    const postcode = normalizeText(details.postcode, 10);

    if (!requesterName || !isValidEmail(requesterEmail) || !requesterPhone || !streetAddress || !suburb || !postcode) {
      return res.status(400).json({ error: 'Valid contact and property details are required.' });
    }

    const request = await createDocumentRequest({
      product,
      category,
      propertyId: normalizeText(details.propertyId, 128) || undefined,
      clientId: normalizeText(details.clientId, 128) || undefined,
      clientUserId: normalizeText(details.clientUserId, 128) || undefined,
      requesterName,
      requesterEmail,
      requesterPhone,
      address: {
        streetAddress,
        unit: normalizeText(details.unit, 80) || undefined,
        suburb,
        state: state || 'WA',
        postcode,
      },
      notes: normalizeText(details.notes, 3000) || undefined,
    });
    return res.status(201).json({ success: true, request });
  } catch (error) {
    console.error('Document request creation failed:', error);
    return res.status(500).json({ error: 'Unable to submit the document request.' });
  }
});

app.post('/api/bookings/create', bookingRateLimit, async (req, res) => {
  let calendarEventId: string | undefined;
  let lockedBookingId: string | null = null;

  try {
    const { serviceId, serviceCategory, property, access, appointment } = req.body || {};

    if (!serviceId || !serviceCategory || !property || !access || !appointment?.start) {
      return res.status(400).json({ error: 'Missing mandatory booking information.' });
    }

    if (!isServiceCategory(serviceCategory)) {
      return res.status(400).json({ error: 'Invalid service category.' });
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

    if (!service.categories.includes(serviceCategory)) {
      return res.status(400).json({
        error: 'The selected service is not available for that property category.',
      });
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
      serviceCategory,
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

app.get('/api/tenant/session', tenantRateLimit, requireTenant, (_req, res) => {
  const tenant = res.locals.tenant as TenantUserRecord;
  return res.json({
    authorised: true,
    tenant: {
      id: tenant.id,
      email: tenant.email,
      displayName: tenant.displayName,
      phone: tenant.phone,
    },
  });
});

app.get('/api/tenant/dashboard', tenantRateLimit, requireTenant, async (_req, res) => {
  try {
    const tenant = res.locals.tenant as TenantUserRecord;
    const dashboard = await getTenantPortalDashboard(tenant);
    return res.json({ dashboard });
  } catch (error) {
    console.error('Tenant dashboard load failed:', error);
    return res.status(500).json({ error: 'Unable to load the tenant portal.' });
  }
});

app.post('/api/tenant/requests', tenantWriteRateLimit, requireTenant, async (req, res) => {
  try {
    const tenant = res.locals.tenant as TenantUserRecord;
    const parsed = sanitizeTenantRequestInput(req.body);

    if (!parsed.request) {
      return res.status(400).json({ error: parsed.error || 'Invalid tenant request.' });
    }

    const request = await createTenantRequest(tenant, parsed.request);

    sendTenantRequestReceiptEmail({
      tenant,
      request,
      portalUrl: `${publicBaseUrl(req)}/tenant`,
    }).catch((emailError) => {
      console.error('Tenant request receipt email failed:', emailError);
    });

    return res.status(201).json({ success: true, request });
  } catch (error) {
    if (error instanceof Error && error.message === 'TENANCY_NOT_AUTHORISED') {
      return res.status(403).json({ error: 'You do not have access to that tenancy.' });
    }
    if (error instanceof Error && error.message === 'TENANCY_ENDED') {
      return res.status(409).json({ error: 'Requests cannot be submitted against an ended tenancy.' });
    }
    console.error('Tenant request creation failed:', error);
    return res.status(500).json({ error: 'Unable to submit the request.' });
  }
});

app.post(
  '/api/tenant/requests/:id/attachments',
  tenantWriteRateLimit,
  requireTenant,
  tenantFileBody,
  async (req, res) => {
    let savedPath: string | null = null;
    try {
      const tenant = res.locals.tenant as TenantUserRecord;
      const request = await getTenantRequestForUser(tenant, req.params.id);
      if (!request) {
        return res.status(404).json({ error: 'Tenant request not found.' });
      }

      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'Choose a file to upload.' });
      }

      const fileName = normalizeText(req.headers['x-file-name'], 160);
      if (!fileName) {
        return res.status(400).json({ error: 'File name is required.' });
      }

      const stored = await saveTenantRequestAttachment({
        requestId: request.id,
        fileName,
        contentType: req.headers['content-type'] || 'application/octet-stream',
        bytes: req.body,
      });
      savedPath = stored.storagePath;

      const updated = await addTenantRequestAttachment(request.id, {
        id: randomBytes(12).toString('hex'),
        fileName: stored.fileName,
        contentType: stored.contentType,
        size: stored.size,
        uploadedAt: new Date().toISOString(),
        storagePath: stored.storagePath,
      });

      return res.status(201).json({ success: true, request: updated });
    } catch (error) {
      if (savedPath) {
        await deleteTenantFile(savedPath).catch(() => undefined);
      }
      if (error instanceof Error && error.message === 'TENANT_STORAGE_NOT_CONFIGURED') {
        return res.status(503).json({ error: 'Tenant document storage is not configured.' });
      }
      if (error instanceof Error && error.message === 'TENANT_FILE_TYPE_NOT_ALLOWED') {
        return res.status(400).json({ error: 'That file type is not supported.' });
      }
      if (error instanceof Error && error.message === 'TENANT_FILE_SIZE_INVALID') {
        return res.status(400).json({ error: 'Files must be no larger than 20 MB.' });
      }
      console.error('Tenant attachment upload failed:', error);
      return res.status(500).json({ error: 'Unable to upload the attachment.' });
    }
  }
);

app.get(
  '/api/tenant/requests/:requestId/attachments/:attachmentId/download',
  tenantRateLimit,
  requireTenant,
  async (req, res) => {
    try {
      const tenant = res.locals.tenant as TenantUserRecord;
      const attachment = await getTenantRequestAttachmentForUser(
        tenant,
        req.params.requestId,
        req.params.attachmentId
      );
      if (!attachment) {
        return res.status(404).json({ error: 'Attachment not found.' });
      }
      const url = await signedTenantFileUrl(attachment.storagePath);
      return res.json({ url });
    } catch (error) {
      console.error('Tenant attachment download failed:', error);
      return res.status(500).json({ error: 'Unable to open the attachment.' });
    }
  }
);

app.get('/api/tenant/documents/:id/download', tenantRateLimit, requireTenant, async (req, res) => {
  try {
    const tenant = res.locals.tenant as TenantUserRecord;
    const document = await getTenantDocumentForUser(tenant, req.params.id);
    if (!document?.storagePath) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const url = await signedTenantFileUrl(document.storagePath);
    return res.json({ url });
  } catch (error) {
    console.error('Tenant document download failed:', error);
    return res.status(500).json({ error: 'Unable to open the document.' });
  }
});

app.get('/api/client/session', clientRateLimit, requireClient, (_req, res) => {
  const clientUser = res.locals.clientUser as ClientUserRecord;
  return res.json({
    authorised: true,
    clientUser: {
      id: clientUser.id,
      email: clientUser.email,
      displayName: clientUser.displayName,
      phone: clientUser.phone,
    },
  });
});

app.get('/api/client/dashboard', clientRateLimit, requireClient, async (_req, res) => {
  try {
    const clientUser = res.locals.clientUser as ClientUserRecord;
    const base = await getClientPortalDashboard(clientUser);
    const dashboard = await buildUnifiedClientDashboard({
      user: clientUser,
      clients: base.clients,
      properties: base.properties,
      propertyLinks: base.propertyLinks,
      documents: base.documents,
    });
    return res.json({ dashboard });
  } catch (error) {
    console.error('Client dashboard load failed:', error);
    return res.status(500).json({ error: 'Unable to load the client portal.' });
  }
});

app.get('/api/client/documents/:id/download', clientRateLimit, requireClient, async (req, res) => {
  try {
    const clientUser = res.locals.clientUser as ClientUserRecord;
    const document = await getClientDocumentForUser(clientUser, req.params.id);
    if (!document?.storagePath) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const url = await signedTenantFileUrl(document.storagePath);
    return res.json({ url });
  } catch (error) {
    console.error('Client document download failed:', error);
    return res.status(500).json({ error: 'Unable to open the document.' });
  }
});

app.post('/api/client/requests', clientRateLimit, requireClient, async (req, res) => {
  try {
    const user = res.locals.clientUser as ClientUserRecord;
    const clientId = normalizeText(req.body?.clientId, 128);
    const type = normalizeText(req.body?.type, 32) as 'maintenance' | 'document' | 'general';
    const title = normalizeText(req.body?.title, 180);
    const details = normalizeText(req.body?.details, 5000);
    const propertyId = normalizeText(req.body?.propertyId, 128) || undefined;
    const priority = normalizeText(req.body?.priority, 20) as 'routine' | 'priority' | 'urgent';

    if (!clientId || !['maintenance','document','general'].includes(type) || title.length < 3 || details.length < 5) {
      return res.status(400).json({ error: 'Client, request type, title and details are required.' });
    }

    const request = await createClientRequestRecord({
      clientUser: user,
      clientId,
      propertyId,
      type,
      title,
      details,
      priority: ['routine','priority','urgent'].includes(priority) ? priority : 'routine',
      payload: req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {},
    });
    return res.status(201).json({ success: true, request });
  } catch (error) {
    if (error instanceof Error && ['CLIENT_NOT_AUTHORISED','PROPERTY_NOT_AUTHORISED'].includes(error.message)) {
      return res.status(403).json({ error: 'This request is not authorised for the selected client or property.' });
    }
    console.error('Client request creation failed:', error);
    return res.status(500).json({ error: 'Unable to submit the request.' });
  }
});

app.post('/api/client/approvals/:id/respond', clientRateLimit, requireClient, async (req, res) => {
  try {
    const status = normalizeText(req.body?.status, 32) as 'approved' | 'changes_requested' | 'declined';
    if (!['approved','changes_requested','declined'].includes(status)) {
      return res.status(400).json({ error: 'Select a valid approval response.' });
    }
    const approval = await respondApproval({
      approvalId: req.params.id,
      user: res.locals.clientUser as ClientUserRecord,
      status,
      comment: normalizeText(req.body?.comment, 3000) || undefined,
    });
    if (!approval) return res.status(404).json({ error: 'Approval not found.' });
    return res.json({ success: true, approval });
  } catch (error) {
    if (error instanceof Error && error.message === 'CLIENT_NOT_AUTHORISED') {
      return res.status(403).json({ error: 'This approval is not available to this account.' });
    }
    console.error('Client approval response failed:', error);
    return res.status(500).json({ error: 'Unable to save the approval response.' });
  }
});

app.post('/api/client/notifications/:id/read', clientRateLimit, requireClient, async (req, res) => {
  const user = res.locals.clientUser as ClientUserRecord;
  const notification = await markNotificationRead(req.params.id, user.id);
  if (!notification) return res.status(404).json({ error: 'Notification not found.' });
  return res.json({ success: true, notification });
});

app.get('/api/admin/session', requireAdmin, (_req, res) => {
  return res.json({
    authorised: true,
    role: res.locals.admin.role,
    permissions: res.locals.admin.permissions,
  });
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

app.get('/api/admin/operations', requireAdmin, async (_req, res) => {
  try {
    const data = await listAdminOperations();
    return res.json(data);
  } catch (error) {
    console.error('Operations queue load failed:', error);
    return res.status(500).json({ error: 'Unable to load operations.' });
  }
});

app.post('/api/admin/contractors', requireAdmin, async (req, res) => {
  try {
    const name = normalizeText(req.body?.name, 180);
    if (name.length < 2) return res.status(400).json({ error: 'Contractor name is required.' });
    const contractor = await createContractor({
      name,
      trade: normalizeText(req.body?.trade, 100) || undefined,
      email: normalizeText(req.body?.email, 254).toLowerCase() || undefined,
      phone: normalizeText(req.body?.phone, 40) || undefined,
      notes: normalizeText(req.body?.notes, 2000) || undefined,
    });
    return res.status(201).json({ success:true, contractor });
  } catch (error) {
    console.error('Contractor creation failed:', error);
    return res.status(500).json({ error: 'Unable to create contractor.' });
  }
});

app.post('/api/admin/work-orders', requireAdmin, async (req, res) => {
  try {
    const propertyId = normalizeText(req.body?.propertyId, 128);
    const title = normalizeText(req.body?.title, 180);
    const description = normalizeText(req.body?.description, 5000);
    if (!propertyId || title.length < 3 || description.length < 5) {
      return res.status(400).json({ error: 'Property, title and description are required.' });
    }
    const workOrder = await createWorkOrder({
      sourceType: ['tenant_request','client_request','booking','manual'].includes(req.body?.sourceType)
        ? req.body.sourceType
        : 'manual',
      sourceId: normalizeText(req.body?.sourceId,128) || undefined,
      propertyId,
      clientId: normalizeText(req.body?.clientId,128) || undefined,
      tenancyId: normalizeText(req.body?.tenancyId,128) || undefined,
      title,
      description,
      priority: ['routine','priority','urgent','emergency'].includes(req.body?.priority)
        ? req.body.priority
        : 'routine',
      accessNotes: normalizeText(req.body?.accessNotes,2000) || undefined,
      createdBy: res.locals.admin.email,
    });
    return res.status(201).json({ success:true, workOrder });
  } catch (error) {
    if (error instanceof Error && error.message === 'PROPERTY_NOT_FOUND') {
      return res.status(404).json({ error:'Property not found.' });
    }
    console.error('Work order creation failed:', error);
    return res.status(500).json({ error:'Unable to create work order.' });
  }
});

app.patch('/api/admin/work-orders/:id', requireAdmin, async (req, res) => {
  try {
    const status = normalizeText(req.body?.status,32) as WorkOrderStatus;
    const workOrder = await updateWorkOrder(req.params.id, {
      status: status && ['triage','quote_required','awaiting_approval','approved','assigned','scheduled','in_progress','completed','cancelled'].includes(status) ? status : undefined,
      contractorId: normalizeText(req.body?.contractorId,128) || undefined,
      quoteAmountExGst: Number.isFinite(Number(req.body?.quoteAmountExGst)) ? Number(req.body.quoteAmountExGst) : undefined,
      quoteDocumentId: normalizeText(req.body?.quoteDocumentId,128) || undefined,
      invoiceDocumentId: normalizeText(req.body?.invoiceDocumentId,128) || undefined,
      scheduledStart: normalizeText(req.body?.scheduledStart,60) || undefined,
      scheduledEnd: normalizeText(req.body?.scheduledEnd,60) || undefined,
      accessNotes: req.body?.accessNotes === undefined ? undefined : normalizeText(req.body.accessNotes,2000),
      completionNotes: req.body?.completionNotes === undefined ? undefined : normalizeText(req.body.completionNotes,3000),
      completionDocumentIds: Array.isArray(req.body?.completionDocumentIds) ? req.body.completionDocumentIds.filter((x:unknown):x is string => typeof x === 'string') : undefined,
    }, { type:'staff', id:res.locals.admin.uid, email:res.locals.admin.email });
    if (!workOrder) return res.status(404).json({ error:'Work order not found.' });
    return res.json({ success:true, workOrder });
  } catch (error) {
    console.error('Work order update failed:', error);
    return res.status(500).json({ error:'Unable to update work order.' });
  }
});

app.post('/api/admin/approvals', requireAdmin, async (req, res) => {
  try {
    const clientId = normalizeText(req.body?.clientId,128);
    const title = normalizeText(req.body?.title,180);
    if (!clientId || title.length < 3) return res.status(400).json({ error:'Client and approval title are required.' });
    const approval = await createApproval({
      clientId,
      propertyId: normalizeText(req.body?.propertyId,128) || undefined,
      clientUserId: normalizeText(req.body?.clientUserId,128) || undefined,
      workOrderId: normalizeText(req.body?.workOrderId,128) || undefined,
      documentId: normalizeText(req.body?.documentId,128) || undefined,
      requestId: normalizeText(req.body?.requestId,128) || undefined,
      type: ['quote','document','instruction','other'].includes(req.body?.type) ? req.body.type : 'other',
      title,
      summary: normalizeText(req.body?.summary,3000) || undefined,
      amountExGst: Number.isFinite(Number(req.body?.amountExGst)) ? Number(req.body.amountExGst) : undefined,
      requestedBy: res.locals.admin.email,
    });
    if (approval.clientUserId) {
      await createNotification({
        audience:'client',
        clientUserId:approval.clientUserId,
        clientId:approval.clientId,
        propertyId:approval.propertyId,
        title:'Approval required',
        message:approval.title,
        link:'/client/approvals',
      });
    }
    if (approval.workOrderId) {
      await updateWorkOrder(approval.workOrderId, { status:'awaiting_approval', approvalId: approval.id } as any, { type:'staff', email:res.locals.admin.email });
    }
    return res.status(201).json({ success:true, approval });
  } catch (error) {
    console.error('Approval creation failed:', error);
    return res.status(500).json({ error:'Unable to create approval.' });
  }
});

app.patch('/api/admin/client-requests/:id', requireAdmin, async (req, res) => {
  const status = normalizeText(req.body?.status,32) as ClientRequestStatus;
  const request = await updateClientRequestRecord(req.params.id, {
    status: status && ['submitted','under_review','awaiting_client','approved','in_progress','completed','cancelled'].includes(status) ? status : undefined,
    adminNotes: req.body?.adminNotes === undefined ? undefined : normalizeText(req.body.adminNotes,3000),
  }, { type:'staff', id:res.locals.admin.uid, email:res.locals.admin.email });
  if (!request) return res.status(404).json({ error:'Client request not found.' });
  return res.json({ success:true, request });
});

app.patch('/api/admin/document-requests/:id', requireAdmin, async (req, res) => {
  const status = normalizeText(req.body?.status,40) as DocumentRequestStatus;
  const request = await updateDocumentRequest(req.params.id, {
    status: status && ['submitted','under_review','awaiting_information','in_preparation','ready','completed','cancelled'].includes(status) ? status : undefined,
    generatedDocumentId: normalizeText(req.body?.generatedDocumentId,128) || undefined,
    propertyId: normalizeText(req.body?.propertyId,128) || undefined,
    clientId: normalizeText(req.body?.clientId,128) || undefined,
  }, { type:'staff', id:res.locals.admin.uid, email:res.locals.admin.email });
  if (!request) return res.status(404).json({ error:'Document request not found.' });
  return res.json({ success:true, request });
});

app.patch('/api/admin/payments/:id', requireAdmin, async (req, res) => {
  const status = normalizeText(req.body?.status,32) as PaymentStatus;
  if (!['pending','payment_required','paid','failed','refunded','waived'].includes(status)) {
    return res.status(400).json({ error:'Invalid payment status.' });
  }
  const payment = await updatePaymentStatus(req.params.id, status, {
    type:'staff', id:res.locals.admin.uid, email:res.locals.admin.email,
  });
  if (!payment) return res.status(404).json({ error:'Payment not found.' });
  return res.json({ success:true, payment });
});

app.get('/api/admin/audit', requireAdmin, async (req, res) => {
  try {
    const events = await listAuditEvents({
      entityType: typeof req.query.entityType === 'string' ? req.query.entityType as any : undefined,
      entityId: typeof req.query.entityId === 'string' ? req.query.entityId : undefined,
      propertyId: typeof req.query.propertyId === 'string' ? req.query.propertyId : undefined,
      limit: Math.min(200, Math.max(1, Number(req.query.limit || 100))),
    });
    return res.json({ events });
  } catch (error) {
    console.error('Audit load failed:', error);
    return res.status(500).json({ error:'Unable to load audit history.' });
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

app.get('/api/admin/tenant-portal', requireAdmin, async (_req, res) => {
  try {
    const snapshot = await listAdminTenantPortal();
    return res.json({ snapshot });
  } catch (error) {
    console.error('Admin tenant portal load failed:', error);
    return res.status(500).json({ error: 'Unable to load tenant portal data.' });
  }
});

app.post('/api/admin/clients', requireAdmin, async (req, res) => {
  try {
    const name = normalizeText(req.body?.name, 180);
    const clientType = normalizeText(req.body?.clientType, 40) as ClientType;
    const email = normalizeText(req.body?.email, 254).toLowerCase();

    if (name.length < 2 || !CLIENT_TYPES.has(clientType) || (email && !isValidEmail(email))) {
      return res.status(400).json({ error: 'Client name, valid client type and optional valid email are required.' });
    }

    const client = await createClient({
      name,
      clientType,
      email: email || undefined,
      phone: normalizeText(req.body?.phone, 40) || undefined,
      externalReference: normalizeText(req.body?.externalReference, 100) || undefined,
    });
    return res.status(201).json({ success: true, client });
  } catch (error) {
    console.error('Admin client creation failed:', error);
    return res.status(500).json({ error: 'Unable to create the client.' });
  }
});

app.post('/api/admin/client-users', requireAdmin, async (req, res) => {
  try {
    const email = normalizeText(req.body?.email, 254).toLowerCase();
    const displayName = normalizeText(req.body?.displayName, 160);
    const clientIds = Array.isArray(req.body?.clientIds)
      ? req.body.clientIds
          .filter((id: unknown): id is string => typeof id === 'string')
          .map((id: string) => id.trim())
          .filter(Boolean)
      : [];

    if (!isValidEmail(email) || displayName.length < 2 || clientIds.length === 0) {
      return res.status(400).json({
        error: 'Client user name, valid email and at least one client are required.',
      });
    }

    const clientUser = await createClientUser({
      email,
      displayName,
      phone: normalizeText(req.body?.phone, 40) || undefined,
      clientIds,
    });

    return res.status(201).json({
      success: true,
      clientUser,
      portalUrl: `${publicBaseUrl(req)}/client`,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'CLIENT_USER_EMAIL_EXISTS') {
      return res.status(409).json({ error: 'A client portal user already exists for that email address.' });
    }
    if (error instanceof Error && error.message === 'CLIENT_NOT_FOUND') {
      return res.status(404).json({ error: 'One or more selected clients no longer exist.' });
    }
    console.error('Admin client user creation failed:', error);
    return res.status(500).json({ error: 'Unable to create the client portal user.' });
  }
});

app.post('/api/admin/client-property-links', requireAdmin, async (req, res) => {
  try {
    const clientId = normalizeText(req.body?.clientId, 128);
    const propertyId = normalizeText(req.body?.propertyId, 128);
    const role = normalizeText(req.body?.role, 40) as ClientPropertyRole;

    if (!clientId || !propertyId || !CLIENT_PROPERTY_ROLES.has(role)) {
      return res.status(400).json({ error: 'Client, property and valid relationship role are required.' });
    }

    const link = await createClientPropertyLink({
      clientId,
      propertyId,
      role,
      primary: Boolean(req.body?.primary),
    });
    return res.status(201).json({ success: true, link });
  } catch (error) {
    if (error instanceof Error && error.message === 'CLIENT_NOT_FOUND') {
      return res.status(404).json({ error: 'Client not found.' });
    }
    if (error instanceof Error && error.message === 'PROPERTY_NOT_FOUND') {
      return res.status(404).json({ error: 'Property not found.' });
    }
    console.error('Admin client-property link creation failed:', error);
    return res.status(500).json({ error: 'Unable to link the client to the property.' });
  }
});

app.post('/api/admin/tenant-properties', requireAdmin, async (req, res) => {
  try {
    const streetAddress = normalizeText(req.body?.streetAddress, 160);
    const suburb = normalizeText(req.body?.suburb, 100);
    const state = normalizeText(req.body?.state, 10).toUpperCase();
    const postcode = normalizeText(req.body?.postcode, 10);

    if (!streetAddress || !suburb || !/^[A-Z]{2,3}$/.test(state) || !/^\d{4}$/.test(postcode)) {
      return res.status(400).json({ error: 'A valid Australian property address is required.' });
    }

    const property = await createTenantProperty({
      streetAddress,
      unit: normalizeText(req.body?.unit, 40) || undefined,
      suburb,
      state,
      postcode,
      propertyType: normalizeText(req.body?.propertyType, 80) || undefined,
      primaryClientId: normalizeText(req.body?.primaryClientId, 128) || undefined,
      clientName: normalizeText(req.body?.clientName, 160) || undefined,
      clientReference: normalizeText(req.body?.clientReference, 100) || undefined,
    });

    return res.status(201).json({ success: true, property });
  } catch (error) {
    if (error instanceof Error && error.message === 'CLIENT_NOT_FOUND') {
      return res.status(404).json({ error: 'Client not found.' });
    }
    console.error('Admin tenant property creation failed:', error);
    return res.status(500).json({ error: 'Unable to create the property.' });
  }
});

app.post('/api/admin/tenancies', requireAdmin, async (req, res) => {
  try {
    const propertyId = normalizeText(req.body?.propertyId, 128);
    const startDate = normalizeText(req.body?.startDate, 20);
    const endDate = normalizeText(req.body?.endDate, 20);
    const rentAmount =
      req.body?.rentAmount === undefined || req.body?.rentAmount === ''
        ? undefined
        : Number(req.body.rentAmount);

    if (!propertyId || !isValidDateKey(startDate) || (endDate && !isValidDateKey(endDate))) {
      return res.status(400).json({ error: 'Property and valid tenancy dates are required.' });
    }

    if (rentAmount !== undefined && (!Number.isFinite(rentAmount) || rentAmount < 0)) {
      return res.status(400).json({ error: 'Rent amount must be a valid positive number.' });
    }

    const frequency = normalizeText(req.body?.rentFrequency, 20) as
      | 'weekly'
      | 'fortnightly'
      | 'monthly'
      | '';
    if (frequency && !['weekly', 'fortnightly', 'monthly'].includes(frequency)) {
      return res.status(400).json({ error: 'Invalid rent frequency.' });
    }

    const tenancy = await createTenancy({
      propertyId,
      startDate,
      endDate: endDate || undefined,
      rentAmount,
      rentFrequency: frequency || undefined,
      bondReference: normalizeText(req.body?.bondReference, 100) || undefined,
      notes: normalizeText(req.body?.notes, 2000) || undefined,
      status: ['pending', 'active', 'ended'].includes(req.body?.status)
        ? req.body.status
        : 'active',
    });

    return res.status(201).json({ success: true, tenancy });
  } catch (error) {
    if (error instanceof Error && error.message === 'PROPERTY_NOT_FOUND') {
      return res.status(404).json({ error: 'Property not found.' });
    }
    console.error('Admin tenancy creation failed:', error);
    return res.status(500).json({ error: 'Unable to create the tenancy.' });
  }
});

app.post('/api/admin/tenant-users', requireAdmin, async (req, res) => {
  try {
    const email = normalizeText(req.body?.email, 254).toLowerCase();
    const displayName = normalizeText(req.body?.displayName, 160);
    const tenancyIds = Array.isArray(req.body?.tenancyIds)
      ? req.body.tenancyIds
          .filter((id: unknown): id is string => typeof id === 'string')
          .map((id: string) => id.trim())
          .filter(Boolean)
      : [];

    if (!isValidEmail(email) || displayName.length < 2 || tenancyIds.length === 0) {
      return res.status(400).json({
        error: 'Tenant name, valid email address and at least one tenancy are required.',
      });
    }

    const tenant = await createTenantUser({
      email,
      displayName,
      phone: normalizeText(req.body?.phone, 40) || undefined,
      tenancyIds,
    });

    return res.status(201).json({
      success: true,
      tenant,
      portalUrl: `${publicBaseUrl(req)}/tenant`,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'TENANT_EMAIL_EXISTS') {
      return res.status(409).json({ error: 'A tenant portal user already exists for that email address.' });
    }
    if (error instanceof Error && error.message === 'TENANCY_NOT_FOUND') {
      return res.status(404).json({ error: 'One or more selected tenancies no longer exist.' });
    }
    console.error('Admin tenant user creation failed:', error);
    return res.status(500).json({ error: 'Unable to create the tenant user.' });
  }
});

app.patch('/api/admin/tenancies/:id', requireAdmin, async (req, res) => {
  try {
    const rawStatus = normalizeText(req.body?.status, 20);
    const status = rawStatus
      ? (rawStatus as 'pending' | 'active' | 'ended')
      : undefined;
    if (status && !['pending', 'active', 'ended'].includes(status)) {
      return res.status(400).json({ error: 'Invalid tenancy status.' });
    }

    const rawEndDate = req.body?.endDate === undefined
      ? undefined
      : normalizeText(req.body.endDate, 20);

    if (rawEndDate && !isValidDateKey(rawEndDate)) {
      return res.status(400).json({ error: 'End date must be a valid date.' });
    }

    const tenancy = await updateTenancyAdmin(req.params.id, {
      status,
      endDate: rawEndDate || undefined,
      notes:
        req.body?.notes === undefined
          ? undefined
          : normalizeText(req.body.notes, 2000),
    });

    if (!tenancy) return res.status(404).json({ error: 'Tenancy not found.' });
    return res.json({ success: true, tenancy });
  } catch (error) {
    console.error('Admin tenancy update failed:', error);
    return res.status(500).json({ error: 'Unable to update the tenancy.' });
  }
});

app.patch('/api/admin/tenant-users/:id', requireAdmin, async (req, res) => {
  try {
    const tenancyIds = req.body?.tenancyIds === undefined
      ? undefined
      : Array.isArray(req.body.tenancyIds)
        ? req.body.tenancyIds
            .filter((id: unknown): id is string => typeof id === 'string')
            .map((id: string) => id.trim())
            .filter(Boolean)
        : null;

    if (tenancyIds === null || (tenancyIds && tenancyIds.length === 0)) {
      return res.status(400).json({ error: 'Tenant access must retain at least one tenancy.' });
    }

    const tenant = await updateTenantUserAdmin(req.params.id, {
      active: typeof req.body?.active === 'boolean' ? req.body.active : undefined,
      displayName:
        req.body?.displayName === undefined
          ? undefined
          : normalizeText(req.body.displayName, 160),
      phone:
        req.body?.phone === undefined
          ? undefined
          : normalizeText(req.body.phone, 40),
      tenancyIds: tenancyIds || undefined,
    });

    if (!tenant) return res.status(404).json({ error: 'Tenant user not found.' });
    return res.json({ success: true, tenant });
  } catch (error) {
    if (error instanceof Error && error.message === 'TENANCY_NOT_FOUND') {
      return res.status(404).json({ error: 'One or more selected tenancies no longer exist.' });
    }
    console.error('Admin tenant user update failed:', error);
    return res.status(500).json({ error: 'Unable to update tenant access.' });
  }
});

app.patch('/api/admin/tenant-requests/:id', requireAdmin, async (req, res) => {
  try {
    const rawStatus = normalizeText(req.body?.status, 40);
    const status = rawStatus ? (rawStatus as TenantRequestStatus) : undefined;
    if (status && !TENANT_REQUEST_STATUSES.has(status)) {
      return res.status(400).json({ error: 'Invalid tenant request status.' });
    }

    const request = await updateTenantRequestAdmin(req.params.id, {
      status,
      adminNotes:
        req.body?.adminNotes === undefined
          ? undefined
          : normalizeText(req.body.adminNotes, 3000),
    });

    if (!request) return res.status(404).json({ error: 'Tenant request not found.' });

    if (status) {
      const tenant = await getTenantUserById(request.tenantUserId);
      if (tenant?.active) {
        sendTenantRequestStatusEmail({
          tenant,
          request,
          portalUrl: `${publicBaseUrl(req)}/tenant`,
        }).catch((emailError) => {
          console.error('Tenant request status email failed:', emailError);
        });
      }
    }

    return res.json({ success: true, request });
  } catch (error) {
    console.error('Admin tenant request update failed:', error);
    return res.status(500).json({ error: 'Unable to update the tenant request.' });
  }
});

app.post(
  '/api/admin/property-documents/:propertyId',
  requireAdmin,
  tenantFileBody,
  async (req, res) => {
    let savedPath: string | null = null;
    try {
      const propertyDoc = await adminDb.collection('properties').doc(req.params.propertyId).get();
      if (!propertyDoc.exists) return res.status(404).json({ error: 'Property not found.' });

      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'Choose a file to upload.' });
      }

      const title = normalizeText(req.headers['x-document-title'], 180);
      const fileName = normalizeText(req.headers['x-file-name'], 160);
      const category = normalizeText(req.headers['x-document-category'], 64) as TenantDocumentCategory;
      const tenancyId = normalizeText(req.headers['x-tenancy-id'], 128) || undefined;
      const audiences = normalizeText(req.headers['x-document-audiences'], 100)
        .split(',')
        .map((value) => value.trim())
        .filter((value): value is PortalAudience => PORTAL_AUDIENCES.has(value as PortalAudience));
      const clientIds = normalizeText(req.headers['x-client-ids'], 1000)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

      if (!title || !fileName || !TENANT_DOCUMENT_CATEGORIES.has(category)) {
        return res.status(400).json({ error: 'Document title, category and file name are required.' });
      }

      if (audiences.length === 0) {
        return res.status(400).json({ error: 'Select at least one document audience.' });
      }

      const stored = await saveTenantDocumentFile({
        propertyId: req.params.propertyId,
        tenancyId,
        fileName,
        contentType: req.headers['content-type'] || 'application/octet-stream',
        bytes: req.body,
      });
      savedPath = stored.storagePath;

      const document = await createTenantDocumentRecord({
        propertyId: req.params.propertyId,
        tenancyId,
        clientIds,
        audiences,
        title,
        category,
        fileName: stored.fileName,
        contentType: stored.contentType,
        size: stored.size,
        storagePath: stored.storagePath,
        uploadedBy: res.locals.admin.email,
      });

      return res.status(201).json({ success: true, document });
    } catch (error) {
      if (savedPath) await deleteTenantFile(savedPath).catch(() => undefined);
      if (error instanceof Error && error.message === 'TENANCY_PROPERTY_MISMATCH') {
        return res.status(400).json({ error: 'The selected tenancy does not belong to this property.' });
      }
      if (error instanceof Error && error.message === 'CLIENT_PROPERTY_MISMATCH') {
        return res.status(400).json({ error: 'One or more selected clients are not linked to this property.' });
      }
      if (error instanceof Error && error.message === 'TENANT_STORAGE_NOT_CONFIGURED') {
        return res.status(503).json({ error: 'Property document storage is not configured.' });
      }
      if (error instanceof Error && error.message === 'TENANT_FILE_TYPE_NOT_ALLOWED') {
        return res.status(400).json({ error: 'That file type is not supported.' });
      }
      if (error instanceof Error && error.message === 'TENANT_FILE_SIZE_INVALID') {
        return res.status(400).json({ error: 'Files must be no larger than 20 MB.' });
      }
      console.error('Admin property document upload failed:', error);
      return res.status(500).json({ error: 'Unable to upload the property document.' });
    }
  }
);

app.post(
  '/api/admin/tenant-documents/:tenancyId',
  requireAdmin,
  tenantFileBody,
  async (req, res) => {
    let savedPath: string | null = null;
    try {
      const tenancy = await getTenancyById(req.params.tenancyId);
      if (!tenancy) return res.status(404).json({ error: 'Tenancy not found.' });

      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'Choose a file to upload.' });
      }

      const title = normalizeText(req.headers['x-document-title'], 180);
      const fileName = normalizeText(req.headers['x-file-name'], 160);
      const category = normalizeText(req.headers['x-document-category'], 64) as TenantDocumentCategory;

      if (!title || !fileName || !TENANT_DOCUMENT_CATEGORIES.has(category)) {
        return res.status(400).json({ error: 'Document title, category and file name are required.' });
      }

      const stored = await saveTenantDocumentFile({
        propertyId: tenancy.propertyId,
        tenancyId: tenancy.id,
        fileName,
        contentType: req.headers['content-type'] || 'application/octet-stream',
        bytes: req.body,
      });
      savedPath = stored.storagePath;

      const document = await createTenantDocumentRecord({
        tenancyId: tenancy.id,
        propertyId: tenancy.propertyId,
        audiences: ['tenant'],
        title,
        category,
        fileName: stored.fileName,
        contentType: stored.contentType,
        size: stored.size,
        storagePath: stored.storagePath,
        uploadedBy: res.locals.admin.email,
      });

      return res.status(201).json({ success: true, document });
    } catch (error) {
      if (savedPath) await deleteTenantFile(savedPath).catch(() => undefined);
      if (error instanceof Error && error.message === 'TENANT_STORAGE_NOT_CONFIGURED') {
        return res.status(503).json({ error: 'Tenant document storage is not configured.' });
      }
      if (error instanceof Error && error.message === 'TENANT_FILE_TYPE_NOT_ALLOWED') {
        return res.status(400).json({ error: 'That file type is not supported.' });
      }
      if (error instanceof Error && error.message === 'TENANT_FILE_SIZE_INVALID') {
        return res.status(400).json({ error: 'Files must be no larger than 20 MB.' });
      }
      console.error('Admin tenant document upload failed:', error);
      return res.status(500).json({ error: 'Unable to upload the tenant document.' });
    }
  }
);

app.post('/api/admin/tenant-inspections', requireAdmin, async (req, res) => {
  try {
    const tenancyId = normalizeText(req.body?.tenancyId, 128);
    const propertyId = normalizeText(req.body?.propertyId, 128);
    const type = normalizeText(req.body?.type, 40) as TenantInspection['type'];
    const scheduledStart = normalizeText(req.body?.scheduledStart, 80);
    const scheduledEnd = normalizeText(req.body?.scheduledEnd, 80);

    if (
      !tenancyId ||
      !propertyId ||
      !TENANT_INSPECTION_TYPES.has(type) ||
      !scheduledStart ||
      Number.isNaN(Date.parse(scheduledStart)) ||
      (scheduledEnd && Number.isNaN(Date.parse(scheduledEnd)))
    ) {
      return res.status(400).json({ error: 'Valid tenancy, property, inspection type and schedule are required.' });
    }

    const inspection = await createTenantInspection({
      tenancyId,
      propertyId,
      type,
      scheduledStart,
      scheduledEnd: scheduledEnd || undefined,
      noticeDocumentId: normalizeText(req.body?.noticeDocumentId, 128) || undefined,
      notes: normalizeText(req.body?.notes, 2000) || undefined,
    });

    return res.status(201).json({ success: true, inspection });
  } catch (error) {
    if (error instanceof Error && error.message === 'TENANCY_PROPERTY_MISMATCH') {
      return res.status(400).json({ error: 'The selected property does not belong to that tenancy.' });
    }
    console.error('Admin tenant inspection creation failed:', error);
    return res.status(500).json({ error: 'Unable to create the inspection.' });
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
