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
  PropertyType,
  ServiceCategory,
} from './src/types/booking.js';
import type {
  ClientDocumentRequestInput,
  ClientMaintenanceRequestInput,
  ClientOnboardingInput,
  ClientOrganisationRole,
  ClientPropertyInput,
} from './src/types/clientPortal.js';
import type {
  DocumentParty,
  DocumentRequesterRole,
  DocumentRequestDetails,
  DocumentRequestRecord,
  DocumentWorkflowAnswer,
  DocumentWorkflowData,
  DocumentWorkflowDefinition,
  DocumentWorkflowField,
  PublicDocumentRequestSummary,
} from './src/types/documentRequest.js';
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
  listDocumentProducts,
  listDocumentRequestsWithSecrets,
  getDocumentProduct,
  listServices,
  activateClientOrganisation,
  completeClientOnboarding,
  claimClientDocumentDraftGeneration,
  createClientApproval,
  createClientDocument,
  createClientProperty,
  createClientRequest,
  ensureClientContext,
  getClientDocument,
  getClientDocumentForAdmin,
  getClientPortalDashboard,
  getClientProperty,
  getClientRequest,
  inviteClientOrganisationMember,
  linkBookingToClient,
  listClientApprovalsForAdmin,
  listClientDocumentsForAdmin,
  listClientRequestsForAdmin,
  respondToClientApproval,
  updateClientOrganisationMember,
  updateClientProperty,
  updateClientRequest,
  updateClientRequestForAdmin,
  newBookingId,
  newDocumentRequestId,
  documentRequestReferenceExists,
  releaseClientDocumentDraftGeneration,
  releaseScheduleLocks,
  reorderServices,
  saveBooking,
  saveDocumentRequest,
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
  sendClientPortalInvitationEmail,
  sendClientPortalRequestNotification,
  sendDocumentRequestEmails,
} from './src/server/email.js';
import {
  openClientFileStream,
  saveClientFile,
  saveGeneratedClientFile,
  validateClientUpload,
} from './src/server/clientFiles.js';
import { generateDocumentDraft } from './src/server/documentGenerator.js';
import {
  isValidAustralianPhone,
  isWAPostcode,
} from './src/utils/australianValidation.js';
import {
  getDocumentWorkflowDefinition,
  isWorkflowAnswerPresent,
  isWorkflowFieldVisible,
  sensitiveWorkflowFieldIds,
  validateDocumentWorkflowRules,
} from './src/documents/documentWorkflowDefinitions.js';
import {
  documentRequestEncryptionIsConfigured,
  encryptDocumentRequestSecrets,
} from './src/server/documentRequestSecrets.js';


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

const documentRequestRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  prefix: 'document-request',
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

async function verifiedFirebaseIdentity(req: Request): Promise<{
  uid: string;
  email: string;
  displayName?: string;
} | null> {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;

  const idToken = authHeader.slice(7).trim();
  const decoded = await adminAuth.verifyIdToken(idToken, true);
  const email = (decoded.email || '').trim().toLowerCase();

  if (!email || decoded.email_verified !== true) {
    return null;
  }

  return {
    uid: decoded.uid,
    email,
    displayName:
      typeof decoded.name === 'string' && decoded.name.trim()
        ? decoded.name.trim()
        : undefined,
  };
}

async function requireClient(req: Request, res: Response, next: NextFunction) {
  try {
    const identity = await verifiedFirebaseIdentity(req);
    if (!identity) {
      return res.status(401).json({ error: 'A verified client account is required.' });
    }

    const context = await ensureClientContext(identity);
    res.locals.client = {
      ...identity,
      context,
    };
    return next();
  } catch (error) {
    if (error instanceof Error && error.message === 'CLIENT_ACCOUNT_DISABLED') {
      return res.status(403).json({ error: 'This client portal account has been disabled.' });
    }

    console.error('Client authentication failed:', error);
    return res.status(401).json({ error: 'Client session is invalid or has expired.' });
  }
}

async function optionalClientIdentity(req: Request): Promise<{
  uid: string;
  email: string;
  displayName?: string;
} | null> {
  try {
    return await verifiedFirebaseIdentity(req);
  } catch {
    return null;
  }
}

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const identity = await verifiedFirebaseIdentity(req);
    if (!identity) {
      return res.status(401).json({ error: 'Administrator authentication is required.' });
    }

    const { uid, email } = identity;
    const configuredAdmins = parseAdminEmails();
    let authorised = configuredAdmins.has(email);

    if (!authorised) {
      const adminUser = await adminDb.collection('adminUsers').doc(uid).get();
      const data = adminUser.exists ? adminUser.data() : null;
      authorised =
        Boolean(data) &&
        data?.active !== false &&
        (!data?.email || String(data.email).trim().toLowerCase() === email);
    }

    if (!authorised) {
      return res.status(403).json({ error: 'This account is not authorised for ProInspect administration.' });
    }

    res.locals.admin = { uid, email };
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

function clientContext(res: Response): Awaited<ReturnType<typeof ensureClientContext>> {
  return res.locals.client.context as Awaited<ReturnType<typeof ensureClientContext>>;
}

const CLIENT_PROPERTY_TYPES = new Set<PropertyType>([
  'House',
  'Apartment / Unit',
  'Townhouse',
  'Commercial',
  'Retail',
  'Office',
  'Industrial',
  'Strata / Common Property',
  'Other',
]);

const CLIENT_ENTITY_TYPES = new Set<ClientOnboardingInput['entityType']>([
  'individual',
  'company',
  'trust',
  'partnership',
  'strata',
  'agency',
  'other',
]);

const CLIENT_DOCUMENT_TYPES = new Set<ClientDocumentRequestInput['documentType']>([
  'Commercial Lease',
  'Lease Variation',
  'Lease Renewal / Extension',
  'Notice / Letter',
  'Authority / Agreement',
  'Other',
]);

const CLIENT_MAINTENANCE_TYPES = new Set<ClientMaintenanceRequestInput['issueType']>([
  'Plumbing',
  'Electrical',
  'Air Conditioning',
  'Appliance',
  'Door / Window',
  'Security',
  'Water Ingress',
  'General Repair',
  'Other',
]);

function sanitizeClientPropertyInput(
  input: unknown
): { value?: ClientPropertyInput; error?: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'Property details are required.' };
  }

  const raw = input as Record<string, unknown>;
  const streetAddress = normalizeText(raw.streetAddress, 150);
  const unit = normalizeText(raw.unit, 50);
  const suburb = normalizeText(raw.suburb, 100);
  const state = normalizeText(raw.state, 10).toUpperCase() || 'WA';
  const postcode = normalizeText(raw.postcode, 10);
  const propertyType = CLIENT_PROPERTY_TYPES.has(raw.propertyType as PropertyType)
    ? (raw.propertyType as PropertyType)
    : null;
  const categories = Array.isArray(raw.categories)
    ? Array.from(
        new Set(
          raw.categories.filter((item): item is ServiceCategory =>
            isServiceCategory(item)
          )
        )
      )
    : [];

  if (!streetAddress || !suburb || !/^\d{4}$/.test(postcode)) {
    return { error: 'Enter a complete Australian property address.' };
  }
  if (!['WA', 'NSW', 'VIC', 'QLD', 'SA', 'TAS', 'ACT', 'NT'].includes(state)) {
    return { error: 'Select a valid Australian state or territory.' };
  }
  if (!propertyType) {
    return { error: 'Select a valid property type.' };
  }
  if (categories.length === 0) {
    return { error: 'Select at least one property service category.' };
  }

  return {
    value: {
      streetAddress,
      unit: unit || undefined,
      suburb,
      state,
      postcode,
      propertyType,
      nickname: normalizeText(raw.nickname, 100) || undefined,
      clientReference: normalizeText(raw.clientReference, 100) || undefined,
      categories,
      notes: normalizeText(raw.notes, 2000) || undefined,
    },
  };
}

function sanitizeClientOnboarding(
  input: unknown,
  accountEmail: string
): { value?: ClientOnboardingInput; error?: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'Onboarding information is required.' };
  }

  const raw = input as Record<string, unknown>;
  const displayName = normalizeText(raw.displayName, 150);
  const organisationName = normalizeText(raw.organisationName, 150);
  const entityType = CLIENT_ENTITY_TYPES.has(raw.entityType as ClientOnboardingInput['entityType'])
    ? (raw.entityType as ClientOnboardingInput['entityType'])
    : null;
  const billingEmail = normalizeText(raw.billingEmail, 120).toLowerCase() || accountEmail;
  const abn = normalizeText(raw.abn, 20).replace(/\s+/g, '');
  const acn = normalizeText(raw.acn, 20).replace(/\s+/g, '');

  if (!displayName || !organisationName || !entityType) {
    return { error: 'Your name, organisation name and entity type are required.' };
  }
  if (!isValidEmail(billingEmail)) {
    return { error: 'Enter a valid billing email address.' };
  }
  const phone = normalizeText(raw.phone, 50);
  if (phone && !isValidAustralianPhone(phone)) {
    return { error: 'Enter a valid Australian phone number.' };
  }
  if (abn && !/^\d{11}$/.test(abn)) {
    return { error: 'ABN must contain 11 digits.' };
  }
  if (acn && !/^\d{9}$/.test(acn)) {
    return { error: 'ACN must contain 9 digits.' };
  }

  let firstProperty: ClientPropertyInput | undefined;
  if (raw.firstProperty) {
    const property = sanitizeClientPropertyInput(raw.firstProperty);
    if (!property.value) return { error: property.error };
    firstProperty = property.value;
  }

  return {
    value: {
      displayName,
      phone: phone || undefined,
      organisationName,
      entityType,
      abn: abn || undefined,
      acn: acn || undefined,
      billingEmail,
      firstProperty,
    },
  };
}

function sanitizeClientDocumentRequest(
  input: unknown
): { value?: ClientDocumentRequestInput; error?: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'Document request details are required.' };
  }
  const raw = input as Record<string, unknown>;
  const documentType = CLIENT_DOCUMENT_TYPES.has(raw.documentType as ClientDocumentRequestInput['documentType'])
    ? (raw.documentType as ClientDocumentRequestInput['documentType'])
    : null;
  const instructions = normalizeText(raw.instructions, 5000);
  if (!documentType || !instructions) {
    return { error: 'Select a document type and provide drafting instructions.' };
  }

  return {
    value: {
      propertyId: normalizeText(raw.propertyId, 128) || undefined,
      documentType,
      title: normalizeText(raw.title, 200) || undefined,
      counterpartyName: normalizeText(raw.counterpartyName, 200) || undefined,
      commencementDate: normalizeText(raw.commencementDate, 50) || undefined,
      term: normalizeText(raw.term, 100) || undefined,
      rent: normalizeText(raw.rent, 100) || undefined,
      permittedUse: normalizeText(raw.permittedUse, 250) || undefined,
      specialConditions: normalizeText(raw.specialConditions, 3000) || undefined,
      instructions,
      dueDate: normalizeText(raw.dueDate, 50) || undefined,
    },
  };
}

function sanitizeClientMaintenanceRequest(
  input: unknown
): { value?: ClientMaintenanceRequestInput; error?: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'Maintenance request details are required.' };
  }
  const raw = input as Record<string, unknown>;
  const issueType = CLIENT_MAINTENANCE_TYPES.has(raw.issueType as ClientMaintenanceRequestInput['issueType'])
    ? (raw.issueType as ClientMaintenanceRequestInput['issueType'])
    : null;
  const priority = ['routine', 'priority', 'urgent'].includes(String(raw.priority))
    ? (String(raw.priority) as ClientMaintenanceRequestInput['priority'])
    : null;
  const propertyId = normalizeText(raw.propertyId, 128);
  const title = normalizeText(raw.title, 200);
  const description = normalizeText(raw.description, 5000);

  if (!propertyId || !issueType || !priority || !title || !description) {
    return { error: 'Property, issue type, priority, title and description are required.' };
  }

  return {
    value: {
      propertyId,
      issueType,
      title,
      description,
      location: normalizeText(raw.location, 250) || undefined,
      priority,
      activeWater: raw.activeWater === true,
      powerAffected: raw.powerAffected === true,
      propertySecure: raw.propertySecure !== false,
      accessNotes: normalizeText(raw.accessNotes, 2000) || undefined,
    },
  };
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

async function generateDocumentRequestReference(): Promise<string> {
  const datePart = getPerthDateKey(new Date()).replace(/-/g, '');

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = String(Math.floor(1000 + Math.random() * 9000));
    const reference = `DR-${datePart}-${suffix}`;
    if (!(await documentRequestReferenceExists(reference))) return reference;
  }

  return `DR-${datePart}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function sanitizeDocumentRequestDetails(
  input: unknown
): { details?: DocumentRequestDetails; error?: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'Document request details are required.' };
  }

  const value = input as Record<string, unknown>;
  const streetAddress = normalizeText(value.streetAddress, 160);
  const unit = normalizeText(value.unit, 50);
  const suburb = normalizeText(value.suburb, 100);
  const state = normalizeText(value.state, 3).toUpperCase();
  const postcode = normalizeText(value.postcode, 4);
  const customerName = normalizeText(value.customerName, 120);
  const customerEmail = normalizeText(value.customerEmail, 160).toLowerCase();
  const customerPhone = normalizeText(value.customerPhone, 40);
  const clientName = normalizeText(value.clientName, 160);
  const clientReference = normalizeText(value.clientReference, 100);
  const notes = normalizeText(value.notes, 3000);

  if (!streetAddress || !suburb) {
    return { error: 'A property street address and suburb are required.' };
  }

  if (state !== 'WA') {
    return {
      error:
        'The current Residential document workflows are for Western Australian properties.',
    };
  }

  if (!isWAPostcode(postcode)) {
    return { error: 'Enter a valid Western Australian postcode.' };
  }

  if (!customerName) {
    return { error: 'A request contact name is required.' };
  }

  if (!isValidEmail(customerEmail)) {
    return { error: 'Enter a valid request contact email address.' };
  }

  if (!isValidAustralianPhone(customerPhone)) {
    return { error: 'Enter a valid Australian contact phone number.' };
  }

  return {
    details: {
      streetAddress,
      ...(unit ? { unit } : {}),
      suburb,
      state,
      postcode,
      customerName,
      customerEmail,
      customerPhone,
      ...(clientName ? { clientName } : {}),
      ...(clientReference ? { clientReference } : {}),
      ...(notes ? { notes } : {}),
    },
  };
}

const DOCUMENT_REQUESTER_ROLES = new Set<DocumentRequesterRole>([
  'lessor',
  'property-manager',
  'tenant',
  'other',
]);

function sanitizeDocumentParty(input: unknown): DocumentParty | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  const id = normalizeText(value.id, 80) || randomBytes(8).toString('hex');
  const name = normalizeText(value.name, 180);
  const address = normalizeText(value.address, 300);
  const postcode = normalizeText(value.postcode, 4);
  const email = normalizeText(value.email, 180).toLowerCase();
  const phone = normalizeText(value.phone, 50);

  if (!name) return null;
  if (email && !isValidEmail(email)) return null;
  if (phone && !isValidAustralianPhone(phone)) return null;
  if (postcode && !isWAPostcode(postcode)) return null;

  return {
    id,
    name,
    ...(address ? { address } : {}),
    ...(postcode ? { postcode } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
  };
}

function sanitizeWorkflowValue(
  input: unknown,
  depth = 0
): DocumentWorkflowAnswer | undefined {
  if (depth > 4) return undefined;

  if (typeof input === 'string') {
    return input.trim().slice(0, 5000);
  }

  if (typeof input === 'boolean') return input;

  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : undefined;
  }

  if (input === null) return null;

  if (Array.isArray(input)) {
    const array = input
      .slice(0, 30)
      .map((item) => sanitizeWorkflowValue(item, depth + 1))
      .filter((item) => item !== undefined);

    if (array.every((item) => typeof item === 'string')) {
      return array as string[];
    }

    return array
      .filter(
        (item): item is Record<string, unknown> =>
          Boolean(item && typeof item === 'object' && !Array.isArray(item))
      )
      .slice(0, 20);
  }

  if (typeof input === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, rawValue] of Object.entries(
      input as Record<string, unknown>
    ).slice(0, 60)) {
      const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
      if (!safeKey) continue;
      const sanitized = sanitizeWorkflowValue(rawValue, depth + 1);
      if (sanitized !== undefined) output[safeKey] = sanitized;
    }
    return output;
  }

  return undefined;
}

function validOptionValue(
  field: DocumentWorkflowField,
  value: DocumentWorkflowAnswer | undefined
): boolean {
  if (!field.options?.length) return true;
  const allowed = new Set(field.options.map((option) => option.value));

  if (field.type === 'multiselect') {
    return (
      Array.isArray(value) &&
      value.every((item) => typeof item === 'string' && allowed.has(item))
    );
  }

  return typeof value === 'string' && allowed.has(value);
}

function validatePartyElectronicConsents(
  value: DocumentWorkflowAnswer | undefined,
  parties: DocumentParty[]
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const map = value as Record<string, unknown>;

  return parties.every((party) => {
    const entry = map[party.id];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return false;
    }
    const data = entry as Record<string, unknown>;
    const emailConsent = data.email === 'yes' || data.email === 'no';
    const faxConsent = data.fax === 'yes' || data.fax === 'no';

    if (!emailConsent || !faxConsent) return false;
    if (data.email === 'yes' && !party.email) return false;
    if (
      data.fax === 'yes' &&
      !normalizeText(data.faxNumber, 50)
    ) {
      return false;
    }

    return true;
  });
}

function validatePartyPayouts(
  value: DocumentWorkflowAnswer | undefined,
  parties: DocumentParty[]
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const map = value as Record<string, unknown>;

  return parties.every((party) => {
    const entry = map[party.id];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return false;
    }

    const data = entry as Record<string, unknown>;
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount < 0) return false;
    if (amount === 0) return true;

    return Boolean(
      normalizeText(data.accountName, 180) &&
        normalizeText(data.bsb, 20) &&
        normalizeText(data.accountNumber, 40) &&
        normalizeText(data.institution, 180)
    );
  });
}

function validateWorkflowField(
  field: DocumentWorkflowField,
  value: DocumentWorkflowAnswer | undefined,
  workflow: DocumentWorkflowData
): string | null {
  if (field.required && !isWorkflowAnswerPresent(field, value)) {
    return `${field.label} is required.`;
  }

  if (value === undefined || value === null || value === '') return null;

  if (
    (field.type === 'select' ||
      field.type === 'radio' ||
      field.type === 'multiselect') &&
    !validOptionValue(field, value)
  ) {
    return `${field.label} contains an invalid selection.`;
  }

  if (field.type === 'date') {
    if (typeof value !== 'string' || !isValidDateKey(value)) {
      return `${field.label} must be a valid date.`;
    }
  }

  if (
    field.type === 'email' &&
    (typeof value !== 'string' || !isValidEmail(value))
  ) {
    return `${field.label} must be a valid email address.`;
  }

  if (
    field.type === 'phone' &&
    (typeof value !== 'string' || !isValidAustralianPhone(value))
  ) {
    return `${field.label} must be a valid Australian phone number.`;
  }

  if (field.type === 'number' || field.type === 'currency') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return `${field.label} must be a valid number.`;
    }
    if (field.min !== undefined && parsed < field.min) {
      return `${field.label} is below the permitted minimum.`;
    }
    if (field.max !== undefined && parsed > field.max) {
      return `${field.label} exceeds the permitted maximum.`;
    }
  }

  if (field.type === 'tenant-select') {
    if (
      typeof value !== 'string' ||
      !workflow.tenants.some((tenant) => tenant.id === value)
    ) {
      return `${field.label} must identify a tenant named in this request.`;
    }
  }

  if (field.type === 'party-electronic-consents') {
    if (
      !validatePartyElectronicConsents(value, [
        ...workflow.lessors,
        ...workflow.tenants,
      ])
    ) {
      return 'Select email and fax notice preferences for each named party.';
    }
  }

  if (field.type === 'party-payouts') {
    if (
      !validatePartyPayouts(value, [
        ...workflow.tenants,
        ...workflow.lessors,
      ])
    ) {
      return 'Complete the proposed bond payment amount for every named party and bank details for each party receiving money.';
    }
  }

  return null;
}

function sanitizeDocumentWorkflow(
  input: unknown,
  definition: DocumentWorkflowDefinition
): {
  workflow?: DocumentWorkflowData;
  sensitiveAnswers?: Record<string, DocumentWorkflowAnswer>;
  error?: string;
} {
  if (!input || typeof input !== 'object') {
    return { error: 'The document-specific workflow is required.' };
  }

  const value = input as Record<string, unknown>;
  const version = Number(value.version);
  const requesterRole = normalizeText(value.requesterRole, 40) as DocumentRequesterRole;

  if (version !== 1) {
    return { error: 'Unsupported document workflow version.' };
  }

  if (!DOCUMENT_REQUESTER_ROLES.has(requesterRole)) {
    return { error: 'Select a valid requester role.' };
  }

  if (
    definition.allowedRequesterRoles &&
    !definition.allowedRequesterRoles.includes(requesterRole)
  ) {
    return {
      error:
        'The selected document is not designed for the requester role provided.',
    };
  }

  const lessors = Array.isArray(value.lessors)
    ? value.lessors
        .slice(0, 10)
        .map(sanitizeDocumentParty)
        .filter((party): party is DocumentParty => Boolean(party))
    : [];
  const tenants = Array.isArray(value.tenants)
    ? value.tenants
        .slice(0, 10)
        .map(sanitizeDocumentParty)
        .filter((party): party is DocumentParty => Boolean(party))
    : [];

  if (lessors.length < (definition.minimumLessors || 0)) {
    return { error: 'Enter the required landlord / lessor details.' };
  }
  if (tenants.length < (definition.minimumTenants || 0)) {
    return { error: 'Enter the required tenant details.' };
  }

  const rawAnswers =
    value.answers && typeof value.answers === 'object' && !Array.isArray(value.answers)
      ? (value.answers as Record<string, unknown>)
      : {};

  const permittedFields = definition.sections.flatMap((section) => section.fields);
  const answers: Record<string, DocumentWorkflowAnswer> = {};

  for (const field of permittedFields) {
    const sanitized = sanitizeWorkflowValue(rawAnswers[field.id]);
    if (sanitized !== undefined) answers[field.id] = sanitized;
  }

  const workflow: DocumentWorkflowData = {
    version: 1,
    requesterRole,
    lessors,
    tenants,
    answers,
  };

  for (const field of permittedFields) {
    if (!isWorkflowFieldVisible(field, answers)) continue;
    const validationError = validateWorkflowField(
      field,
      answers[field.id],
      workflow
    );
    if (validationError) return { error: validationError };
  }

  const ruleErrors = validateDocumentWorkflowRules(
    definition.documentId,
    answers
  );
  if (ruleErrors.length > 0) {
    return { error: ruleErrors[0].message };
  }

  const sensitiveIds = sensitiveWorkflowFieldIds(definition);
  const sensitiveAnswers: Record<string, DocumentWorkflowAnswer> = {};

  for (const fieldId of sensitiveIds) {
    if (answers[fieldId] !== undefined) {
      sensitiveAnswers[fieldId] = answers[fieldId];
      delete answers[fieldId];
    }
  }

  return {
    workflow,
    ...(Object.keys(sensitiveAnswers).length
      ? { sensitiveAnswers }
      : {}),
  };
}

function publicDocumentRequestView(
  request: DocumentRequestRecord
): PublicDocumentRequestSummary {
  return {
    requestReference: request.requestReference,
    documentName: request.documentName,
    documentCategory: request.documentCategory,
    priceExGst: request.priceExGst,
    status: request.status,
    details: {
      streetAddress: request.details.streetAddress,
      ...(request.details.unit ? { unit: request.details.unit } : {}),
      suburb: request.details.suburb,
      state: request.details.state,
      postcode: request.details.postcode,
      customerName: request.details.customerName,
      customerEmail: request.details.customerEmail,
    },
  };
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

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    calendarConfigured: calendarIsConfigured(),
    bookingEmailConfigured: bookingEmailIsConfigured(),
    sensitiveAccessEncryptionConfigured: accessEncryptionIsConfigured(),
    documentRequestEncryptionConfigured:
      documentRequestEncryptionIsConfigured(),
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

app.get('/api/document-products', async (_req, res) => {
  try {
    const documents = await listDocumentProducts(true);
    return res.json({ documents });
  } catch (error) {
    console.error('Document catalogue load failed:', error);
    return res.status(500).json({ error: 'Unable to load document products.' });
  }
});

app.post('/api/document-requests', documentRequestRateLimit, async (req, res) => {
  try {
    const { documentId, documentCategory, details, workflow } = req.body || {};

    if (!documentId || !documentCategory || !details || !workflow) {
      return res.status(400).json({
        error:
          'Select a document and complete the required document workflow.',
      });
    }

    if (!isServiceCategory(documentCategory)) {
      return res.status(400).json({ error: 'Invalid document category.' });
    }

    const product = await getDocumentProduct(String(documentId));
    if (!product || !product.active || !product.publiclyRequestable) {
      return res.status(400).json({
        error: 'The selected document is not available for public requests.',
      });
    }

    if (!product.categories.includes(documentCategory)) {
      return res.status(400).json({
        error:
          'The selected document is not available for that property category.',
      });
    }

    const definition = getDocumentWorkflowDefinition(product.id);
    if (!definition) {
      return res.status(503).json({
        error:
          'The guided workflow for this document is not available. Please contact ProInspect.',
      });
    }

    const detailValidation = sanitizeDocumentRequestDetails(details);
    if (!detailValidation.details) {
      return res.status(400).json({
        error:
          detailValidation.error ||
          'Valid document request details are required.',
      });
    }

    const workflowValidation = sanitizeDocumentWorkflow(
      workflow,
      definition
    );
    if (!workflowValidation.workflow) {
      return res.status(400).json({
        error:
          workflowValidation.error ||
          'Complete the required document-specific information.',
      });
    }

    const requestId = newDocumentRequestId();
    let encryptedSecrets;

    if (
      workflowValidation.sensitiveAnswers &&
      Object.keys(workflowValidation.sensitiveAnswers).length > 0
    ) {
      if (!documentRequestEncryptionIsConfigured()) {
        return res.status(503).json({
          error:
            'Secure storage for sensitive document details is temporarily unavailable. Please try again shortly.',
        });
      }

      encryptedSecrets = encryptDocumentRequestSecrets(
        requestId,
        workflowValidation.sensitiveAnswers
      );
    }

    const now = new Date().toISOString();
    const request: DocumentRequestRecord = {
      id: requestId,
      requestReference: await generateDocumentRequestReference(),
      documentId: product.id,
      documentName: product.formCode
        ? `${product.name} (${product.formCode})`
        : product.name,
      documentCategory,
      priceExGst: product.priceExGst,
      details: detailValidation.details,
      workflow: workflowValidation.workflow,
      status: 'submitted',
      createdAt: now,
      updatedAt: now,
    };

    await saveDocumentRequest(request, encryptedSecrets);

    // A signed-in client using the public catalogue also receives the request
    // in the active organisation workspace. Anonymous catalogue requests are
    // unchanged.
    const authenticatedClient = await optionalClientIdentity(req);
    if (
      authenticatedClient &&
      authenticatedClient.email === request.details.customerEmail
    ) {
      try {
        const context = await ensureClientContext(authenticatedClient);
        await createClientRequest({
          context,
          type: 'document',
          title: request.documentName,
          priority: 'routine',
          details: {
            sourceDocumentRequestId: request.id,
            requestReference: request.requestReference,
            documentId: request.documentId,
            documentName: request.documentName,
            documentCategory: request.documentCategory,
            priceExGst: request.priceExGst,
            streetAddress: request.details.streetAddress,
            suburb: request.details.suburb,
            state: request.details.state,
            postcode: request.details.postcode,
            ...(request.details.unit ? { unit: request.details.unit } : {}),
            ...(request.details.notes
              ? { instructions: request.details.notes }
              : {}),
          },
        });
      } catch (portalLinkError) {
        console.error(
          'Document request was saved but could not be linked to the Client Portal:',
          portalLinkError
        );
      }
    }

    const emailResult = await sendDocumentRequestEmails(request);
    if (emailResult.customer.status === 'failed') {
      console.error(
        `Document request ${request.requestReference} customer confirmation email failed:`,
        emailResult.customer.error
      );
    }
    if (emailResult.internal.status === 'failed') {
      console.error(
        `Document request ${request.requestReference} internal notification email failed:`,
        emailResult.internal.error
      );
    }

    return res.status(201).json({
      success: true,
      request: publicDocumentRequestView(request),
      message:
        emailResult.customer.status === 'sent'
          ? 'Document request submitted successfully. A confirmation email has been sent.'
          : 'Document request submitted successfully. ProInspect will review the supplied details before preparation or distribution.',
    });
  } catch (error) {
    console.error('Document request creation failed:', error);
    return res.status(500).json({
      error:
        'The document request could not be submitted. Please try again.',
    });
  }
});

app.get('/api/client/session', requireClient, (_req, res) => {
  const context = clientContext(res);
  return res.json({
    authorised: true,
    profile: context.profile,
    organisation: context.organisation,
    membership: context.membership,
  });
});

app.get('/api/client/dashboard', requireClient, async (_req, res) => {
  try {
    const client = res.locals.client as {
      uid: string;
      email: string;
      displayName?: string;
    };
    const dashboard = await getClientPortalDashboard(client);
    return res.json({ dashboard });
  } catch (error) {
    console.error('Client portal dashboard load failed:', error);
    return res.status(500).json({ error: 'Unable to load the client portal.' });
  }
});

app.post('/api/client/onboarding', requireClient, async (req, res) => {
  try {
    const context = clientContext(res);
    const parsed = sanitizeClientOnboarding(req.body, context.profile.email);
    if (!parsed.value) {
      return res.status(400).json({ error: parsed.error || 'Invalid onboarding information.' });
    }

    const updatedContext = await completeClientOnboarding({
      context,
      input: parsed.value,
    });
    return res.json({ success: true, context: updatedContext });
  } catch (error) {
    console.error('Client onboarding failed:', error);
    return res.status(500).json({ error: 'Unable to complete client onboarding.' });
  }
});

app.post('/api/client/properties', requireClient, async (req, res) => {
  try {
    const parsed = sanitizeClientPropertyInput(req.body);
    if (!parsed.value) {
      return res.status(400).json({ error: parsed.error || 'Invalid property information.' });
    }

    const property = await createClientProperty({
      context: clientContext(res),
      input: parsed.value,
    });
    return res.status(201).json({ success: true, property });
  } catch (error) {
    if (error instanceof Error && error.message === 'CLIENT_WRITE_FORBIDDEN') {
      return res.status(403).json({ error: 'Your client role is read-only.' });
    }
    console.error('Client property creation failed:', error);
    return res.status(500).json({ error: 'Unable to add this property.' });
  }
});

app.patch('/api/client/properties/:id', requireClient, async (req, res) => {
  try {
    const changes: Record<string, unknown> = {};
    if (req.body?.nickname !== undefined) {
      changes.nickname = normalizeText(req.body.nickname, 100) || undefined;
    }
    if (req.body?.clientReference !== undefined) {
      changes.clientReference = normalizeText(req.body.clientReference, 100) || undefined;
    }
    if (req.body?.notes !== undefined) {
      changes.notes = normalizeText(req.body.notes, 2000) || undefined;
    }
    if (req.body?.status !== undefined) {
      if (!['active', 'inactive'].includes(String(req.body.status))) {
        return res.status(400).json({ error: 'Invalid property status.' });
      }
      changes.status = req.body.status;
    }
    if (req.body?.categories !== undefined) {
      if (!Array.isArray(req.body.categories)) {
        return res.status(400).json({ error: 'Property categories must be a list.' });
      }
      const categories = Array.from(
        new Set(
          req.body.categories.filter((item: unknown): item is ServiceCategory =>
            isServiceCategory(item)
          )
        )
      );
      if (categories.length === 0) {
        return res.status(400).json({ error: 'Select at least one property category.' });
      }
      changes.categories = categories;
    }

    const property = await updateClientProperty({
      context: clientContext(res),
      propertyId: req.params.id,
      changes,
    });
    return res.json({ success: true, property });
  } catch (error) {
    if (error instanceof Error && error.message === 'CLIENT_PROPERTY_NOT_FOUND') {
      return res.status(404).json({ error: 'Property not found.' });
    }
    if (error instanceof Error && error.message === 'CLIENT_WRITE_FORBIDDEN') {
      return res.status(403).json({ error: 'Your client role is read-only.' });
    }
    console.error('Client property update failed:', error);
    return res.status(500).json({ error: 'Unable to update this property.' });
  }
});

app.post('/api/client/organisations/:id/activate', requireClient, async (req, res) => {
  try {
    const client = res.locals.client as { uid: string; email: string; displayName?: string };
    const context = await activateClientOrganisation({
      uid: client.uid,
      email: client.email,
      organisationId: req.params.id,
    });
    return res.json({ success: true, context });
  } catch (error) {
    if (error instanceof Error && error.message === 'CLIENT_ORGANISATION_FORBIDDEN') {
      return res.status(403).json({ error: 'You do not have access to this organisation.' });
    }
    console.error('Client organisation switch failed:', error);
    return res.status(500).json({ error: 'Unable to switch organisation.' });
  }
});

app.post('/api/client/organisation/members', requireClient, async (req, res) => {
  try {
    const email = normalizeText(req.body?.email, 120).toLowerCase();
    const role = normalizeText(req.body?.role, 30) as Exclude<ClientOrganisationRole, 'owner'>;
    if (!isValidEmail(email) || !['admin', 'member', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Enter a valid email and member role.' });
    }

    const context = clientContext(res);
    const membership = await inviteClientOrganisationMember({
      context,
      email,
      role,
    });

    const invitationEmail = await sendClientPortalInvitationEmail({
      email,
      organisationName: context.organisation.name,
      invitedByName: context.profile.displayName,
      role,
      signInUrl: `${publicBaseUrl(req)}/signin`,
    });

    if (invitationEmail.status === 'failed') {
      console.error(
        `Client Portal invitation email failed for ${email}:`,
        invitationEmail.error
      );
    }

    return res.status(201).json({
      success: true,
      membership,
      invitationEmailStatus: invitationEmail.status,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'CLIENT_ORGANISATION_ADMIN_REQUIRED') {
      return res.status(403).json({ error: 'Owner or admin access is required to invite members.' });
    }
    if (error instanceof Error && error.message === 'CLIENT_MEMBERSHIP_OWNER_PROTECTED') {
      return res.status(409).json({ error: 'The organisation owner membership cannot be replaced by an invitation.' });
    }
    if (error instanceof Error && error.message === 'CLIENT_MEMBERSHIP_ALREADY_EXISTS') {
      return res.status(409).json({ error: 'That email already has a membership or invitation for this organisation.' });
    }
    console.error('Client member invitation failed:', error);
    return res.status(500).json({ error: 'Unable to invite this organisation member.' });
  }
});

app.patch('/api/client/organisation/members/:id', requireClient, async (req, res) => {
  try {
    const role = req.body?.role === undefined
      ? undefined
      : (normalizeText(req.body.role, 30) as Exclude<ClientOrganisationRole, 'owner'>);
    const status = req.body?.status === undefined
      ? undefined
      : normalizeText(req.body.status, 30) as 'active' | 'revoked';

    if (role && !['admin', 'member', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid member role.' });
    }
    if (status && !['active', 'revoked'].includes(status)) {
      return res.status(400).json({ error: 'Invalid membership status.' });
    }

    const membership = await updateClientOrganisationMember({
      context: clientContext(res),
      membershipId: req.params.id,
      role,
      status,
    });
    return res.json({ success: true, membership });
  } catch (error) {
    if (error instanceof Error && error.message === 'CLIENT_ORGANISATION_OWNER_REQUIRED') {
      return res.status(403).json({ error: 'Organisation owner access is required.' });
    }
    if (error instanceof Error && error.message === 'CLIENT_MEMBERSHIP_NOT_FOUND') {
      return res.status(404).json({ error: 'Organisation member not found.' });
    }
    console.error('Client member update failed:', error);
    return res.status(500).json({ error: 'Unable to update this organisation member.' });
  }
});

app.post('/api/client/requests/document', requireClient, async (req, res) => {
  try {
    const parsed = sanitizeClientDocumentRequest(req.body);
    if (!parsed.value) {
      return res.status(400).json({ error: parsed.error || 'Invalid document request.' });
    }

    const input = parsed.value;
    const request = await createClientRequest({
      context: clientContext(res),
      type: 'document',
      title: input.title || input.documentType,
      propertyId: input.propertyId,
      priority: 'routine',
      details: {
        documentType: input.documentType,
        ...(input.counterpartyName ? { counterpartyName: input.counterpartyName } : {}),
        ...(input.commencementDate ? { commencementDate: input.commencementDate } : {}),
        ...(input.term ? { term: input.term } : {}),
        ...(input.rent ? { rent: input.rent } : {}),
        ...(input.permittedUse ? { permittedUse: input.permittedUse } : {}),
        ...(input.specialConditions ? { specialConditions: input.specialConditions } : {}),
        instructions: input.instructions,
        ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      },
    });

    const context = clientContext(res);
    const property = input.propertyId
      ? await getClientProperty({
          organisationId: context.organisation.id,
          propertyId: input.propertyId,
        })
      : null;
    const notification = await sendClientPortalRequestNotification({
      requestId: request.id,
      requestType: 'document',
      title: request.title,
      organisationName: context.organisation.name,
      submittedByName: context.profile.displayName,
      submittedByEmail: context.profile.email,
      propertyAddress: property
        ? [
            property.unit
              ? `${property.unit}, ${property.streetAddress}`
              : property.streetAddress,
            `${property.suburb} ${property.state} ${property.postcode}`,
          ].join(', ')
        : undefined,
      priority: request.priority,
      staffUrl: publicBaseUrl(req),
    });
    if (notification.status === 'failed') {
      console.error(
        `Client document request ${request.id} notification failed:`,
        notification.error
      );
    }

    return res.status(201).json({ success: true, request });
  } catch (error) {
    if (error instanceof Error && error.message === 'CLIENT_PROPERTY_NOT_FOUND') {
      return res.status(400).json({ error: 'Select a property linked to your organisation.' });
    }
    if (error instanceof Error && error.message === 'CLIENT_WRITE_FORBIDDEN') {
      return res.status(403).json({ error: 'Your client role is read-only.' });
    }
    console.error('Document request creation failed:', error);
    return res.status(500).json({ error: 'Unable to submit the document request.' });
  }
});

app.post('/api/client/requests/maintenance', requireClient, async (req, res) => {
  try {
    const parsed = sanitizeClientMaintenanceRequest(req.body);
    if (!parsed.value) {
      return res.status(400).json({ error: parsed.error || 'Invalid maintenance request.' });
    }

    const input = parsed.value;
    const request = await createClientRequest({
      context: clientContext(res),
      type: 'maintenance',
      title: input.title,
      propertyId: input.propertyId,
      priority: input.priority,
      details: {
        issueType: input.issueType,
        description: input.description,
        ...(input.location ? { location: input.location } : {}),
        activeWater: Boolean(input.activeWater),
        powerAffected: Boolean(input.powerAffected),
        propertySecure: input.propertySecure !== false,
        ...(input.accessNotes ? { accessNotes: input.accessNotes } : {}),
      },
    });

    const context = clientContext(res);
    const property = await getClientProperty({
      organisationId: context.organisation.id,
      propertyId: input.propertyId,
    });
    const notification = await sendClientPortalRequestNotification({
      requestId: request.id,
      requestType: 'maintenance',
      title: request.title,
      organisationName: context.organisation.name,
      submittedByName: context.profile.displayName,
      submittedByEmail: context.profile.email,
      propertyAddress: property
        ? [
            property.unit
              ? `${property.unit}, ${property.streetAddress}`
              : property.streetAddress,
            `${property.suburb} ${property.state} ${property.postcode}`,
          ].join(', ')
        : undefined,
      priority: request.priority,
      staffUrl: publicBaseUrl(req),
    });
    if (notification.status === 'failed') {
      console.error(
        `Client maintenance request ${request.id} notification failed:`,
        notification.error
      );
    }

    return res.status(201).json({ success: true, request });
  } catch (error) {
    if (error instanceof Error && error.message === 'CLIENT_PROPERTY_NOT_FOUND') {
      return res.status(400).json({ error: 'Select a property linked to your organisation.' });
    }
    if (error instanceof Error && error.message === 'CLIENT_WRITE_FORBIDDEN') {
      return res.status(403).json({ error: 'Your client role is read-only.' });
    }
    console.error('Maintenance request creation failed:', error);
    return res.status(500).json({ error: 'Unable to submit the maintenance request.' });
  }
});

app.post(
  '/api/client/files/upload',
  requireClient,
  express.raw({ type: () => true, limit: '10mb' }),
  async (req, res) => {
    try {
      const context = clientContext(res);
      if (context.membership.role === 'viewer') {
        return res.status(403).json({ error: 'Your client role is read-only.' });
      }

      const fileName = normalizeText(
        decodeURIComponent(String(req.header('x-file-name') || '')),
        200
      );
      const contentType = normalizeText(req.header('content-type'), 150);
      const propertyId = normalizeText(req.header('x-property-id'), 128) || undefined;
      const requestId = normalizeText(req.header('x-request-id'), 128) || undefined;
      const documentType =
        normalizeText(req.header('x-document-type'), 100) || 'Supporting Document';
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

      const validationError = validateClientUpload({
        fileName,
        contentType,
        sizeBytes: bytes.length,
      });
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      if (propertyId) {
        const property = await getClientProperty({
          organisationId: context.organisation.id,
          propertyId,
        });
        if (!property) {
          return res.status(400).json({ error: 'The selected property is not available to this organisation.' });
        }
      }

      if (requestId) {
        const request = await getClientRequest({
          organisationId: context.organisation.id,
          requestId,
        });
        if (!request) {
          return res.status(400).json({ error: 'The selected request is not available to this organisation.' });
        }
      }

      const stored = await saveClientFile({
        organisationId: context.organisation.id,
        uploadedByUid: context.profile.uid,
        fileName,
        contentType,
        bytes,
      });

      const document = await createClientDocument({
        context,
        propertyId,
        requestId,
        name: stored.fileName,
        documentType,
        status: 'available',
        storagePath: stored.storagePath,
        contentType,
        sizeBytes: stored.sizeBytes,
      });

      return res.status(201).json({ success: true, document });
    } catch (error) {
      console.error('Client file upload failed:', error);
      return res.status(500).json({ error: 'Unable to upload this file.' });
    }
  }
);

app.post('/api/client/requests/:id/generate-draft', requireClient, async (req, res) => {
  const context = clientContext(res);
  let generationClaimed = false;

  try {
    if (context.membership.role === 'viewer') {
      return res.status(403).json({ error: 'Your client role is read-only.' });
    }

    const existingRequest = await getClientRequest({
      organisationId: context.organisation.id,
      requestId: req.params.id,
    });
    if (!existingRequest || existingRequest.type !== 'document') {
      return res.status(404).json({ error: 'Document request not found.' });
    }

    const request = await claimClientDocumentDraftGeneration({
      context,
      requestId: req.params.id,
    });
    generationClaimed = true;

    const details = request.details || {};
    const documentType = String(details.documentType || 'Other') as ClientDocumentRequestInput['documentType'];
    if (!CLIENT_DOCUMENT_TYPES.has(documentType)) {
      return res.status(400).json({ error: 'This request does not contain a supported document type.' });
    }

    const input: ClientDocumentRequestInput = {
      propertyId: request.propertyId,
      documentType,
      title: request.title,
      counterpartyName: typeof details.counterpartyName === 'string' ? details.counterpartyName : undefined,
      commencementDate: typeof details.commencementDate === 'string' ? details.commencementDate : undefined,
      term: typeof details.term === 'string' ? details.term : undefined,
      rent: typeof details.rent === 'string' ? details.rent : undefined,
      permittedUse: typeof details.permittedUse === 'string' ? details.permittedUse : undefined,
      specialConditions: typeof details.specialConditions === 'string' ? details.specialConditions : undefined,
      instructions: typeof details.instructions === 'string' ? details.instructions : '',
      dueDate: typeof details.dueDate === 'string' ? details.dueDate : undefined,
    };

    const property = request.propertyId
      ? await getClientProperty({
          organisationId: context.organisation.id,
          propertyId: request.propertyId,
        })
      : undefined;

    const generated = generateDocumentDraft({
      request,
      input,
      organisation: context.organisation,
      property: property || undefined,
    });

    const stored = await saveGeneratedClientFile({
      organisationId: context.organisation.id,
      generatedByUid: context.profile.uid,
      fileName: generated.fileName,
      contentType: generated.contentType,
      bytes: generated.bytes,
    });

    const document = await createClientDocument({
      context,
      propertyId: request.propertyId,
      requestId: request.id,
      name: stored.fileName,
      documentType: input.documentType,
      status: 'draft',
      storagePath: stored.storagePath,
      contentType: generated.contentType,
      sizeBytes: stored.sizeBytes,
      generated: true,
    });

    const approval = await createClientApproval({
      context,
      propertyId: request.propertyId,
      requestId: request.id,
      documentId: document.id,
      type: 'document',
      title: `Review ${input.documentType} draft`,
      summary: 'Review the generated working draft and either approve it or request changes.',
    });

    await updateClientRequest({
      context,
      requestId: request.id,
      changes: {
        status: 'waiting_client',
        generatedDocumentId: document.id,
        draftGenerationStatus: 'generated',
      },
    });

    return res.status(201).json({ success: true, document, approval });
  } catch (error) {
    if (generationClaimed) {
      await releaseClientDocumentDraftGeneration({
        context,
        requestId: req.params.id,
      }).catch((releaseError) => {
        console.error('Failed to release document draft generation claim:', releaseError);
      });
    }

    if (error instanceof Error && error.message === 'CLIENT_DRAFT_ALREADY_GENERATED') {
      return res.status(409).json({
        error: 'A draft has already been generated or is currently being generated for this request.',
      });
    }

    console.error('Client document draft generation failed:', error);
    return res.status(500).json({ error: 'Unable to generate this document draft.' });
  }
});

app.get('/api/client/documents/:id/download', requireClient, async (req, res) => {
  try {
    const context = clientContext(res);
    const document = await getClientDocument({
      organisationId: context.organisation.id,
      documentId: req.params.id,
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    res.setHeader('Content-Type', document.contentType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`
    );
    res.setHeader('Cache-Control', 'private, no-store');

    if (!document.storagePath) {
      return res.status(500).json({ error: 'This document is missing its storage reference.' });
    }

    if (!document.storagePath) {
      return res.status(500).json({ error: 'This document is missing its storage reference.' });
    }

    const stream = openClientFileStream(document.storagePath);
    stream.on('error', (error) => {
      console.error('Client document stream failed:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Unable to download this document.' });
      } else {
        res.destroy(error as Error);
      }
    });
    stream.pipe(res);
  } catch (error) {
    console.error('Client document download failed:', error);
    return res.status(500).json({ error: 'Unable to download this document.' });
  }
});

app.post('/api/client/approvals/:id/respond', requireClient, async (req, res) => {
  try {
    const status = normalizeText(req.body?.status, 40) as
      | 'approved'
      | 'changes_requested'
      | 'declined';
    if (!['approved', 'changes_requested', 'declined'].includes(status)) {
      return res.status(400).json({ error: 'Select a valid approval response.' });
    }

    const approval = await respondToClientApproval({
      context: clientContext(res),
      approvalId: req.params.id,
      status,
      comment: normalizeText(req.body?.comment, 3000) || undefined,
    });
    return res.json({ success: true, approval });
  } catch (error) {
    if (error instanceof Error && error.message === 'CLIENT_APPROVAL_NOT_FOUND') {
      return res.status(404).json({ error: 'Approval not found.' });
    }
    if (error instanceof Error && error.message === 'CLIENT_APPROVAL_ALREADY_RESPONDED') {
      return res.status(409).json({ error: 'This approval has already been responded to.' });
    }
    if (error instanceof Error && error.message === 'CLIENT_WRITE_FORBIDDEN') {
      return res.status(403).json({ error: 'Your client role is read-only.' });
    }
    console.error('Client approval response failed:', error);
    return res.status(500).json({ error: 'Unable to save this approval response.' });
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
    const authenticatedClient = await optionalClientIdentity(req);

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

    if (
      authenticatedClient &&
      authenticatedClient.email === validatedProperty.customerEmail
    ) {
      try {
        const context = await ensureClientContext(authenticatedClient);
        const clientLink = await linkBookingToClient({
          context,
          booking,
        });
        booking.clientUid = clientLink.clientUid;
        booking.clientOrganisationId = clientLink.clientOrganisationId;
        booking.propertyId = clientLink.propertyId;
      } catch (clientLinkError) {
        // Booking confirmation must not fail because the optional portal linkage
        // could not be written. The next portal load can reconcile by verified email.
        console.error('Client portal booking linkage failed:', clientLinkError);
      }
    }

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

app.get('/api/admin/document-requests', requireAdmin, async (_req, res) => {
  try {
    const requests = await listDocumentRequestsWithSecrets();
    return res.json({ requests });
  } catch (error) {
    console.error('Admin document requests load failed:', error);
    return res.status(500).json({
      error: 'Unable to load document requests.',
    });
  }
});

app.get('/api/admin/client-requests', requireAdmin, async (_req, res) => {
  try {
    const requests = await listClientRequestsForAdmin();
    return res.json({ requests });
  } catch (error) {
    console.error('Admin client requests load failed:', error);
    return res.status(500).json({ error: 'Unable to load client requests.' });
  }
});

app.patch('/api/admin/client-requests/:id', requireAdmin, async (req, res) => {
  try {
    const status = normalizeText(req.body?.status, 40);
    if (!['submitted', 'in_progress', 'waiting_client', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid client request status.' });
    }

    const request = await updateClientRequestForAdmin({
      requestId: req.params.id,
      status: status as 'submitted' | 'in_progress' | 'waiting_client' | 'completed' | 'cancelled',
    });
    if (!request) {
      return res.status(404).json({ error: 'Client request not found.' });
    }
    return res.json({ success: true, request });
  } catch (error) {
    console.error('Admin client request update failed:', error);
    return res.status(500).json({ error: 'Unable to update client request.' });
  }
});

app.get('/api/admin/client-approvals', requireAdmin, async (_req, res) => {
  try {
    const approvals = await listClientApprovalsForAdmin();
    return res.json({ approvals });
  } catch (error) {
    console.error('Admin client approvals load failed:', error);
    return res.status(500).json({ error: 'Unable to load client approvals.' });
  }
});

app.get('/api/admin/client-documents', requireAdmin, async (_req, res) => {
  try {
    const documents = await listClientDocumentsForAdmin();
    return res.json({ documents });
  } catch (error) {
    console.error('Admin client documents load failed:', error);
    return res.status(500).json({ error: 'Unable to load client documents.' });
  }
});

app.get('/api/admin/client-documents/:id/download', requireAdmin, async (req, res) => {
  try {
    const document = await getClientDocumentForAdmin(req.params.id);
    if (!document) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    res.setHeader('Content-Type', document.contentType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`
    );
    res.setHeader('Cache-Control', 'private, no-store');

    const stream = openClientFileStream(document.storagePath);
    stream.on('error', (error) => {
      console.error('Admin client document stream failed:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Unable to download this document.' });
      } else {
        res.destroy(error as Error);
      }
    });
    stream.pipe(res);
  } catch (error) {
    console.error('Admin client document download failed:', error);
    return res.status(500).json({ error: 'Unable to download this document.' });
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
