import { createHash } from 'node:crypto';

export const PRODUCTION_PROJECT = 'business-plan-applicatio-17047';
export const MODEL_VERSION = 'proinspect-unification-v3';
export const COLLECTIONS = [
  'clients', 'clientUsers', 'clientMemberships', 'properties', 'clientPropertyLinks',
  'tenancies', 'tenantUsers', 'bookings', 'workOrders', 'propertyDocuments',
  'documentRequests', 'communications', 'subscriptions', 'payments', 'adminUsers',
  'auditEvents', 'services', 'settings', 'clientOrganisations', 'clientProperties',
  'clientDocuments', 'clientRequests', 'clientApprovals', 'tenantRequests',
  'tenantInspections', 'tenantFormRequests', 'portalNotifications', 'contractors',
];
const TARGET_COLLECTIONS = new Set(['clients','clientUsers','clientMemberships','properties','clientPropertyLinks','bookings','propertyDocuments','clientRequests','clientApprovals']);
const ROLES = ['owner', 'admin', 'member', 'viewer'];
const normal = value => typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const stableId = (prefix, value) => `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
export const counts = data => Object.fromEntries(Object.keys(data).sort().map(c => [c, Object.keys(data[c]).length]));
const clean = value => JSON.parse(JSON.stringify(value));
export function addressKey(p) {
  return [normal(p.unit), normal(p.streetAddress), normal(p.suburb), normal(p.state || 'WA'), normal(p.postcode)].join('|');
}
function completeAddress(p) { return !!(normal(p.streetAddress) && normal(p.suburb) && normal(p.postcode)); }
function recordId(id) { return typeof id === 'string' && id.length > 0 && !id.includes('/'); }
export function assertTarget(target) {
  if (!['staging', 'production', 'emulator'].includes(target.environment)) throw new Error('Explicit staging, production or emulator environment required.');
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(target.project || '')) throw new Error('Explicit valid project ID required.');
  if (!recordId(target.database)) throw new Error('Explicit database ID required.');
  if (target.environment === 'staging' && [PRODUCTION_PROJECT, target.productionProject].includes(target.project)) throw new Error('Staging cannot target production.');
  if (target.environment === 'production' && target.project !== PRODUCTION_PROJECT) throw new Error('Production target is not the recorded production project.');
  if (target.environment === 'emulator' && !target.project.startsWith('demo-')) throw new Error('Emulator project must start with demo-.');
  if (target.environment !== 'emulator' && target.project.startsWith('demo-')) throw new Error('Demo projects are emulator-only.');
}

/** Referential and scope validation. Historical audit events are not rewritten. */
export function integrity(data) {
  const errors = [];
  const exists = (c, id) => recordId(id) && Object.hasOwn(data[c] || {}, id);
  const check = (c, id, field, destination, value, required = false) => {
    if ((required || value != null && value !== '') && !exists(destination, value)) errors.push(`${c}/${id}: invalid ${field} -> ${destination}`);
  };
  const relationships = {
    clientMemberships: { clientId: ['clients', true], clientUserId: ['clientUsers', true] },
    properties: { primaryClientId: ['clients', false] },
    clientPropertyLinks: { clientId: ['clients', true], propertyId: ['properties', true] },
    tenancies: { propertyId: ['properties', true], clientId: ['clients', false] },
    bookings: { propertyId: ['properties', true], clientId: ['clients', false] },
    workOrders: { propertyId: ['properties', true], clientId: ['clients', false], tenancyId: ['tenancies', false] },
    propertyDocuments: { propertyId: ['properties', true], tenancyId: ['tenancies', false], bookingId: ['bookings', false], workOrderId: ['workOrders', false] },
    documentRequests: { propertyId: ['properties', false], clientId: ['clients', false], clientUserId: ['clientUsers', false], generatedDocumentId: ['propertyDocuments', false] },
    clientRequests: { clientId: ['clients', true], clientUserId: ['clientUsers', true], propertyId: ['properties', false] },
    clientApprovals: { clientId: ['clients', true], propertyId: ['properties', false], workOrderId: ['workOrders', false], documentId: ['propertyDocuments', false] },
    tenantRequests: { propertyId: ['properties', true], tenancyId: ['tenancies', true], tenantUserId: ['tenantUsers', true] },
    tenantInspections: { propertyId: ['properties', true], tenancyId: ['tenancies', true] },
    tenantFormRequests: { propertyId: ['properties', false], tenancyId: ['tenancies', false] },
    payments: { propertyId: ['properties', false], clientId: ['clients', false], bookingId: ['bookings', false], workOrderId: ['workOrders', false] },
    subscriptions: { clientId: ['clients', true] },
  };
  for (const [collection, fields] of Object.entries(relationships)) {
    for (const [id, row] of Object.entries(data[collection] || {})) {
      for (const [field, [destination, required]] of Object.entries(fields)) check(collection, id, field, destination, row[field], required);
      if (row.propertyId) {
        for (const [field, destination] of [['tenancyId', 'tenancies'], ['bookingId', 'bookings'], ['workOrderId', 'workOrders']]) {
          const related = data[destination]?.[row[field]];
          if (related?.propertyId && related.propertyId !== row.propertyId) errors.push(`${collection}/${id}: cross-property ${field}`);
        }
        for (const clientId of [...(row.clientIds || []), ...(row.clientId ? [row.clientId] : [])]) {
          check(collection, id, 'clientIds', 'clients', clientId, true);
          if (!Object.values(data.clientPropertyLinks || {}).some(link => link.clientId === clientId && link.propertyId === row.propertyId)) errors.push(`${collection}/${id}: missing client/property relationship`);
        }
      }
    }
  }
  for (const [id, user] of Object.entries(data.tenantUsers || {})) for (const tenancy of user.tenancyIds || []) check('tenantUsers', id, 'tenancyIds', 'tenancies', tenancy, true);
  for (const [id, user] of Object.entries(data.clientUsers || {})) {
    for (const client of user.clientIds || []) {
      check('clientUsers', id, 'clientIds', 'clients', client, true);
      const memberships = Object.values(data.clientMemberships || {}).filter(m => m.clientId === client && m.clientUserId === id);
      if (user.active !== false && (!memberships.some(m => m.status === 'active') || memberships.some(m => m.status === 'revoked'))) errors.push(`clientUsers/${id}: active access conflicts with membership status`);
    }
  }
  for (const collection of ['clientUsers', 'tenantUsers']) {
    for (const field of ['firebaseUid', 'emailLower']) {
      const seen = new Set();
      for (const [id, user] of Object.entries(data[collection] || {})) {
        const value = normal(user[field]);
        if (value && seen.has(value)) errors.push(`${collection}/${id}: duplicate identity ${field}`);
        if (value) seen.add(value);
      }
    }
  }
  const pairs = new Set();
  for (const [id, m] of Object.entries(data.clientMemberships || {})) {
    const pair = `${m.clientId}|${m.clientUserId}`;
    if (pairs.has(pair)) errors.push(`clientMemberships/${id}: duplicate membership pair requires review`);
    pairs.add(pair);
    if (!ROLES.includes(m.role) || !['active', 'invited', 'revoked'].includes(m.status)) errors.push(`clientMemberships/${id}: invalid role/status`);
  }
  return [...new Set(errors)].sort();
}

/** Pure planning function: never connects to Firestore and never mutates input. */
export function planMigration(snapshot, context) {
  assertTarget(context);
  const before = clean(snapshot);
  const after = clean(snapshot);
  COLLECTIONS.forEach(c => { before[c] ||= {}; after[c] ||= {}; });
  const errors = [], warnings = [], mappings = context.mappings || {};
  const now = context.generatedAt || new Date().toISOString();
  const put = (c, id, row) => {
    if (!recordId(id)) { errors.push(`${c}: invalid document ID`); return; }
    after[c][id] = clean(row);
  };
  const fill = (c, id, values) => {
    const existing = after[c][id] || {};
    const row = { ...values, ...existing, id };
    if (!after[c][id]) { row.createdAt ||= now; row.updatedAt ||= now; }
    put(c, id, row);
  };
  const clients = new Map();
  for (const [id, old] of Object.entries(after.clientOrganisations)) {
    const clientId = mappings.organisations?.[id] || id;
    if (!normal(old.name)) { errors.push(`clientOrganisations/${id}: missing name`); continue; }
    const existing = after.clients[clientId];
    if (existing && normal(existing.name) !== normal(old.name) && !mappings.organisations?.[id]) { errors.push(`clientOrganisations/${id}: canonical client collision`); continue; }
    fill('clients', clientId, {
      name: old.name, clientType: ({ individual: 'landlord', company: 'commercial_landlord', agency: 'agency', strata: 'strata_company' })[old.entityType] || 'other',
      status: 'active', billingEmail: old.billingEmail, email: old.billingEmail, phone: old.phone, abn: old.abn, acn: old.acn,
      createdAt: old.createdAt || now, migrationSource: 'legacy-client-organisation',
    });
    clients.set(id, clientId);
  }
  const clientIdFor = id => clients.get(id) || id;
  const addresses = new Map();
  for (const [id, property] of Object.entries(after.properties)) {
    if (!completeAddress(property)) { errors.push(`properties/${id}: incomplete address`); continue; }
    const key = addressKey(property);
    if (addresses.has(key)) errors.push(`properties/${id}: duplicate canonical address`);
    addresses.set(key, id);
    // Retain the established uppercase state segment for canonical addressKey compatibility.
    const parts = key.split('|'); parts[3] = parts[3].toUpperCase();
    put('properties', id, { ...property, addressKey: parts.join('|') });
  }
  const propertyMap = new Map();
  const link = (clientId, propertyId) => {
    if (!clientId) return;
    if (!after.clients[clientId]) { errors.push(`properties/${propertyId}: unknown client`); return; }
    // Existing inactive links are never reactivated by migration.
    if (Object.values(after.clientPropertyLinks).some(x => x.clientId === clientId && x.propertyId === propertyId)) return;
    const id = stableId('cpl', `${clientId}|${propertyId}`);
    fill('clientPropertyLinks', id, { clientId, propertyId, role: 'other', primary: false, active: true, migrationSource: MODEL_VERSION });
  };
  const ensureProperty = (source, old, preferred, clientId) => {
    if (!completeAddress(old)) { errors.push(`${source}: incomplete property address`); return null; }
    const key = addressKey(old);
    const id = preferred || addresses.get(key) || stableId('prop', key);
    const existing = after.properties[id];
    if (existing && addressKey(existing) !== key) { errors.push(`${source}: property ID/address conflict`); return null; }
    if (addresses.has(key) && addresses.get(key) !== id) { errors.push(`${source}: property address collision`); return null; }
    const parts = key.split('|'); parts[3] = parts[3].toUpperCase();
    fill('properties', id, {
      streetAddress: old.streetAddress, unit: old.unit, suburb: old.suburb, state: old.state || 'WA', postcode: old.postcode,
      propertyType: old.propertyType, primaryClientId: clientId, clientName: old.clientName, clientReference: old.clientReference,
      addressKey: parts.join('|'), status: old.status === 'inactive' ? 'inactive' : 'active', createdAt: old.createdAt || now, migrationSource: MODEL_VERSION,
    });
    addresses.set(key, id); link(clientId, id); return id;
  };
  for (const [id, old] of Object.entries(after.clientProperties)) {
    const clientId = clientIdFor(old.organisationId || old.clientId);
    if (!clientId || !after.clients[clientId]) { errors.push(`clientProperties/${id}: unknown organisation/client`); continue; }
    const preferred = mappings.properties?.[id] || addresses.get(addressKey(old)) || id;
    const propertyId = ensureProperty(`clientProperties/${id}`, old, preferred, clientId);
    if (propertyId) propertyMap.set(id, propertyId);
  }
  for (const [id, booking] of Object.entries(after.bookings)) {
    const p = booking.property || {};
    let clientId = clientIdFor(booking.clientId || booking.clientOrganisationId || mappings.bookingClients?.[id]);
    if (!clientId && normal(p.clientName)) {
      // Names are not reliable authority. An operator-approved mapping is required.
      errors.push(`bookings/${id}: clientName requires an explicit bookingClients mapping`);
      continue;
    }
    if (clientId && !after.clients[clientId]) { errors.push(`bookings/${id}: unknown client`); continue; }
    const preferred = propertyMap.get(booking.propertyId) || booking.propertyId;
    const propertyId = ensureProperty(`bookings/${id}`, p, preferred, clientId);
    if (!propertyId) continue;
    if (!clientId) warnings.push(`bookings/${id}: public booking has no client relationship; no portal access inferred`);
    put('bookings', id, { ...booking, propertyId, ...(clientId ? { clientId } : {}) });
  }
  for (const [id, p] of Object.entries(after.properties)) if (p.primaryClientId) link(p.primaryClientId, id);

  // Convert legacy profiles in place; preserve disabled identities and avoid duplicate users.
  for (const [id, old] of Object.entries(after.clientUsers)) {
    if (!old.uid) continue;
    if (old.firebaseUid && old.firebaseUid !== old.uid) { errors.push(`clientUsers/${id}: conflicting UID`); continue; }
    put('clientUsers', id, { ...old, id, firebaseUid: old.uid, emailLower: normal(old.email), clientIds: old.clientIds || [], clientRoles: old.clientRoles || {}, active: old.active !== false });
  }
  const identity = (uid, email, source) => {
    const byUid = Object.entries(after.clientUsers).filter(([, u]) => uid && u.firebaseUid === uid);
    const byEmail = Object.entries(after.clientUsers).filter(([, u]) => email && normal(u.emailLower || u.email) === email);
    if (byUid.length > 1 || byEmail.length > 1 || (byUid.length && byEmail.length && byUid[0][0] !== byEmail[0][0])) { errors.push(`${source}: ambiguous identity`); return null; }
    if (uid && byEmail[0]?.[1].firebaseUid && byEmail[0][1].firebaseUid !== uid) { errors.push(`${source}: email/UID collision`); return null; }
    return byUid[0]?.[0] || byEmail[0]?.[0] || stableId('client_user', uid || email);
  };
  for (const [id, old] of Object.entries(after.clientMemberships)) {
    if (old.clientId && old.clientUserId) continue;
    const clientId = clientIdFor(old.organisationId), uid = old.uid || '', email = normal(old.email);
    if (!after.clients[clientId] || (!uid && !email) || !ROLES.includes(old.role) || !['active', 'invited', 'revoked'].includes(old.status)) { errors.push(`clientMemberships/${id}: incomplete legacy membership`); continue; }
    if (old.status === 'active' && !uid) { errors.push(`clientMemberships/${id}: active legacy membership has no verified UID`); continue; }
    const userId = identity(uid, email, `clientMemberships/${id}`);
    if (!userId) continue;
    fill('clientUsers', userId, { email, emailLower: email, firebaseUid: uid || undefined, displayName: old.displayName || email, active: old.status === 'active', clientIds: [], clientRoles: {}, migrationSource: MODEL_VERSION });
    const user = after.clientUsers[userId];
    if (uid && !user.firebaseUid) user.firebaseUid = uid;
    const status = user.active === false && old.status === 'active' ? 'revoked' : old.status;
    put('clientMemberships', id, { id, clientId, clientUserId: userId, email, role: old.role, status, createdAt: old.createdAt || now, updatedAt: old.updatedAt || now, migrationSource: MODEL_VERSION });
  }
  for (const [id, user] of Object.entries(after.clientUsers)) {
    user.emailLower ||= normal(user.email);
    user.clientIds ||= [];
    user.clientRoles ||= {};
    for (const clientId of [...user.clientIds]) {
      if (!after.clients[clientId]) { errors.push(`clientUsers/${id}: unknown client`); continue; }
      const memberships = Object.values(after.clientMemberships).filter(m => m.clientUserId === id && m.clientId === clientId);
      if (!memberships.length) {
        const membershipId = stableId('cm', `${id}|${clientId}`);
        // Never invent ownership from array order or email matches.
        const role = ROLES.includes(user.clientRoles[clientId]) ? user.clientRoles[clientId] : 'viewer';
        fill('clientMemberships', membershipId, { clientId, clientUserId: id, email: normal(user.email), role, status: user.active === false ? 'revoked' : 'active', migrationSource: MODEL_VERSION });
      }
    }
    const memberships = Object.values(after.clientMemberships).filter(m => m.clientUserId === id);
    const roles = {};
    for (const m of memberships) if (m.status === 'active' && user.active !== false) roles[m.clientId] = m.role;
    for (const m of memberships) if (m.status === 'revoked') delete roles[m.clientId];
    put('clientUsers', id, { ...user, clientIds: Object.keys(roles).sort(), clientRoles: roles });
  }
  const uidMap = new Map(Object.entries(after.clientUsers).filter(([,u]) => u.firebaseUid).map(([id,u]) => [u.firebaseUid, id]));
  for (const [id, old] of Object.entries(after.clientDocuments)) {
    const propertyId = propertyMap.get(old.propertyId) || mappings.documentProperties?.[id] || old.propertyId;
    const clientId = clientIdFor(old.organisationId || old.clientId);
    if (!after.properties[propertyId] || !after.clients[clientId] || !old.storagePath) { errors.push(`clientDocuments/${id}: missing canonical property, client or storage path`); continue; }
    const existing = after.propertyDocuments[id];
    if (existing && existing.propertyId !== propertyId) { errors.push(`clientDocuments/${id}: canonical document collision`); continue; }
    fill('propertyDocuments', id, {
      propertyId, clientIds: [clientId], audiences: old.status === 'draft' || old.status === 'archived' ? ['staff'] : ['client'],
      title: old.name || old.title || old.documentType || 'Imported document', category: 'other', fileName: old.name || old.fileName || 'document',
      contentType: old.contentType || 'application/octet-stream', size: Number(old.sizeBytes || old.size || 0), storagePath: old.storagePath,
      status: old.status === 'draft' ? 'draft' : old.status === 'archived' ? 'archived' : 'issued', version: 1,
      uploadedAt: old.createdAt || now, uploadedBy: uidMap.get(old.clientUid) || old.clientUid || 'migration', migrationSource: MODEL_VERSION,
    });
  }
  // Legacy Client requests/approvals share collection names but not canonical shapes.
  for (const collection of ['clientRequests', 'clientApprovals']) for (const [id, old] of Object.entries(after[collection])) {
    if (!old.organisationId || old.clientId) continue;
    const clientId = clientIdFor(old.organisationId);
    const propertyId = propertyMap.get(old.propertyId) || old.propertyId;
    const userId = uidMap.get(old.clientUid);
    if (!after.clients[clientId] || collection === 'clientRequests' && !userId) { errors.push(`${collection}/${id}: unknown legacy client/user`); continue; }
    const row = { ...old, id, clientId, propertyId, reference: old.reference || `MIG-${id}`, migrationSource: MODEL_VERSION };
    if (collection === 'clientRequests') Object.assign(row, { clientUserId: userId, details: typeof old.details === 'string' ? old.details : String(old.details?.description || old.details?.instructions || ''), payload: typeof old.details === 'object' ? old.details : old.payload || {}, status: old.status === 'waiting_client' ? 'awaiting_client' : old.status, attachmentDocumentIds: old.attachmentDocumentIds || [] });
    put(collection, id, row);
  }
  for (const [id, document] of Object.entries(after.propertyDocuments)) {
    if (String(document.storagePath || '').startsWith('tenant-sensitive/') || document.formCode === '2' || document.sensitive === true) errors.push(`propertyDocuments/${id}: sensitive Form 2/evidence cannot enter the shared document collection`);
  }
  const allErrors = [...new Set([...errors, ...integrity(after)])].sort();
  const operations = [];
  for (const collection of Object.keys(after).sort()) for (const id of Object.keys(after[collection]).sort()) {
    const old = before[collection]?.[id] ?? null, next = after[collection][id];
    if (digest(old) !== digest(next)) operations.push({ path: `${collection}/${id}`, before: old, after: next, beforeHash: digest(old), afterHash: digest(next) });
  }
  const plan = {
    schema: MODEL_VERSION, environment: context.environment, project: context.project, database: context.database,
    sourceSha: context.sourceSha, codeHash: context.codeHash, generatedAt: now, mappings: clean(mappings),
    sourceHash: digest(before), targetHash: digest(after), beforeCounts: counts(before), afterCounts: counts(after),
    errors: allErrors, warnings: [...new Set(warnings)].sort(), operations,
  };
  return { ...plan, planId: digest(plan) };
}

export function validatePlan(plan) {
  const { planId, ...body } = plan;
  assertTarget(plan);
  if (plan.schema !== MODEL_VERSION || planId !== digest(body)) throw new Error('Plan integrity check failed.');
  if (plan.errors.length) throw new Error(`Plan has ${plan.errors.length} unresolved integrity errors.`);
  for (const operation of plan.operations) {
    if (operation.path.split('/').length !== 2 || !TARGET_COLLECTIONS.has(operation.path.split('/')[0])) throw new Error('Invalid migration operation path.');
    if (operation.after === null || operation.beforeHash !== digest(operation.before) || operation.afterHash !== digest(operation.after)) throw new Error('Invalid migration operation.');
  }
  return plan;
}
