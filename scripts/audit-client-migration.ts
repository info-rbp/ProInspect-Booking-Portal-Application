import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

type Row = Record<string, unknown> & { id: string };
const collections = ['clientUsers', 'clientOrganisations', 'clientMemberships', 'clientProperties', 'clientRequests', 'clientDocuments', 'clientApprovals', 'bookings'] as const;
type Collection = typeof collections[number];
type Snapshot = Record<Collection, Row[]>;

// Only identifiers and error codes are returned. Never emit contact data, tokens,
// document contents or storage credentials into a migration report.
function audit(data: Snapshot) {
  const index = Object.fromEntries(collections.map(c => [c, new Map(data[c].map(r => [r.id, r]))])) as Record<Collection, Map<string, Row>>;
  const issues: { collection: Collection; id: string; code: string }[] = [];
  const add = (c: Collection, r: Row, code: string) => issues.push({ collection: c, id: r.id, code });
  for (const c of collections) {
    if (c === 'clientUsers' || c === 'clientOrganisations' || c === 'bookings') continue;
    for (const r of data[c]) {
      if (!index.clientOrganisations.has(String(r.organisationId || ''))) add(c, r, 'ORPHAN_ORGANISATION');
      if (r.propertyId) {
        const p = index.clientProperties.get(String(r.propertyId));
        if (!p) add(c, r, 'ORPHAN_PROPERTY');
        else if (p.organisationId !== r.organisationId) add(c, r, 'CROSS_ORGANISATION_PROPERTY');
      }
      if (r.requestId) {
        const q = index.clientRequests.get(String(r.requestId));
        if (!q) add(c, r, 'ORPHAN_REQUEST');
        else if (q.organisationId !== r.organisationId || (r.propertyId && q.propertyId && r.propertyId !== q.propertyId)) add(c, r, 'REQUEST_SCOPE_MISMATCH');
      }
      if (r.documentId) {
        const d = index.clientDocuments.get(String(r.documentId));
        if (!d) add(c, r, 'ORPHAN_DOCUMENT');
        else if (d.organisationId !== r.organisationId) add(c, r, 'DOCUMENT_SCOPE_MISMATCH');
      }
      if (c === 'clientMemberships') {
        if (!['active', 'invited', 'revoked'].includes(String(r.status))) add(c, r, 'INVALID_MEMBERSHIP_STATUS');
        if (!['owner', 'admin', 'member', 'viewer'].includes(String(r.role))) add(c, r, 'INVALID_MEMBERSHIP_ROLE');
        if (r.status === 'active' && !index.clientUsers.has(String(r.uid || ''))) add(c, r, 'ORPHAN_ACTIVE_IDENTITY');
      }
      if (c === 'clientRequests') {
        for (const id of Array.isArray(r.attachmentDocumentIds) ? r.attachmentDocumentIds : []) {
          const d = index.clientDocuments.get(String(id));
          if (!d || d.organisationId !== r.organisationId || d.requestId !== r.id) add(c, r, 'INVALID_ATTACHMENT_LINK');
        }
      }
    }
  }
  for (const r of data.bookings) {
    if (!r.clientOrganisationId) continue; // Public historical bookings remain unclaimed.
    if (!index.clientOrganisations.has(String(r.clientOrganisationId))) add('bookings', r, 'ORPHAN_BOOKING_ORGANISATION');
    const p = r.propertyId ? index.clientProperties.get(String(r.propertyId)) : undefined;
    if (r.propertyId && (!p || p.organisationId !== r.clientOrganisationId)) add('bookings', r, 'BOOKING_PROPERTY_SCOPE_MISMATCH');
  }
  return { schema: 1, mode: 'read-only', counts: Object.fromEntries(collections.map(c => [c, data[c].length])), issues, readyForMapping: issues.length === 0 };
}

const { values } = parseArgs({ options: { 'self-test': { type: 'boolean' }, 'read-only': { type: 'boolean' }, project: { type: 'string' }, database: { type: 'string' }, report: { type: 'string' } }, strict: true });
if (values['self-test']) {
  const data = Object.fromEntries(collections.map(c => [c, []])) as Snapshot;
  assert.equal(audit(data).readyForMapping, true);
  data.clientOrganisations.push({ id: 'o' }, { id: 'other' });
  data.clientUsers.push({ id: 'u' });
  data.clientMemberships.push({ id: 'm', organisationId: 'o', uid: 'u', role: 'owner', status: 'active' });
  data.clientProperties.push({ id: 'p', organisationId: 'o' });
  data.clientRequests.push({ id: 'r', organisationId: 'o', propertyId: 'p', attachmentDocumentIds: ['d'] });
  data.clientDocuments.push({ id: 'd', organisationId: 'o', propertyId: 'p', requestId: 'r' });
  data.clientApprovals.push({ id: 'a', organisationId: 'o', requestId: 'r', documentId: 'd' });
  data.bookings.push({ id: 'b', clientOrganisationId: 'o', propertyId: 'p' });
  assert.equal(audit(data).readyForMapping, true);
  data.clientDocuments[0].organisationId = 'other';
  assert.ok(audit(data).issues.some(i => i.code === 'INVALID_ATTACHMENT_LINK'));
  assert.ok(audit(data).issues.some(i => i.code === 'REQUEST_SCOPE_MISMATCH'));
  assert.ok(audit(data).issues.some(i => i.code === 'DOCUMENT_SCOPE_MISMATCH'));
  data.clientMemberships[0].role = 'superadmin';
  assert.ok(audit(data).issues.some(i => i.code === 'INVALID_MEMBERSHIP_ROLE'));
  data.clientUsers = [];
  assert.ok(audit(data).issues.some(i => i.code === 'ORPHAN_ACTIVE_IDENTITY'));
  data.clientProperties = [];
  assert.ok(audit(data).issues.some(i => i.code === 'BOOKING_PROPERTY_SCOPE_MISMATCH'));
  console.log('PASS: migration preflight detects orphan identities, cross-organisation relationships, invalid roles, request/document and booking mismatches.');
} else {
  assert.ok(values['read-only'] && values.project && values.database && values.report, 'Required: --read-only --project PROJECT --database DATABASE --report PATH');
  assert.equal(process.env.FIREBASE_PROJECT_ID, values.project, 'Project must match the explicitly configured runtime project.');
  assert.equal(process.env.FIRESTORE_DATABASE_ID, values.database, 'Database must be explicit.');
  const { adminDb } = await import('../src/server/firebaseAdmin.js');
  const { FieldPath } = await import('firebase-admin/firestore');
  const data = Object.fromEntries(collections.map(c => [c, []])) as Snapshot;
  for (const c of collections) {
    let cursor: string | undefined;
    for (;;) {
      let query = adminDb.collection(c).orderBy(FieldPath.documentId()).limit(200);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      for (const d of page.docs) data[c].push({ ...d.data(), id: d.id });
      if (page.size < 200) break;
      cursor = page.docs[page.docs.length - 1].id;
    }
  }
  const result = audit(data);
  writeFileSync(values.report!, JSON.stringify({ ...result, project: values.project, database: values.database, observedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ counts: result.counts, issueCount: result.issues.length, readyForMapping: result.readyForMapping }));
  if (!result.readyForMapping) process.exitCode = 2;
}
