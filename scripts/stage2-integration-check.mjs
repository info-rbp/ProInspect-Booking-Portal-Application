import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}
function requireInvariant(name, condition) {
  if (!condition) throw new Error(`STAGE 2 CHECK FAILED: ${name}`);
  console.log(`PASS: ${name}`);
}

const server = read('server.ts');
const app = read('src/App.tsx');
const adminStore = read('src/server/adminStore.ts');
const canonicalStore = read('src/server/canonicalPlatformStore.ts');
const adminTypes = read('src/types/admin.ts');
const canonicalTypes = read('src/types/canonicalPlatform.ts');
const platformStore = read('src/server/platformStore.ts');
const bookingStore = read('src/server/store.ts');
const tenantStore = read('src/server/tenantStore.ts');
const clientPortal = read('src/components/client/ClientPortal.tsx');
const adminPortal = read('src/components/admin/AdminPortal.tsx');
const documentDefinitions = read('src/documents/documentWorkflowDefinitions.ts');
const documentProducts = read('src/documents/defaultDocumentProducts.ts');
const documentSecrets = read('src/server/documentRequestSecrets.ts');
const migration = read('scripts/migrate-unified-portal.ts');
const envExample = read('.env.example');

for (const collection of [
  'clients',
  'clientUsers',
  'clientMemberships',
  'properties',
  'clientPropertyLinks',
  'tenancies',
  'tenantUsers',
  'bookings',
  'workOrders',
  'propertyDocuments',
  'documentRequests',
  'communications',
  'subscriptions',
  'payments',
  'adminUsers',
  'auditEvents',
  'services',
  'settings',
]) {
  requireInvariant(
    `canonical collection ${collection} is represented`,
    canonicalTypes.includes(collection) ||
      canonicalStore.includes(`'${collection}'`) ||
      bookingStore.includes(`'${collection}'`)
  );
}

requireInvariant(
  'Canonical Admin session resolver is wired',
  server.includes('resolveAdminSession({')
);
requireInvariant(
  'Booking reads are staff-resource scoped',
  server.includes('filterBookingsForSession(allBookings, session)')
);
requireInvariant(
  'Booking writes are staff-resource scoped',
  server.includes('canUpdateBookingForSession(booking, adminSession(res))')
);
requireInvariant(
  'Canonical Admin resource API is exposed',
  server.includes("'/api/admin/resources/:resource'")
);
requireInvariant(
  'Tenant statutory forms remain present',
  server.includes("'/api/tenant/forms'")
);
requireInvariant(
  'Restricted tenant form workflow remains present',
  server.includes("'/api/tenant/forms-sensitive'")
);
requireInvariant(
  'Client dashboard remains present',
  server.includes("'/api/client/dashboard'")
);
requireInvariant(
  'Client self-onboarding uses canonical clients',
  server.includes("'/api/client/onboarding'") &&
    server.includes('onboardCanonicalClient')
);
requireInvariant(
  'Client organisation metadata is canonical',
  canonicalTypes.includes('billingEmail?: string') &&
    canonicalTypes.includes('abn?: string') &&
    canonicalTypes.includes('acn?: string')
);
requireInvariant(
  'Explicit canonical client memberships are active',
  fs.existsSync('src/server/clientMembershipStore.ts')
);
requireInvariant(
  'Unified migration converts legacy Client organisations',
  migration.includes("collection('clientOrganisations')") &&
    migration.includes('legacyClientOrganisationsMigrated') &&
    migration.includes('legacy-client-organisation')
);
requireInvariant(
  'Unified migration converts legacy-shaped clientMemberships',
  migration.includes('legacyMembershipDocs') &&
    migration.includes('legacyClientMembershipsMigrated') &&
    migration.includes('legacy-client-membership')
);
requireInvariant(
  'Unified migration preserves ABN, ACN and billing email',
  migration.includes('billingEmail: old.billingEmail') &&
    migration.includes('abn: old.abn') &&
    migration.includes('acn: old.acn')
);
requireInvariant(
  'Client Portal document requests use canonical documentRequests',
  server.includes("'/api/client/document-requests'") &&
    server.includes('createDocumentRequest({') &&
    clientPortal.includes("setComposer('document')") &&
    clientPortal.includes('createClientDocumentRequest')
);
requireInvariant(
  'Client dashboard exposes canonical document request status',
  platformStore.includes('documentRequests: params.documentRequests || []') &&
    clientPortal.includes('selectedDocumentRequests')
);

const residentialWorkflowIds = [
  'residential-tenancy-lease-agreement-form-1aa',
  'lodgement-security-bond-money-form-preparation',
  'variation-security-bond-money-form',
  'joint-application-disposal-security-bond',
  'notice-rent-increase-form-10',
  'notice-rent-increase-income-form-11',
  'notice-proposed-entry-form-19',
  'notice-breach-agreement-form-20',
  'breach-non-payment-rent-form-21',
  'termination-family-violence-form-2',
  'termination-non-payment-rent-form-1a',
  'termination-non-payment-rent-form-1b',
  'termination-other-than-non-payment-form-1c',
  'former-tenant-disposal-goods-form-cp2',
  'disposal-goods-form-3',
  'abandonment-premises-form-12',
  'termination-premises-abandoned-form-13',
];
requireInvariant(
  'All 17 production Residential guided document workflows remain present',
  residentialWorkflowIds.every(
    (id) => documentDefinitions.includes(id) && documentProducts.includes(id)
  )
);
requireInvariant(
  'Sensitive document answers remain separately encrypted',
  documentSecrets.includes('aes-256-gcm') &&
    server.includes('encryptDocumentRequestSecrets')
);
requireInvariant(
  'Public guided document requests retain notifications',
  server.includes('sendDocumentRequestEmails')
);
requireInvariant(
  'Commercial and Strata document products retain explicit workflows',
  documentDefinitions.includes("'commercial-lease': genericOperationalWorkflow") &&
    documentDefinitions.includes("'strata-correspondence': genericOperationalWorkflow")
);

requireInvariant(
  'Report Tool ingestion remains canonical',
  server.includes("'/api/integrations/reports'") &&
    server.includes('createTenantDocumentRecord')
);
requireInvariant(
  'Admin Report Tool handoff is signed and short lived',
  server.includes("'/api/admin/reports/handoff'") &&
    server.includes('createReportHandoffToken') &&
    server.includes('REPORT_HANDOFF_SIGNING_KEY') &&
    server.includes('Math.floor(Date.now() / 1000) + 5 * 60')
);
requireInvariant(
  'Admin UI launches Report Tool from canonical property context',
  adminPortal.includes('createAdminReportHandoff') &&
    adminPortal.includes('Open Report Tool') &&
    adminPortal.includes("fetchAdminResource('workOrders')") &&
    adminPortal.includes("fetchAdminResource('tenancies')")
);
requireInvariant(
  'Report ingestion is idempotency keyed and retries short-circuit before storage',
  server.includes("'x-report-source-id'") &&
    server.includes('existingDocument.exists') &&
    server.indexOf('existingDocument.exists') <
      server.indexOf('const stored = await saveTenantDocumentFile') &&
    server.includes('idempotent: true') &&
    tenantStore.includes('DOCUMENT_IDEMPOTENCY_CONFLICT')
);
requireInvariant(
  'Report Tool integration secrets remain server-side configuration',
  envExample.includes('REPORT_TOOL_URL') &&
    envExample.includes('REPORT_HANDOFF_SIGNING_KEY') &&
    envExample.includes('REPORT_INGEST_TOKEN')
);

requireInvariant(
  'Payment integration remains present',
  server.includes("'/api/integrations/payments/:id/status'")
);
requireInvariant(
  'Public booking remains unauthenticated route',
  server.includes("'/api/bookings/create'")
);
requireInvariant(
  'Secure booking management remains present',
  server.includes("'/api/bookings/manage/:token'")
);
requireInvariant(
  'Portal gateway owns the root route',
  app.includes("pathname === '/'") && app.includes('<PortalGateway')
);
requireInvariant(
  'Client, Tenant and Admin have explicit routes',
  app.includes("'/client'") && app.includes("'/tenant'") && app.includes("'/admin'")
);
requireInvariant(
  'Unified Admin exposes workflow and platform workspaces',
  fs.existsSync('src/components/admin/UnifiedAdminPortal.tsx')
);
requireInvariant(
  'Canonical Admin permission vocabulary is active',
  adminTypes.includes("'bookings.read'") &&
    adminTypes.includes("'maintenance.manage'") &&
    adminTypes.includes("'reports.manage'")
);
requireInvariant(
  'Canonical store does not use legacy maintenanceRequests',
  !canonicalStore.includes("collection('maintenanceRequests')")
);
requireInvariant(
  'Operational work orders use canonical workOrders',
  platformStore.includes("collection('workOrders')")
);
requireInvariant(
  'No legacy client organisation store is active at runtime',
  !server.includes("collection('clientOrganisations')")
);
requireInvariant(
  'No legacy client property store is active at runtime',
  !server.includes("collection('clientProperties')")
);
requireInvariant(
  'No legacy client document store is active at runtime',
  !server.includes("collection('clientDocuments')")
);

console.log('Stage 2 platform-unification architecture checks passed.');
