/** Production migration entry point. No Stage 3 environment checks are bypassed. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { pathToFileURL } from 'node:url';
import { transform } from '../migrate-unified-portal.js';
import { PRODUCTION_PROJECT, PRODUCTION_DATABASE, makePlan, snapshot, counts, digestOf,
  hash, commitValidatedPlan, type Plan } from '../stage3/migration-engine.js';

type Json=Record<string,any>;
const load=(p:string):Json=>JSON.parse(readFileSync(p,'utf8'));
function check(v:unknown,m:string):asserts v { if(!v) throw new Error(m); }
function recent(value:any) {
  const n=Date.parse(value);
  return Number.isFinite(n) && n<=Date.now() && Date.now()-n<=86400000;
}
export function validateProductionPermit(p:Json, plan:Plan, c:Json, configHash:string) {
  check(c.environment==='production' && c.projectId===PRODUCTION_PROJECT &&
    c.databaseId===PRODUCTION_DATABASE && c.skipStaging===true,'Exact production configuration required.');
  check(p.schemaVersion===1 && p.stage===4 && p.status==='approved' &&
    p.releaseId===c.releaseId && p.sourceSha===c.sourceSha && p.configFileHash===configHash,
    'Production cutover permit/source/config mismatch.');
  check(p.approvedDigest===plan.digest && p.sourceHash===plan.sourceHash &&
    p.projectId===c.projectId && p.databaseId===c.databaseId && recent(p.createdAt),
    'Cutover plan approval/target/freshness mismatch.');
  check(plan.sourceSha===c.sourceSha && plan.target.environment==='production' &&
    plan.target.projectId===c.projectId && plan.target.databaseId===c.databaseId,'Plan targets another source/database.');
  const b=p.backup, restore=p.restore;
  check(b && b.status==='SUCCESSFUL' && b.sourceHash===plan.sourceHash &&
    b.projectId===c.projectId && b.databaseId===c.databaseId && b.sourceSha===c.sourceSha &&
    recent(b.completedAt) && typeof b.outputUriPrefix==='string' &&
    b.outputUriPrefix.startsWith('gs://'+c.production.backupBucket+'/stage4/'),
    'Successful exact-source production backup required.');
  check(restore?.verifiedContent===true && restore.sourceHash===plan.sourceHash &&
    restore.backupOperation===b.operation && recent(restore.completedAt),
    'Exact backup must be restored and verified before production mutation.');
  check(p.freeze?.externalWritersPaused===true && p.freeze.evidenceReference &&
    p.freeze.maintenanceRevision && recent(p.freeze.drainedAt),
    'Verified maintenance plus explicit external-writer attestation required.');
}
export async function main(args:string[]) {
  const values=new Map<string,string>();
  for(let i=0;i<args.length;i+=2) {
    check(['--action','--config','--output','--plan','--approve','--permit','--database'].includes(args[i]) &&
      !values.has(args[i]) && args[i+1] && !args[i+1].startsWith('--'),'Unknown, duplicate or incomplete argument.');
    values.set(args[i],args[i+1]);
  }
  const value=(k:string)=>values.get(k)||'';
  const action=value('--action');
  check(['plan','capture','apply','repeat'].includes(action),'Explicit production migration action required.');
  const c=load(value('--config'));
  const sourceSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  check(!execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'Tracked source must be clean.');
  check(c.environment==='production' && c.projectId===PRODUCTION_PROJECT && c.databaseId===PRODUCTION_DATABASE &&
    c.skipStaging===true && c.sourceSha===sourceSha,'Wrong production target or source.');
  check(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST,
    'Production migration cannot use emulator configuration.');
  const database=value('--database')||c.databaseId;
  check(database===c.databaseId || (action==='capture' && /^stage4-restore-[a-f0-9]{16}$/.test(database)),
    'Only capture may target a uniquely named restore-check database.');
  const identity=c.production.migrationIdentity;
  check(identity.endsWith('@'+c.projectId+'.iam.gserviceaccount.com'),'Migration identity must belong to production.');
  const command=(parts:string[],account=identity)=>execFileSync('gcloud',[
    ...parts,'--project='+c.projectId,'--impersonate-service-account='+account,'--quiet'
  ],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000}).trim();
  const app=initializeApp({projectId:c.projectId,credential:{
    getAccessToken:async()=>({access_token:command(['auth','print-access-token']),expires_in:3000})
  }},'stage4-migration');
  const db=getFirestore(app,database);
  db.settings({ignoreUndefinedProperties:true});
  const save=(x:Json)=>{check(value('--output'),'A private --output path is required.');writeFileSync(value('--output'),JSON.stringify(x,null,2)+'\n',{mode:0o600});chmodSync(value('--output'),0o600);};
  const version=hash(['scripts/migrate-unified-portal.ts','scripts/stage3/migration-engine.ts','scripts/stage4/migrate.ts'].map(p=>readFileSync(p,'utf8')));
  try {
    if(action==='apply') {
      const plan=load(value('--plan')) as Plan,p=load(value('--permit'));
      validateProductionPermit(p,plan,c,createHash('sha256').update(readFileSync(value('--config'))).digest('hex'));
      check(value('--approve')===plan.digest,'Exact migration plan digest approval required.');
      const live=JSON.parse(command(['run','services','describe',c.terraform.cloud_run_service_name,
        '--region='+c.terraform.region,'--format=json'],c.production.deployIdentity));
      const active=live.status.traffic.filter((t:Json)=>t.percent>0);
      check(active.length===1 && active[0].percent===100 &&
        active[0].revisionName===p.freeze.maintenanceRevision &&
        live.status.traffic.every((t:Json)=>!t.tag || t.revisionName===p.freeze.maintenanceRevision),
        'Traffic or tagged writer changed after production freeze.');
      const operation=JSON.parse(command(['firestore','operations','describe',p.backup.operation,'--format=json']));
      check(operation.name===p.backup.operation && operation.done && !operation.error &&
        operation.metadata?.operationState==='SUCCESSFUL' &&
        operation.metadata?.outputUriPrefix===p.backup.outputUriPrefix,'Managed backup operation is not complete.');
      save(await commitValidatedPlan(db,plan,plan.target,plan.digest,version));
    } else {
      const before=await snapshot(db);
      if(action==='capture') {
        save({counts:counts(before),sourceHash:digestOf(before),completedAt:new Date().toISOString()});
      } else {
        const target={environment:'production' as const,projectId:c.projectId,databaseId:c.databaseId};
        const plan=await makePlan(before,target,transform,version,sourceSha);
        check(digestOf(await snapshot(db))===digestOf(before),'Production changed during dry run; discard the plan.');
        if(action==='repeat') check(plan.changes.length===0,'Repeat migration still proposes writes.');
        save(plan as any);
      }
    }
  } finally { await deleteApp(app); }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).catch(()=>{console.error('STAGE 4 MIGRATION BLOCKED. No credentials or record payloads were logged.');process.exitCode=1;});
