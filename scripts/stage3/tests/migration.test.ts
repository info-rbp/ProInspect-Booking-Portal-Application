import assert from 'node:assert/strict';
import test from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, GeoPoint } from 'firebase-admin/firestore';
import { COLLECTIONS, makePlan, applyPlan, snapshot, validateTarget, validateIntegrity, validateSources, encode, decode, digestOf, type Snapshot, type Target } from '../migration-engine.js';
import { transform } from '../../migrate-unified-portal.js';

const target: Target = {environment:'emulator',projectId:'demo-stage3-atomic',databaseId:'(default)'};
function fixture(): Snapshot {
  const s = Object.fromEntries(COLLECTIONS.map(c => [c, {}])) as Snapshot;
  s.clients.c1 = {id:'c1',name:'Canonical Client',status:'active'};
  s.properties.p1 = {id:'p1',streetAddress:'10 Test Street',suburb:'Perth',state:'WA',postcode:'6000',primaryClientId:'c1'};
  s.clientPropertyLinks.l1 = {id:'l1',propertyId:'p1',clientId:'c1',active:true,role:'owner'};
  s.clientUsers.cu1 = {id:'cu1',email:'canonical@example.test',clientIds:['c1'],active:true};
  s.clientOrganisations.o1 = {name:'Legacy Organisation',entityType:'company',billingEmail:'billing@example.test',abn:'51824753556',acn:'123456789'};
  s.clientMemberships.m1 = {organisationId:'o1',uid:'u1',email:'legacy@example.test',role:'admin',status:'active'};
  s.clientProperties.legacy1 = {streetAddress:'10 Test Street',suburb:'Perth',state:'WA',postcode:'6000',organisationId:'o1'};
  s.clientDocuments.d1 = {propertyId:'legacy1',organisationId:'o1',title:'Synthetic document',fileName:'test.pdf',contentType:'application/pdf',storagePath:'synthetic/test.pdf',sizeBytes:10};
  return s;
}
async function plan(s = fixture()) { return makePlan(s,target,transform,'test-version','a'.repeat(40)); }
function after(s: Snapshot, changes: Awaited<ReturnType<typeof plan>>['changes']): Snapshot {
  const result=structuredClone(s);
  for (const c of changes) result[c.collection][c.id]=c.after;
  return result;
}

test('planning never mutates its source and records exact counts', async () => {
  const s=fixture(); const before=structuredClone(s); const p=await plan(s);
  assert.deepEqual(s,before);
  assert.equal(p.sourceHash,digestOf(s));
  assert.equal(p.afterCounts.properties,1);
  assert.equal(p.afterCounts.clients,2);
  assert.ok(p.changes.length>0);
});

test('duplicate addresses block the transform before any write can be proposed', async () => {
  const s=fixture(); s.properties.duplicate={...s.properties.p1,id:'duplicate'};
  let called=false;
  await assert.rejects(makePlan(s,target,async () => {called=true;},'v','a'.repeat(40)),/Duplicate canonical property/);
  assert.equal(called,false);
});

test('a late transform failure cannot mutate the source', async () => {
  const s=fixture(); const before=structuredClone(s);
  await assert.rejects(makePlan(s,target,async db => {await db.collection('clients').doc('partial').set({name:'Not committed'}); throw new Error('late validation');},'v','a'.repeat(40)),/late validation/);
  assert.deepEqual(s,before);
});

test('ambiguous or orphaned legacy memberships are blocking', () => {
  const s=fixture(); s.clientMemberships.m1.organisationId='missing';
  assert.throws(()=>validateSources(s),/ambiguous or orphaned/);
});

test('conflicting email and Firebase identities are blocking', () => {
  const s=fixture(); s.clientUsers.uid={firebaseUid:'u1',email:'other@example.test'}; s.clientUsers.email={email:'legacy@example.test'};
  assert.throws(()=>validateSources(s),/conflicting identities/);
});

test('legacy documents follow deduplicated canonical property IDs', async () => {
  const s=fixture(); const p=await plan(s); const result=after(s,p.changes);
  assert.equal(result.propertyDocuments.d1.propertyId,'p1');
  assert.deepEqual(result.propertyDocuments.d1.clientIds,['o1']);
  assert.equal(result.clients.o1.abn,'51824753556');
  assert.equal(result.clients.o1.acn,'123456789');
  assert.equal(result.clients.o1.billingEmail,'billing@example.test');
  validateIntegrity(result);
});

test('missing roles do not infer ownership from client-array order', async () => {
  const s=fixture(); const p=await plan(s); const result=after(s,p.changes);
  assert.equal(result.clientUsers.cu1.clientRoles.c1,'viewer');
});

test('revoked legacy membership does not create active access', async () => {
  const s=fixture(); s.clientMemberships.m1.status='revoked';
  const result=after(s,(await plan(s)).changes);
  const member=result.clientMemberships.m1;
  assert.equal(member.status,'revoked');
  const user=result.clientUsers[member.clientUserId];
  assert.equal(user.active,false);
  assert.deepEqual(user.clientIds,[]);
});

test('a second full migration plan proposes zero mutations', async () => {
  const s=fixture(); const first=await plan(s); const result=after(s,first.changes);
  const repeated=await plan(result);
  assert.equal(repeated.changes.length,0);
  assert.deepEqual(repeated.beforeCounts,repeated.afterCounts);
});

test('cross-client document visibility fails integrity', async () => {
  const s=fixture(); const result=after(s,(await plan(s)).changes);
  result.clients.stranger={name:'Unrelated'};
  result.propertyDocuments.d1.clientIds=['stranger'];
  assert.throws(()=>validateIntegrity(result),/unrelated client/);
});

test('atomic write bound fails closed instead of performing a partial migration', async () => {
  const s=Object.fromEntries(COLLECTIONS.map(c=>[c,{}])) as Snapshot;
  await assert.rejects(makePlan(s,target,async db => {for(let i=0;i<401;i++) await db.collection('clients').doc('c'+i).set({name:'Synthetic '+i});},'v','a'.repeat(40)),/400 changed documents/);
});

test('target validation rejects unspecified targets and production apply', () => {
  assert.throws(()=>validateTarget({environment:'staging',projectId:'',databaseId:''},false),/Explicit/);
  const host=process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  try {
    assert.throws(()=>validateTarget({environment:'staging',projectId:'business-plan-applicatio-17047',databaseId:'staging'},false),/separate project/);
    assert.throws(()=>validateTarget({environment:'production',projectId:'business-plan-applicatio-17047',databaseId:'ai-studio-7242850f-c156-4268-aeb7-c8d47ff6931a'},true),/locked/);
  } finally { if(host) process.env.FIRESTORE_EMULATOR_HOST=host; }
});

test('real Firestore emulator: dry run, tamper, drift, atomic apply and no-op rerun', async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST,'The acceptance test requires the Firestore emulator; it must not be skipped.');
  const app=initializeApp({projectId:target.projectId},'stage3-test');
  const db=getFirestore(app,target.databaseId);
  db.settings({ignoreUndefinedProperties:true});
  try {
    for(const c of COLLECTIONS) {
      const docs=await db.collection(c).get();
      for(const d of docs.docs) await d.ref.delete();
    }
    const s=fixture();
    for(const c of COLLECTIONS) for(const [id,row] of Object.entries(s[c])) await db.collection(c).doc(id).set(row);
    await db.collection('settings').doc('types').set({timestamp:new Timestamp(1700000000,123456789),point:new GeoPoint(-31.95,115.86),bytes:Buffer.from([1,2,3]),reference:db.doc('clients/c1')});
    const before=await snapshot(db);
    assert.deepEqual(encode(decode(before.settings.types,db)),before.settings.types);
    const p=await plan(before);
    assert.deepEqual(await snapshot(db),before);
    const tampered=structuredClone(p); tampered.changes[0].after.name='Tampered';
    await assert.rejects(applyPlan(db,tampered,target,p.digest,'test-version'),/digest mismatch/);
    assert.deepEqual(await snapshot(db),before);
    await db.collection('clients').doc('concurrent').set({name:'Concurrent writer'});
    const drifted=await snapshot(db);
    await assert.rejects(applyPlan(db,p,target,p.digest,'test-version'),/changed since dry run/);
    assert.deepEqual(await snapshot(db),drifted);
    await db.collection('clients').doc('concurrent').delete();
    const evidence=await applyPlan(db,p,target,p.digest,'test-version');
    assert.equal(evidence.status,'passed');
    assert.deepEqual(evidence.counts,p.afterCounts);
    assert.equal((await db.collection('propertyDocuments').doc('d1').get()).data()?.propertyId,'p1');
    const applied=await snapshot(db);
    assert.deepEqual(applied.settings.types,before.settings.types);
    assert.equal((await plan(applied)).changes.length,0);
  } finally { await deleteApp(app); }
});
