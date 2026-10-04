import assert from 'node:assert/strict';

const base=(process.env.CLOUDFLARE_SMOKE_URL||'').replace(/\/$/,'');
const mode=process.env.CLOUDFLARE_EXPECT_MODE||'live';
if(!/^https:\/\//.test(base)||!['maintenance','live'].includes(mode))throw new Error('Smoke URL and expected mode are required');
async function req(path,expected,options={}){
 const response=await fetch(base+path,{redirect:'manual',...options,headers:{Origin:base,...options.headers}});
 assert.equal(response.status,expected,path+' returned '+response.status);
 return response;
}
const health=await (await req('/healthz',200)).json();
assert.equal(health.platform,'cloudflare');assert.equal(health.mode,mode);assert.match(String(health.release||''),/^[a-f0-9]{40}$/);
if(mode==='maintenance'){
 await req('/api/services',503);
 await req('/book',503);
}else{
 const services=await (await req('/api/services',200)).json();assert.ok(Array.isArray(services.services)&&services.services.length>0);
 const config=await (await req('/api/platform/config',200)).json();assert.equal(config.platform,'cloudflare');assert.equal(config.calendarProvider,'ProInspect');
 for(const page of ['/','/book','/client','/tenant','/admin']){const text=await (await req(page,200,{headers:{'Sec-Fetch-Mode':'navigate'}})).text();assert.match(text,/id="root"/);}
 for(const api of ['/api/admin/session','/api/client/session','/api/tenant/session'])await req(api,401);
}
console.log(JSON.stringify({status:'passed',base,mode,release:health.release},null,2));
