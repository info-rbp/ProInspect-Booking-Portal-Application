const API='https://api.cloudflare.com/client/v4';
const token=process.env.CLOUDFLARE_API_TOKEN;
if(!token)throw new Error('CLOUDFLARE_API_TOKEN is missing');
async function raw(path){
 const response=await fetch(API+path,{headers:{Authorization:'Bearer '+token}});
 let payload={};try{payload=await response.json();}catch{}
 return {ok:response.ok&&payload.success!==false,status:response.status,result:payload.result,errors:(payload.errors||[]).map(x=>String(x?.message||x?.code||'unknown')).slice(0,4)};
}
const accountResponse=await raw('/accounts?per_page=50');
if(!accountResponse.ok)throw new Error('Cloudflare account discovery failed ('+accountResponse.status+'): '+accountResponse.errors.join(' | '));
const accounts=accountResponse.result||[];
const configured=(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
const account=configured||(accounts.length===1?accounts[0].id:'');
if(!account)throw new Error('CLOUDFLARE_ACCOUNT_ID is required because this token can access '+String(accounts.length)+' accounts');
if(!accounts.some(x=>x.id===account))throw new Error('Configured Cloudflare account is not accessible to this API token');

const checks={};
async function capability(name,path,read){
 const response=await raw(path);
 checks[name]={ok:response.ok,status:response.status,errors:response.errors};
 if(response.ok&&read)Object.assign(checks[name],read(response.result));
}
await capability('d1','/accounts/'+account+'/d1/database?per_page=100',r=>({count:(r||[]).length}));
await capability('r2','/accounts/'+account+'/r2/buckets',r=>({count:r?.buckets?.length||0}));
await capability('queues','/accounts/'+account+'/queues?per_page=100',r=>({count:(r||[]).length}));
await capability('turnstile','/accounts/'+account+'/challenges/widgets?per_page=1000',r=>({count:(r||[]).length}));
const zoneResult=await raw('/zones?name=proinspect.systems&account.id='+account+'&per_page=50');
checks.zone={ok:zoneResult.ok,status:zoneResult.status,errors:zoneResult.errors,count:zoneResult.ok?(zoneResult.result||[]).length:0};
if(zoneResult.ok&&(zoneResult.result||[]).length===1){
 const zoneId=zoneResult.result[0].id;
 const email=await raw('/zones/'+zoneId+'/email/sending/subdomains');
 checks.email={ok:email.ok,status:email.status,errors:email.errors,enabled:email.ok&&(email.result||[]).some(x=>x.name==='proinspect.systems'&&x.enabled===true)};
 const routes=await raw('/zones/'+zoneId+'/workers/routes');
 checks.workersRoutes={ok:routes.ok,status:routes.status,errors:routes.errors,count:routes.ok?(routes.result||[]).length:0};
 const waf=await raw('/zones/'+zoneId+'/rulesets/phases/http_request_firewall_custom/entrypoint');
 checks.waf={ok:waf.ok||waf.status===404,status:waf.status,errors:waf.status===404?[]:waf.errors,entrypointExists:waf.ok};
}else{
 checks.email={ok:false,status:zoneResult.status,errors:['proinspect.systems zone is not uniquely readable by this token'],enabled:false};
 checks.workersRoutes={ok:false,status:zoneResult.status,errors:['proinspect.systems zone is not uniquely readable by this token'],count:0};
 checks.waf={ok:false,status:zoneResult.status,errors:['proinspect.systems zone is not uniquely readable by this token'],entrypointExists:false};
}

const required={
 d1:'Account > D1: Edit/Write',
 r2:'Account > Workers R2 Storage: Edit/Write',
 queues:'Account > Queues: Edit/Write (or Workers Scripts Write where accepted)',
 turnstile:'Account > Turnstile: Edit/Write',
 zone:'Zone > Zone: Read for proinspect.systems',
 email:'Account > Email Sending: Edit plus Zone: Read for proinspect.systems',
 workersRoutes:'Zone > Workers Routes: Write for proinspect.systems',
 waf:'Zone > WAF: Write (or Rulesets Write where accepted) for proinspect.systems'
};
const missing=Object.entries(checks).filter(([,value])=>!value.ok).map(([name])=>({capability:name,requiredPermission:required[name]}));
console.log(JSON.stringify({accountId:account,checks,missing},null,2));
if(missing.length)throw new Error('Cloudflare API token is missing required production capabilities: '+missing.map(x=>x.capability).join(', '));
