const baseUrl = (process.env.PORTAL_TEST_BASE_URL || '').replace(/\/$/, '');
const tenantToken = process.env.PORTAL_TEST_TENANT_TOKEN || '';
const clientToken = process.env.PORTAL_TEST_CLIENT_TOKEN || '';
const adminToken = process.env.PORTAL_TEST_ADMIN_TOKEN || '';
const readOnlyAdminToken = process.env.PORTAL_TEST_READ_ONLY_ADMIN_TOKEN || '';
const viewerClientToken = process.env.PORTAL_TEST_VIEWER_CLIENT_TOKEN || '';

if (!baseUrl) {
  console.error('Set PORTAL_TEST_BASE_URL to a deployed ProInspect environment.');
  process.exit(1);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.text();
  let parsed = null;
  try { parsed = body ? JSON.parse(body) : null; } catch {}
  return { response, body, parsed };
}

async function expect(name, condition, detail) {
  if (!condition) throw new Error(`${name} failed: ${detail}`);
  console.log(`PASS: ${name}`);
}

async function main() {
  const unauthClient = await request('/api/client/dashboard');
  await expect('Client dashboard rejects anonymous access', [401,403].includes(unauthClient.response.status), `status ${unauthClient.response.status}`);

  const unauthTenant = await request('/api/tenant/dashboard');
  await expect('Tenant dashboard rejects anonymous access', [401,403].includes(unauthTenant.response.status), `status ${unauthTenant.response.status}`);

  const unauthAdmin = await request('/api/admin/operations');
  await expect('Admin operations rejects anonymous access', [401,403].includes(unauthAdmin.response.status), `status ${unauthAdmin.response.status}`);

  const unauthForms = await request('/api/tenant/forms');
  await expect('Tenant forms reject anonymous access', [401,403].includes(unauthForms.response.status), `status ${unauthForms.response.status}`);

  const unauthSensitive = await request('/api/admin/sensitive-tenant-forms');
  await expect('Restricted tenancy forms reject anonymous access', [401,403].includes(unauthSensitive.response.status), `status ${unauthSensitive.response.status}`);

  const badReport = await request('/api/integrations/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: Buffer.from('test'),
  });
  await expect('Report ingest rejects missing integration token', badReport.response.status === 401, `status ${badReport.response.status}`);

  if (tenantToken) {
    const tenant = await request('/api/tenant/dashboard', {
      headers: { Authorization: `Bearer ${tenantToken}` },
    });
    await expect('Tenant token opens tenant dashboard', tenant.response.ok, `status ${tenant.response.status}`);
    const dashboard = tenant.parsed?.dashboard;
    await expect('Tenant dashboard never returns admin notes', !JSON.stringify(dashboard || {}).includes('adminNotes'), 'adminNotes found');
    await expect('Tenant dashboard never returns storage paths', !JSON.stringify(dashboard || {}).includes('storagePath'), 'storagePath found');
    await expect(
      'Tenant dashboard contains only requests submitted by that tenant',
      (dashboard?.requests || []).every((request) => request.tenantUserId === dashboard?.tenant?.id),
      'another tenant request was visible'
    );

    const forms = await request('/api/tenant/forms', {
      headers: { Authorization: `Bearer ${tenantToken}` },
    });
    await expect('Tenant token opens statutory forms dashboard', forms.response.ok, `status ${forms.response.status}`);
    await expect('Statutory forms dashboard never returns storage paths', !JSON.stringify(forms.parsed?.dashboard || {}).includes('storagePath'), 'storagePath found');
    await expect(
      'Statutory forms dashboard contains only forms submitted by that tenant',
      (forms.parsed?.dashboard?.requests || []).every((request) => request.tenantUserId === dashboard?.tenant?.id),
      'another tenant form was visible'
    );
    await expect('Tenant forms dashboard does not expose restricted evidence metadata', !JSON.stringify(forms.parsed?.dashboard || {}).includes('evidenceType'), 'restricted evidence metadata found');
  }

  if (clientToken) {
    const client = await request('/api/client/dashboard', {
      headers: { Authorization: `Bearer ${clientToken}` },
    });
    await expect('Client token opens client dashboard', client.response.ok, `status ${client.response.status}`);
    await expect('Client dashboard never returns storage paths', !JSON.stringify(client.parsed?.dashboard || {}).includes('storagePath'), 'storagePath found');
  }

  if (adminToken) {
    const admin = await request('/api/admin/operations', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    await expect('Admin token opens operations', admin.response.ok, `status ${admin.response.status}`);
  }

  if (readOnlyAdminToken) {
    const session = await request('/api/admin/session', {
      headers: { Authorization: `Bearer ${readOnlyAdminToken}` },
    });
    await expect('Read-only staff token opens admin session', session.response.ok, `status ${session.response.status}`);
    await expect('Read-only staff role is reported correctly', session.parsed?.role === 'read_only', `role ${session.parsed?.role}`);

    const mutation = await request('/api/admin/contractors', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${readOnlyAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'SECURITY TEST MUST NOT CREATE' }),
    });
    await expect('Read-only staff cannot mutate operations', mutation.response.status === 403, `status ${mutation.response.status}`);
  }

  if (viewerClientToken) {
    const client = await request('/api/client/dashboard', {
      headers: { Authorization: `Bearer ${viewerClientToken}` },
    });
    await expect('Viewer client token opens client dashboard', client.response.ok, `status ${client.response.status}`);
    const viewerClientId = client.parsed?.dashboard?.clientUser?.memberships?.find(
      (membership) => membership.role === 'viewer'
    )?.clientId;
    await expect('Viewer client token has a viewer membership', Boolean(viewerClientId), 'viewer membership not found');

    const mutation = await request('/api/client/requests', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${viewerClientToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientId: viewerClientId,
        type: 'general',
        title: 'Security test request',
        details: 'This request must be rejected because the user is a viewer.',
        priority: 'routine',
      }),
    });
    await expect('Viewer client cannot submit instructions', mutation.response.status === 403, `status ${mutation.response.status}`);
  }

  console.log('Portal security smoke tests completed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
