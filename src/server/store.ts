import type { BookingRecord, BusinessSettings, InspectionService } from '../types/booking.js';
import { DEFAULT_SERVICES, DEFAULT_SETTINGS } from '../services/defaultServices.js';
import { adminDb } from './firebaseAdmin.js';

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

export async function listServices(publicOnly = false): Promise<InspectionService[]> {
  await ensureSeedData();
  const snapshot = await adminDb.collection('services').orderBy('order', 'asc').get();
  const services = snapshot.docs.map((doc) => ({ ...(doc.data() as InspectionService), id: doc.id }));
  return publicOnly ? services.filter((service) => service.active && service.publiclyBookable) : services;
}

export async function getService(serviceId: string): Promise<InspectionService | null> {
  await ensureSeedData();
  const snapshot = await adminDb.collection('services').doc(serviceId).get();
  return snapshot.exists ? ({ ...(snapshot.data() as InspectionService), id: snapshot.id }) : null;
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

export async function saveBooking(booking: BookingRecord): Promise<BookingRecord> {
  await adminDb.collection('bookings').doc(booking.id).set(booking);
  return booking;
}

export async function listBookings(): Promise<BookingRecord[]> {
  const snapshot = await adminDb.collection('bookings').orderBy('appointment.start', 'desc').limit(500).get();
  return snapshot.docs.map((doc) => ({ ...(doc.data() as BookingRecord), id: doc.id }));
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
