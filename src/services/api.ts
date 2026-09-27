import type {
  InspectionService,
  BusinessSettings,
  AppointmentSlot,
  BookingRecord,
} from '../types/booking';
import { getAdminIdToken } from './firebase';

export async function fetchServices(): Promise<InspectionService[]> {
  const res = await fetch('/api/services');
  if (!res.ok) throw new Error('Failed to fetch services.');
  const data = await res.json();
  return data.services;
}

export async function fetchSettings(): Promise<BusinessSettings> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error('Failed to fetch settings.');
  const data = await res.json();
  return data.settings;
}

export async function fetchAvailability(
  date: string,
  serviceId: string
): Promise<{ slots: AppointmentSlot[]; message?: string }> {
  const query = new URLSearchParams({ date, serviceId });
  const res = await fetch(`/api/calendar/availability?${query.toString()}`);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch availability.');
  }

  return data;
}

export async function submitBooking(payload: {
  serviceId: string;
  property: unknown;
  access: unknown;
  appointment: { start: string };
}): Promise<{ success: boolean; booking: BookingRecord; message?: string }> {
  const res = await fetch('/api/bookings/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (!res.ok) {
    const error = new Error(data.error || 'Failed to confirm booking.');
    (error as any).conflict = Boolean(data.conflict);
    throw error;
  }

  return data;
}

async function adminFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const idToken = await getAdminIdToken();

  if (!idToken) {
    throw new Error('Administrator authentication is required.');
  }

  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${idToken}`);

  return fetch(input, {
    ...init,
    headers,
  });
}

export async function verifyAdminSession(): Promise<void> {
  const res = await adminFetch('/api/admin/session');
  if (!res.ok) {
    throw new Error('This Google account is not authorised for ProInspect administration.');
  }
}

export async function fetchAdminBookings(): Promise<BookingRecord[]> {
  const res = await adminFetch('/api/admin/bookings');
  if (!res.ok) throw new Error('Failed to load bookings.');
  const data = await res.json();
  return data.bookings;
}

export async function fetchAdminServices(): Promise<InspectionService[]> {
  const res = await adminFetch('/api/admin/services');
  if (!res.ok) throw new Error('Failed to load services.');
  const data = await res.json();
  return data.services;
}

export async function fetchAdminSettings(): Promise<BusinessSettings> {
  const res = await adminFetch('/api/admin/settings');
  if (!res.ok) throw new Error('Failed to load settings.');
  const data = await res.json();
  return data.settings;
}

export async function updateAdminBooking(
  id: string,
  updates: { status?: string; adminNotes?: string }
): Promise<BookingRecord> {
  const res = await adminFetch(`/api/admin/bookings/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Failed to update booking.');
  }

  return data.booking;
}

export async function fetchBookingByToken(token: string): Promise<any> {
  const res = await fetch(`/api/bookings/manage/${encodeURIComponent(token)}`);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Booking not found.');
  }

  return data.booking;
}
