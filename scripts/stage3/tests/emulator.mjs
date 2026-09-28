import assert from 'node:assert/strict';
import { deleteApp } from 'firebase-admin/app';
import { Timestamp } from 'firebase-admin/firestore';
import { COLLECTIONS, digest, planMigration } from '../migration-model.mjs';
import { connect, snapshot, codeHash, applyPlan, rollbackPlan } from '../migrate.mjs';
const target={environment:'emulator',project:'demo-stage3',database:'(default)'};
const {app,db}=connect(target);
const context={...target,sourceSha:'a'.repeat(40),codeHash:codeHash(),generatedAt:'2026-09-28T00:00:00.000Z'};
const options=plan=>({target,approvedId:plan.planId,writersPaused:true});
async function reset() { for (const collection of await db.listCollections()) await db.recursiveDelete(collection); }
try {
  await reset();
  const sources={
    clientOrganisations:{org:{name:'Synthetic Rehearsal',entityType:'company'}},
    clientUsers:{uid:{uid:'uid',email:'fixture@example.invalid',active:true}},
    clientMemberships:{m:{organisationId:'org',uid:'uid',email:'fixture@example.invalid',role:'admin',status:'active'}},
    clientProperties:{p:{organisationId:'org',streetAddress:'1 Fixture Street',suburb:'Perth',state:'WA',postcode:'6000'}},
    clientDocuments:{d:{organisationId:'org',propertyId:'p',storagePath:'fixture/report.pdf',status:'available'}},
    auditEvents:{a:{action:'untouched',occurredAt:new Timestamp(123,987654321)}},
    unrecognisedHistory:{h:{retain:true}},
  };
  for (const [c,rows] of Object.entries(sources)) for (const [id,row] of Object.entries(rows)) await db.doc(`${c}/${id}`).set(row);
  await db.doc('auditEvents/a/descendants/original').set({immutable:true});
  // Firestore truncates timestamps to microseconds when initially stored.
  // Compare against the persisted source, not the higher-precision SDK input.
  const storedTimestamp=(await db.doc('auditEvents/a').get()).data().occurredAt;
  const before=await snapshot(db), plan=planMigration(before,context);
  assert.deepEqual(plan.errors,[]);
  assert.equal(digest(await snapshot(db)),digest(before),'dry-run wrote to Firestore');
  await assert.rejects(()=>applyPlan(db,plan,{...options(plan),writersPaused:false}),/paused/);
  await assert.rejects(()=>applyPlan(db,plan,{...options(plan),approvedId:'wrong'}),/approve-plan/);
  const evidence=await applyPlan(db,plan,options(plan));
  assert.equal(evidence.status,'passed');
  assert.equal(evidence.repeatRunOperations,0);
  assert.ok((await db.doc('auditEvents/a').get()).data().occurredAt.isEqual(storedTimestamp));
  assert.equal((await db.doc('auditEvents/a/descendants/original').get()).data().immutable,true);
  assert.equal((await db.doc('propertyDocuments/d').get()).data().propertyId,'p');
  const rerun=planMigration(await snapshot(db),context);
  assert.deepEqual(rerun.operations,[]);
  await db.doc('clients/org').update({name:'Later operator edit'});
  await assert.rejects(()=>rollbackPlan(db,plan,options(plan)),/later edit/);
  const op=plan.operations.find(o=>o.path==='clients/org');
  await db.doc('clients/org').set(op.after);
  const rollback=await rollbackPlan(db,plan,options(plan));
  assert.equal(rollback.status,'rolled_back');
  assert.equal(digest(await snapshot(db)),digest(before));
  // A different plan is required after the recorded rollback.
  const stale=planMigration(before,{...context,generatedAt:'2026-09-28T00:00:01.000Z'});
  await db.doc('auditEvents/a').update({concurrent:true});
  await assert.rejects(()=>applyPlan(db,stale,options(stale)),/Source changed/);
  assert.equal((await db.collection('clients').get()).size,0,'stale plan performed writes');
  await reset();
  for (const [c,rows] of Object.entries(sources)) for (const [id,row] of Object.entries(rows)) await db.doc(`${c}/${id}`).set(row);
  const resumePlan=planMigration(await snapshot(db),context);
  // Simulate a process stopping immediately after one atomic operation/receipt.
  const first=resumePlan.operations[0];
  await db.doc(first.path).set(first.after);
  const run=db.doc(`_stage3Migrations/${resumePlan.planId}`);
  await run.set({planId:resumePlan.planId,status:'applying'});
  await run.collection('receipts').doc(digest(first.path)).set({path:first.path,afterHash:first.afterHash});
  await db.doc('_stage3Migrations/active').set({planId:resumePlan.planId});
  const resumed=await applyPlan(db,resumePlan,{...options(resumePlan),resume:true});
  assert.equal(resumed.status,'passed');
  console.log('Stage 3 emulator: dry-run immutability, apply, exact reconciliation, native timestamp/subcollection preservation, repeat-run zero writes, stale-plan rejection, concurrent-edit rollback refusal, safe rollback and partial-run resume PASS.');
} finally { await reset(); await deleteApp(app); }
