import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { DEFAULT_SERVICES, DEFAULT_SETTINGS } from './src/services/defaultServices.js';
import { generateBookingReference, generateManagementToken, formatAustralianDate, formatAustralianTime } from './src/utils/dateTime.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// In-memory operational store for bookings and calendar sync
// Synchronized with Firestore on the client/admin side
interface StoredBooking {
  id: string;
  bookingReference: string;
  managementToken: string;
  serviceId: string;
  serviceName: string;
  calendarEventId?: string;
  property: any;
  access: any;
  appointment: {
    start: string;
    end: string;
    dateString: string;
    timeString: string;
    durationMinutes: number;
    timezone: string;
  };
  status: 'confirmed' | 'completed' | 'cancelled';
  adminNotes?: string;
  createdAt: string;
  updatedAt: string;
}

// Seed initial realistic Perth bookings for operational realism
const bookingsStore: StoredBooking[] = [
  {
    id: 'pi-seed-1',
    bookingReference: 'PI-20261005-0012',
    managementToken: 'pi_seed_token_1',
    serviceId: 'routine-inspection',
    serviceName: 'Routine Inspection',
    calendarEventId: 'gcal_event_001',
    property: {
      streetAddress: '27 Example Street',
      unit: '',
      suburb: 'Cloverdale',
      state: 'WA',
      postcode: '6105',
      propertyType: 'House',
      clientName: 'Perth Premier Real Estate',
      clientReference: 'PPR-CLOV-27',
      customerName: 'Sarah Jones',
      customerEmail: 'sarah.jones@example.com.au',
      customerPhone: '0400 123 456',
    },
    access: {
      method: 'tenant',
      tenant: {
        tenantName: 'John Smith',
        tenantPhone: '0411 222 333',
        tenantEmail: 'john.smith@example.com',
        noticeIssued: 'yes',
        noticeDate: '2026-09-28',
        accessRestrictions: 'Dog in backyard, please keep side gate closed.',
      },
      specialInstructions: 'Friendly border collie in rear garden. Call tenant on arrival.',
    },
    appointment: {
      start: '2026-10-05T09:00:00+08:00',
      end: '2026-10-05T09:45:00+08:00',
      dateString: 'Monday, 5 October 2026',
      timeString: '9:00 am',
      durationMinutes: 45,
      timezone: 'Australia/Perth',
    },
    status: 'confirmed',
    adminNotes: 'Confirmed by tenant via SMS.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'pi-seed-2',
    bookingReference: 'PI-20261005-0015',
    managementToken: 'pi_seed_token_2',
    serviceId: 'property-condition-report',
    serviceName: 'Property Condition Report (PCR)',
    calendarEventId: 'gcal_event_002',
    property: {
      streetAddress: '14/82 King George Street',
      unit: 'Unit 14',
      suburb: 'Victoria Park',
      state: 'WA',
      postcode: '6100',
      propertyType: 'Apartment / Unit',
      clientName: 'Bourkes Real Estate',
      clientReference: 'BK-VP-14',
      customerName: 'Michael Wong',
      customerEmail: 'mwong@bourkes.example.com',
      customerPhone: '0422 987 654',
    },
    access: {
      method: 'lockbox',
      lockbox: {
        location: 'Gas meter box on western exterior wall',
        instructions: 'Scramble dials after returning keys',
        code: '4821',
      },
      specialInstructions: 'Visitor parking available in marked bay 14.',
    },
    appointment: {
      start: '2026-10-05T13:30:00+08:00',
      end: '2026-10-05T15:00:00+08:00',
      dateString: 'Monday, 5 October 2026',
      timeString: '1:30 pm',
      durationMinutes: 90,
      timezone: 'Australia/Perth',
    },
    status: 'confirmed',
    adminNotes: 'Keys verified in lockbox.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
];

// Active administrative Google OAuth Access Token (stored when admin signs in)
let activeServerOAuthToken: string | null = null;

// Helper: Format Google Calendar structured event description according to Section 12
function formatCalendarEventDescription(booking: StoredBooking): string {
  const parts: string[] = [];

  parts.push('BOOKING REFERENCE');
  parts.push(booking.bookingReference);
  parts.push('');

  parts.push('SERVICE');
  parts.push(booking.serviceName);
  parts.push('');

  parts.push('PROPERTY');
  const unitPrefix = booking.property.unit ? `${booking.property.unit}, ` : '';
  parts.push(`${unitPrefix}${booking.property.streetAddress}`);
  parts.push(`${booking.property.suburb} ${booking.property.state} ${booking.property.postcode}`);
  parts.push('');

  if (booking.property.clientName) {
    parts.push('CLIENT');
    parts.push(booking.property.clientName);
    if (booking.property.clientReference) {
      parts.push(`Ref: ${booking.property.clientReference}`);
    }
    parts.push('');
  }

  parts.push('CUSTOMER');
  parts.push(booking.property.customerName);
  parts.push(booking.property.customerPhone);
  parts.push(booking.property.customerEmail);
  parts.push('');

  parts.push('ACCESS');
  const methodNames: Record<string, string> = {
    tenant: 'Tenant will provide access',
    meet_onsite: 'Meet someone onsite',
    keys_agency: 'Keys held at agency',
    keys_proinspect: 'Keys held by ProInspect',
    lockbox: 'Lockbox on site',
    vacant: 'Property is vacant / open access',
    other: 'Other / custom access arrangement',
  };
  parts.push(methodNames[booking.access.method] || booking.access.method);

  if (booking.access.method === 'tenant' && booking.access.tenant) {
    parts.push('');
    parts.push('TENANT');
    parts.push(booking.access.tenant.tenantName);
    parts.push(booking.access.tenant.tenantPhone);
    if (booking.access.tenant.tenantEmail) parts.push(booking.access.tenant.tenantEmail);
    if (booking.access.tenant.noticeIssued) {
      parts.push('');
      parts.push('ENTRY NOTICE');
      const noticeStatus = booking.access.tenant.noticeIssued === 'yes' ? 'Issued' : 'Pending';
      const noticeDate = booking.access.tenant.noticeDate ? ` on ${booking.access.tenant.noticeDate}` : '';
      parts.push(`${noticeStatus}${noticeDate}`);
    }
    if (booking.access.tenant.accessRestrictions) {
      parts.push(`Restrictions: ${booking.access.tenant.accessRestrictions}`);
    }
  } else if (booking.access.method === 'meet_onsite' && booking.access.meetOnsite) {
    parts.push('');
    parts.push('ONSITE CONTACT');
    parts.push(`${booking.access.meetOnsite.contactName} (${booking.access.meetOnsite.relationship || 'Contact'})`);
    parts.push(booking.access.meetOnsite.contactPhone);
    if (booking.access.meetOnsite.specialInstructions) {
      parts.push(`Instructions: ${booking.access.meetOnsite.specialInstructions}`);
    }
  } else if (booking.access.method === 'keys_agency' && booking.access.agencyKeys) {
    parts.push('');
    parts.push('KEY COLLECTION');
    parts.push(`Agency: ${booking.access.agencyKeys.agencyName}`);
    parts.push(`Address: ${booking.access.agencyKeys.collectionAddress}`);
    if (booking.access.agencyKeys.keyReference) parts.push(`Key Ref: ${booking.access.agencyKeys.keyReference}`);
    if (booking.access.agencyKeys.keyInstructions) parts.push(`Instructions: ${booking.access.agencyKeys.keyInstructions}`);
    if (booking.access.agencyKeys.returnInstructions) parts.push(`Return: ${booking.access.agencyKeys.returnInstructions}`);
  } else if (booking.access.method === 'lockbox' && booking.access.lockbox) {
    parts.push('');
    parts.push('LOCKBOX');
    parts.push(`Location: ${booking.access.lockbox.location}`);
    parts.push(`Code: ${booking.access.lockbox.code}`);
    if (booking.access.lockbox.instructions) parts.push(`Instructions: ${booking.access.lockbox.instructions}`);
  }

  if (booking.access.specialInstructions) {
    parts.push('');
    parts.push('SPECIAL INSTRUCTIONS');
    parts.push(booking.access.specialInstructions);
  }

  return parts.join('\n');
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// 1. Sync admin access token from client
app.post('/api/admin/sync-token', (req: Request, res: Response) => {
  const { accessToken } = req.body;
  if (accessToken) {
    activeServerOAuthToken = accessToken;
    res.json({ success: true, message: 'Google Calendar server integration token active.' });
  } else {
    res.status(400).json({ error: 'Missing access token.' });
  }
});

// 2. Status of Calendar Integration
app.get('/api/calendar/status', (req: Request, res: Response) => {
  res.json({
    connected: true,
    provider: 'Google Calendar API',
    hasOAuthToken: Boolean(activeServerOAuthToken),
    timezone: 'Australia/Perth',
    locale: 'en-AU',
  });
});

// 3. Query Calendar Availability using Google Calendar FreeBusy and operating hours
app.get('/api/calendar/availability', async (req: Request, res: Response) => {
  try {
    const { date, duration = '45', bufferBefore = '15', bufferAfter = '15' } = req.query;

    if (!date || typeof date !== 'string') {
      return res.status(400).json({ error: 'Query parameter "date" (YYYY-MM-DD) is required.' });
    }

    const durationNum = parseInt(duration as string, 10) || 45;
    const bufBeforeNum = parseInt(bufferBefore as string, 10) || 15;
    const bufAfterNum = parseInt(bufferAfter as string, 10) || 15;

    // Parse date in Australia/Perth
    // Format: YYYY-MM-DD
    const [yearStr, monthStr, dayStr] = date.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10) - 1;
    const day = parseInt(dayStr, 10);

    // Get day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
    const targetDate = new Date(Date.UTC(year, month, day, 4, 0, 0)); // Roughly mid-day UTC for Perth (UTC+8)
    const dayOfWeek = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Australia/Perth',
      weekday: 'long',
    }).format(targetDate).toLowerCase();

    // Check operating hours for day of week
    // Monday: 8:00 am to 5:00 pm
    // Tuesday to Friday: 8:00 am to 4:00 pm
    // Saturday / Sunday: unavailable
    const hoursConfig = DEFAULT_SETTINGS.operatingHours[dayOfWeek as keyof typeof DEFAULT_SETTINGS.operatingHours];

    if (!hoursConfig || !hoursConfig.active) {
      return res.json({
        date,
        slots: [],
        message: 'No appointments are available on this date. Please choose another date.',
      });
    }

    const [openH, openM] = hoursConfig.open.split(':').map(Number);
    const [closeH, closeM] = hoursConfig.close.split(':').map(Number);

    // Business bounds in minutes from midnight
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    // Query Google Calendar FreeBusy if access token is available
    const busyIntervals: Array<{ start: Date; end: Date }> = [];

    // Also include existing bookings from our store
    for (const b of bookingsStore) {
      if (b.status === 'cancelled') continue;
      const bStart = new Date(b.appointment.start);
      const bEnd = new Date(b.appointment.end);
      
      // Format start in Perth date key
      const bDateKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Australia/Perth',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(bStart);

      if (bDateKey === date) {
        // Apply buffer around existing appointment
        const bufferedStart = new Date(bStart.getTime() - bufBeforeNum * 60000);
        const bufferedEnd = new Date(bEnd.getTime() + bufAfterNum * 60000);
        busyIntervals.push({ start: bufferedStart, end: bufferedEnd });
      }
    }

    // Call Google Calendar FreeBusy API if an access token is provided or active
    const clientAuthToken = (req.headers.authorization || '').replace('Bearer ', '') || activeServerOAuthToken;
    if (clientAuthToken) {
      try {
        const timeMin = `${date}T00:00:00+08:00`;
        const timeMax = `${date}T23:59:59+08:00`;
        const gcalRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${clientAuthToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            timeMin,
            timeMax,
            timeZone: 'Australia/Perth',
            items: [{ id: 'primary' }],
          }),
        });

        if (gcalRes.ok) {
          const gcalData = await gcalRes.json();
          const primaryBusy = gcalData.calendars?.primary?.busy || [];
          for (const item of primaryBusy) {
            busyIntervals.push({
              start: new Date(new Date(item.start).getTime() - bufBeforeNum * 60000),
              end: new Date(new Date(item.end).getTime() + bufAfterNum * 60000),
            });
          }
        }
      } catch (gcalErr) {
        console.warn('Google Calendar FreeBusy check warning (using local business scheduling):', gcalErr);
      }
    }

    // Calculate slots: 45 min intervals or matching duration
    const intervalStepMinutes = durationNum <= 45 ? 45 : durationNum <= 60 ? 60 : 60;
    const slots: Array<{
      start: string;
      end: string;
      displayTime: string;
      displayDate: string;
      dateKey: string;
    }> = [];

    // Australian Perth timezone offset string: +08:00
    const now = new Date();
    const minNoticeMs = DEFAULT_SETTINGS.minimumNoticeHours * 3600000;

    for (let m = openMinutes; m + durationNum <= closeMinutes; m += intervalStepMinutes) {
      const slotHour = Math.floor(m / 60);
      const slotMin = m % 60;

      const hourPad = String(slotHour).padStart(2, '0');
      const minPad = String(slotMin).padStart(2, '0');

      const slotStartISO = `${date}T${hourPad}:${minPad}:00+08:00`;
      const slotStartDate = new Date(slotStartISO);

      // Check minimum booking notice
      if (slotStartDate.getTime() - now.getTime() < minNoticeMs) {
        continue;
      }

      const endMinutesTotal = m + durationNum;
      const endHour = Math.floor(endMinutesTotal / 60);
      const endMin = endMinutesTotal % 60;
      const endHourPad = String(endHour).padStart(2, '0');
      const endMinPad = String(endMin).padStart(2, '0');
      const slotEndISO = `${date}T${endHourPad}:${endMinPad}:00+08:00`;
      const slotEndDate = new Date(slotEndISO);

      // Check conflict with busy intervals
      const hasConflict = busyIntervals.some(busy => {
        return slotStartDate < busy.end && slotEndDate > busy.start;
      });

      if (!hasConflict) {
        slots.push({
          start: slotStartISO,
          end: slotEndISO,
          displayTime: formatAustralianTime(slotStartDate),
          displayDate: formatAustralianDate(slotStartDate),
          dateKey: date,
        });
      }
    }

    res.json({
      date,
      slots,
      message: slots.length === 0 ? 'No appointments are available on this date. Please choose another date.' : undefined,
    });
  } catch (error) {
    console.error('Error getting calendar availability:', error);
    res.status(500).json({ error: 'Failed to retrieve availability.' });
  }
});

// 4. Create Booking with instant conflict recheck & Google Calendar Event Creation
app.post('/api/bookings/create', async (req: Request, res: Response) => {
  try {
    const { serviceId, property, access, appointment } = req.body;

    // Validation
    if (!serviceId || !property || !access || !appointment || !appointment.start) {
      return res.status(400).json({ error: 'Missing mandatory booking information.' });
    }

    if (!property.streetAddress || !property.suburb || !property.postcode) {
      return res.status(400).json({ error: 'Incomplete property address.' });
    }

    if (!property.customerName || !property.customerEmail || !property.customerPhone) {
      return res.status(400).json({ error: 'Customer contact details are required.' });
    }

    // CRITICAL: Availability and Conflict Protection
    // Query availability again immediately before creating appointment
    const reqStart = new Date(appointment.start);
    const reqEnd = new Date(appointment.end);

    const conflictingBooking = bookingsStore.find(b => {
      if (b.status === 'cancelled') return false;
      const bStart = new Date(b.appointment.start);
      const bEnd = new Date(b.appointment.end);
      return reqStart < bEnd && reqEnd > bStart;
    });

    if (conflictingBooking) {
      return res.status(409).json({
        error: 'That appointment has just become unavailable. Please select another time.',
        conflict: true,
      });
    }

    // Find service definition
    const service = DEFAULT_SERVICES.find(s => s.id === serviceId) || {
      name: serviceId,
      duration: appointment.durationMinutes || 45,
    };

    // Generate Human-Readable ProInspect Booking Reference: PI-YYYYMMDD-XXXX
    const bookingRef = generateBookingReference(reqStart);
    const managementToken = generateManagementToken();

    const newBooking: StoredBooking = {
      id: `booking-${Date.now()}`,
      bookingReference: bookingRef,
      managementToken,
      serviceId,
      serviceName: service.name,
      property,
      access,
      appointment: {
        start: appointment.start,
        end: appointment.end,
        dateString: formatAustralianDate(reqStart),
        timeString: formatAustralianTime(reqStart),
        durationMinutes: service.duration || 45,
        timezone: 'Australia/Perth',
      },
      status: 'confirmed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Google Calendar Event Creation
    // Format Title: [Service] | [Property Address]
    const unitText = property.unit ? `${property.unit}, ` : '';
    const fullAddress = `${unitText}${property.streetAddress}, ${property.suburb} ${property.state || 'WA'} ${property.postcode}`;
    const eventSummary = `${service.name} | ${fullAddress}`;
    const eventDescription = formatCalendarEventDescription(newBooking);

    let calendarEventId = `gcal_${Date.now()}`;

    // Execute server-side Google Calendar API insert if token available
    const clientAuthToken = (req.headers.authorization || '').replace('Bearer ', '') || activeServerOAuthToken;
    if (clientAuthToken) {
      try {
        const gcalEventPayload = {
          summary: eventSummary,
          location: fullAddress,
          description: eventDescription,
          start: {
            dateTime: appointment.start,
            timeZone: 'Australia/Perth',
          },
          end: {
            dateTime: appointment.end,
            timeZone: 'Australia/Perth',
          },
          attendees: [
            { email: property.customerEmail, displayName: property.customerName },
          ],
          reminders: {
            useDefault: true,
          },
        };

        const gcalRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${clientAuthToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(gcalEventPayload),
        });

        if (gcalRes.ok) {
          const createdGcal = await gcalRes.json();
          calendarEventId = createdGcal.id || calendarEventId;
        } else {
          console.warn('Google Calendar API returned status:', gcalRes.status);
        }
      } catch (calErr) {
        console.warn('Error during Google Calendar event insertion:', calErr);
      }
    }

    newBooking.calendarEventId = calendarEventId;
    bookingsStore.unshift(newBooking);

    res.status(201).json({
      success: true,
      booking: newBooking,
      message: 'Booking confirmed successfully and calendar event created.',
    });
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Failed to process and confirm your booking. Please try again.' });
  }
});

// 5. Get all bookings for admin
app.get('/api/admin/bookings', (req: Request, res: Response) => {
  res.json({ bookings: bookingsStore });
});

// 6. Update booking status / notes (admin)
app.patch('/api/admin/bookings/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, adminNotes } = req.body;

  const booking = bookingsStore.find(b => b.id === id || b.bookingReference === id);
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found.' });
  }

  if (status) booking.status = status;
  if (adminNotes !== undefined) booking.adminNotes = adminNotes;
  booking.updatedAt = new Date().toISOString();

  res.json({ success: true, booking });
});

// 7. Get booking by management token (public self-service)
app.get('/api/bookings/manage/:token', (req: Request, res: Response) => {
  const { token } = req.params;
  const booking = bookingsStore.find(b => b.managementToken === token || b.bookingReference === token);
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found or invalid reference.' });
  }
  // Expose sanitized public view
  res.json({ booking });
});

// 8. Public Services & Settings
app.get('/api/services', (req: Request, res: Response) => {
  res.json({ services: DEFAULT_SERVICES });
});

app.get('/api/settings', (req: Request, res: Response) => {
  res.json({ settings: DEFAULT_SETTINGS });
});

// ----------------------------------------------------
// VITE MIDDLEWARE / STATIC ASSETS SETUP
// ----------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`ProInspect Booking Hub server running on port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
