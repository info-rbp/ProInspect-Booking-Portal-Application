import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionReleaseGate } from '../../../src/server/productionReleaseGate.js';
import { validateTarget, PRODUCTION_PROJECT, PRODUCTION_DATABASE } from '../../stage3/migration-engine.js';
import { validateProductionPermit } from '../migrate.js';

const cfg={releaseId:'production-test',sourceSha:'a'.repeat(40),token:'x'.repeat(48),ingestToken:'r'.repeat(48),revision:'rc-1'};
async function gate(state:any,path='/book',token='',method='GET',report='') {
  let next=false,status=200,payload:any;
  const res:any={status(n:number){status=n;return this;},json(v:any){payload=v;return this;},set(){return this;},end(){return this;}};
  await productionReleaseGate(async()=>{if(state instanceof Error)throw state;return state;},cfg)(
    {path,method,headers:{'x-proinspect-release-token':token,'x-report-ingest-token':report}} as any,res,()=>{next=true;});
  return {next,status,payload};
}
test('candidate is closed even when reached at its public tag URL',async()=>{
  assert.equal((await gate({phase:'testing',releaseId:cfg.releaseId,sourceSha:cfg.sourceSha})).status,503);
});
test('wrong release token never opens candidate',async()=>{
  assert.equal((await gate({phase:'testing',releaseId:cfg.releaseId,sourceSha:cfg.sourceSha},'/book','bad')).status,503);
});
test('correct token permits explicitly opened testing phase',async()=>{
  assert.equal((await gate({phase:'testing',releaseId:cfg.releaseId,sourceSha:cfg.sourceSha},'/book',cfg.token)).next,true);
});
test('release token cannot bypass a closed phase',async()=>{
  assert.equal((await gate({phase:'closed',releaseId:cfg.releaseId,sourceSha:cfg.sourceSha},'/api/bookings/create',cfg.token,'POST')).status,503);
});
test('wrong release or source is always closed',async()=>{
  assert.equal((await gate({phase:'live',releaseId:'another',sourceSha:cfg.sourceSha})).status,503);
  assert.equal((await gate({phase:'live',releaseId:cfg.releaseId,sourceSha:'b'.repeat(40)})).status,503);
});
test('missing or unreadable release control fails closed',async()=>{
  assert.equal((await gate({})).status,503);
  assert.equal((await gate(new Error('unavailable'))).status,503);
});
test('public access starts only with a matching live record',async()=>{
  assert.equal((await gate({phase:'live',releaseId:cfg.releaseId,sourceSha:cfg.sourceSha})).next,true);
});
test('candidate health exposes no metadata without a token',async()=>{
  assert.equal((await gate({},'/api/release/health')).status,404);
  const r=await gate({},'/api/release/health',cfg.token);
  assert.equal(r.payload.phase,'closed');assert.equal(r.payload.revision,'rc-1');
});
test('report token grants only exact POST ingest during testing',async()=>{
  const state={phase:'testing',releaseId:cfg.releaseId,sourceSha:cfg.sourceSha};
  assert.equal((await gate(state,'/api/integrations/reports','','POST',cfg.ingestToken)).next,true);
  assert.equal((await gate(state,'/api/admin/bookings','','POST',cfg.ingestToken)).status,503);
  assert.equal((await gate(state,'/api/integrations/reports','','GET',cfg.ingestToken)).status,503);
});
test('misconfigured gate rejects startup',()=>{
  assert.throws(()=>productionReleaseGate(async()=>({}),{...cfg,token:''}));
});
test('Stage 3 production mutation lock still holds',()=>{
  assert.throws(()=>validateTarget({environment:'production',projectId:PRODUCTION_PROJECT,databaseId:PRODUCTION_DATABASE},true));
});
function example(){
  const now=new Date().toISOString(), source='a'.repeat(40);
  const c:any={environment:'production',projectId:PRODUCTION_PROJECT,databaseId:PRODUCTION_DATABASE,
    sourceSha:source,releaseId:'production-test',skipStaging:true,production:{backupBucket:'private-backups'}};
  const plan:any={digest:'digest',sourceHash:'hash',sourceSha:source,
    target:{environment:'production',projectId:c.projectId,databaseId:c.databaseId}};
  const backup={status:'SUCCESSFUL',sourceHash:'hash',projectId:c.projectId,databaseId:c.databaseId,
    sourceSha:source,completedAt:now,outputUriPrefix:'gs://private-backups/stage4/release',operation:'operation'};
  const p:any={schemaVersion:1,stage:4,status:'approved',releaseId:c.releaseId,sourceSha:source,
    configFileHash:'filehash',approvedDigest:'digest',sourceHash:'hash',projectId:c.projectId,databaseId:c.databaseId,
    createdAt:now,backup,restore:{verifiedContent:true,sourceHash:'hash',backupOperation:'operation',completedAt:now},
    freeze:{externalWritersPaused:true,evidenceReference:'operator-record',maintenanceRevision:'maint',drainedAt:now}};
  return {c,plan,p};
}
test('complete source/backup/restore/freeze permit validates',()=>{
  const {c,plan,p}=example();validateProductionPermit(p,plan,c,'filehash');
});
test('production permit rejects drift, stale time, wrong target, missing restore or writer freeze',()=>{
  const mutations=[(p:any)=>p.approvedDigest='wrong',(p:any)=>p.sourceHash='changed',
    (p:any)=>p.sourceSha='wrong',(p:any)=>p.createdAt='not-a-time',
    (p:any)=>p.restore.verifiedContent=false,(p:any)=>p.freeze.externalWritersPaused=false,
    (p:any)=>p.backup.status='RUNNING',(p:any)=>p.backup.databaseId='other',
    (p:any)=>p.configFileHash='other'];
  for(const change of mutations){const {c,plan,p}=example();change(p);assert.throws(()=>validateProductionPermit(p,plan,c,'filehash'));}
});
