import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createImportPlan,applyImportPlan,validateObjectManifest} from '../../scripts/cloudflare/migration.mjs';
import {fixture} from './fixture.mjs';
const snapshot=()=>({schemaVersion:1,capturedAt:'2026-10-03T00:00:00Z',source:{projectId:'test',databaseId:'isolated'},collections:{clients:{c:{id:'c',name:'Agency'}},properties:{p:{id:'p',primaryClientId:'c'}},bookings:{b:{id:'b',propertyId:'p',status:'confirmed'}}}});
test('D1 migration is deterministic, preserves IDs and second application writes nothing',async()=>{
 const {binding}=fixture();const plan=createImportPlan(snapshot());assert.equal(createImportPlan(snapshot()).digest,plan.digest);
 const first=await applyImportPlan(plan,binding,plan.digest);assert.equal(first.inserted,3);
 const second=await applyImportPlan(plan,binding,plan.digest);assert.equal(second.inserted,0);assert.equal(second.verified,3);
});
test('migration rejects wrong digest, tampering, unknown collections and orphan links',async()=>{
 const {binding}=fixture();const plan=createImportPlan(snapshot());await assert.rejects(applyImportPlan(plan,binding,'wrong'));
 plan.rows[0].data.status='tampered';await assert.rejects(applyImportPlan(plan,binding,plan.digest));
 const unknown=snapshot();unknown.collections.unknown={};assert.throws(()=>createImportPlan(unknown));
 const orphan=snapshot();orphan.collections.bookings.b.propertyId='missing';assert.throws(()=>createImportPlan(orphan));
});
test('import refuses to overwrite changed destination records',async()=>{
 const {binding,db}=fixture();const plan=createImportPlan(snapshot());await db.collection('clients').doc('c').set({name:'different'});
 await assert.rejects(applyImportPlan(plan,binding,plan.digest));assert.equal((await db.collection('bookings').doc('b').get()).exists,false);
});
test('object manifests reject traversal, duplicate paths and sensitive bucket mistakes',()=>{
 const valid={path:'tenant-sensitive/forms/a.pdf',sha256:'a'.repeat(64),size:15,bucketClass:'sensitive'};assert.equal(validateObjectManifest([valid]).objects,1);
 assert.throws(()=>validateObjectManifest([valid,valid]));assert.throws(()=>validateObjectManifest([{...valid,path:'../a'}]));assert.throws(()=>validateObjectManifest([{...valid,bucketClass:'documents'}]));
});
