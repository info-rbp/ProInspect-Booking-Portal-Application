import { GoogleAuth } from 'google-auth-library';
import type { BookingRecord } from '../types/booking.js';

export interface BusyInterval {
  start: string;
  end: string;
}

let authClientPromise: Promise<any> | null = null;

function configuredCalendarId(serviceCalendarId?: string): string {
  const id = serviceCalendarId || process.env.GOOGLE_CALENDAR_ID;
  if (!id) throw new Error('GOOGLE_CALENDAR_ID is not configured.');
  return id;
}

async function getAuthClient() {
  if (!authClientPromise) {
    const credentialsJson = process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON;
    const credentials = credentialsJson ? JSON.parse(credentialsJson) : undefined;
    if (credentials?.private_key) {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }

    const auth = new GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.events.freebusy',
      ],
    });
    authClientPromise = auth.getClient();
  }

  return authClientPromise;
}

async function request(url: string, init: RequestInit = {}) {
  const client = await getAuthClient();
  const tokenResult = await client.getAccessToken();
  const token = typeof tokenResult === 'string' ? tokenResult : tokenResult?.token;

  if (!token) throw new Error('Google Calendar authentication did not return an access token.');

  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

export function calendarIsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CALENDAR_ID);
}

export function getCalendarId(serviceCalendarId?: string): string {
  return configuredCalendarId(serviceCalendarId);
}

export async function freeBusy(params: {
  timeMin: string;
  timeMax: string;
  timezone: string;
  calendarId?: string;
}): Promise<BusyInterval[]> {
  const calendarId = configuredCalendarId(params.calendarId);
  const response = await request('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    body: JSON.stringify({
      timeMin: params.timeMin,
      timeMax: params.timeMax,
      timeZone: params.timezone,
      items: [{ id: calendarId }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Google Calendar availability request failed with status ${response.status}.`);
  }

  const data = await response.json();
  return data.calendars?.[calendarId]?.busy || [];
}

function calendarDescription(booking: BookingRecord): string {
  const lines = [
    'BOOKING REFERENCE',
    booking.bookingReference,
    '',
    'SERVICE',
    booking.serviceName,
    '',
    'PROPERTY',
    `${booking.property.unit ? `${booking.property.unit}, ` : ''}${booking.property.streetAddress}`,
    `${booking.property.suburb} ${booking.property.state} ${booking.property.postcode}`,
    '',
    'BOOKING CONTACT',
    booking.property.customerName,
    booking.property.customerEmail,
    booking.property.customerPhone,
    '',
    'ACCESS',
    booking.access.method.replaceAll('_', ' '),
    '',
    'IMPORTANT',
    'Sensitive access information is stored in the ProInspect Operations Portal and is not included in this calendar event.',
  ];

  if (booking.property.clientName) {
    lines.push('', 'CLIENT', booking.property.clientName);
    if (booking.property.clientReference) {
      lines.push(`Reference: ${booking.property.clientReference}`);
    }
  }

  return lines.join('\n');
}

export async function createEvent(
  booking: BookingRecord,
  serviceCalendarId?: string
): Promise<{ eventId: string; htmlLink?: string }> {
  const calendarId = configuredCalendarId(serviceCalendarId);
  const fullAddress = `${booking.property.unit ? `${booking.property.unit}, ` : ''}${booking.property.streetAddress}, ${booking.property.suburb} ${booking.property.state} ${booking.property.postcode}`;

  const response = await request(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`,
    {
      method: 'POST',
      body: JSON.stringify({
        summary: `${booking.serviceName} | ${fullAddress}`,
        location: fullAddress,
        description: calendarDescription(booking),
        start: {
          dateTime: booking.appointment.start,
          timeZone: booking.appointment.timezone,
        },
        end: {
          dateTime: booking.appointment.end,
          timeZone: booking.appointment.timezone,
        },
        reminders: { useDefault: true },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Google Calendar event creation failed with status ${response.status}.`);
  }

  const data = await response.json();
  if (!data.id) throw new Error('Google Calendar did not return an event ID.');

  return { eventId: data.id, htmlLink: data.htmlLink };
}

export async function deleteEvent(eventId: string, serviceCalendarId?: string): Promise<void> {
  const calendarId = configuredCalendarId(serviceCalendarId);
  const response = await request(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE' }
  );

  if (response.status === 404 || response.status === 410) return;
  if (!response.ok) {
    throw new Error(`Google Calendar event cancellation failed with status ${response.status}.`);
  }
}
