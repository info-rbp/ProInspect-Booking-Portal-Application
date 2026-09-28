import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFreeBusy, assertIndexes, validateProbeConfig } from '../integrations.js';
import { outboundRecipients } from '../../../src/server/emailBoundary.js';
import { validateBackupEvidence, makePlan, applyPlan, COLLECTIONS, validateSources, digestOf, type Target, type Snapshot } from '../migration-engine.js';

const target: Target={environment:'emulator',projectId:'demo-stage3-atomic',databaseId:'(default)'};
const empty=()=>Object.fromEntries(COLLECTIONS.map(c=>[c,{}])) as Snapshot;
function withoutEmulator(body:()=>void) {
  const old=process.env.FIRESTORE_EMULATOR_HOST; delete process.env.FIRESTORE_EMULATOR_HOST;
  try { body(); } finally { if(old) process.env.FIRESTORE_EMULATOR_HOST=old; }
}

test('HTTP 200 Calendar response with per-calendar errors is not readiness',()=>{
  assert.throws(()=>assertFreeBusy({calendars:{test:{errors:[{reason:'notFound'}]}}},'test'),/Calendar sharing/);
  assert.throws(()=>assertFreeBusy({calendars:{}},'test'),/Calendar sharing/);
  assertFreeBusy({calendars:{test:{busy:[]}}},'test');
});

test('indexes must match scope and fields and be READY',()=>{
  const desired=[{collectionGroup:'bookings',queryScope:'COLLECTION',fields:[{fieldPath:'propertyId',order:'ASCENDING'},{fieldPath:'createdAt',order:'DESCENDING'}]}];
  const index={...desired[0],name:'projects/p/databases/d/collectionGroups/bookings/indexes/1',state:'CREATING'};
  assert.throws(()=>assertIndexes(desired,[index]),/not ready/);
  assertIndexes(desired,[{...index,state:'READY'}]);
  assert.throws(()=>assertIndexes(desired,[{...index,state:'READY',queryScope:'COLLECTION_GROUP'}]),/not ready/);
});

test('staging notifications use one sink; production recipients are unchanged',()=>{
  const oldEnv=process.env.PLATFORM_ENVIRONMENT, oldSink=process.env.STAGING_EMAIL_RECIPIENT;
  try {
    process.env.PLATFORM_ENVIRONMENT='staging'; delete process.env.STAGING_EMAIL_RECIPIENT;
    assert.throws(()=>outboundRecipients(['customer@example.test']),/STAGING_EMAIL_RECIPIENT/);
    process.env.STAGING_EMAIL_RECIPIENT='qa@example.test';
    assert.deepEqual(outboundRecipients(['customer@example.test','staff@example.test']),['qa@example.test']);
    process.env.STAGING_EMAIL_RECIPIENT='qa@example.test,customer@example.test';
    assert.throws(()=>outboundRecipients(['customer@example.test']),/STAGING_EMAIL_RECIPIENT/);
    process.env.PLATFORM_ENVIRONMENT='production';
    assert.deepEqual(outboundRecipients(['customer@example.test']),['customer@example.test']);
  } finally {
    if(oldEnv===undefined) delete process.env.PLATFORM_ENVIRONMENT; else process.env.PLATFORM_ENVIRONMENT=oldEnv;
    if(oldSink===undefined) delete process.env.STAGING_EMAIL_RECIPIENT; else process.env.STAGING_EMAIL_RECIPIENT=oldSink;
  }
});

test('live probes reject production and cross-database evidence',()=>withoutEmulator(()=>{
  const config={environment:'staging',projectId:'qa-project',databaseId:'qa',testEmail:'qa@example.test',terraform:{runtime_service_account_email:'runtime@qa-project.iam.gserviceaccount.com',google_calendar_id:'test-calendar'}};
  const manifest={...config,runtimeIdentity:config.terraform.runtime_service_account_email,runtimeEnvironment:{STAGING_EMAIL_RECIPIENT:config.testEmail,GOOGLE_CALENDAR_ID:'test-calendar'}};
  const deployment={...config,status:'passed',sourceSha:'a'.repeat(40),candidateUrl:'https://rc--platform-123.run.app',serviceUrl:'https://platform-123.run.app'};
  validateProbeConfig(config,manifest,deployment);
  assert.throws(()=>validateProbeConfig(config,manifest,{...deployment,databaseId:'other'}),/target mismatch/);
  assert.throws(()=>validateProbeConfig({...config,projectId:'business-plan-applicatio-17047'},manifest,deployment),/isolated staging/);
  assert.throws(()=>validateProbeConfig(config,manifest,{...deployment,candidateUrl:'https://attacker.example.test'}),/Cloud Run origins/);
}));

test('invalid, old and future plan dates are rejected before opening a transaction',async()=>{
  const plan=await makePlan(empty(),target,async()=>{},'v','a'.repeat(40));
  let opened=false;
  const db={runTransaction:async()=>{opened=true;}} as any;
  for(const createdAt of ['not-a-date',new Date(Date.now()-25*3600000).toISOString(),new Date(Date.now()+3600000).toISOString()]) {
    const {digest,...body}=plan; const bad={...body,createdAt};
    const candidate={...bad,digest:digestOf(bad)};
    await assert.rejects(applyPlan(db,candidate,target,candidate.digest,'v'),/expired|future|date/i);
  }
  assert.equal(opened,false);
});

test('backup evidence is target, source and age bound',async()=>{
  const p=await makePlan(empty(),{environment:'staging',projectId:'qa-project',databaseId:'qa'},async()=>{},'v','a'.repeat(40));
  const good={schemaVersion:1,...p.target,status:'SUCCESSFUL',sourceSha:p.sourceSha,sourceHash:p.sourceHash,operation:'projects/qa-project/databases/qa/operations/export1',outputUriPrefix:'gs://qa-backups/export1',completedAt:new Date().toISOString()};
  validateBackupEvidence(good,p);
  for(const patch of [{databaseId:'other'},{status:'RUNNING'},{sourceSha:'b'.repeat(40)},{sourceHash:'wrong'},{completedAt:'invalid'},{completedAt:new Date(Date.now()+3600000).toISOString()}]) {
    assert.throws(()=>validateBackupEvidence({...good,...patch},p));
  }
});

test('legacy email cannot overwrite a different Firebase identity',()=>{
  const s=empty(); s.clients.c={name:'Client'};
  s.clientUsers.u={email:'person@example.test',firebaseUid:'existing'};
  s.clientMemberships.m={organisationId:'c',email:'person@example.test',uid:'attacker',role:'member',status:'active'};
  assert.throws(()=>validateSources(s),/identity|UID/i);
});

test('report gateway rejects wrong secrets and production destinations',async()=>{
  const {validGatewaySecret,validateGatewayTarget}=await import('../../../src/server/reportGateway.js');
  assert.equal(validGatewaySecret('a'.repeat(32),'a'.repeat(32)),true);
  assert.equal(validGatewaySecret('a'.repeat(32),'b'.repeat(32)),false);
  assert.equal(validGatewaySecret('',undefined),false);
  assert.throws(()=>validateGatewayTarget('https://x.run.app/api/integrations/reports','https://x.run.app','production'),/restricted to staging/);
  assert.throws(()=>validateGatewayTarget('https://attacker.example.test/','https://x.run.app','staging'),/explicit Cloud Run/);
});

test('gateway exposes only report POST and never forwards an unauthenticated request',async()=>{
  const {createGateway}=await import('../../../src/server/reportGateway.js');
  const original=process.env.PLATFORM_ENVIRONMENT; process.env.PLATFORM_ENVIRONMENT='staging';
  let tokens=0; let forwarded=0;
  const app=createGateway({target:'https://core.run.app/api/integrations/reports',audience:'https://core.run.app',secret:'a'.repeat(32),identityToken:async()=>{tokens++;return 'short-lived';},transport:(async(_url:any,options:any)=>{forwarded++;assert.equal(options.redirect,'error');assert.equal(options.headers['X-Serverless-Authorization'],'Bearer short-lived');return new Response(JSON.stringify({success:true}),{status:201,headers:{'Content-Type':'application/json'}});}) as typeof fetch});
  const server=app.listen(0,'127.0.0.1'); await new Promise<void>(resolve=>server.once('listening',resolve));
  try {
    const address=server.address() as import('node:net').AddressInfo; const origin='http://127.0.0.1:'+address.port;
    assert.equal((await fetch(origin+'/admin')).status,404);
    assert.equal((await fetch(origin+'/api/integrations/reports',{method:'POST'})).status,401);
    assert.equal(tokens,0);assert.equal(forwarded,0);
    assert.equal((await fetch(origin+'/api/integrations/reports',{method:'POST',headers:{'Content-Type':'application/pdf','X-Report-Ingest-Token':'a'.repeat(32)},body:'%PDF-1.4\nsynthetic'})).status,201);
    assert.equal(tokens,1);assert.equal(forwarded,1);
  } finally { await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())); if(original===undefined) delete process.env.PLATFORM_ENVIRONMENT; else process.env.PLATFORM_ENVIRONMENT=original; }
});

test('companion receipts require a recent real report hash and explicit deployment attestation',async()=>{
  const {validateReceipt}=await import('../record-companion.js');
  const config={operatorPrincipal:'user:qa@example.test',terraform:{report_tool_url:'https://reports-qa.example.test'}};
  const receipt={schemaVersion:1,operatorPrincipal:config.operatorPrincipal,deployedCompanionSha:'247cc387a9e05fb1d93e5e3d4bdeb3fca6dfa707',reportToolUrl:config.terraform.report_tool_url,finalized:true,deploymentEvidenceReference:'cloudflare-version-123',reportSourceId:'report-id',propertyId:'property-id',handoffAuditId:'audit-id',issuedPdfSha256:'a'.repeat(64),completedAt:new Date().toISOString()};
  validateReceipt(receipt,config);
  for(const changed of [{deployedCompanionSha:'b'.repeat(40)},{issuedPdfSha256:''},{completedAt:'invalid'},{operatorPrincipal:'user:other@example.test'},{finalized:false}]) assert.throws(()=>validateReceipt({...receipt,...changed},config));
});
