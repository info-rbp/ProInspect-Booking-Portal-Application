import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function requireInvariant(name, condition) {
  if (!condition) {
    throw new Error(`FREEZE CHECK FAILED: ${name}`);
  }
  console.log(`PASS: ${name}`);
}

const server = read('server.ts');
const tenantStore = read('src/server/tenantStore.ts');
const tenantFormStore = read('src/server/tenantFormStore.ts');
const platformStore = read('src/server/platformStore.ts');
const formDefinitions = read('src/tenantForms/formDefinitions.ts');
const tenantFiles = read('src/server/tenantFiles.ts');
const firestoreRules = read('firestore.rules');
const storageRules = read('storage.rules');
const packageJson = JSON.parse(read('package.json'));

requireInvariant(
  'Direct browser Firestore access remains denied',
  /allow\s+read,\s*write:\s*if\s+false/.test(firestoreRules)
);
requireInvariant(
  'Direct browser Storage access remains denied',
  /allow\s+read,\s*write:\s*if\s+false/.test(storageRules)
);
requireInvariant(
  'Forms 22 and 23 remain excluded from tenant statutory definitions',
  !/formCode:\s*['"](?:22|23)['"]/.test(formDefinitions)
);
requireInvariant(
  'Sensitive Form 2 uses a separate Firestore collection',
  tenantFormStore.includes("collection('sensitiveTenantForms')")
);
requireInvariant(
  'Sensitive evidence uses a separate Storage prefix',
  tenantFiles.includes('tenant-sensitive/forms/')
);
requireInvariant(
  'Tenant statutory form dashboard filters by submitting tenant',
  tenantFormStore.includes('request.tenantUserId === tenant.id')
);
requireInvariant(
  'Generic tenant request lookup enforces submitting-tenant ownership',
  tenantStore.includes('if (request.tenantUserId !== tenant.id) return null;')
);
requireInvariant(
  'Generic tenant dashboard filters requests by submitting tenant',
  tenantStore.includes('.filter((request) => request.tenantUserId === tenant.id)')
);
requireInvariant(
  'Client booking visibility requires canonical client/property relationships',
  !platformStore.includes(".where('property.customerEmail', '==', params.user.email)") &&
    !platformStore.includes('booking.property.customerEmail.trim().toLowerCase() === params.user.email.trim().toLowerCase()')
);
requireInvariant(
  'Read-only staff writes are blocked through explicit write permission middleware',
  server.includes('function requireAdminWritePermission(permission: string)')
);
requireInvariant(
  'Client membership role/revocation endpoint is wired',
  server.includes("app.patch('/api/client/team-users/:id/membership'")
);
requireInvariant(
  'Last-client-owner protection exists',
  tenantStore.includes("throw new Error('LAST_CLIENT_OWNER')")
);
requireInvariant(
  'Portal migration dry-run command exists',
  packageJson.scripts?.['migrate:portal:dry'] === 'tsx scripts/migrate-unified-portal.ts'
);
requireInvariant(
  'Portal security smoke test command exists',
  packageJson.scripts?.['test:e2e:portal-security'] === 'node scripts/e2e-portal-security.mjs'
);

console.log('Architecture freeze checks passed.');
