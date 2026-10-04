import assert from 'node:assert/strict';

const base=(process.env.CLOUDFLARE_SMOKE_URL||'').replace(/\/$/,'');
const mode=process.env.CLOUDFLARE_EXPECT_MODE||'live';
const source=(process.env.SOURCE_SHA||process.env.RELEASE_SHA||'').trim();
if(!/^https:\/\//.test(base)||!['maintenance','live'].includes(mode)||!/^[a-f0-9]{40}$/.test(source))throw new Error('Smoke URL, mode and exact expected source SHA are required');
async function req(path,expected,options={}){
 const response=await fetch(base+path,{redirect:'manual',signal:AbortSignal.timeout(15000),...options,headers:{Origin:base,'Cache-Control':'no-cache',...options.headers}});
 assert.equal(response.status,expected,path+' returned '+response.status);
 return response;
}
let health;
// A successful upload may briefly leave the preceding version at an edge.
// Never accept that older version as evidence for the new source.
for(let attempt=0;attempt<30;attempt++){
 try{
  const candidate=await (await req('/healthz?release='+source,200)).json();
  if(candidate.platform==='cloudflare'&&candidate.mode===mode&&candidate.release===source){health=candidate;break;}
 }catch{}
 if(attempt<29)await new Promise(resolve=>setTimeout(resolve,2000));
}
assert.ok(health,'The exact expected Worker source and mode did not become available');
if(mode==='maintenance'){
 await req('/api/services',503);
 await req('/book',503);
}else{
 const services=await (await req('/api/services',200)).json();assert.ok(Array.isArray(services.services)&&services.services.length>0);
 const config=await (await req('/api/platform/config',200)).json();assert.equal(config.platform,'cloudflare');assert.equal(config.calendarProvider,'ProInspect');
 for(const page of ['/','/book','/client','/tenant','/admin']){const text=await (await req(page,200,{headers:{'Sec-Fetch-Mode':'navigate'}})).text();assert.match(text,/id="root"/);}
 for(const api of ['/api/admin/session','/api/client/session','/api/tenant/session'])await req(api,401);
}
console.log(JSON.stringify({status:'passed',base,mode,release:health.release,exactSourceVerified:true},null,2));
