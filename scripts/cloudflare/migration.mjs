import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
export const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const checksum=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(canonical(v))).digest('hex');
const source=readFileSync(new URL('../../src/cloudflare/collections.ts',import.meta.url),'utf8');
const allowed=[...source.split('] as const')[0].matchAll(/'([^']+)'/g)].map(x=>x[1]);
const archived=new Set(['clientOrganisations','clientProperties','clientDocuments']);
const references={propertyId:'properties',clientId:'clients',primaryClientId:'clients',tenancyId:'tenancies',clientUserId:'clientUsers',tenantUserId:'tenantUsers',bookingId:'bookings',workOrderId:'workOrders'};
export function createImportPlan(snapshot){
 if(snapshot.schemaVersion!==1||!snapshot.collections||!snapshot.capturedAt||!snapshot.source?.projectId||!snapshot.source?.databaseId)throw new Error('Export manifest required');
 const rows=[],counts={},archives=[];const data=snapshot.collections;
 for(const collection of Object.keys(data).sort()){
  if(archived.has(collection)){archives.push({collection,count:Object.keys(data[collection]).length,sha256:checksum(data[collection])});continue;}
  if(!allowed.includes(collection))throw new Error('Unreviewed collection: '+collection);
  counts[collection]=0;
  for(const id of Object.keys(data[collection]).sort()){
   const value=data[collection][id];if(!id||id.includes('/')||!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid record: '+collection+'/'+id);
   for(const [field,target] of Object.entries(references))if(value[field]&&!data[target]?.[value[field]])throw new Error('Orphan reference: '+collection+'/'+id+'.'+field);
   for(const [field,target] of [['clientIds','clients'],['tenancyIds','tenancies']])if(value[field]&&(!Array.isArray(value[field])||value[field].some(x=>!data[target]?.[x])))throw new Error('Orphan membership: '+collection+'/'+id+'.'+field);
   if(collection==='propertyDocuments'&&(value.audiences||[]).includes('tenant')&&!value.tenancyId)throw new Error('Unscoped tenant document: '+id);
   if(collection==='bookings'&&!value.propertyId)throw new Error('Canonical property migration must precede D1 import: '+id);
   rows.push({collection,id,data:canonical(value),sha256:checksum(value)});counts[collection]++;
  }
 }
 const plan={schemaVersion:1,source:snapshot.source,capturedAt:snapshot.capturedAt,sourceSha256:checksum(snapshot),counts,archives,rows};
 return {...plan,digest:checksum(plan)};
}
export function verifyPlan(plan){const {digest,...body}=plan;if(checksum(body)!==digest)throw new Error('Migration plan digest mismatch');}
export async function applyImportPlan(plan,db,approvedDigest){
 verifyPlan(plan);if(approvedDigest!==plan.digest)throw new Error('Exact migration digest approval required');
 const changes=[];
 for(const row of plan.rows){
  if(!allowed.includes(row.collection)||checksum(row.data)!==row.sha256)throw new Error('Invalid migration row');
  const existing=await db.prepare(`SELECT data FROM "${row.collection}" WHERE id=?`).bind(row.id).first();
  if(existing){if(checksum(JSON.parse(existing.data))!==row.sha256)throw new Error('Destination differs; refusing overwrite: '+row.collection+'/'+row.id);continue;}
  changes.push(row);
 }
 // Maintenance-only operation; safe to resume. Each batch is transactional.
 for(let i=0;i<changes.length;i+=40){const batch=changes.slice(i,i+40).map(row=>db.prepare(`INSERT INTO "${row.collection}"(id,data) VALUES(?,?)`).bind(row.id,JSON.stringify(row.data)));await db.batch(batch);}
 for(const row of plan.rows){const stored=await db.prepare(`SELECT data FROM "${row.collection}" WHERE id=?`).bind(row.id).first();if(!stored||checksum(JSON.parse(stored.data))!==row.sha256)throw new Error('Post-import reconciliation failed');}
 return {sourceSha256:plan.sourceSha256,planDigest:plan.digest,inserted:changes.length,verified:plan.rows.length,counts:plan.counts};
}
export function validateObjectManifest(objects){
 const seen=new Set();for(const item of objects){
  if(!item.path||item.path.startsWith('/')||item.path.split('/').some(x=>!x||x==='..'||x==='.')||/[\\\x00-\x1f]/.test(item.path)||seen.has(item.path)||!/^([a-f0-9]{64})$/.test(item.sha256)||!Number.isSafeInteger(item.size)||item.size<0)throw new Error('Invalid object manifest');
  if(!['documents','sensitive'].includes(item.bucketClass))throw new Error('Unknown destination storage class');
  if(item.path.startsWith('tenant-sensitive/')&&item.bucketClass!=='sensitive')throw new Error('Sensitive file cannot migrate into ordinary storage');seen.add(item.path);
 }
 return {objects:objects.length,bytes:objects.reduce((n,x)=>n+x.size,0),sha256:checksum(objects)};
}
if(process.argv[1]?.endsWith('migration.mjs')){
 const [input,out]=process.argv.slice(2);if(!input||!out)throw new Error('Usage: node scripts/cloudflare/migration.mjs canonical-export.json private-output-directory');
 const plan=createImportPlan(JSON.parse(readFileSync(input,'utf8')));mkdirSync(out,{recursive:true,mode:0o700});
 writeFileSync(path.join(out,'d1-import-plan.json'),JSON.stringify(plan,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({digest:plan.digest,counts:plan.counts,archived:plan.archives.map(x=>x.collection)},null,2));
}
