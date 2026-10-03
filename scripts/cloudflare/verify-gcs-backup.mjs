import {createHash} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';

const args=Object.fromEntries(process.argv.slice(2).map(value=>{const i=value.indexOf('=');return i<0?[value,'']:[value.slice(0,i),value.slice(i+1)];}));
const sourceBucket=(args['--source-bucket']||'').trim();
const backupBucket=(args['--backup-bucket']||'').trim();
const backupPrefix=(args['--backup-prefix']||'').replace(/^\/+|\/+$/g,'');
const output=args['--output']||'.cloudflare/storage-backup-evidence.json';
const token=(process.env.GOOGLE_OAUTH_ACCESS_TOKEN||'').trim();
if(!token||!sourceBucket||!backupBucket||!backupPrefix)throw new Error('Source bucket, backup bucket, backup prefix and short-lived Google token are required');
const fields='nextPageToken,items(name,size,md5Hash,crc32c)';
async function inventory(bucket,prefix=''){
 const rows=[];let pageToken='';
 do{
  const url=new URL('https://storage.googleapis.com/storage/v1/b/'+encodeURIComponent(bucket)+'/o');
  url.searchParams.set('projection','noAcl');url.searchParams.set('fields',fields);url.searchParams.set('maxResults','1000');
  if(prefix)url.searchParams.set('prefix',prefix+'/');
  if(pageToken)url.searchParams.set('pageToken',pageToken);
  const response=await fetch(url,{headers:{Authorization:'Bearer '+token}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error('Cloud Storage inventory failed for '+bucket+' ('+response.status+')');
  for(const object of body.items||[]){
   const relative=prefix?String(object.name).slice(prefix.length+1):String(object.name);
   if(!relative)continue;
   rows.push({name:relative,size:Number(object.size||0),md5Hash:object.md5Hash||null,crc32c:object.crc32c||null});
  }
  pageToken=body.nextPageToken||'';
 }while(pageToken);
 rows.sort((a,b)=>a.name.localeCompare(b.name));
 const manifest=rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
 return {rows,count:rows.length,bytes:rows.reduce((n,row)=>n+row.size,0),manifestSha256:createHash('sha256').update(manifest).digest('hex')};
}
const source=await inventory(sourceBucket);
const backup=await inventory(backupBucket,backupPrefix);
if(source.count!==backup.count||source.bytes!==backup.bytes)throw new Error('Firebase Storage backup count/byte reconciliation failed');
for(let i=0;i<source.rows.length;i++){
 const left=source.rows[i],right=backup.rows[i];
 if(left.name!==right.name||left.size!==right.size||left.md5Hash!==right.md5Hash||left.crc32c!==right.crc32c)throw new Error('Firebase Storage backup checksum reconciliation failed');
}
const evidence={schemaVersion:1,sourceBucket,backupBucket,backupPrefix,objectCount:source.count,totalBytes:source.bytes,sourceManifestSha256:source.manifestSha256,backupManifestSha256:backup.manifestSha256,reconciled:true,capturedAt:new Date().toISOString()};
mkdirSync('.cloudflare',{recursive:true});
writeFileSync(output,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(evidence,null,2));
