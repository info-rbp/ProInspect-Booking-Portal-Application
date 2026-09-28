import { createHash } from 'crypto';
import type { BookingRecord, BusinessSettings, InspectionService, PropertyDetails, ServiceCategory } from '../types/booking.js';
import type {
  ClientBookingSummary,
  ClientDocumentSummary,
  ClientPortalDashboard,
  ClientProfile,
  ClientProperty,
  ClientRequestSummary,
} from '../types/clientPortal.js';
import { DEFAULT_SERVICES, DEFAULT_SETTINGS } from '../services/defaultServices.js';
import { adminDb } from './firebaseAdmin.js';
import {
  decryptAccessSecrets,
  restoreSensitiveAccess,
  type EncryptedAccessSecretsDocument,
} from './accessSecrets.js';

const SETTINGS_ID = 'business';
const SERVICE_CATALOGUE_META_ID = 'serviceCatalogue';
const SERVICE_CATALOGUE_VERSION = 4;
let seeded: Promise<void> | null = null;

export async function ensureSeedData() {
  if (!seeded) {
    seeded = (async () => {
      const settingsRef = adminDb.collection('settings').doc(SETTINGS_ID);
      const catalogueMetaRef = adminDb.collection('systemMetadata').doc(SERVICE_CATALOGUE_META_ID);
      const refs = DEFAULT_SERVICES.map((service) => adminDb.collection('services').doc(service.id));
      const [settingsDoc, catalogueMetaDoc, ...docs] = await Promise.all([
        settingsRef.get(),
        catalogueMetaRef.get(),
        ...refs.map((ref) => ref.get()),
      ]);
      const catalogueVersion = Number(catalogueMetaDoc.data()?.version || 0);
      const batch = adminDb.batch();
      let hasWrites = false;

      if (!settingsDoc.exists) {
        batch.set(settingsRef, DEFAULT_SETTINGS);
        hasWrites = true;
      }

      docs.forEach((doc, index) => {
        if (!doc.exists) {
          batch.set(refs[index], DEFAULT_SERVICES[index]);
          hasWrites = true;
          return;
        }

        const existing = doc.data() as Partial<InspectionService>;
        const defaultService = DEFAULT_SERVICES[index];

        if (!Array.isArray(existing.categories) || existing.categories.length === 0) {
          batch.set(
            refs[index],
            { categories: defaultService.categories },
            { merge: true }
          );
          hasWrites = true;
        }

        if (catalogueVersion < SERVICE_CATALOGUE_VERSION) {
          const migrationPatch: Partial<InspectionService> = {
            order: defaultService.order,
          };

          if (
            defaultService.id === 'maintenance-attendance' ||
            defaultService.id === 'other-custom-appointment' ||
            defaultService.id === 'commercial-property-inspection' ||
            defaultService.id === 'building-management-attendance' ||
            defaultService.id === 'follow-up-reinspection' ||
            defaultService.id === 'contractor-access-attendance' ||
            defaultService.id === 'key-handover-collection'
          ) {
            migrationPatch.publicDescription = defaultService.publicDescription;
          }

          if (defaultService.id === 'key-handover-collection') {
            migrationPatch.name = defaultService.name;
          }

          if (
            defaultService.id === 'completed-works-inspection' ||
            defaultService.id === 'follow-up-reinspection' ||
            defaultService.id === 'contractor-access-attendance' ||
            defaultService.id === 'key-handover-collection'
          ) {
            migrationPatch.categories = defaultService.categories;
          }

          batch.set(refs[index], migrationPatch, { merge: true });
          hasWrites = true;
        }
      });

      if (catalogueVersion < SERVICE_CATALOGUE_VERSION) {
        batch.set(
          catalogueMetaRef,
          {
            version: SERVICE_CATALOGUE_VERSION,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        hasWrites = true;
      }

      if (hasWrites) await batch.commit();
    })().catch((error) => {
      seeded = null;
      throw error;
    });
  }
  return seeded;
}

function serviceFromDocument(
  data: Partial<InspectionService>,
  id: string
): InspectionService {
  const service = data as InspectionService;
  return {
    ...service,
    id,
    categories: Array.isArray(service.categories) ? service.categories : [],
  };
}

export async function listServices(publicOnly = false): Promise<InspectionService[]> {
  await ensureSeedData();
  const snapshot = await adminDb.collection('services').orderBy('order', 'asc').get();
  const services = snapshot.docs.map((doc) =>
    serviceFromDocument(doc.data() as Partial<InspectionService>, doc.id)
  );
  return publicOnly ? services.filter((service) => service.active && service.publiclyBookable) : services;
}

export async function getService(serviceId: string): Promise<InspectionService | null> {
  await ensureSeedData();
  const snapshot = await adminDb.collection('services').doc(serviceId).get();
  return snapshot.exists
    ? serviceFromDocument(
        (snapshot.data() || {}) as Partial<InspectionService>,
        snapshot.id
      )
    : null;
}

export async function createService(service: InspectionService): Promise<InspectionService> {
  await ensureSeedData();
  const ref = adminDb.collection('services').doc(service.id);

  await adminDb.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists) {
      throw new Error('SERVICE_ALREADY_EXISTS');
    }
    transaction.set(ref, service);
  });

  return service;
}

export async function updateService(
  serviceId: string,
  service: InspectionService
): Promise<InspectionService | null> {
  await ensureSeedData();
  const ref = adminDb.collection('services').doc(serviceId);
  const existing = await ref.get();

  if (!existing.exists) return null;

  await ref.set(
    {
      ...service,
      id: serviceId,
    },
    { merge: false }
  );

  return {
    ...service,
    id: serviceId,
  };
}

export async function reorderServices(serviceIds: string[]): Promise<InspectionService[]> {
  await ensureSeedData();
  const uniqueIds = Array.from(new Set(serviceIds));

  if (uniqueIds.length !== serviceIds.length) {
    throw new Error('DUPLICATE_SERVICE_IDS');
  }

  const refs = serviceIds.map((id) => adminDb.collection('services').doc(id));
  const snapshots = await Promise.all(refs.map((ref) => ref.get()));

  if (snapshots.some((snapshot) => !snapshot.exists)) {
    throw new Error('SERVICE_NOT_FOUND');
  }

  const batch = adminDb.batch();
  refs.forEach((ref, index) => {
    batch.set(ref, { order: index + 1 }, { merge: true });
  });
  await batch.commit();

  return listServices(false);
}

export async function getSettings(): Promise<BusinessSettings> {
  await ensureSeedData();
  const snapshot = await adminDb.collection('settings').doc(SETTINGS_ID).get();
  return { ...DEFAULT_SETTINGS, ...(snapshot.exists ? snapshot.data() : {}) } as BusinessSettings;
}

export function newBookingId(): string {
  return adminDb.collection('bookings').doc().id;
}

export async function bookingReferenceExists(reference: string): Promise<boolean> {
  const snapshot = await adminDb.collection('bookings').where('bookingReference', '==', reference).limit(1).get();
  return !snapshot.empty;
}

export async function saveBooking(
  booking: BookingRecord,
  encryptedAccessSecrets?: EncryptedAccessSecretsDocument
): Promise<BookingRecord> {
  const bookingRef = adminDb.collection('bookings').doc(booking.id);
  const batch = adminDb.batch();
  batch.set(bookingRef, booking);

  if (encryptedAccessSecrets) {
    batch.set(
      adminDb.collection('bookingAccessSecrets').doc(booking.id),
      encryptedAccessSecrets
    );
  }

  await batch.commit();
  return booking;
}

export async function listBookings(): Promise<BookingRecord[]> {
  const snapshot = await adminDb.collection('bookings').orderBy('appointment.start', 'desc').limit(500).get();
  return snapshot.docs.map((doc) => ({ ...(doc.data() as BookingRecord), id: doc.id }));
}

export async function listBookingsWithAccessSecrets(): Promise<BookingRecord[]> {
  const bookings = await listBookings();
  if (bookings.length === 0) return bookings;

  const refs = bookings.map((booking) =>
    adminDb.collection('bookingAccessSecrets').doc(booking.id)
  );
  const secretDocs = await adminDb.getAll(...refs);

  return bookings.map((booking, index) => {
    const secretDoc = secretDocs[index];
    if (!secretDoc?.exists) return booking;

    try {
      const secrets = decryptAccessSecrets(
        booking.id,
        secretDoc.data() as EncryptedAccessSecretsDocument
      );
      return {
        ...booking,
        access: restoreSensitiveAccess(booking.access, secrets),
      };
    } catch (error) {
      console.error(
        `Failed to decrypt sensitive access details for booking ${booking.id}:`,
        error
      );
      return booking;
    }
  });
}

export async function getBooking(bookingId: string): Promise<BookingRecord | null> {
  const snapshot = await adminDb.collection('bookings').doc(bookingId).get();
  return snapshot.exists ? ({ ...(snapshot.data() as BookingRecord), id: snapshot.id }) : null;
}

export async function findBookingByToken(token: string): Promise<BookingRecord | null> {
  const snapshot = await adminDb.collection('bookings').where('managementToken', '==', token).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { ...(doc.data() as BookingRecord), id: doc.id };
}

export async function activeBookingsForDate(dateKey: string): Promise<BookingRecord[]> {
  const snapshot = await adminDb.collection('bookings').where('appointment.dateKey', '==', dateKey).get();
  return snapshot.docs
    .map((doc) => ({ ...(doc.data() as BookingRecord), id: doc.id }))
    .filter((booking) => booking.status === 'confirmed');
}

export async function updateBooking(bookingId: string, changes: Partial<BookingRecord>): Promise<BookingRecord | null> {
  const ref = adminDb.collection('bookings').doc(bookingId);
  const existing = await ref.get();
  if (!existing.exists) return null;

  await ref.set({ ...changes, updatedAt: new Date().toISOString() }, { merge: true });
  const updated = await ref.get();
  return { ...(updated.data() as BookingRecord), id: updated.id };
}

function clientPropertyKey(uid: string, property: PropertyDetails): string {
  const address = [
    property.unit || '',
    property.streetAddress,
    property.suburb,
    property.state,
    property.postcode,
  ]
    .map((value) => value.trim().toLowerCase())
    .join('|');

  return createHash('sha256')
    .update(`${uid}|${address}`)
    .digest('hex')
    .slice(0, 32);
}

export function clientPropertyIdFor(uid: string, property: PropertyDetails): string {
  return clientPropertyKey(uid, property);
}

export async function ensureClientProfile(params: {
  uid: string;
  email: string;
  displayName?: string;
}): Promise<ClientProfile> {
  const ref = adminDb.collection('clientUsers').doc(params.uid);
  const existing = await ref.get();
  const now = new Date().toISOString();
  const current = existing.exists ? (existing.data() as Partial<ClientProfile>) : {};

  if (current.active === false) {
    throw new Error('CLIENT_ACCOUNT_DISABLED');
  }

  const profile: ClientProfile = {
    uid: params.uid,
    email: params.email.toLowerCase(),
    displayName: params.displayName?.trim() || current.displayName || params.email,
    organisationName: current.organisationName,
    phone: current.phone,
    active: true,
    createdAt: current.createdAt || now,
    updatedAt: now,
  };

  await ref.set(profile, { merge: true });
  return profile;
}

async function upsertClientProperty(
  uid: string,
  email: string,
  property: PropertyDetails,
  category?: ServiceCategory,
  lastBookingAt?: string
): Promise<string> {
  const id = clientPropertyKey(uid, property);
  const ref = adminDb.collection('clientProperties').doc(id);
  const existing = await ref.get();
  const now = new Date().toISOString();
  const current = existing.exists ? (existing.data() as Partial<ClientProperty>) : {};
  const categories = Array.from(
    new Set<ServiceCategory>([
      ...((current.categories || []) as ServiceCategory[]),
      ...(category ? [category] : []),
    ])
  );

  const record: ClientProperty = {
    id,
    clientUid: uid,
    clientEmail: email.toLowerCase(),
    streetAddress: property.streetAddress,
    unit: property.unit,
    suburb: property.suburb,
    state: property.state,
    postcode: property.postcode,
    propertyType: property.propertyType,
    clientName: property.clientName,
    clientReference: property.clientReference,
    categories,
    createdAt: current.createdAt || now,
    updatedAt: now,
    lastBookingAt: lastBookingAt || current.lastBookingAt,
  };

  await ref.set(record, { merge: true });
  return id;
}

export async function linkHistoricalBookingsToClient(params: {
  uid: string;
  email: string;
}): Promise<void> {
  const email = params.email.trim().toLowerCase();
  const snapshot = await adminDb
    .collection('bookings')
    .where('property.customerEmail', '==', email)
    .limit(500)
    .get();

  if (snapshot.empty) return;

  for (const doc of snapshot.docs) {
    const booking = { ...(doc.data() as BookingRecord), id: doc.id };
    const propertyId = await upsertClientProperty(
      params.uid,
      email,
      booking.property,
      booking.serviceCategory,
      booking.appointment.start
    );

    if (
      booking.clientUid !== params.uid ||
      booking.propertyId !== propertyId
    ) {
      await doc.ref.set(
        {
          clientUid: params.uid,
          propertyId,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }
  }
}

export async function linkBookingToClient(params: {
  uid: string;
  email: string;
  booking: BookingRecord;
}): Promise<{ clientUid: string; propertyId: string }> {
  const propertyId = await upsertClientProperty(
    params.uid,
    params.email,
    params.booking.property,
    params.booking.serviceCategory,
    params.booking.appointment.start
  );

  return {
    clientUid: params.uid,
    propertyId,
  };
}

function clientBookingView(booking: BookingRecord): ClientBookingSummary {
  return {
    id: booking.id,
    bookingReference: booking.bookingReference,
    propertyId: booking.propertyId,
    serviceName: booking.serviceName,
    serviceCategory: booking.serviceCategory,
    status: booking.status,
    property: {
      streetAddress: booking.property.streetAddress,
      unit: booking.property.unit,
      suburb: booking.property.suburb,
      state: booking.property.state,
      postcode: booking.property.postcode,
      propertyType: booking.property.propertyType,
    },
    appointment: {
      start: booking.appointment.start,
      end: booking.appointment.end,
      dateString: booking.appointment.dateString,
      timeString: booking.appointment.timeString,
      durationMinutes: booking.appointment.durationMinutes,
      timezone: booking.appointment.timezone,
    },
    createdAt: booking.createdAt,
  };
}

export async function getClientPortalDashboard(params: {
  uid: string;
  email: string;
  displayName?: string;
}): Promise<ClientPortalDashboard> {
  const profile = await ensureClientProfile(params);
  await linkHistoricalBookingsToClient(params);

  const [propertiesSnapshot, bookingsSnapshot, requestsSnapshot, documentsSnapshot] =
    await Promise.all([
      adminDb.collection('clientProperties').where('clientUid', '==', params.uid).get(),
      adminDb.collection('bookings').where('clientUid', '==', params.uid).get(),
      adminDb.collection('clientRequests').where('clientUid', '==', params.uid).get(),
      adminDb.collection('clientDocuments').where('clientUid', '==', params.uid).get(),
    ]);

  const properties = propertiesSnapshot.docs
    .map((doc) => ({ ...(doc.data() as ClientProperty), id: doc.id }))
    .sort((a, b) => (b.lastBookingAt || '').localeCompare(a.lastBookingAt || ''));

  const bookings = bookingsSnapshot.docs
    .map((doc) => clientBookingView({ ...(doc.data() as BookingRecord), id: doc.id }))
    .sort(
      (a, b) =>
        new Date(b.appointment.start).getTime() -
        new Date(a.appointment.start).getTime()
    );

  const requests = requestsSnapshot.docs
    .map((doc) => ({ ...(doc.data() as ClientRequestSummary), id: doc.id }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const documents = documentsSnapshot.docs
    .map((doc) => ({ ...(doc.data() as ClientDocumentSummary), id: doc.id }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return {
    profile,
    properties,
    bookings,
    requests,
    documents,
  };
}


const SCHEDULE_LOCK_INTERVAL_MINUTES = 15;

function scheduleLockIndexes(
  startIso: string,
  endIso: string,
  bufferBeforeMinutes: number,
  bufferAfterMinutes: number
): number[] {
  const intervalMs = SCHEDULE_LOCK_INTERVAL_MINUTES * 60_000;
  const startMs = new Date(startIso).getTime() - bufferBeforeMinutes * 60_000;
  const endMs = new Date(endIso).getTime() + bufferAfterMinutes * 60_000;
  const first = Math.floor(startMs / intervalMs);
  const lastExclusive = Math.ceil(endMs / intervalMs);
  const indexes: number[] = [];

  for (let index = first; index < lastExclusive; index += 1) {
    indexes.push(index);
  }

  return indexes;
}

function calendarLockPrefix(calendarId: string): string {
  return createHash('sha256').update(calendarId).digest('hex').slice(0, 16);
}

export class ScheduleLockConflictError extends Error {
  constructor() {
    super('The requested appointment is currently being confirmed by another booking.');
    this.name = 'ScheduleLockConflictError';
  }
}

export async function acquireScheduleLocks(params: {
  bookingId: string;
  calendarId: string;
  start: string;
  end: string;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
}): Promise<void> {
  const prefix = calendarLockPrefix(params.calendarId);
  const indexes = scheduleLockIndexes(
    params.start,
    params.end,
    params.bufferBeforeMinutes,
    params.bufferAfterMinutes
  );
  const refs = indexes.map((index) =>
    adminDb.collection('scheduleLocks').doc(`${prefix}_${index}`)
  );
  const now = Date.now();
  const temporaryExpiry = new Date(now + 5 * 60_000).toISOString();

  await adminDb.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));

    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue;
      const data = snapshot.data();
      const expiresAt = Date.parse(String(data?.expiresAt || ''));

      if (
        data?.bookingId !== params.bookingId &&
        Number.isFinite(expiresAt) &&
        expiresAt > now
      ) {
        throw new ScheduleLockConflictError();
      }
    }

    for (const ref of refs) {
      transaction.set(ref, {
        bookingId: params.bookingId,
        expiresAt: temporaryExpiry,
        updatedAt: new Date().toISOString(),
      });
    }
  });
}

export async function releaseScheduleLocks(bookingId: string): Promise<void> {
  const snapshot = await adminDb
    .collection('scheduleLocks')
    .where('bookingId', '==', bookingId)
    .get();

  if (snapshot.empty) return;

  const batch = adminDb.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}
