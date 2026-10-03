import {mkdirSync,writeFileSync} from 'node:fs';

const API='https://api.cloudflare.com/client/v4';
const token=process.env.CLOUDFLARE_API_TOKEN;
const appUrl=process.env.CLOUDFLARE_APP_URL||'https://proinspect-platform.delicate-dream-e4c9.workers.dev';
if(!token)throw new Error('CLOUDFLARE_API_TOKEN is required');
const appHost=new URL(appUrl).hostname;

function safeErrors(body,status){
 const errors=Array.isArray(body?.errors)?body.errors.map(x=>String(x?.message||x?.code||'unknown')).slice(0,5):[];
 return 'Cloudflare API request failed ('+status+'): '+(errors.join(' | ')||'no safe error detail');
}
async function api(path,{method='GET',body}={}){
 const response=await fetch(API+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 let payload={};try{payload=await response.json();}catch{}
 if(!response.ok||payload.success===false)throw new Error(safeErrors(payload,response.status));
 return payload.result;
}
async function accountId(){
 const configured=(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
 if(configured){if(!/^[a-f0-9]{32}$/i.test(configured))throw new Error('CLOUDFLARE_ACCOUNT_ID has an invalid format');return configured;}
 const accounts=await api('/accounts?per_page=50');
 if(!Array.isArray(accounts)||accounts.length!==1)throw new Error('CLOUDFLARE_ACCOUNT_ID is required when the API token can access zero or multiple accounts');
 return accounts[0].id;
}
async function ensureD1(account,name){
 const list=await api('/accounts/'+account+'/d1/database?name='+encodeURIComponent(name)+'&per_page=100');
 const exact=(list||[]).filter(x=>x.name===name);
 if(exact.length>1)throw new Error('Multiple D1 databases use the production name');
 if(exact.length===1)return exact[0];
 return api('/accounts/'+account+'/d1/database',{method:'POST',body:{name,primary_location_hint:'oc'}});
}
async function ensureBucket(account,name){
 const listed=await api('/accounts/'+account+'/r2/buckets?name='+encodeURIComponent(name));
 const buckets=listed?.buckets||[];
 const exact=buckets.filter(x=>x.name===name);
 if(exact.length>1)throw new Error('Multiple R2 buckets use the production name');
 if(exact.length===1)return exact[0];
 return api('/accounts/'+account+'/r2/buckets',{method:'POST',body:{name,locationHint:'oc',storageClass:'Standard'}});
}
async function ensureQueue(account,name){
 const listed=await api('/accounts/'+account+'/queues?per_page=100');
 const exact=(listed||[]).filter(x=>x.queue_name===name);
 if(exact.length>1)throw new Error('Multiple Queues use the production name');
 if(exact.length===1)return exact[0];
 return api('/accounts/'+account+'/queues',{method:'POST',body:{queue_name:name}});
}
async function ensureTurnstile(account){
 const name='ProInspect Production';
 const listed=await api('/accounts/'+account+'/challenges/widgets?per_page=1000&filter='+encodeURIComponent('name:'+name));
 let widget=(listed||[]).find(x=>x.name===name);
 let secret=(process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY||'').trim();
 const domains=[appHost,'bookings.proinspect.systems'];
 if(!widget){
  widget=await api('/accounts/'+account+'/challenges/widgets',{method:'POST',body:{name,domains,mode:'managed'}});
  secret=widget.secret||'';
 }else{
  const current=[...(widget.domains||[])].sort().join(',');
  const required=[...domains].sort().join(',');
  if(current!==required)widget=await api('/accounts/'+account+'/challenges/widgets/'+widget.sitekey,{method:'PUT',body:{name,domains,mode:'managed'}});
  if(!secret){
   const rotated=await api('/accounts/'+account+'/challenges/widgets/'+widget.sitekey+'/rotate_secret',{method:'POST'});
   secret=rotated.secret||'';
  }
 }
 if(!widget?.sitekey||!secret)throw new Error('Turnstile widget exists but its secret could not be established');
 return {sitekey:widget.sitekey,secret};
}
async function ensureEmail(account){
 const zones=await api('/zones?name=proinspect.systems&account.id='+account+'&per_page=50');
 if(!Array.isArray(zones)||zones.length!==1)return {zoneId:null,enabled:false,reason:'proinspect.systems is not an active zone in this Cloudflare account'};
 const zone=zones[0];
 let configured=await api('/zones/'+zone.id+'/email/sending/subdomains');
 let row=(configured||[]).find(x=>x.name==='proinspect.systems');
 if(!row)row=await api('/zones/'+zone.id+'/email/sending/subdomains',{method:'POST',body:{name:'proinspect.systems'}});
 return {zoneId:zone.id,enabled:row?.enabled===true,tag:row?.tag||null};
}

const account=await accountId();
const names={
 database:'proinspect-platform-production',
 documents:'proinspect-production-documents',
 sensitive:'proinspect-production-sensitive',
 queue:'proinspect-production-mail',
 dead:'proinspect-production-dead'
};
const database=await ensureD1(account,names.database);
await ensureBucket(account,names.documents);
await ensureBucket(account,names.sensitive);
await ensureQueue(account,names.queue);
await ensureQueue(account,names.dead);
const turnstile=await ensureTurnstile(account);
const email=await ensureEmail(account);

mkdirSync('.cloudflare',{recursive:true});
const publicState={
 schemaVersion:1,
 accountId:account,
 appUrl,
 workerName:'proinspect-platform',
 database:{name:names.database,id:database.uuid},
 documentsBucket:names.documents,
 sensitiveBucket:names.sensitive,
 queue:names.queue,
 deadLetterQueue:names.dead,
 turnstileSiteKey:turnstile.sitekey,
 email,
 provisionedAt:new Date().toISOString()
};
writeFileSync('.cloudflare/production-resources.json',JSON.stringify(publicState,null,2)+'\n',{mode:0o600});
writeFileSync('.cloudflare/production-private.json',JSON.stringify({turnstileSecret:turnstile.secret})+'\n',{mode:0o600});
console.log(JSON.stringify({...publicState,email:{...email}},null,2));
if(!email.enabled)console.log('CLOUDFLARE_EMAIL_GATE=not-enabled');
else console.log('CLOUDFLARE_EMAIL_GATE=enabled');
