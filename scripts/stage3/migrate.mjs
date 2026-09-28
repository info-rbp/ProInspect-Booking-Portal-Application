#!/usr/bin/env node
/** Explicit-target, reviewable migration. Plans contain personal data: never upload them to public CI. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, GeoPoint, DocumentReference, FieldPath } from 'firebase-admin/firestore';
import { GoogleAuth } from 'google-auth-library';
import { COLLECTIONS, MODEL_VERSION, assertTarget, canonical, counts, digest, integrity, planMigration, validatePlan } from './migration-model.mjs';

const MARKER = '__proinspect_firestore_type__';
export function encode(value) {
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : { [MARKER]: 'integer', value: value.toString() };
  if (value instanceof Timestamp) return { [MARKER]: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value instanceof GeoPoint) return { [MARKER]: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  if (value instanceof DocumentReference) return { [MARKER]: 'reference', path: value.path, project: value.firestore.projectId, database: value.firestore.databaseId };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { [MARKER]: 'bytes', base64: Buffer.from(value).toString('base64') };
  if (typeof value === 'number' && !Number.isFinite(value)) return { [MARKER]: 'number', value: String(value) };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') {
    if (Object.hasOwn(value, MARKER)) throw new Error('Reserved migration serialization key found in source data. Manual review required.');
    return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,encode(v)]));
  }
  return value;
}
export function decode(value, db) {
  if (value?.[MARKER]) {
    switch (value[MARKER]) {
      case 'integer': return BigInt(value.value);
      case 'timestamp': return new Timestamp(value.seconds, value.nanoseconds);
      case 'geopoint': return new GeoPoint(value.latitude, value.longitude);
      case 'reference':
        if (value.project !== db.projectId || value.database !== db.databaseId) throw new Error('Cross-project/database Firestore references require explicit manual review.');
        return db.doc(value.path);
      case 'bytes': return Buffer.from(value.base64, 'base64');
      case 'number': return Number(value.value);
      default: throw new Error('Unrecognised serialized Firestore type.');
    }
  }
  if (Array.isArray(value)) return value.map(v => decode(v, db));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,decode(v,db)]));
  return value;
}
export function codeHash() {
  return digest(['migration-model.mjs', 'migrate.mjs'].map(name => readFileSync(new URL(name, import.meta.url), 'utf8')));
}
export function privateJSON(path, value) {
  mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
export function connect(target) {
  assertTarget(target);
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (target.environment === 'emulator' && !/^(127\.0\.0\.1|localhost):\d+$/.test(host || '')) throw new Error('An explicit loopback Firestore emulator is required.');
  if (target.environment !== 'emulator' && host) throw new Error('Emulator host is forbidden for a cloud target.');
  const app = initializeApp({ projectId: target.project, ...(target.environment === 'emulator' ? {} : { credential: applicationDefault() }) }, `stage3-${Date.now()}-${Math.random()}`);
  const db = getFirestore(app, target.database);
  db.settings({ useBigInt: true });
  return { app, db };
}
export async function snapshot(db) {
  const names = new Set([...COLLECTIONS, ...(await db.listCollections()).map(c => c.id)]);
  const result = {};
  for (const name of [...names].filter(n => n !== '_stage3Migrations').sort()) {
    result[name] = {};
    let cursor;
    for (;;) {
      let query = db.collection(name).orderBy(FieldPath.documentId()).limit(400);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      for (const doc of page.docs) result[name][doc.id] = encode(doc.data());
      if (page.size < 400) break;
      cursor = page.docs.at(-1);
    }
  }
  return canonical(result);
}
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
function identityMatches(a, b) { return ['environment','project','database'].every(k => a[k] === b[k]); }
export function validateExecution(plan, target, approvedId) {
  validatePlan(plan);
  if (!identityMatches(plan, target)) throw new Error('Plan environment/project/database mismatch.');
  if (plan.codeHash !== codeHash()) throw new Error('Migration code changed; regenerate and rehearse the plan.');
  if (approvedId !== plan.planId) throw new Error('Explicit --approve-plan matching the complete planId is required.');
  // Stage 4 owns production approval, traffic cutover and production execution.
  // Do not remove this gate as a deployment workaround.
  if (target.environment === 'production') throw new Error('Production writes are locked in Stage 3. Stage 4 requires independently accepted staging evidence and release approval.');
  if (target.environment === 'staging' && plan.sourceSha !== execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()) throw new Error('Source commit differs from the approved plan. Re-plan at the deployment source SHA.');
}
async function backupCheck(target, operation, bucket) {
  if (target.environment === 'emulator') return { emulator: true };
  if (!operation?.startsWith(`projects/${target.project}/databases/${target.database}/operations/`) || !bucket || bucket.includes('/')) throw new Error('Completed same-database Firestore export operation and backup bucket required.');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] });
  const { data } = await (await auth.getClient()).request({ url: `https://firestore.googleapis.com/v1/${operation}` });
  if (!data.done || data.error || data.metadata?.operationState !== 'SUCCESSFUL' || !String(data.response?.outputUriPrefix || data.metadata?.outputUriPrefix || '').startsWith(`gs://${bucket}/`)) throw new Error('Firestore export has not completed successfully in the approved backup bucket.');
  if (Date.now() - Date.parse(data.metadata?.endTime || '') > 24 * 60 * 60 * 1000 || !Number.isFinite(Date.parse(data.metadata?.endTime || ''))) throw new Error('A fresh completed export (less than 24 hours old) is required.');
  return { operation, bucket, completedAt: data.metadata.endTime };
}
export async function applyPlan(db, plan, { target, approvedId, writersPaused, backupOperation, backupBucket, resume = false }) {
  validateExecution(plan, target, approvedId);
  if (!writersPaused) throw new Error('All application, worker and manual writers must be paused; --writers-paused is required.');
  for (const op of plan.operations) decode(op.after, db); // Validate all native types before any writes.
  const backup = await backupCheck(target, backupOperation, backupBucket);
  const lock = db.doc('_stage3Migrations/active');
  const run = db.doc(`_stage3Migrations/${plan.planId}`);
  await db.runTransaction(async tx => {
    const [active, previous] = await Promise.all([tx.get(lock), tx.get(run)]);
    if (active.exists && active.data().planId !== plan.planId) throw new Error('Another migration owns the database lock.');
    if (previous.exists && !resume) throw new Error('Run already exists. Explicit --resume required; a verified run must not be applied again.');
    if (previous.exists && previous.data().status !== 'applying' && previous.data().status !== 'failed') throw new Error('Run is not resumable.');
    if (previous.exists && previous.data().planId !== plan.planId) throw new Error('Run identity mismatch.');
    tx.set(lock, { planId: plan.planId, acquiredAt: new Date().toISOString() });
    tx.set(run, { planId: plan.planId, status: 'applying', codeHash: plan.codeHash, sourceSha: plan.sourceSha, target, backup }, { merge: true });
  });
  try {
    const current = await snapshot(db);
    if (!resume && digest(current) !== plan.sourceHash) throw new Error('Source changed after planning. No migration writes performed.');
    if (!resume && digest(planMigration(current, plan).operations) !== digest(plan.operations)) throw new Error('Approved operations are not reproducible from the source and reviewed mappings.');
    if (resume) {
      const expected = structuredClone(current);
      for (const op of plan.operations) {
        const receipt = await run.collection('receipts').doc(digest(op.path)).get();
        const [c,id] = op.path.split('/');
        const hash = digest(current[c]?.[id] ?? null);
        if (hash !== (receipt.exists ? op.afterHash : op.beforeHash)) throw new Error('Resume refused: data differs from recorded operation state.');
        if (op.before === null) delete expected[c][id]; else expected[c][id] = op.before;
      }
      if (digest(expected) !== plan.sourceHash) throw new Error('Resume refused: unrelated source data changed.');
    }
    for (const op of plan.operations) {
      const ref = db.doc(op.path), receipt = run.collection('receipts').doc(digest(op.path));
      await db.runTransaction(async tx => {
        const [doc, prior] = await Promise.all([tx.get(ref), tx.get(receipt)]);
        const hash = digest(doc.exists ? encode(doc.data()) : null);
        if (prior.exists) {
          if (hash !== op.afterHash) throw new Error(`Concurrent edit at ${op.path}; refusing overwrite.`);
          return;
        }
        if (hash !== op.beforeHash) throw new Error(`Precondition changed at ${op.path}; refusing overwrite.`);
        tx.set(ref, decode(op.after, db));
        tx.create(receipt, { path: op.path, beforeHash: op.beforeHash, afterHash: op.afterHash });
      });
    }
    const result = await verifyPlan(db, plan);
    await run.set({ status: 'verified', verifiedAt: result.verifiedAt, evidence: result }, { merge: true });
    await lock.delete();
    return result;
  } catch (error) {
    await run.set({ status: 'failed', failedAt: new Date().toISOString() }, { merge: true });
    // Keep the lock on partial failure. Resume or guarded rollback is mandatory.
    throw error;
  }
}
export async function verifyPlan(db, plan) {
  validatePlan(plan);
  if (plan.codeHash !== codeHash()) throw new Error('Evidence cannot be certified with different migration code.');
  const actual = await snapshot(db);
  if (digest(actual) !== plan.targetHash || digest(counts(actual)) !== digest(plan.afterCounts)) throw new Error('Reconciliation failed: database counts/content do not equal the approved target.');
  const errors = integrity(actual);
  const rerun = planMigration(actual, { ...plan, generatedAt: new Date().toISOString() });
  if (errors.length || rerun.errors.length || rerun.operations.length) throw new Error('Integrity or zero-write repeat-run check failed.');
  return { schema: MODEL_VERSION, status: 'passed', environment: plan.environment, project: plan.project, database: plan.database, planId: plan.planId, codeHash: plan.codeHash, sourceSha: plan.sourceSha, sourceHash: plan.sourceHash, targetHash: plan.targetHash, beforeCounts: plan.beforeCounts, afterCounts: counts(actual), operations: plan.operations.length, integrityErrors: 0, repeatRunOperations: 0, verifiedAt: new Date().toISOString() };
}
export async function rollbackPlan(db, plan, { target, approvedId, writersPaused }) {
  validateExecution(plan, target, approvedId);
  if (!writersPaused) throw new Error('Writers must remain paused for rollback.');
  const lock = db.doc('_stage3Migrations/active'), run = db.doc(`_stage3Migrations/${plan.planId}`);
  await db.runTransaction(async tx => {
    const [active, previous] = await Promise.all([tx.get(lock), tx.get(run)]);
    if (!previous.exists || previous.data().planId !== plan.planId) throw new Error('No recorded apply exists for this plan.');
    if (active.exists && active.data().planId !== plan.planId) throw new Error('Another migration owns the database lock.');
    tx.set(lock, { planId: plan.planId });
    tx.set(run, { status: 'rolling_back' }, { merge: true });
  });
  for (const op of [...plan.operations].reverse()) {
    const ref = db.doc(op.path), receipt = run.collection('receipts').doc(digest(op.path));
    await db.runTransaction(async tx => {
      const [doc, prior] = await Promise.all([tx.get(ref), tx.get(receipt)]);
      if (!prior.exists || prior.data().rolledBack) return;
      if (digest(doc.exists ? encode(doc.data()) : null) !== op.afterHash) throw new Error(`Rollback refuses a later edit at ${op.path}. Resolve manually; lock retained.`);
      if (op.before === null) tx.delete(ref); else tx.set(ref, decode(op.before, db));
      tx.update(receipt, { rolledBack: true });
    });
  }
  if (digest(await snapshot(db)) !== plan.sourceHash) throw new Error('Rollback reconciliation failed; lock retained.');
  await run.set({ status: 'rolled_back', rolledBackAt: new Date().toISOString() }, { merge: true });
  await lock.delete();
  return { status: 'rolled_back', planId: plan.planId, restoredSourceHash: plan.sourceHash };
}
async function main() {
  const { values: v, positionals } = parseArgs({ allowPositionals: true, options: Object.fromEntries(['environment','project','database','plan','out','mappings','approve-plan','backup-operation','backup-bucket'].map(k => [k,{type:'string'}]).concat([['writers-paused',{type:'boolean'}],['resume',{type:'boolean'}]])) });
  const action = positionals[0];
  if (!['plan','apply','verify','rollback'].includes(action) || positionals.length !== 1) throw new Error('Usage: node scripts/stage3/migrate.mjs plan|apply|verify|rollback --environment staging|emulator|production --project ID --database ID --out PRIVATE_FILE [--plan PRIVATE_PLAN --approve-plan HASH --writers-paused]');
  const target = { environment: v.environment, project: v.project, database: v.database };
  assertTarget(target);
  if (!v.out) throw new Error('Explicit private output path is required.');
  if (action !== 'plan' && !v.plan) throw new Error('--plan is required.');
  const plan = v.plan ? readJSON(v.plan) : null;
  if (plan && !identityMatches(plan,target)) throw new Error('Plan target mismatch.');
  const { app, db } = connect(target);
  try {
    let result;
    if (action === 'plan') {
      const before = await snapshot(db);
      result = planMigration(before, { ...target, sourceSha: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), codeHash: codeHash(), mappings: v.mappings ? readJSON(v.mappings) : {} });
      if (digest(await snapshot(db)) !== digest(before)) throw new Error('Database changed during dry-run. Pause writers and plan again.');
    } else if (action === 'verify') result = await verifyPlan(db,plan);
    else result = await (action === 'apply' ? applyPlan : rollbackPlan)(db,plan,{target,approvedId:v['approve-plan'],writersPaused:v['writers-paused'],backupOperation:v['backup-operation'],backupBucket:v['backup-bucket'],resume:v.resume});
    privateJSON(v.out,result);
    console.log(JSON.stringify({ action, status: result.errors?.length ? 'blocked' : result.status || 'planned', planId: result.planId, operations: result.operations?.length ?? result.operations, errors: result.errors?.length ?? 0, output: v.out }));
    if (result.errors?.length) process.exitCode = 2;
  } finally { await deleteApp(app); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
