import {mkdirSync,writeFileSync} from 'node:fs';

const API='https://api.cloudflare.com/client/v4';
const token=(process.env.CLOUDFLARE_API_TOKEN||'').trim();
const releaseSha=(process.env.RELEASE_SHA||process.env.GITHUB_SHA||'').trim();
if(!token)throw new Error('CLOUDFLARE_API_TOKEN is required');
if(!/^[a-f0-9]{40}$/.test(releaseSha))throw new Error('Exact staging release SHA is required');
function safeErrors(body,status){return 'Cloudflare API request failed ('+status+'): '+((body?.errors||[]).map(x=>String(x?.message||x?.code||'unknown')).slice(0,5).join(' | ')||'no safe error detail');}
async function api(path,{method='GET',body}={}){
 const response=await fetch(API+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok||payload.success===false)throw new Error(safeErrors(payload,response.status));
 return payload.result;
}
async function accountId(){
 const configured=(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
 if(configured){if(!/^[a-f0-9]{32}$/i.test(configured))throw new Error('CLOUDFLARE_ACCOUNT_ID has an invalid format');return configured;}
 const accounts=await api('/accounts?per_page=50');
 if(!Array.isArray(accounts)||accounts.length!==1)throw new Error('CLOUDFLARE_ACCOUNT_ID is required when the token can access zero or multiple accounts');
 return accounts[0].id;
}
async function ensureD1(account,name){
 const list=await api('/accounts/'+account+'/d1/database?name='+encodeURIComponent(name)+'&per_page=100');
 const exact=(list||[]).filter(x=>x.name===name);
 if(exact.length>1)throw new Error('Multiple staging D1 databases use the reviewed name');
 if(exact.length===1)return exact[0];
 return api('/accounts/'+account+'/d1/database',{method:'POST',body:{name,primary_location_hint:'oc'}});
}
async function ensureBucket(account,name){
 const listed=await api('/accounts/'+account+'/r2/buckets?name='+encodeURIComponent(name));
 const exact=(listed?.buckets||[]).filter(x=>x.name===name);
 if(exact.length>1)throw new Error('Multiple staging R2 buckets use the reviewed name');
 if(exact.length===1)return exact[0];
 return api('/accounts/'+account+'/r2/buckets',{method:'POST',body:{name,locationHint:'oc',storageClass:'Standard'}});
}
async function ensureQueue(account,name){
 const listed=await api('/accounts/'+account+'/queues?per_page=100');
 const exact=(listed||[]).filter(x=>x.queue_name===name);
 if(exact.length>1)throw new Error('Multiple staging Queues use the reviewed name');
 if(exact.length===1)return exact[0];
 return api('/accounts/'+account+'/queues',{method:'POST',body:{queue_name:name}});
}
async function ensureTurnstile(account,host){
 const name='ProInspect Staging';
 const listed=await api('/accounts/'+account+'/challenges/widgets?per_page=1000&filter='+encodeURIComponent('name:'+name));
 let widget=(listed||[]).find(x=>x.name===name),secret='';
 if(!widget){widget=await api('/accounts/'+account+'/challenges/widgets',{method:'POST',body:{name,domains:[host],mode:'managed'}});secret=widget.secret||'';}
 else {
  if((widget.domains||[]).slice().sort().join(',')!==host)widget=await api('/accounts/'+account+'/challenges/widgets/'+widget.sitekey,{method:'PUT',body:{name,domains:[host],mode:'managed'}});
  const rotated=await api('/accounts/'+account+'/challenges/widgets/'+widget.sitekey+'/rotate_secret',{method:'POST'});secret=rotated.secret||'';
 }
 if(!widget?.sitekey||!secret)throw new Error('Staging Turnstile widget/secret could not be established');
 return {sitekey:widget.sitekey,secret};
}
async function emailStatus(account){
 const zones=await api('/zones?name=proinspect.systems&account.id='+account+'&per_page=50');
 if(!Array.isArray(zones)||zones.length!==1)return {enabled:false,reason:'proinspect.systems is not uniquely readable'};
 const rows=await api('/zones/'+zones[0].id+'/email/sending/subdomains');
 return {enabled:(rows||[]).some(x=>x.name==='proinspect.systems'&&x.enabled===true),zoneId:zones[0].id};
}
const account=await accountId();
const subdomain=await api('/accounts/'+account+'/workers/subdomain');
if(!subdomain?.subdomain)throw new Error('Workers account subdomain is not configured');
const names={worker:'proinspect-platform-staging',database:'proinspect-platform-staging-'+releaseSha.slice(0,12),documents:'proinspect-staging-documents',sensitive:'proinspect-staging-sensitive',queue:'proinspect-staging-mail',dead:'proinspect-staging-dead'};
const appUrl='https://'+names.worker+'.'+subdomain.subdomain+'.workers.dev';
const database=await ensureD1(account,names.database);
await ensureBucket(account,names.documents);await ensureBucket(account,names.sensitive);await ensureQueue(account,names.queue);await ensureQueue(account,names.dead);
const turnstile=await ensureTurnstile(account,new URL(appUrl).hostname),email=await emailStatus(account);
mkdirSync('.cloudflare',{recursive:true});
const state={schemaVersion:1,environment:'staging',sourceSha:releaseSha,accountId:account,appUrl,workerName:names.worker,database:{name:names.database,id:database.uuid},documentsBucket:names.documents,sensitiveBucket:names.sensitive,queue:names.queue,deadLetterQueue:names.dead,turnstileSiteKey:turnstile.sitekey,email,provisionedAt:new Date().toISOString()};
writeFileSync('.cloudflare/staging-resources.json',JSON.stringify(state,null,2)+'\n',{mode:0o600});
writeFileSync('.cloudflare/staging-private.json',JSON.stringify({turnstileSecret:turnstile.secret})+'\n',{mode:0o600});
console.log(JSON.stringify({...state,email:{enabled:email.enabled}},null,2));
if(!email.enabled)throw new Error('Cloudflare Email Sending is not enabled for proinspect.systems');
