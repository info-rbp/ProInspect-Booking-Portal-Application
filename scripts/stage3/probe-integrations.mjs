#!/usr/bin/env node
/** Real runtime-identity checks. No live customer email, documents, or Calendar events are used. */
import { GoogleAuth, Impersonated } from 'google-auth-library';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { PRODUCTION_PROJECT } from './migration-model.mjs';
const {values:v}=parseArgs({options:{config:{type:'string'},out:{type:'string'},'write-probes':{type:'boolean'},'storage-plan':{type:'string'}}});
async function main() {
  if (!v.config||!v.out) throw new Error('Usage: probe-integrations.mjs --config PLATFORM_OUTPUT_JSON --out PRIVATE_EVIDENCE [--write-probes] [--storage-plan PRIVATE_MIGRATION_PLAN]');
  const raw=JSON.parse(readFileSync(v.config,'utf8')), c=raw.platform?.value||raw;
  if (c.environment!=='staging'||c.project_id===PRODUCTION_PROJECT||c.project_id===c.production_project_id) throw new Error('Probes are staging-only.');
  const sourceClient=await new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
  const client=new Impersonated({sourceClient,targetPrincipal:c.runtime_service_account,targetScopes:['https://www.googleapis.com/auth/cloud-platform','https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.events.freebusy'],lifetime:600});
  const request=async(method,url,data)=> (await client.request({method,url,data,timeout:30000})).data;
  const checks={};
  // Firestore count proves the runtime can reach the explicitly named database without exposing records.
  const database=`projects/${c.project_id}/databases/${c.database_id}`;
  await request('POST',`https://firestore.googleapis.com/v1/${database}/documents:runAggregationQuery`,{structuredAggregationQuery:{structuredQuery:{from:[{collectionId:'properties'}]},aggregations:[{alias:'count',count:{}}]}});
  checks.firestore='passed';
  // Identity Toolkit responses are never emitted: they can contain OAuth configuration.
  const authConfig=await request('GET',`https://identitytoolkit.googleapis.com/admin/v2/projects/${c.project_id}/config`);
  if (!authConfig.signIn?.email?.enabled || authConfig.signIn.email.passwordRequired!==false) throw new Error('Staging email-link sign-in is not enabled.');
  const google=await request('GET',`https://identitytoolkit.googleapis.com/admin/v2/projects/${c.project_id}/defaultSupportedIdpConfigs/google.com`);
  if (!google.enabled||!google.clientId) throw new Error('Staging Google sign-in provider is not configured.');
  const host=new URL(c.runtime_environment.APP_URL).hostname;
  if (!authConfig.authorizedDomains?.includes(host)) throw new Error('Staging application hostname is not an authorised Firebase Auth domain.');
  checks.firebaseAuthConfiguration='passed';
  const files=await request('GET',`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(c.documents_bucket)}/o?maxResults=1`);
  void files;checks.storageRead='passed';
  if (v['storage-plan']) {
    const plan=JSON.parse(readFileSync(v['storage-plan'],'utf8'));
    if(plan.project!==c.project_id||plan.database!==c.database_id) throw new Error('Storage plan target mismatch.');
    const paths=new Set(plan.operations.filter(o=>o.path.startsWith('propertyDocuments/')).map(o=>o.after.storagePath).filter(Boolean));
    for (const path of paths) await request('GET',`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(c.documents_bucket)}/o/${encodeURIComponent(path)}?fields=name,size,generation,crc32c`);
    checks.migratedStorageObjects={status:'passed',count:paths.size};
  }
  if(v['write-probes']) {
    const path=`stage3-probes/${randomUUID()}.txt`, bytes='synthetic-proinspect-stage3-probe';
    let generation;
    try {
      const created=await client.request({method:'POST',url:`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(c.documents_bucket)}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(path)}`,data:bytes,headers:{'Content-Type':'text/plain'}});
      generation=created.data.generation;
      const read=await client.request({url:`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(c.documents_bucket)}/o/${encodeURIComponent(path)}?alt=media&generation=${generation}`,responseType:'text'});
      if(read.data!==bytes) throw new Error('Storage round-trip mismatch.');
      checks.storageRoundTrip='passed';
    } finally { if(generation) await request('DELETE',`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(c.documents_bucket)}/o/${encodeURIComponent(path)}?ifGenerationMatch=${generation}&generation=${generation}`); }
  }
  const calendars=(c.runtime_environment.STAGING_CALENDAR_IDS||'').split(',').filter(Boolean);
  if(!calendars.length||!calendars.includes(c.runtime_environment.GOOGLE_CALENDAR_ID)) throw new Error('A dedicated staging default Calendar and explicit allowlist are required.');
  const start=new Date(Date.now()+86400000).toISOString(),end=new Date(Date.now()+86400000+60000).toISOString();
  for (const calendar of calendars) {
    const availability=await request('POST','https://www.googleapis.com/calendar/v3/freeBusy',{timeMin:start,timeMax:end,items:[{id:calendar}]});
    if(!availability.calendars?.[calendar]||availability.calendars[calendar].errors?.length||!Array.isArray(availability.calendars[calendar].busy)) throw new Error('Calendar free/busy returned a per-calendar error. Workspace sharing is required.');
    if(v['write-probes']) {
      const base=`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar)}/events`;
      let id;
      try { const created=await request('POST',`${base}?sendUpdates=none`,{summary:'ProInspect synthetic Stage 3 permission probe',description:'Synthetic probe; automatic cleanup.',transparency:'transparent',start:{dateTime:start},end:{dateTime:end},reminders:{useDefault:false}});id=created.id;if(!id)throw new Error('Calendar did not return probe ID.');await request('PATCH',`${base}/${id}?sendUpdates=none`,{description:'Updated synthetic permission probe'}); }
      finally { if(id)await request('DELETE',`${base}/${id}?sendUpdates=none`); }
    }
  }
  checks.calendar={status:'passed',calendars:calendars.length,writeProbe:Boolean(v['write-probes'])};
  const evidence={status:'passed',environment:'staging',project:c.project_id,database:c.database_id,runtimeIdentity:c.runtime_service_account,checks,verifiedAt:new Date().toISOString(),scope:'Runtime Google service permissions only; Report Tool finalisation/callback and browser portal journeys require separate acceptance.'};
  mkdirSync(dirname(resolve(v.out)),{recursive:true,mode:0o700});writeFileSync(v.out,JSON.stringify(evidence,null,2),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({status:'passed',checks:Object.keys(checks),evidence:v.out}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
