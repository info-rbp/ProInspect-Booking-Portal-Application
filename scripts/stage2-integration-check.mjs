import fs from 'node:fs';
function read(path) { return fs.readFileSync(path, 'utf8'); }
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
for (const collection of ['clients','clientUsers','clientMemberships','properties','clientPropertyLinks','tenancies','tenantUsers','bookings','workOrders','propertyDocuments','documentRequests','communications','subscriptions','payments','adminUsers','auditEvents','services','settings']) {
  requireInvariant(`canonical collection ${collection} is represented`, canonicalTypes.includes(collection) || canonicalStore.includes(`'${collection}'`));
}
requireInvariant('Canonical Admin session resolver is wired', server.includes('resolveAdminSession({'));
requireInvariant('Booking reads are staff-resource scoped', server.includes('filterBookingsForSession(allBookings, session)'));
requireInvariant('Booking writes are staff-resource scoped', server.includes('canUpdateBookingForSession(booking, adminSession(res))'));
requireInvariant('Canonical Admin resource API is exposed', server.includes("'/api/admin/resources/:resource'"));
requireInvariant('Tenant statutory forms remain present', server.includes("'/api/tenant/forms'"));
requireInvariant('Restricted tenant form workflow remains present', server.includes("'/api/tenant/forms-sensitive'"));
requireInvariant('Client dashboard remains present', server.includes("'/api/client/dashboard'"));
requireInvariant('Report Tool ingestion remains canonical', server.includes("'/api/integrations/reports'") && server.includes('createTenantDocumentRecord'));
requireInvariant('Payment integration remains present', server.includes("'/api/integrations/payments/:id/status'"));
requireInvariant('Public booking remains unauthenticated route', server.includes("'/api/bookings/create'"));
requireInvariant('Secure booking management remains present', server.includes("'/api/bookings/manage/:token'"));
requireInvariant('Portal gateway owns the root route', app.includes("pathname === '/'") && app.includes('<PortalGateway'));
requireInvariant('Client, Tenant and Admin have explicit routes', app.includes("'/client'") && app.includes("'/tenant'") && app.includes("'/admin'"));
requireInvariant('Unified Admin exposes workflow and platform workspaces', fs.existsSync('src/components/admin/UnifiedAdminPortal.tsx'));
requireInvariant('Canonical Admin permission vocabulary is active', adminTypes.includes("'bookings.read'") && adminTypes.includes("'maintenance.manage'"));
requireInvariant('Canonical store does not use legacy maintenanceRequests', !canonicalStore.includes("collection('maintenanceRequests')"));
requireInvariant('Operational work orders use canonical workOrders', platformStore.includes("collection('workOrders')"));
requireInvariant('No legacy client organisation store is active', !server.includes("collection('clientOrganisations')"));
requireInvariant('No legacy client property store is active', !server.includes("collection('clientProperties')"));
requireInvariant('No legacy client document store is active', !server.includes("collection('clientDocuments')"));
console.log('Stage 2 platform-unification architecture checks passed.');
