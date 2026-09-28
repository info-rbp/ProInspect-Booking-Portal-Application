import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { adminDb } from '../src/server/firebaseAdmin.js';

const collections = [
  'bookings',
  'properties',
  'clients',
  'clientUsers',
  'clientPropertyLinks',
  'clientProperties',
  'clientDocuments',
  'propertyDocuments',
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

  batch.set(adminDb.collection('properties').doc('property-existing'), {
    id: 'property-existing',
    streetAddress: '10 Stage One Street',
    suburb: 'Perth',
    state: 'WA',
    postcode: '6000',
    status: 'active',
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
  });

  batch.set(adminDb.collection('clients').doc('client-existing'), {
    id: 'client-existing',
    name: 'Stage One Client',
    clientType: 'landlord',
    status: 'active',
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
  });

  batch.set(adminDb.collection('clientUsers').doc('client-user-existing'), {
    id: 'client-user-existing',
    email: 'client@example.com',
    clientIds: ['client-existing'],
    active: true,
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
  });

  batch.set(adminDb.collection('clientProperties').doc('legacy-client-property'), {
    streetAddress: '11 Stage One Street',
    suburb: 'Perth',
    state: 'WA',
    postcode: '6000',
    clientId: 'client-existing',
    clientName: 'Stage One Client',
    status: 'active',
    createdAt: '2026-09-28T00:00:00.000Z',
  });

  batch.set(adminDb.collection('clientDocuments').doc('legacy-client-document'), {
    propertyId: 'property-existing',
    clientId: 'client-existing',
    title: 'Legacy client document',
    fileName: 'legacy.pdf',
    contentType: 'application/pdf',
    storagePath: 'legacy/client/legacy.pdf',
    sizeBytes: 123,
    createdAt: '2026-09-28T00:00:00.000Z',
  });

  await batch.commit();
}

async function main() {
  assert.ok(
    process.env.FIRESTORE_EMULATOR_HOST,
    'This verification must run against the Firestore emulator.'
  );

  await seed();
  const before = await snapshot();

  const run = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/migrate-unified-portal.ts'],
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

  assert.equal(run.status, 0, 'Unified portal migration dry-run must complete successfully.');
  assert.match(run.stdout, /"dryRun": true/);
  assert.match(run.stdout, /"propertyAddressKeysBackfilled": 1/);
  assert.match(run.stdout, /"clientRolesBackfilled": 1/);
  assert.match(run.stdout, /"legacyClientPropertiesScanned": 1/);
  assert.match(run.stdout, /"legacyClientDocumentsScanned": 1/);
  assert.match(run.stdout, /Dry run only/);

  const after = await snapshot();
  assert.deepEqual(after, before, 'Dry-run migration changed Firestore data.');

  console.log('Tenant/unified portal migration dry-run preflight passed with zero Firestore mutations.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
