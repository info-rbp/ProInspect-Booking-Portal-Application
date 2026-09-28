import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { applicationDefault, initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, GeoPoint } from 'firebase-admin/firestore';
import type { Firestore, Transaction } from 'firebase-admin/firestore';

export const COLLECTIONS = ['bookings','properties','clients','clientUsers','clientMemberships','clientPropertyLinks','clientOrganisations','clientProperties','clientDocuments','propertyDocuments','tenancies','tenantUsers','workOrders','documentRequests','communications','subscriptions','payments','adminUsers','auditEvents','services','settings'] as const;
export const PRODUCTION_PROJECT = 'business-plan-applicatio-17047';
export const PRODUCTION_DATABASE = 'ai-studio-7242850f-c156-4268-aeb7-c8d47ff6931a';
type Row = Record<string, any>;
export type Snapshot = Record<string, Record<string, Row>>;
export type Target = { environment: 'emulator' | 'staging' | 'production'; projectId: string; databaseId: string };
export type Change = { collection: string; id: string; before: Row | null; after: Row };
export type Plan = { schemaVersion: 1; target: Target; createdAt: string; sourceSha: string; migrationVersion: string; sourceHash: string; beforeCounts: Record<string, number>; afterCounts: Record<string, number>; changes: Change[]; digest: string };
const fail = (message: string): never => { throw new Error(message); };
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Encode Firestore-native values without converting timestamps/references into ordinary maps.
export function encode(value: any): any {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return { $stage3: 'number', value: String(value) };
    return value;
  }
  if (value instanceof Timestamp) return { $stage3: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value instanceof GeoPoint) return { $stage3: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  if (Buffer.isBuffer(value)) return { $stage3: 'bytes', value: value.toString('base64') };
  if (value instanceof Date) return { $stage3: 'date', value: value.toISOString() };
  if (typeof value.path === 'string' && value.firestore && typeof value.get === 'function') return { $stage3: 'reference', path: value.path };
  if (Array.isArray(value)) return value.map(encode);
  if (Object.getPrototypeOf(value) !== Object.prototype) fail('Unsupported Firestore value; extend the lossless codec before migration.');
  if (Object.hasOwn(value, '$stage3')) fail('Reserved migration codec key in document; manual review required.');
  return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, encode(value[k])]));
}
export function decode(value: any, db: Firestore): any {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => decode(v, db));
  if (value.$stage3 === 'timestamp') return new Timestamp(value.seconds, value.nanoseconds);
  if (value.$stage3 === 'geopoint') return new GeoPoint(value.latitude, value.longitude);
  if (value.$stage3 === 'bytes') return Buffer.from(value.value, 'base64');
  if (value.$stage3 === 'date') return new Date(value.value);
  if (value.$stage3 === 'reference') return db.doc(value.path);
  if (value.$stage3 === 'number') return Number(value.value);
  return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, decode(v, db)]));
}
function canonical(value: any): any {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
}
export const digestOf = (value: unknown) => hash(canonical(value));
export const counts = (snapshot: Snapshot) => Object.fromEntries(COLLECTIONS.map(c => [c, Object.keys(snapshot[c] || {}).length]));
const normal = (v: unknown) => typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : '';
const addressKey = (p: Row) => [normal(p.unit), normal(p.streetAddress), normal(p.suburb), normal(p.state || 'WA').toUpperCase(), normal(p.postcode)].join('|');

export function validateTarget(target: Target, applying: boolean) {
  if (!target.projectId || !target.databaseId || !['emulator','staging','production'].includes(target.environment)) fail('Explicit environment, project and database are required.');
  if (target.environment === 'emulator') {
    if (!process.env.FIRESTORE_EMULATOR_HOST || !target.projectId.startsWith('demo-')) fail('Emulator runs require a demo-* project and FIRESTORE_EMULATOR_HOST.');
  } else {
    if (process.env.FIRESTORE_EMULATOR_HOST) fail('A live target cannot use emulator credentials/configuration.');
    if (target.environment === 'staging' && target.projectId === PRODUCTION_PROJECT) fail('Staging must use a separate project, not the production project.');
  }
  if (applying && target.environment === 'production') fail('Production apply is locked in Stage 3. Stage 4 requires separately approved cutover and accepted staging evidence.');
}

export async function snapshot(db: Firestore, tx?: Transaction): Promise<Snapshot> {
  const result: Snapshot = {};
  let total = 0;
  for (const c of COLLECTIONS) {
    const query = db.collection(c).orderBy('__name__');
    const snap = tx ? await tx.get(query) : await query.get();
    total += snap.size;
    if (total > 20000) fail('Snapshot exceeds the 20,000-document rehearsal limit. No writes have been made.');
    result[c] = Object.fromEntries(snap.docs.map(d => [d.id, encode(d.data())]));
  }
  return result;
}

export function validateSources(s: Snapshot) {
  const unique = (collection: string, key: (row: Row) => string, label: string) => {
    const seen = new Set<string>();
    for (const row of Object.values(s[collection] || {})) {
      const value = key(row);
      if (value && seen.has(value)) fail(`Duplicate ${label}; reconcile before applying.`);
      if (value) seen.add(value);
    }
  };
  unique('properties', p => p.streetAddress && p.suburb && p.postcode ? addressKey(p) : '', 'canonical property address');
  unique('clientUsers', u => normal(u.emailLower || u.email), 'client-user email');
  unique('clientUsers', u => typeof u.firebaseUid === 'string' ? u.firebaseUid.trim() : '', 'client-user Firebase UID');
  for (const [id, row] of Object.entries(s.clientOrganisations || {})) {
    if (!normal(row.name)) fail(`Legacy organisation ${id} has no name.`);
    const current = s.clients?.[id];
    if (current && normal(current.name) !== normal(row.name)) fail(`Legacy organisation ${id} collides with a different canonical client.`);
  }
  for (const [id, row] of Object.entries(s.clientMemberships || {})) {
    if (!row.organisationId || row.clientId) continue;
    if ((!s.clients?.[row.organisationId] && !s.clientOrganisations?.[row.organisationId]) || (!row.uid && !row.email)) fail(`Legacy membership ${id} is ambiguous or orphaned.`);
    if (!['owner','admin','member','viewer'].includes(row.role) || !['active','invited','revoked'].includes(row.status)) fail(`Legacy membership ${id} has an invalid role or status.`);
    const users = Object.entries(s.clientUsers || {});
    const byUid = users.find(([,u]) => row.uid && u.firebaseUid === row.uid);
    const byEmail = users.find(([,u]) => row.email && normal(u.emailLower || u.email) === normal(row.email));
    if (byUid && byEmail && byUid[0] !== byEmail[0]) fail(`Legacy membership ${id} has conflicting identities.`);
  }
  for (const [id, p] of Object.entries(s.clientProperties || {})) {
    if (!p.streetAddress || !p.suburb || !p.postcode) fail(`Legacy property ${id} has an incomplete address.`);
    const clientId = p.organisationId || p.clientId;
    if (clientId && !s.clients?.[clientId] && !s.clientOrganisations?.[clientId]) fail(`Legacy property ${id} has an unknown client.`);
  }
  for (const [id, row] of Object.entries(s.clientDocuments || {})) {
    if (!row.propertyId || !row.storagePath) fail(`Legacy document ${id} has no property or storage reference.`);
  }
}

export function validateIntegrity(s: Snapshot) {
  const references: Record<string, string> = { propertyId:'properties', clientId:'clients', primaryClientId:'clients', clientUserId:'clientUsers', tenancyId:'tenancies', bookingId:'bookings', workOrderId:'workOrders', documentRequestId:'documentRequests', subscriptionId:'subscriptions' };
  const canonicalCollections = COLLECTIONS.filter(c => !['clientOrganisations','clientProperties','clientDocuments'].includes(c));
  for (const c of canonicalCollections) for (const [id, row] of Object.entries(s[c] || {})) {
    if (c === 'clientMemberships' && row.organisationId && !row.clientId) fail(`Unconverted membership ${id}.`);
    if (['clientMemberships','clientPropertyLinks'].includes(c)) for (const key of c === 'clientMemberships' ? ['clientId','clientUserId'] : ['clientId','propertyId']) if (!row[key]) fail(`${c}/${id} missing ${key}.`);
    for (const [key, target] of Object.entries(references)) {
      const value = row[key];
      if (value !== undefined && value !== null && value !== '' && (typeof value !== 'string' || !s[target]?.[value])) fail(`Orphan ${c}/${id}.${key}.`);
    }
    for (const [key,target] of [['clientIds','clients'],['propertyIds','properties'],['tenancyIds','tenancies']] as const) {
      if (row[key] !== undefined && (!Array.isArray(row[key]) || row[key].some((v: any) => typeof v !== 'string' || !s[target]?.[v]))) fail(`Invalid ${c}/${id}.${key}.`);
    }
    for (const key of ['bookingId','workOrderId','tenancyId']) {
      const ref = row[key] && s[references[key]]?.[row[key]];
      if (ref && row.propertyId && ref.propertyId && row.propertyId !== ref.propertyId) fail(`Cross-property ${c}/${id}.${key}.`);
    }
    if (c === 'propertyDocuments' && row.propertyId) {
      for (const clientId of row.clientIds || []) {
        const linked = s.properties?.[row.propertyId]?.primaryClientId === clientId || Object.values(s.clientPropertyLinks || {}).some(l => l.propertyId === row.propertyId && l.clientId === clientId);
        if (!linked) fail(`Document ${id} exposes a property to an unrelated client.`);
      }
    }
  }
}

// Transform against a private in-memory database. No Firestore writer is exposed.
export function planningDatabase(source: Snapshot) {
  const data: Snapshot = structuredClone(source);
  const merge = (a: Row, b: Row): Row => {
    const result = { ...a };
    for (const [k,v] of Object.entries(b)) if (v !== undefined) result[k] = v && typeof v === 'object' && !Array.isArray(v) && !v.$stage3 && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
    return result;
  };
  const collection = (name: string) => {
    if (!COLLECTIONS.includes(name as any)) fail(`Unapproved migration collection ${name}.`);
    data[name] ||= {};
    const doc = (id: string): any => {
      if (!id || typeof id !== 'string' || id.includes('/')) fail('Invalid document ID.');
      const ref: any = { id, path: `${name}/${id}`, get: async () => ({ id, exists: Object.hasOwn(data[name],id), data: () => structuredClone(data[name][id]), ref }), set: async (value: Row, options?: {merge?: boolean}) => {
        // Proposed values already contain encoded source values; preserve their tags.
        const clean = JSON.parse(JSON.stringify(value));
        data[name][id] = options?.merge ? merge(data[name][id] || {}, clean) : clean;
      } };
      return ref;
    };
    return { doc, get: async () => ({ size: Object.keys(data[name]).length, docs: await Promise.all(Object.keys(data[name]).sort().map(id => doc(id).get())) }) };
  };
  return { db: { collection }, data };
}

export async function makePlan(source: Snapshot, target: Target, transform: (db: any) => Promise<void>, version: string, sha: string): Promise<Plan> {
  validateSources(source);
  const shadow = planningDatabase(source);
  await transform(shadow.db);
  validateSources(shadow.data);
  validateIntegrity(shadow.data);
  const changes: Change[] = [];
  for (const c of COLLECTIONS) for (const [id, after] of Object.entries(shadow.data[c] || {})) {
    const before = source[c]?.[id] || null;
    const withoutUpdated = (row: Row) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'updatedAt'));
    if (before && isDeepStrictEqual(canonical(withoutUpdated(before)), canonical(withoutUpdated(after)))) continue;
    changes.push({ collection: c, id, before, after });
  }
  if (changes.length > 400) fail('More than 400 changed documents: atomic rehearsal limit exceeded; partition design and review required, no writes made.');
  if (Buffer.byteLength(JSON.stringify(changes)) > 7 * 1024 * 1024) fail('Plan exceeds safe atomic request size; no writes made.');
  const body = { schemaVersion: 1 as const, target, createdAt: new Date().toISOString(), sourceSha: sha, migrationVersion: version, sourceHash: digestOf(source), beforeCounts: counts(source), afterCounts: counts(shadow.data), changes };
  return { ...body, digest: digestOf(body) };
}

export async function applyPlan(db: Firestore, plan: Plan, target: Target, approvedDigest: string, version: string) {
  validateTarget(target, true);
  const { digest, ...body } = plan;
  if (digestOf(body) !== digest || digest !== approvedDigest || !isDeepStrictEqual(plan.target, target) || plan.migrationVersion !== version || plan.schemaVersion !== 1) fail('Plan approval, target, version or digest mismatch.');
  if (Date.now() - Date.parse(plan.createdAt) > 24 * 3600_000 || Date.parse(plan.createdAt) > Date.now() + 60_000) fail('Plan expired or future-dated.');
  if (plan.changes.length > 400) fail('Atomic write limit exceeded.');
  await db.runTransaction(async tx => {
    const current = await snapshot(db, tx);
    if (digestOf(current) !== plan.sourceHash) fail('Database changed since dry run. Generate and approve a new plan.');
    const expected = structuredClone(current);
    for (const change of plan.changes) {
      if (!COLLECTIONS.includes(change.collection as any) || !change.id || change.id.includes('/')) fail('Invalid plan change.');
      if (!isDeepStrictEqual(current[change.collection]?.[change.id] || null, change.before)) fail('Plan preimage mismatch.');
      expected[change.collection][change.id] = change.after;
    }
    validateSources(expected);
    validateIntegrity(expected);
    if (!isDeepStrictEqual(counts(expected), plan.afterCounts)) fail('Plan reconciliation count mismatch.');
    for (const change of plan.changes) tx.set(db.collection(change.collection).doc(change.id), decode(change.after, db));
  });
  const actual = await snapshot(db);
  validateIntegrity(actual);
  if (!isDeepStrictEqual(counts(actual), plan.afterCounts)) fail('Post-apply count mismatch; stop cutover and investigate.');
  for (const change of plan.changes) if (!isDeepStrictEqual(actual[change.collection][change.id], change.after)) fail('Post-apply content mismatch; stop cutover.');
  return { schemaVersion: 1, status: 'passed', target, planDigest: digest, migrationVersion: version, sourceSha: plan.sourceSha, appliedAt: new Date().toISOString(), changedDocuments: plan.changes.length, counts: counts(actual), integrity: 'passed', databaseHash: digestOf(actual) };
}

export async function runMigration(transform: (db: any) => Promise<void>) {
  const args = process.argv.slice(2);
  const value = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const applying = args.includes('--apply');
  const target: Target = { environment: (value('--environment') || (process.env.FIRESTORE_EMULATOR_HOST ? 'emulator' : '')) as Target['environment'], projectId: value('--project') || process.env.FIREBASE_PROJECT_ID || '', databaseId: value('--database') || process.env.FIRESTORE_DATABASE_ID || '' };
  validateTarget(target, applying);
  const version = hash([readFileSync('scripts/migrate-unified-portal.ts','utf8'), readFileSync('scripts/stage3/migration-engine.ts','utf8')]);
  const sha = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const app = initializeApp({projectId: target.projectId, ...(target.environment === 'emulator' ? {} : {credential: applicationDefault()})}, `stage3-${Date.now()}`);
  const db = getFirestore(app,target.databaseId);
  db.settings({ignoreUndefinedProperties:true});
  const save = (path: string, content: unknown) => { mkdirSync(dirname(path),{recursive:true}); writeFileSync(path, JSON.stringify(content,null,2)+'\n',{mode:0o600}); };
  try {
    if (applying) {
      const path = value('--plan'); const approved = value('--approve');
      if (!path || !approved) fail('--apply requires --plan and --approve <plan-digest>.');
      if (target.environment !== 'emulator') {
        const backupPath = value('--backup-evidence');
        if (!backupPath) fail('Live staging apply requires a completed managed export evidence file.');
        const backup = JSON.parse(readFileSync(backupPath,'utf8'));
        if (backup.projectId !== target.projectId || backup.databaseId !== target.databaseId || backup.status !== 'SUCCESSFUL' || !String(backup.outputUriPrefix).startsWith('gs://') || Date.now()-Date.parse(backup.completedAt) > 24*3600_000) fail('Backup evidence target/status/age mismatch.');
      }
      const evidence = await applyPlan(db, JSON.parse(readFileSync(path,'utf8')), target, approved, version);
      save(value('--evidence') || 'private-evidence/stage3/migration-apply.json', evidence);
      console.log(JSON.stringify(evidence,null,2));
    } else {
      const before = await snapshot(db);
      const plan = await makePlan(before,target,transform,version,sha);
      if (digestOf(await snapshot(db)) !== digestOf(before)) fail('Database changed during dry run; no plan accepted.');
      const path = value('--plan') || 'private-evidence/stage3/migration-plan.json';
      save(path,plan);
      console.log(JSON.stringify({dryRun:true, planDigest:plan.digest, changes:plan.changes.length, beforeCounts:plan.beforeCounts, afterCounts:plan.afterCounts, integrity:'passed'},null,2));
      console.log('Dry run only. Plan contains private data; never upload it to public CI artifacts.');
    }
  } finally { await deleteApp(app); }
}
