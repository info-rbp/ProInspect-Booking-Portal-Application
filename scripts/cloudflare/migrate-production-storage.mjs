import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const [exportPath='private-migration/canonical-export.json',resourcesPath='.cloudflare/production-resources.json']=process.argv.slice(2);
const snapshot=JSON.parse(readFileSync(exportPath,'utf8'));
const resources=JSON.parse(readFileSync(resourcesPath,'utf8'));
const sourceBucket=process.env.GCP_FIREBASE_STORAGE_BUCKET||'business-plan-applicatio-17047.firebasestorage.app';
const impersonate=(process.env.GCP_STORAGE_IMPERSONATE_SERVICE_ACCOUNT||'').trim();
const gcloudArgs=(args)=>impersonate?[...args,'--impersonate-service-account='+impersonate]:args;
if(!snapshot?.collections||!resources?.documentsBucket||!resources?.sensitiveBucket)throw new Error('Canonical export and isolated resource descriptor are required');
const staging=resources.environment==='staging';
if(resources.workerName!==(staging?'proinspect-platform-staging':'proinspect-platform'))throw new Error('Unexpected storage migration Worker target');
const configPath=staging?'.cloudflare/wrangler.staging.json':'.cloudflare/wrangler.production.json';
const config=JSON.parse(readFileSync(configPath,'utf8'));
if(config.name!==resources.workerName||config.account_id!==resources.accountId||config.d1_databases?.[0]?.database_id!==resources.database?.id)throw new Error('Storage migration configuration does not match the reviewed resources');
for(const [binding,bucket] of [['DOCUMENTS',resources.documentsBucket],['SENSITIVE',resources.sensitiveBucket]])if(!config.r2_buckets?.some(item=>item.binding===binding&&item.bucket_name===bucket))throw new Error('Storage bucket binding mismatch');
if(staging&&[resources.documentsBucket,resources.sensitiveBucket].some(name=>!name.startsWith('proinspect-staging-')))throw new Error('Staging cannot write production storage');

const paths=new Set();
function walk(value){
 if(Array.isArray(value)){for(const item of value)walk(item);return;}
 if(!value||typeof value!=='object')return;
 for(const [key,item] of Object.entries(value)){
  if(key==='storagePath'&&typeof item==='string'&&item.trim())paths.add(item.trim());
  walk(item);
 }
}
walk(snapshot.collections);
function validateStoragePath(value){
 if(value.startsWith('/')||value.includes('\\')||value.split('/').some(x=>!x||x==='.'||x==='..')||/[\x00-\x1f]/.test(value))throw new Error('Unsafe storage path in migration export');
 return value;
}
const root=mkdtempSync(path.join(os.tmpdir(),'proinspect-r2-'));
const migrated=[];
try{
 let index=0;
 for(const raw of [...paths].sort()){
  const storagePath=validateStoragePath(raw);
  const targetBucket=storagePath.startsWith('tenant-sensitive/')?resources.sensitiveBucket:resources.documentsBucket;
  const local=path.join(root,'source-'+String(index++));
  const roundtrip=local+'.verify';
  const source='gs://'+sourceBucket+'/'+storagePath;
  let metadata={};
  try{metadata=JSON.parse(execFileSync('gcloud',gcloudArgs(['storage','objects','describe',source,'--format=json']),{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}
  catch{throw new Error('Referenced legacy storage object is unavailable at manifest position '+index);}
  execFileSync('gcloud',gcloudArgs(['storage','cp',source,local,'--quiet']),{stdio:'ignore'});
  const bytes=statSync(local).size;
  const sha256=createHash('sha256').update(readFileSync(local)).digest('hex');
  const args=['--yes','wrangler@4.147.0','r2','object','put',targetBucket+'/'+storagePath,'--file='+local,'--remote','--config='+configPath,'--force'];
  const contentType=metadata.contentType||metadata.content_type;
  if(contentType)args.push('--content-type='+String(contentType));
  execFileSync('npx',args,{stdio:'ignore'});
  execFileSync('npx',['--yes','wrangler@4.147.0','r2','object','get',targetBucket+'/'+storagePath,'--file='+roundtrip,'--remote','--config='+configPath],{stdio:'ignore'});
  const verifiedSha=createHash('sha256').update(readFileSync(roundtrip)).digest('hex');
  if(verifiedSha!==sha256)throw new Error('R2 round-trip checksum mismatch at manifest position '+index);
  migrated.push({path:storagePath,bucketClass:targetBucket===resources.sensitiveBucket?'sensitive':'documents',size:bytes,sha256,contentType:contentType||null});
 }
 mkdirSync('private-migration',{recursive:true,mode:0o700});
 writeFileSync('private-migration/storage-migration.json',JSON.stringify({schemaVersion:1,sourceBucket,objects:migrated,bytes:migrated.reduce((n,x)=>n+x.size,0)},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({environment:staging?'staging':'production',objects:migrated.length,bytes:migrated.reduce((n,x)=>n+x.size,0),sensitive:migrated.filter(x=>x.bucketClass==='sensitive').length},null,2));
}finally{rmSync(root,{recursive:true,force:true});}
