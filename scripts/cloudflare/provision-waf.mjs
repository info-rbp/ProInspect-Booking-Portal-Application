const API='https://api.cloudflare.com/client/v4';
const token=(process.env.CLOUDFLARE_API_TOKEN||'').trim();
const hostname=(process.env.CLOUDFLARE_CUSTOM_DOMAIN||'bookings.proinspect.systems').trim().toLowerCase();
if(!token)throw new Error('CLOUDFLARE_API_TOKEN is required');
if(hostname!=='bookings.proinspect.systems')throw new Error('Production WAF hostname changed unexpectedly');

async function raw(path,{method='GET',body}={}){
 const response=await fetch(API+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const payload=await response.json().catch(()=>({}));
 return {response,payload};
}
async function api(path,options={}){
 const {response,payload}=await raw(path,options);
 if(!response.ok||payload.success===false)throw new Error('Cloudflare WAF request failed ('+response.status+'): '+(payload.errors||[]).map(x=>x.message||x.code).join(' | '));
 return payload.result;
}
const account=(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
const zones=await api('/zones?name=proinspect.systems'+(account?'&account.id='+account:'')+'&per_page=50');
if(!Array.isArray(zones)||zones.length!==1)throw new Error('proinspect.systems zone is not uniquely available');
const zoneId=zones[0].id;
const expression='(http.host eq "bookings.proinspect.systems" and (http.request.method in {"TRACE" "CONNECT"} or starts_with(http.request.uri.path, "/.git") or starts_with(http.request.uri.path, "/.env") or starts_with(http.request.uri.path, "/wp-admin") or starts_with(http.request.uri.path, "/wp-login.php")))';
const desired={ref:'proinspect-production-baseline',description:'ProInspect production baseline: block unsupported methods and common secret/source probes',expression,action:'block',enabled:true};

const entry=await raw('/zones/'+zoneId+'/rulesets/phases/http_request_firewall_custom/entrypoint');
let ruleset;
if(entry.response.status===404){
 ruleset=await api('/zones/'+zoneId+'/rulesets',{method:'POST',body:{name:'zone',description:'Zone-level custom firewall entry point',kind:'zone',phase:'http_request_firewall_custom',rules:[desired]}});
}else{
 if(!entry.response.ok||entry.payload.success===false)throw new Error('Unable to read production WAF entry point ('+entry.response.status+')');
 ruleset=entry.payload.result;
 const existing=(ruleset.rules||[]).find(rule=>rule.ref===desired.ref||rule.description===desired.description);
 if(existing){
  await api('/zones/'+zoneId+'/rulesets/'+ruleset.id+'/rules/'+existing.id,{method:'PUT',body:desired});
 }else{
  await api('/zones/'+zoneId+'/rulesets/'+ruleset.id+'/rules',{method:'POST',body:desired});
 }
}
const verified=await api('/zones/'+zoneId+'/rulesets/phases/http_request_firewall_custom/entrypoint');
const rule=(verified.rules||[]).find(row=>row.ref===desired.ref||row.description===desired.description);
if(!rule||rule.enabled===false||rule.action!=='block'||rule.expression!==expression)throw new Error('Production WAF baseline did not reconcile');
console.log(JSON.stringify({zone:'proinspect.systems',hostname,phase:'http_request_firewall_custom',baselineInstalled:true},null,2));
