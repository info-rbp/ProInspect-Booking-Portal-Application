const API='https://api.cloudflare.com/client/v4';
const token=process.env.CLOUDFLARE_API_TOKEN;
if(!token)throw new Error('CLOUDFLARE_API_TOKEN is missing');
async function api(path){
 const response=await fetch(API+path,{headers:{Authorization:'Bearer '+token}});
 let payload={};try{payload=await response.json();}catch{}
 if(!response.ok||payload.success===false)throw new Error('Cloudflare readiness failed for '+path+' ('+response.status+'): '+(payload.errors||[]).map(x=>x.message||x.code).join(' | '));
 return payload.result;
}
const accounts=await api('/accounts?per_page=50');
const configured=(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
const account=configured||((accounts||[]).length===1?accounts[0].id:'');
if(!account)throw new Error('CLOUDFLARE_ACCOUNT_ID is required because this token can access '+String((accounts||[]).length)+' accounts');
if(!(accounts||[]).some(x=>x.id===account))throw new Error('Configured Cloudflare account is not accessible to this API token');
const results={accountId:account};
results.d1=(await api('/accounts/'+account+'/d1/database?per_page=100')).length;
results.r2=(await api('/accounts/'+account+'/r2/buckets')).buckets?.length||0;
results.queues=(await api('/accounts/'+account+'/queues?per_page=100')).length;
results.turnstile=(await api('/accounts/'+account+'/challenges/widgets?per_page=1000')).length;
const zones=await api('/zones?name=proinspect.systems&account.id='+account+'&per_page=50');
results.proinspectZone=(zones||[]).length===1;
if(results.proinspectZone){
 const email=await api('/zones/'+zones[0].id+'/email/sending/subdomains');
 results.emailSending=(email||[]).some(x=>x.name==='proinspect.systems'&&x.enabled===true);
}else results.emailSending=false;
console.log(JSON.stringify(results,null,2));
