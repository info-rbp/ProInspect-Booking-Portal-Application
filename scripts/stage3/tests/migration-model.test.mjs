import test from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTIONS, PRODUCTION_PROJECT, digest, planMigration, validatePlan, integrity, assertTarget } from '../migration-model.mjs';
import { codeHash, validateExecution, encode, decode } from '../migrate.mjs';
import { Timestamp, GeoPoint } from 'firebase-admin/firestore';
export const context = { environment: 'emulator', project: 'demo-stage3', database: '(default)', sourceSha: 'a'.repeat(40), codeHash: codeHash(), generatedAt: '2026-09-28T00:00:00.000Z' };
export function fixture() {
  return Object.assign(Object.fromEntries(COLLECTIONS.map(c => [c,{}])), {
    clientOrganisations: { org: { name:'Synthetic Test Client', entityType:'company', billingEmail:'test@example.invalid' } },
    clientUsers: { uid1: { uid:'uid1', email:'test@example.invalid', active:true } },
    clientMemberships: { membership: { organisationId:'org', uid:'uid1', email:'test@example.invalid', role:'admin', status:'active' } },
    properties: { canonical: { streetAddress:'1 Fixture Street', suburb:'Perth', state:'WA', postcode:'6000', status:'active' } },
    clientProperties: { legacy: { organisationId:'org', streetAddress:'1 Fixture Street', suburb:'Perth', state:'WA', postcode:'6000' } },
    clientDocuments: { doc: { organisationId:'org', clientUid:'uid1', propertyId:'legacy', storagePath:'synthetic/doc.pdf', name:'Test.pdf', status:'available' } },
    clientRequests: { request: { organisationId:'org',clientUid:'uid1',propertyId:'legacy',details:{description:'Synthetic fixture'},status:'waiting_client',type:'general' } },
    auditEvents: { original: { action:'fixture-created',immutable:true } },
  });
}
const apply = (data, plan) => { const next=structuredClone(data); for (const op of plan.operations) { const [c,id]=op.path.split('/'); next[c][id]=op.after; } return next; };
test('dry planning is immutable and accepted plan has integrity', () => { const data=fixture(), before=digest(data); const p=planMigration(data,context); assert.deepEqual(p.errors,[]); assert.equal(digest(data),before); validatePlan(p); });
test('remapped legacy documents and requests use canonical property', () => { const after=apply(fixture(),planMigration(fixture(),context)); assert.equal(after.propertyDocuments.doc.propertyId,'canonical'); assert.equal(after.clientRequests.request.propertyId,'canonical'); assert.equal(after.clientRequests.request.status,'awaiting_client'); });
test('same UID profile is reused and no parallel legacy runtime collection is created', () => { const p=planMigration(fixture(),context); assert.equal(p.afterCounts.clientUsers,1); assert.equal(p.afterCounts.clients,1); assert.equal(p.afterCounts.clientOrganisations,1); });
test('repeat plan is zero-write', () => { const data=fixture(), p=planMigration(data,context), next=apply(data,p); const rerun=planMigration(next,{...context,generatedAt:'2026-10-01T00:00:00Z'}); assert.deepEqual(rerun.errors,[]); assert.deepEqual(rerun.operations,[]); });
test('audit history and sources survive unchanged', () => { const data=fixture(), p=planMigration(data,context), next=apply(data,p); assert.deepEqual(next.auditEvents,data.auditEvents); assert.deepEqual(next.clientDocuments,data.clientDocuments); assert.deepEqual(next.clientProperties,data.clientProperties); });
test('duplicate property addresses block all apply', () => { const d=fixture(); d.properties.other={...d.properties.canonical}; const p=planMigration(d,context); assert.ok(p.errors.some(x=>x.includes('duplicate canonical'))); assert.throws(()=>validatePlan(p)); });
test('unresolved orphan document blocks apply', () => { const d=fixture(); d.clientDocuments.doc.propertyId='missing'; assert.throws(()=>validatePlan(planMigration(d,context))); });
test('explicit reviewed property mapping resolves orphan legacy document', () => { const d=fixture(); d.clientDocuments.doc.propertyId='missing'; const p=planMigration(d,{...context,mappings:{documentProperties:{doc:'canonical'}}}); assert.deepEqual(p.errors,[]); });
test('no owner authority inferred from client array position', () => { const d=fixture(); d.clients.org={name:'Synthetic Test Client'}; d.clientUsers.extra={email:'other@example.invalid',firebaseUid:'u2',active:true,clientIds:['org']}; const a=apply(d,planMigration(d,context)); assert.equal(a.clientUsers.extra.clientRoles.org,'viewer'); });
test('revoked legacy membership remains revoked with no recreated access', () => { const d=fixture(); d.clientMemberships.membership.status='revoked'; const a=apply(d,planMigration(d,context)); assert.equal(a.clientMemberships.membership.status,'revoked'); assert.deepEqual(a.clientUsers.uid1.clientIds,[]); });
test('disabled profile cannot be re-enabled by migration', () => { const d=fixture(); d.clientUsers.uid1.active=false; const a=apply(d,planMigration(d,context)); assert.equal(a.clientUsers.uid1.active,false); assert.equal(a.clientMemberships.membership.status,'revoked'); });
test('active legacy membership without verified UID blocks apply', () => { const d=fixture(); delete d.clientMemberships.membership.uid; assert.throws(()=>validatePlan(planMigration(d,context))); });
test('UID/email ambiguity blocks apply', () => { const d=fixture(); d.clientUsers.u2={uid:'u2',email:'test@example.invalid',active:true}; assert.throws(()=>validatePlan(planMigration(d,context))); });
test('draft files do not become portal-visible', () => { const d=fixture(); d.clientDocuments.doc.status='draft'; const a=apply(d,planMigration(d,context)); assert.deepEqual(a.propertyDocuments.doc.audiences,['staff']); });
test('booking client names do not establish client authority', () => { const d=fixture(); d.bookings.b={property:{...d.properties.canonical,clientName:'Unverified'}}; assert.throws(()=>validatePlan(planMigration(d,context))); });
test('cross-property tenancy/document relationships fail integrity', () => { const d=fixture(); d.tenancies.t={propertyId:'canonical'}; d.propertyDocuments.p={propertyId:'other',tenancyId:'t',clientIds:[]}; assert.ok(integrity(d).some(x=>x.includes('cross-property'))); });
test('plan content tampering is rejected', () => { const p=planMigration(fixture(),context); p.operations[0].after.name='tampered'; assert.throws(()=>validatePlan(p)); });
test('project/environment are explicit; production cannot masquerade as staging', () => { assert.throws(()=>assertTarget({})); assert.throws(()=>assertTarget({...context,environment:'staging',project:PRODUCTION_PROJECT})); assert.throws(()=>assertTarget({...context,environment:'emulator',project:PRODUCTION_PROJECT})); });
test('write gate binds approved digest and target', () => { const p=planMigration(fixture(),context); assert.throws(()=>validateExecution(p,context,'bad')); assert.throws(()=>validateExecution(p,{...context,database:'different'},p.planId)); validateExecution(p,context,p.planId); });
test('Stage 3 cannot write production even with approved valid plan', () => { const target={...context,environment:'production',project:PRODUCTION_PROJECT}; const p=planMigration(fixture(),target); assert.throws(()=>validateExecution(p,target,p.planId),/locked in Stage 3/); });
test('Firestore special values round-trip without dropping precision', () => { const values={ts:new Timestamp(123,987654321), point:new GeoPoint(-31.95,115.86),bytes:Buffer.from('bytes'),nan:NaN}; const result=decode(encode(values),{}); assert.equal(result.ts.nanoseconds,987654321); assert.equal(result.point.latitude,-31.95); assert.ok(Buffer.isBuffer(result.bytes)); assert.ok(Number.isNaN(result.nan)); });
test('restricted Form 2 storage never enters shared propertyDocuments',()=>{ const d=fixture();d.clientDocuments.doc.storagePath='tenant-sensitive/forms/synthetic/evidence.pdf';assert.throws(()=>validatePlan(planMigration(d,context))); });
test('64-bit Firestore integer values preserve exact precision',()=>{const value={n:9223372036854775807n};assert.equal(decode(encode(value),{}).n,value.n);});
