import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { adminDb } from '../src/server/firebaseAdmin.js';

const collections = [
  'bookings',
  'properties',
  'workOrders',
  'documentRequests',
  'maintenanceRequests',
  'clients',
  'propertyDocuments',
  'subscriptions',
  'communications',
  'auditEvents',
  'tenants',
] as const;

async function snapshot() {
  const result: Record<string, unknown[]> = {};
  for (const collection of collections) {
    const snap = await adminDb.collection(collection).orderBy('__name__').get();
    result[collection] = snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  }
  return result;
}

async function seed() {
  const batch = adminDb.batch();
  batch.set(adminDb.collection('bookings').doc('legacy-booking'), {
    bookingReference: 'PI-STAGE1-1',
    serviceName: 'Routine Inspection',
    property: {
      streetAddress: '1 Stage One Street',
      suburb: 'Perth',
      state: 'WA',
      postcode: '6000',
    },
    appointment: 'legacy-malformed-appointment',
    access: null,
    status: 'confirmed',
    createdAt: '2026-09-28T00:00:00.000Z',
  });
  batch.set(adminDb.collection('documentRequests').doc('legacy-document-request'), {
    requestReference: 'DR-STAGE1-1',
    documentId: 'form-19',
    documentName: 'Notice of Proposed Entry',
    details: {
      streetAddress: '2 Stage One Street',
      suburb: 'Perth',
      state: 'WA',
      postcode: '6000',
      customerName: 'Stage One Client',
      customerEmail: 'stage1@example.com',
      customerPhone: '0400000000',
    },
    createdAt: '2026-09-28T00:00:00.000Z',
  });
  batch.set(adminDb.collection('clients').doc('legacy-client'), {
    name: 'Legacy Client',
    email: 'legacy@example.com',
  });
  batch.set(adminDb.collection('properties').doc('existing-property'), {
    streetAddress: '3 Stage One Street',
    suburb: 'Perth',
    postcode: '6000',
  });
  batch.set(adminDb.collection('maintenanceRequests').doc('legacy-maintenance'), {
    propertyId: 'existing-property',
    clientId: 'legacy-client',
    title: 'Legacy maintenance',
    description: 'Migration preflight fixture',
    status: 'open',
  });
  batch.set(adminDb.collection('propertyDocuments').doc('legacy-document'), {
    propertyId: 'existing-property',
    title: 'Legacy document',
    storagePath: 'legacy/path.pdf',
  });
  batch.set(adminDb.collection('subscriptions').doc('legacy-subscription'), {
    clientId: 'legacy-client',
    name: 'Legacy plan',
  });
  batch.set(adminDb.collection('communications').doc('legacy-communication'), {
    title: 'Legacy communication',
    notes: 'Migration preflight fixture',
  });
  batch.set(adminDb.collection('auditEvents').doc('legacy-audit'), {
    resourceType: 'client',
    resourceId: 'legacy-client',
    action: 'updated',
  });
  batch.set(adminDb.collection('tenants').doc('legacy-tenant'), {
    email: 'tenant@example.com',
  });
  await batch.commit();
}

async function main() {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'This verification must run against the Firestore emulator.');
  await seed();
  const before = await snapshot();

  const run = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/migrate-admin-platform.ts'],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
    }
  );

  if (run.status !== 0) {
    process.stderr.write(run.stdout || '');
    process.stderr.write(run.stderr || '');
  }
  assert.equal(run.status, 0, 'Admin migration dry-run must complete successfully.');
  assert.match(run.stdout, /"dryRun": true/);
  assert.match(run.stdout, /"bookingsScanned": 1/);
  assert.match(run.stdout, /"bookingPropertiesBackfilled": 1/);
  assert.match(run.stdout, /"bookingWorkOrdersBackfilled": 1/);
  assert.match(run.stdout, /"maintenanceWorkOrdersCreated": 1/);
  assert.match(run.stdout, /"legacyTenantRecordsRequiringReview": 1/);
  assert.match(run.stdout, /No Firestore writes were performed/);

  const after = await snapshot();
  assert.deepEqual(after, before, 'Dry-run migration changed Firestore data.');

  console.log('Admin migration dry-run preflight passed with zero Firestore mutations.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
