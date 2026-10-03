import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,openSync,closeSync} from 'node:fs';
import assert from 'node:assert/strict';
const env={...process.env,WRANGLER_SEND_METRICS:'false'};
delete env.CLOUDFLARE_API_TOKEN;delete env.CLOUDFLARE_ACCOUNT_ID;
execFileSync('npx',['--yes','wrangler@4.147.0','d1','migrations','apply','DB','--local'],{stdio:'inherit',env});
const log='.cloudflare/local-worker.log',fd=openSync(log,'w');
const child=spawn('npx',['--yes','wrangler@4.147.0','dev','--local','--ip','127.0.0.1','--port','8787'],{env,stdio:['ignore',fd,fd],detached:true});
const base='http://localhost:8787';let checks=0;
async function check(path,status,options){const r=await fetch(base+path,{redirect:'manual',...options});assert.equal(r.status,status,path+': '+await r.clone().text());checks++;return r;}
try{
 let ready=false;for(let i=0;i<60;i++){try{const r=await fetch(base+'/healthz');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
 assert.ok(ready,'Local Worker did not start');
 const health=await (await check('/healthz',200)).json();assert.equal(health.platform,'cloudflare');
 const catalogue=await (await check('/api/services',200)).json();assert.ok(catalogue.services.length>0,'Real catalogue must be served from D1');
 for(const path of ['/','/book','/client','/tenant']){const r=await check(path,200);assert.match(await r.text(),/id="root"/);}
 for(const path of ['/admin','/api/admin/session','/%61dmin','/api/tenant/session','/api/client/session','/_files'])await check(path,401);
 await check('/api/admin/session',401,{headers:{Authorization:'Bearer forged-identity'}});
 await check('/api/auth/request',403,{method:'POST',headers:{Origin:'https://evil.invalid','Content-Type':'application/json'},body:JSON.stringify({email:'test@example.test',audience:'client'})});
 await check('/api/bookings/create',400,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'});
 const address=await (await check('/api/address/autocomplete?input=Ashby',200)).json();assert.deepEqual(address.suggestions,[]);
 const result={status:'passed',checks,runtime:'workerd',scope:'isolated local bindings; no production resources or email delivery tested'};
 writeFileSync('.cloudflare/local-smoke.json',JSON.stringify(result,null,2)+'\n');console.log(result);
}catch(error){console.error(readFileSync(log,'utf8').slice(-16000));throw error;}
finally{try{process.kill(-child.pid,'SIGTERM');}catch{}closeSync(fd);}
