import {readFileSync} from 'node:fs';
import {checksum,verifyPlan} from './migration.mjs';

const [planPath='private-migration/d1-import-plan.json',resourcesPath='.cloudflare/production-resources.json']=process.argv.slice(2);
const plan=JSON.parse(readFileSync(planPath,'utf8'));
const resources=JSON.parse(readFileSync(resourcesPath,'utf8'));
const approved=(process.env.CLOUDFLARE_MIGRATION_DIGEST||'').trim();
const token=process.env.CLOUDFLARE_API_TOKEN;
if(!token)throw new Error('CLOUDFLARE_API_TOKEN is required');
verifyPlan(plan);
if(!approved||approved!==plan.digest)throw new Error('Exact CLOUDFLARE_MIGRATION_DIGEST approval is required');
if(!/^[a-f0-9]{32}$/i.test(resources.accountId)||!/^[a-f0-9-]{36}$/i.test(resources.database?.id))throw new Error('Production Cloudflare resource descriptor is invalid');

const allowed=new Set(['_releaseControl','adminUsers','auditEvents','bookingAccessSecrets','bookings','clientApprovals','clientMemberships','clientPropertyLinks','clientRequests','clientUsers','clients','contractors','documentProducts','documentRequestSecrets','documentRequests','formDefinitions','payments','portalNotifications','properties','propertyDocuments','scheduleLocks','sensitiveAuditEvents','sensitiveTenantForms','services','settings','systemMetadata','tenancies','tenantFormRequests','tenantInspections','tenantRequests','tenantUsers','workOrders','nativeCalendarEvents','communications','subscriptions']);
const endpoint='https://api.cloudflare.com/client/v4/accounts/'+resources.accountId+'/d1/database/'+resources.database.id+'/query';

async function query(batch){
 const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({batch})});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok||payload.success===false)throw new Error('D1 API request failed ('+response.status+'): '+(payload.errors||[]).map(x=>x.message||x.code).join(' | '));
 const result=payload.result||[];
 if(result.some(x=>x?.success===false))throw new Error('A D1 batch statement failed');
 return result;
}
let inserted=0,verified=0;
for(let start=0;start<plan.rows.length;start+=40){
 const rows=plan.rows.slice(start,start+40);
 for(const row of rows)if(!allowed.has(row.collection)||!/^[A-Za-z0-9_-]+$/.test(row.id)||checksum(row.data)!==row.sha256)throw new Error('Invalid migration row');
 const found=await query(rows.map(row=>({sql:'SELECT data FROM "'+row.collection+'" WHERE id=?',params:[row.id]})));
 const inserts=[];
 rows.forEach((row,index)=>{
  const existing=found[index]?.results?.[0]?.data;
  if(existing!==undefined){
   if(checksum(JSON.parse(existing))!==row.sha256)throw new Error('Destination differs; refusing overwrite: '+row.collection+'/'+row.id);
  }else inserts.push({sql:'INSERT INTO "'+row.collection+'"(id,data) VALUES(?,?)',params:[row.id,JSON.stringify(row.data)]});
 });
 if(inserts.length){await query(inserts);inserted+=inserts.length;}
 const checked=await query(rows.map(row=>({sql:'SELECT data FROM "'+row.collection+'" WHERE id=?',params:[row.id]})));
 rows.forEach((row,index)=>{
  const stored=checked[index]?.results?.[0]?.data;
  if(stored===undefined||checksum(JSON.parse(stored))!==row.sha256)throw new Error('Post-import reconciliation failed: '+row.collection+'/'+row.id);
  verified++;
 });
}
console.log(JSON.stringify({digest:plan.digest,sourceSha256:plan.sourceSha256,inserted,verified,counts:plan.counts},null,2));
