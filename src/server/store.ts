import { createHash } from 'crypto';
import type { BookingRecord, BusinessSettings, InspectionService } from '../types/booking.js';
import { DEFAULT_SERVICES, DEFAULT_SETTINGS } from '../services/defaultServices.js';
import { adminDb } from './firebaseAdmin.js';
import {
  decryptAccessSecrets,
  restoreSensitiveAccess,
  type EncryptedAccessSecretsDocument,
} from './accessSecrets.js';

const SETTINGS_ID = 'business';
let seeded: Promise<void> | null = null;

export async function ensureSeedData() {
  if (!seeded) {
    seeded = (async () => {
      const settingsRef = adminDb.collection('settings').doc(SETTINGS_ID);
      const settingsDoc = await settingsRef.get();
      const refs = DEFAULT_SERVICES.map((service) => adminDb.collection('services').doc(service.id));
      const docs = await Promise.all(refs.map((ref) => ref.get()));
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
        if (!Array.isArray(existing.categories) || existing.categories.length === 0) {
          batch.set(
            refs[index],
            { categories: DEFAULT_SERVICES[index].categories },
            { merge: true }
          );
          hasWrites = true;
        }
      });

      if (hasWrites) await batch.commit();
    })().catch((error) => {
      seeded = null;
      throw error;
    });
  }
  return seeded;
}

function serviceFromDocument(
  data: FirebaseFirestore.DocumentData,
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
  const services = snapshot.docs.map((doc) => serviceFromDocument(doc.data(), doc.id));
  return publicOnly ? services.filter((service) => service.active && service.publiclyBookable) : services;
}

export async function getService(serviceId: string): Promise<InspectionService | null> {
  await ensureSeedData();
  const snapshot = await adminDb.collection('services').doc(serviceId).get();
  return snapshot.exists ? serviceFromDocument(snapshot.data() || {}, snapshot.id) : null;
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
