/** Live staging probes. No credentials or private record payloads are written to evidence. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { PRODUCTION_PROJECT, digestOf } from './migration-engine.js';

type Json = Record<string, any>;
function requireValue(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const load = (path: string): Json => JSON.parse(readFileSync(path,'utf8'));
const save = (path: string, value: Json) => { writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600}); chmodSync(path,0o600); };

export function validateProbeConfig(config: Json, manifest: Json, deployment: Json) {
  requireValue(config.environment === 'staging' && config.projectId !== PRODUCTION_PROJECT, 'Live probes require an isolated staging project.');
  for (const key of ['projectId','databaseId','environment']) requireValue(config[key] === manifest[key] && config[key] === deployment[key], 'Probe target mismatch: '+key);
  requireValue(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Live probes cannot use emulator configuration.');
  requireValue(manifest.runtimeIdentity === config.terraform.runtime_service_account_email && manifest.runtimeIdentity.endsWith('@'+config.projectId+'.iam.gserviceaccount.com'), 'Runtime identity mismatch.');
  requireValue(manifest.runtimeEnvironment.STAGING_EMAIL_RECIPIENT === config.testEmail && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(config.testEmail), 'A single staging email sink is required.');
  requireValue(manifest.runtimeEnvironment.GOOGLE_CALENDAR_ID === config.terraform.google_calendar_id && !config.terraform.google_calendar_id.startsWith('REQUIRED_'), 'Dedicated staging Calendar is required.');
  for (const key of ['candidateUrl','serviceUrl']) {
    const url=new URL(deployment[key]);
    requireValue(url.protocol === 'https:' && url.hostname.endsWith('.run.app') && !url.username && !url.password && url.pathname === '/', 'Probe endpoints must be HTTPS Cloud Run origins.');
  }
  requireValue(deployment.status === 'passed' && /^[a-f0-9]{40}$/.test(deployment.sourceSha), 'A smoke-tested candidate is required.');
}

export function assertFreeBusy(data: Json, calendarId: string) {
  const item=data.calendars?.[calendarId];
  requireValue(item && !item.errors?.length && Array.isArray(item.busy), 'Calendar sharing/free-busy failed; an HTTP 200 with calendar errors is not success.');
}

export function assertIndexes(desired: Json[], live: Json[]) {
  for (const index of desired) {
    const fields=index.fields.filter((f: Json)=>f.fieldPath!=='__name__');
    const match=live.find(i=>i.name.split('/collectionGroups/')[1]?.split('/')[0]===index.collectionGroup && i.queryScope===index.queryScope && digestOf(i.fields.filter((f: Json)=>f.fieldPath!=='__name__'))===digestOf(fields));
    requireValue(match?.state === 'READY','Required Firestore index is missing or not ready: '+index.collectionGroup);
  }
}

export async function probe(args: string[]) {
  const position=args.indexOf('--config'); const path=position>=0 ? args[position+1] : '';
  requireValue(path,'--config <staging environment descriptor> is required.');
  const config=load(path);
  requireValue(args[args.indexOf('--approve')+1]===config.projectId && args.includes('--approve'),'Probes create synthetic data, a transient Calendar event and a test email; approve the staging project explicitly.');
  // Reuse the stricter Python descriptor validator before issuing any cloud request.
  execFileSync('python3',['scripts/stage3/control.py','validate-config','--config',path],{stdio:['ignore','pipe','pipe']});
  const base=`private-evidence/stage3/${config.environment}/${config.projectId}/${config.databaseId}`;
  const manifest=load(base+'/runtime-manifest.json'); const deployment=load(base+'/deployment.json'); const gateway=load(base+'/report-gateway.json');
  validateProbeConfig(config,manifest,deployment);
  const sourceSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  requireValue(deployment.sourceSha===sourceSha,'Candidate belongs to a different source commit.');
  requireValue(gateway.sourceSha===sourceSha && gateway.coreRevision===deployment.revision && gateway.status==='passed','A report gateway for this exact core revision is required.');
  const gcloud=(command: string[], identity=manifest.runtimeIdentity): string => execFileSync('gcloud',[...command,'--project='+config.projectId,'--impersonate-service-account='+identity,'--quiet'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000}).trim();
  const runtimeToken=gcloud(['auth','print-access-token','--scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/calendar.events,https://www.googleapis.com/auth/calendar.events.freebusy']);
  const call=async (url: string, init: RequestInit={}, token=runtimeToken) => {
    const response=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...init.headers}});
    requireValue(response.ok,'Integration request failed: '+new URL(url).hostname+' HTTP '+response.status);
    return response.status===204 ? {} : await response.json() as Json;
  };
  const service=JSON.parse(gcloud(['run','services','describe',manifest.service,'--region='+manifest.region,'--format=json'],manifest.deployIdentity));
  requireValue(service.status.url===deployment.serviceUrl && service.status.traffic.some((t: Json)=>t.url===deployment.candidateUrl && t.revisionName===deployment.revision),'Candidate URLs/revision do not match the live service.');
  const liveGateway=JSON.parse(gcloud(['run','services','describe',manifest.gatewayService,'--region='+manifest.region,'--format=json'],manifest.deployIdentity));
  requireValue(liveGateway.status.url===gateway.url && liveGateway.status.latestReadyRevisionName===gateway.gatewayRevision,'Gateway evidence differs from the live gateway.');
  const secret=async (key: string) => {
    const binding=deployment.secretVersions[key];
    requireValue(binding && /^[1-9][0-9]*$/.test(binding.version) && binding.secretId===manifest.secretBindings[key],'Missing pinned secret binding: '+key);
    return gcloud(['secrets','versions','access',binding.version,'--secret='+binding.secretId]);
  };
  const app=initializeApp({projectId:config.projectId,credential:{getAccessToken:async()=>({access_token:runtimeToken,expires_in:3000})}},'stage3-probes-'+randomUUID());
  const db=getFirestore(app,config.databaseId); const bucket=getStorage(app).bucket(manifest.documentBucket);
  const nonce=randomUUID().replaceAll('-',''); const object=bucket.file('stage3-probes/'+nonce+'.txt');
  const scratch=db.collection('stage3Probes').doc(nonce);
  const record: Json={schemaVersion:1,status:'running',environment:'staging',projectId:config.projectId,databaseId:config.databaseId,sourceSha,revision:deployment.revision,checks:{},startedAt:new Date().toISOString()};
  save(base+'/integration-readiness.json',record);
  let objectCreated=false; let documentCreated=false; let calendarEventCreated=false;
  const calendarRoot='https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(config.terraform.google_calendar_id)+'/events';
  const eventId='stage3'+nonce;
  try {
    await scratch.create({kind:'stage3-probe',nonce}); documentCreated=true;
    requireValue((await scratch.get()).data()?.nonce===nonce,'Runtime Firestore read-after-write failed.');
    await scratch.update({updated:true}); requireValue((await scratch.get()).data()?.updated===true,'Runtime Firestore update failed.');
    record.checks.firestore='passed';
    const indexRoot=`https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.databaseId}/collectionGroups/-/indexes`;
    const indexes: Json[]=[]; let pageToken=''; const seen=new Set<string>();
    do {
      const page=await call(indexRoot+(pageToken?'?pageToken='+encodeURIComponent(pageToken):'')); indexes.push(...(page.indexes||[])); pageToken=page.nextPageToken||'';
      if(pageToken) {requireValue(!seen.has(pageToken),'Index pagination repeated a token.'); seen.add(pageToken);}
    } while(pageToken);
    assertIndexes(load('firestore.indexes.json').indexes,indexes); record.checks.indexes='passed';
    await object.save(Buffer.from(nonce),{resumable:false,preconditionOpts:{ifGenerationMatch:0}}); objectCreated=true;
    requireValue((await object.download())[0].toString()===nonce,'Runtime private storage read-after-write failed.');
    const signed=await call('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'+manifest.runtimeIdentity+':signBlob',{method:'POST',body:JSON.stringify({payload:Buffer.from('stage3-signing-'+nonce).toString('base64')})});
    requireValue(typeof signed.signedBlob==='string','Runtime identity cannot sign private document download URLs.');
    record.checks.storage='passed'; record.checks.storageSigning='passed';
    const timeMin=new Date(Date.now()+86400000).toISOString(); const timeMax=new Date(Date.now()+86460000).toISOString();
    assertFreeBusy(await call('https://www.googleapis.com/calendar/v3/freeBusy',{method:'POST',body:JSON.stringify({timeMin,timeMax,items:[{id:config.terraform.google_calendar_id}]})}),config.terraform.google_calendar_id);
    await call(calendarRoot+'?sendUpdates=none',{method:'POST',body:JSON.stringify({id:eventId,summary:'ProInspect staging integration probe',start:{dateTime:timeMin},end:{dateTime:timeMax},transparency:'transparent',visibility:'private'})}); calendarEventCreated=true;
    await call(calendarRoot+'/'+eventId+'?sendUpdates=none',{method:'PATCH',body:JSON.stringify({summary:'ProInspect staging integration probe - verified'})});
    record.checks.calendar='passed';
    const authRoot='https://identitytoolkit.googleapis.com/admin/v2/projects/'+config.projectId;
    const authConfig=await call(authRoot+'/config'); const provider=await call(authRoot+'/defaultSupportedIdpConfigs/google.com');
    requireValue(authConfig.signIn?.email?.enabled===true && authConfig.signIn.email.passwordRequired!==true && provider.enabled===true && provider.clientId===config.googleSignInClientId,'Google sign-in or tenant email links are not configured.');
    requireValue((authConfig.authorizedDomains||[]).includes(new URL(manifest.runtimeEnvironment.APP_URL).hostname),'Staging application is not an authorised Firebase Auth domain.');
    record.checks.authentication='passed';
    const encryptionKey=(await secret('ACCESS_DATA_ENCRYPTION_KEY')).replace(/^base64:/,'');
    requireValue(Buffer.from(encryptionKey,'base64').length===32,'Access encryption secret is not a 32-byte base64 key.');
    requireValue((await secret('REPORT_HANDOFF_SIGNING_KEY')).length>=32,'Report handoff signing key is too short.');
    const ingestToken=await secret('REPORT_INGEST_TOKEN'); requireValue(ingestToken.length>=32,'Report ingest token is too short.');
    const email=await call('https://api.resend.com/emails',{method:'POST',headers:{'Idempotency-Key':'stage3-'+nonce},body:JSON.stringify({from:manifest.runtimeEnvironment.BOOKING_EMAIL_FROM,to:[config.testEmail],subject:'ProInspect staging integration verification',text:'Synthetic staging verification. No customer action is required.'})},await secret('RESEND_API_KEY'));
    requireValue(typeof email.id==='string','Email provider did not acknowledge submission.'); record.checks.emailSubmission='passed'; record.emailProviderMessageId=email.id;
    // Use staff-only synthetic context, retained so its immutable audit event never dangles.
    const propertyId='stage3-probe-'+nonce; const reportSourceId='stage3-'+nonce;
    await db.collection('properties').doc(propertyId).create({id:propertyId,streetAddress:nonce+' Stage3 Test Street',suburb:'Perth',state:'WA',postcode:'6000',status:'active',synthetic:true,createdAt:new Date().toISOString()});
    const headers={'Content-Type':'application/pdf','X-Report-Ingest-Token':ingestToken,'X-Property-Id':propertyId,'X-Document-Title':'Stage 3 synthetic report','X-File-Name':'stage3.pdf','X-Document-Category':'property_report','X-Document-Audiences':'staff','X-Report-Source-Id':reportSourceId};
    const pdf=Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
    const publish=async()=>{
      const response=await fetch(gateway.url+'/api/integrations/reports',{method:'POST',headers,body:pdf,redirect:'error',signal:AbortSignal.timeout(60000)});
      requireValue(response.ok,'Report ingest probe failed with HTTP '+response.status); return response.json() as Promise<Json>;
    };
    const first=await publish(); const repeated=await publish();
    requireValue(first.success && repeated.idempotent===true && first.document?.id===repeated.document?.id,'Report publication retry was not idempotent.');
    const stored=(await db.collection('propertyDocuments').doc(first.document.id).get()).data();
    requireValue(stored?.propertyId===propertyId && stored?.audiences?.length===1 && stored.audiences[0]==='staff','Synthetic report context or visibility is incorrect.');
    record.gatewayRevision=gateway.gatewayRevision; record.checks.reportIngest='passed'; record.syntheticReport={propertyId,documentId:first.document.id,reportSourceId,retainedForAudit:true};
    record.status='passed';
  } catch(error) {
    record.status='failed';
    // SDK errors can contain request headers. Store only a generic failure marker.
    record.failure='A live probe failed. Inspect the service-specific check without printing credentials.';
    throw error;
  } finally {
    const cleanup: Promise<unknown>[]=[];
    if(calendarEventCreated) cleanup.push(call(calendarRoot+'/'+eventId+'?sendUpdates=none',{method:'DELETE'}));
    if(objectCreated) cleanup.push(object.delete());
    if(documentCreated) cleanup.push(scratch.delete());
    const results=await Promise.allSettled(cleanup);
    if(results.some(r=>r.status==='rejected')) {record.status='failed';record.cleanup='failed';} else record.cleanup='passed';
    record.completedAt=new Date().toISOString(); save(base+'/integration-readiness.json',record);
    await deleteApp(app);
    if(record.cleanup!=='passed') throw new Error('Probe cleanup failed; inspect private evidence before retrying.');
  }
  console.log(JSON.stringify({status:record.status,checks:record.checks,revision:record.revision}));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  probe(process.argv.slice(2)).catch(()=>{console.error('STAGING INTEGRATION CHECK FAILED. No credentials were logged.');process.exitCode=1;});
}
