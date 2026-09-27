import { InspectionService, BusinessSettings, AppointmentSlot, BookingRecord } from '../types/booking';
import { getCachedAccessToken } from './firebase';

export async function fetchServices(): Promise<InspectionService[]> {
  try {
    const res = await fetch('/api/services');
    if (!res.ok) throw new Error('Failed to fetch services');
    const data = await res.json();
    return data.services;
  } catch (error) {
    console.warn('Falling back to local services:', error);
    const { DEFAULT_SERVICES } = await import('./defaultServices');
    return DEFAULT_SERVICES;
  }
}

export async function fetchSettings(): Promise<BusinessSettings> {
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) throw new Error('Failed to fetch settings');
    const data = await res.json();
    return data.settings;
  } catch (error) {
    console.warn('Falling back to local settings:', error);
    const { DEFAULT_SETTINGS } = await import('./defaultServices');
    return DEFAULT_SETTINGS;
  }
}

export async function fetchAvailability(
  date: string,
  duration: number = 45,
  bufferBefore: number = 15,
  bufferAfter: number = 15
): Promise<{ slots: AppointmentSlot[]; message?: string }> {
  const token = getCachedAccessToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const queryParams = new URLSearchParams({
    date,
    duration: String(duration),
    bufferBefore: String(bufferBefore),
    bufferAfter: String(bufferAfter),
  });

  const res = await fetch(`/api/calendar/availability?${queryParams.toString()}`, {
    headers,
  });

  if (!res.ok) {
    throw new Error('Failed to fetch availability.');
  }

  return await res.json();
}

export async function submitBooking(payload: {
  serviceId: string;
  property: any;
  access: any;
  appointment: any;
}): Promise<{ success: boolean; booking: BookingRecord; message?: string }> {
  const token = getCachedAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch('/api/bookings/create', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (!res.ok) {
    const err = new Error(data.error || 'Failed to confirm booking.');
    (err as any).conflict = data.conflict;
    throw err;
  }

  return data;
}

export async function fetchAdminBookings(): Promise<BookingRecord[]> {
  const res = await fetch('/api/admin/bookings');
  if (!res.ok) throw new Error('Failed to load bookings.');
  const data = await res.json();
  return data.bookings;
}

export async function updateAdminBooking(
  id: string,
  updates: { status?: string; adminNotes?: string }
): Promise<BookingRecord> {
  const res = await fetch(`/api/admin/bookings/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update booking.');
  const data = await res.json();
  return data.booking;
}

export async function fetchBookingByToken(token: string): Promise<BookingRecord> {
  const res = await fetch(`/api/bookings/manage/${token}`);
  if (!res.ok) throw new Error('Booking not found.');
  const data = await res.json();
  return data.booking;
}

export async function syncServerOAuthToken(accessToken: string) {
  try {
    await fetch('/api/admin/sync-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken }),
    });
  } catch (err) {
    console.warn('Failed to sync token to server:', err);
  }
}
