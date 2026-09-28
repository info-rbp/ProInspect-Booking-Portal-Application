const baseUrl = (process.env.E2E_BASE_URL || '').replace(/\/$/, '');
const allowLiveWrite = process.env.E2E_ALLOW_LIVE_WRITE === 'YES';

if (!baseUrl) {
  throw new Error('Set E2E_BASE_URL to the deployed booking portal origin.');
}

if (!allowLiveWrite) {
  throw new Error(
    'This smoke test creates and cancels a real booking. Set E2E_ALLOW_LIVE_WRITE=YES to continue.'
  );
}

const required = [
  'E2E_STREET_ADDRESS',
  'E2E_SUBURB',
  'E2E_POSTCODE',
  'E2E_TEST_EMAIL',
  'E2E_TEST_PHONE',
];

for (const name of required) {
  if (!process.env[name]?.trim()) {
    throw new Error(`Set ${name} before running the live booking smoke test.`);
  }
}

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(60000), headers: {...init?.headers, ...(process.env.E2E_CLOUD_RUN_ID_TOKEN ? {'X-Serverless-Authorization': 'Bearer '+process.env.E2E_CLOUD_RUN_ID_TOKEN} : {})} });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${init?.method || 'GET'} ${path.replace(/manage\/[^/]+/, 'manage/[redacted]')} failed (${response.status}): ${body.error || JSON.stringify(body)}`
    );
  }
  return body;
}

function perthDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Perth',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

async function findSlot(serviceId) {
  for (let offset = 2; offset <= 21; offset += 1) {
    const date = new Date(Date.now() + offset * 24 * 60 * 60_000);
    const dateKey = perthDateKey(date);
    const availability = await request(
      `/api/calendar/availability?date=${encodeURIComponent(dateKey)}&serviceId=${encodeURIComponent(serviceId)}`
    );
    if (Array.isArray(availability.slots) && availability.slots.length > 0) {
      return availability.slots[0];
    }
  }

  throw new Error('No available appointment was found in the next 21 days.');
}

let managementToken;
let bookingReference;

try {
  const health = await request('/api/health');
  if (!health.ok || !health.calendarConfigured) {
    throw new Error(`Health check is not production-ready: ${JSON.stringify(health)}`);
  }

  const servicesResponse = await request('/api/services');
  const serviceId = process.env.E2E_SERVICE_ID || 'routine-inspection';
  const service = servicesResponse.services?.find((item) => item.id === serviceId);
  if (!service) throw new Error(`Public service ${serviceId} was not found.`);

  const slot = await findSlot(service.id);

  const createResponse = await request('/api/bookings/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      serviceId: service.id,
      property: {
        streetAddress: process.env.E2E_STREET_ADDRESS,
        unit: process.env.E2E_UNIT || '',
        suburb: process.env.E2E_SUBURB,
        state: process.env.E2E_STATE || 'WA',
        postcode: process.env.E2E_POSTCODE,
        propertyType: process.env.E2E_PROPERTY_TYPE || 'House',
        clientName: 'ProInspect E2E Test',
        clientReference: `E2E-${Date.now()}`,
        customerName: 'ProInspect E2E Test',
        customerEmail: process.env.E2E_TEST_EMAIL,
        customerPhone: process.env.E2E_TEST_PHONE,
      },
      access: {
        method: 'meet_onsite',
        meetOnsite: {
          contactName: 'ProInspect E2E Test',
          contactPhone: process.env.E2E_TEST_PHONE,
          relationship: 'Other',
          specialInstructions: 'Automated end-to-end smoke test. Booking will be cancelled immediately.',
        },
      },
      appointment: {
        start: slot.start,
      },
    }),
  });

  bookingReference = createResponse.booking?.bookingReference;
  managementToken = createResponse.booking?.managementToken;

  if (!bookingReference || !managementToken) {
    throw new Error('Booking creation did not return a reference and management token.');
  }

  const managed = await request(
    `/api/bookings/manage/${encodeURIComponent(managementToken)}`
  );

  if (managed.booking?.bookingReference !== bookingReference) {
    throw new Error('Secure management lookup did not return the created booking.');
  }

  const cancelled = await request(
    `/api/bookings/manage/${encodeURIComponent(managementToken)}/cancel`,
    { method: 'POST' }
  );

  if (cancelled.booking?.status !== 'cancelled') {
    throw new Error('Booking cancellation did not return cancelled status.');
  }

  const finalLookup = await request(
    `/api/bookings/manage/${encodeURIComponent(managementToken)}`
  );

  if (finalLookup.booking?.status !== 'cancelled') {
    throw new Error('Cancelled booking status was not persisted in Firestore.');
  }

  console.log(
    JSON.stringify(
      {
        success: true,
        bookingReference,
        service: service.name,
        slot: slot.start,
        confirmationEmailStatus:
          createResponse.booking?.confirmationEmailStatus || 'unknown',
        finalStatus: finalLookup.booking.status,
        checks: [
          'Cloud Run health',
          'Firestore service catalogue',
          'Google Calendar availability',
          'Google Calendar event creation',
          'Firestore booking persistence',
          'secure management lookup',
          'Google Calendar event cancellation',
          'Firestore cancelled status persistence',
        ],
      },
      null,
      2
    )
  );
} catch (error) {
  let cleanupStatus = 'not_required';
  if (managementToken) {
    try { await request(`/api/bookings/manage/${encodeURIComponent(managementToken)}/cancel`, {method:'POST'}); cleanupStatus='cancelled'; }
    catch { cleanupStatus='failed_requires_private_review'; }
  }
  console.error(
    JSON.stringify(
      {
        success: false,
        bookingReference,
        managementTokenPresent: Boolean(managementToken),
        error: error instanceof Error ? error.message : String(error),
        cleanup: cleanupStatus,
      },
      null,
      2
    )
  );
  process.exitCode = 1;
}
