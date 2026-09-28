#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_PROJECT, digest } from './migration-model.mjs';
export function deploymentConfig(config, webConfig) {
  if (config.environment!=='staging' || config.project_id===PRODUCTION_PROJECT || config.project_id===config.production_project_id) throw new Error('Deployment is restricted to a dedicated staging project.');
  if (webConfig.projectId!==config.project_id || webConfig.firestoreDatabaseId!==config.database_id || webConfig.storageBucket!==config.documents_bucket) throw new Error('Browser Firebase configuration does not match the staging backend.');
  if (webConfig.private_key || webConfig.client_email || !webConfig.apiKey || !webConfig.authDomain) throw new Error('A public Firebase web-app config is required, never a service-account credential.');
  if (config.runtime_environment?.PLATFORM_ENVIRONMENT!=='staging' || config.runtime_environment.EMAIL_DELIVERY_MODE!=='disabled' || config.runtime_environment.FIREBASE_PROJECT_ID!==config.project_id || config.runtime_environment.FIRESTORE_DATABASE_ID!==config.database_id || config.runtime_environment.FIREBASE_STORAGE_BUCKET!==config.documents_bucket) throw new Error('Staging runtime isolation/email configuration failed.');
  for (const key of ['project_id','region','service_name','database_id','runtime_service_account','build_service_account','documents_bucket','source_bucket','image_repository']) if (typeof config[key]!=='string'||!config[key]||/CHANGE_ME|REPLACE|[\r\n]/.test(config[key])) throw new Error(`Real non-placeholder ${key} is required.`);
  for (const key of ['runtime_service_account','build_service_account']) if (!config[key].endsWith(`@${config.project_id}.iam.gserviceaccount.com`)) throw new Error('Service account is outside the staging project.');
  if (!config.image_repository.startsWith(`${config.region}-docker.pkg.dev/${config.project_id}/`)) throw new Error('Image repository is outside the staging project.');
  if (!/^https:\/\//.test(config.runtime_environment.APP_URL||'') || /bookings\.proinspect\.systems|CHANGE_ME/.test(config.runtime_environment.APP_URL)) throw new Error('A separate HTTPS staging APP_URL is required.');
  for (const key of ['ACCESS_DATA_ENCRYPTION_KEY','REPORT_INGEST_TOKEN','REPORT_HANDOFF_SIGNING_KEY']) if (!config.secret_bindings?.[key]) throw new Error(`Pinned ${key} secret version is required.`);
  for (const [key,value] of Object.entries(config.secret_bindings||{})) if (!/^[A-Z_]+$/.test(key)||!/^proinspect-staging-[a-z0-9-]+:[1-9]\d*$/.test(value)) throw new Error('Only numeric staging secret references are accepted.');
  // Runtime credentials/secrets must be mounted through Secret Manager, not env JSON.
  for (const key of Object.keys(config.runtime_environment)) if (/TOKEN|PASSWORD|PRIVATE_KEY|SERVICE_ACCOUNT_JSON|API_KEY|SIGNING_KEY|ENCRYPTION_KEY$|KEYRING/.test(key)) throw new Error(`Secret ${key} cannot be plaintext runtime configuration.`);
  return config;
}
const cloud=(args)=>JSON.parse(execFileSync('gcloud',[...args,'--format=json','--quiet'],{encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','inherit']}));
async function main() {
  const {values:v}=parseArgs({options:{config:{type:'string'},firebase:{type:'string'},out:{type:'string'}}});
  if (!v.config||!v.firebase||!v.out) throw new Error('Usage: deploy-staging.mjs --config PLATFORM_OUTPUT_JSON --firebase PUBLIC_STAGING_FIREBASE_JSON --out EVIDENCE_JSON');
  const raw=JSON.parse(readFileSync(v.config,'utf8'));
  const c=raw.platform?.value||raw;
  const web=JSON.parse(readFileSync(v.firebase,'utf8'));
  deploymentConfig(c,web);
  const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Full source SHA required.');
  execFileSync('git',['merge-base','--is-ancestor','ceebc2f0d312aec6ab68b796a90e04219e771696',sha]);
  const target=[`--project=${c.project_id}`,`--region=${c.region}`];
  const services=cloud(['run','services','list',...target]);
  const existing=services.find(s=>s.metadata?.name===c.service_name);
  const previous=existing ? cloud(['run','services','describe',c.service_name,...target]) : null;
  const assertPrivate=()=> {
    const service=cloud(['run','services','describe',c.service_name,...target]);
    if(service.metadata?.annotations?.['run.googleapis.com/invoker-iam-disabled']==='true') throw new Error('Staging Invoker IAM check is disabled. Refusing deployment.');
    const policy=cloud(['run','services','get-iam-policy',c.service_name,...target]);
    if ((policy.bindings||[]).some(b=>(b.members||[]).some(m=>['allUsers','allAuthenticatedUsers'].includes(m)))) throw new Error('Staging service has public IAM access. Refusing to proceed.');
  };
  if (existing) assertPrivate();
  const context=mkdtempSync(join(tmpdir(),'proinspect-staging-'));
  try {
    // Archive the committed source only; no local credentials, plans or customer data enter the build.
    const tar=execFileSync('git',['archive',sha],{maxBuffer:64*1024*1024});
    execFileSync('tar',['-x','-C',context],{input:tar});
    writeFileSync(join(context,'firebase-applet-config.json'),JSON.stringify(web,null,2));
    const tag=`${sha}-${digest(web).slice(0,12)}`;
    const image=`${c.image_repository}:${tag}`;
    const images=cloud(['artifacts','docker','images','list',c.image_repository,'--include-tags',`--project=${c.project_id}`]);
    let imageDigest=images.find(i=>(i.tags||[]).includes(tag))?.version?.split('/').at(-1);
    let buildId=null;
    if (!imageDigest) {
      const build=cloud(['builds','submit',context,`--project=${c.project_id}`,`--region=${c.region}`,`--config=${join(context,'cloudbuild.staging.yaml')}`,`--service-account=projects/${c.project_id}/serviceAccounts/${c.build_service_account}`,`--gcs-source-staging-dir=gs://${c.source_bucket}/source`,`--substitutions=_IMAGE=${image}`]);
      if (build.status!=='SUCCESS') throw new Error('Cloud Build failed. No revision deployed.');
      imageDigest=build.results?.images?.find(i=>i.name===image)?.digest;
      buildId=build.id;
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(imageDigest||'')) throw new Error('An immutable verified image digest is required.');
    const envFile=join(context,'runtime-env.json');
    writeFileSync(envFile,JSON.stringify({...c.runtime_environment,NODE_ENV:'production',SOURCE_SHA:sha}),{mode:0o600});
    const revisionTag=`stage3-${sha.slice(0,12)}`;
    const args=['run','deploy',c.service_name,...target,`--image=${c.image_repository}@${imageDigest}`,`--service-account=${c.runtime_service_account}`,`--env-vars-file=${envFile}`,`--set-secrets=${Object.entries(c.secret_bindings).map(([k,val])=>`${k}=${val}`).join(',')}`,'--port=8080','--min-instances=0','--max-instances=2','--concurrency=40','--memory=512Mi','--cpu=1',`--tag=${revisionTag}`];
    // New services are private; existing service traffic stays untouched until smoke acceptance.
    if (existing) args.push('--no-traffic');
    cloud(args);
    assertPrivate();
    const service=cloud(['run','services','describe',c.service_name,...target]);
    const revision=service.status.latestReadyRevisionName;
    const tagged=service.status.traffic?.find(t=>t.tag===revisionTag)?.url;
    if (!tagged||!revision) throw new Error('Candidate revision is not ready. Existing traffic was not changed.');
    const token=execFileSync('gcloud',['auth','print-identity-token',`--audiences=${service.status.url}`],{encoding:'utf8'}).trim();
    for (const path of ['/api/health','/','/book','/client','/tenant','/admin']) {
      const response=await fetch(`${tagged}${path}`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
      if (!response.ok) throw new Error(`Candidate smoke failed on ${path}: ${response.status}. Previous traffic retained.`);
      if (path==='/api/health') { const health=await response.json(); if (!health.ok||health.sourceSha!==sha||health.environment!=='staging'||health.bookingEmailConfigured) throw new Error('Candidate identity/email-isolation health check failed.'); }
    }
    cloud(['run','services','update-traffic',c.service_name,...target,`--to-revisions=${revision}=100`]);
    const evidence={status:'passed',environment:'staging',project:c.project_id,sourceSha:sha,configHash:digest(c),firebaseConfigHash:digest(web),imageDigest,buildId,revision,url:tagged,previousTraffic:previous?.status?.traffic||[],verifiedAt:new Date().toISOString(),scope:'Private staging revision and HTTP route smoke; full authenticated portal/integration acceptance is separate.'};
    mkdirSync(dirname(resolve(v.out)),{recursive:true});
    writeFileSync(v.out,JSON.stringify(evidence,null,2),{mode:0o600,flag:'wx'});
    console.log(JSON.stringify({status:'passed',revision,sourceSha:sha,evidence:v.out}));
  } finally { rmSync(context,{recursive:true,force:true}); }
}
if (process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);process.exitCode=1;});
