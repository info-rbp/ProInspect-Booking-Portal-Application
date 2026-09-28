import assert from 'node:assert/strict';
import type { BookingRecord } from '../src/types/booking.js';
import type { AdminSession } from '../src/types/admin.js';
import {
  ADMIN_RESOURCE_CONFIG,
  bookingMatchesScope,
  permissionsForRole,
} from '../src/server/adminStore.js';

function session(
  overrides: Partial<AdminSession> = {}
): AdminSession {
  return {
    uid: 'staff-1',
    email: 'staff@example.com',
    role: 'inspector',
    permissions: permissionsForRole('inspector'),
    resourceScope: 'assigned',
    assignedServiceIds: [],
    assignedPropertyIds: [],
    assignedClientIds: [],
    ...overrides,
  };
}

function booking(
  overrides: Partial<BookingRecord> = {}
): BookingRecord {
  return {
    id: 'booking-1',
    bookingReference: 'PI-TEST-1',
    managementToken: 'pi_test_token_123456789012345678901234',
    serviceId: 'routine-inspection',
    serviceName: 'Routine Inspection',
    property: {
      streetAddress: '1 Test Street',
      suburb: 'Perth',
      state: 'WA',
      postcode: '6000',
      propertyType: 'House',
      customerName: 'Test Customer',
      customerEmail: 'customer@example.com',
      customerPhone: '0400000000',
    },
    access: { method: 'vacant', vacant: { accessInstructions: 'Test' } },
    readinessStatus: 'ready',
    appointment: {
      start: '2026-10-01T01:00:00.000Z',
      end: '2026-10-01T02:00:00.000Z',
      dateKey: '2026-10-01',
      dateString: '1 October 2026',
      timeString: '9:00 am',
      durationMinutes: 60,
      timezone: 'Australia/Perth',
    },
    status: 'confirmed',
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
    ...overrides,
  };
}

const inspector = session();
assert.equal(
  bookingMatchesScope(booking({ assignedStaffId: inspector.uid }), inspector),
  true,
  'Inspector must see work explicitly assigned to their Firebase UID.'
);
assert.equal(
  bookingMatchesScope(booking({ assignedStaffId: 'another-staff' }), inspector),
  false,
  'Inspector must not receive unrelated bookings.'
);
assert.equal(
  bookingMatchesScope(
    booking({ propertyId: 'property-1' }),
    session({ assignedPropertyIds: ['property-1'] })
  ),
  true,
  'Inspector must see bookings for an explicitly assigned property.'
);
assert.equal(
  bookingMatchesScope(
    booking({ clientId: 'client-1' }),
    session({ assignedClientIds: ['client-1'] })
  ),
  true,
  'Inspector must see bookings for an explicitly assigned client.'
);
assert.equal(
  bookingMatchesScope(
    booking({ assignedStaffId: 'another-staff' }),
    session({ role: 'operations_manager', resourceScope: 'global' })
  ),
  true,
  'Global operational roles must retain organisation-wide visibility.'
);

const readOnly = permissionsForRole('read_only');
assert.equal(readOnly.includes('bookings.update'), false);
assert.equal(readOnly.includes('clients.manage'), false);
assert.equal(readOnly.includes('audit.read'), true);

const inspectorPermissions = permissionsForRole('inspector');
assert.equal(inspectorPermissions.includes('bookings.read'), true);
assert.equal(inspectorPermissions.includes('bookings.sensitive_access'), true);
assert.equal(inspectorPermissions.includes('users.manage'), false);

for (const requiredResource of [
  'clients',
  'clientUsers',
  'clientMemberships',
  'properties',
  'clientPropertyLinks',
  'tenancies',
  'tenantUsers',
  'propertyDocuments',
  'documentRequests',
  'workOrders',
  'subscriptions',
  'payments',
  'communications',
] as const) {
  assert.ok(
    ADMIN_RESOURCE_CONFIG[requiredResource],
    `Canonical admin resource ${requiredResource} must remain registered.`
  );
}

assert.equal(
  ADMIN_RESOURCE_CONFIG.workOrders.collection,
  'workOrders',
  'Maintenance operations must use canonical workOrders, not the legacy maintenanceRequests collection.'
);
assert.equal(
  ADMIN_RESOURCE_CONFIG.tenantUsers.collection,
  'tenantUsers',
  'Tenant identities must use canonical tenantUsers, not the legacy tenants collection.'
);

console.log('Canonical Admin Platform architecture verification passed.');
