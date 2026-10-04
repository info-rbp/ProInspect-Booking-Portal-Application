import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const exact=(relative)=>path.join(root,relative);
const adapters=new Map([
 ['src/server/firebaseAdmin.ts','src/cloudflare/platform.ts'],
 ['src/server/calendar.ts','src/cloudflare/calendar.ts'],
 ['src/server/addressValidation.ts','src/cloudflare/address.ts'],
]);
const contract={sourceRoutes:0,bundledRoutes:0,adapters:Object.fromEntries(adapters)};
const plugin={name:'reviewed-platform-boundaries',setup(b){
 b.onResolve({filter:/^proinspect:app$/},()=>({path:exact('server.ts')}));
 b.onResolve({filter:/firebase-admin\/firestore$/},()=>({path:exact('src/cloudflare/database.ts')}));
 b.onResolve({filter:/firebaseAdmin\.(js|ts)$|\/calendar\.(js|ts)$|\/addressValidation\.(js|ts)$/},args=>{
  const resolved=path.resolve(args.resolveDir,args.path).replace(/\.js$/,'.ts');
  const relative=path.relative(root,resolved);return adapters.has(relative)?{path:exact(adapters.get(relative))}:null;
 });
 b.onLoad({filter:/\/server\.ts$/},async args=>{
  if(args.path!==exact('server.ts'))return;
  let content=await readFile(args.path,'utf8');contract.sourceRoutes=(content.match(/app\.(get|post|patch|put|delete)\(/g)||[]).length;
  const marker='async function startServer() {';
  if(!content.includes(marker))throw new Error('SERVER_BOUNDARY_CHANGED');
  content=content.slice(0,content.indexOf(marker))+'\nexport { app };\n';
  content=content.replace("import 'dotenv/config';",'').replace("import path from 'path';",'').replace("import { fileURLToPath } from 'url';",'').replace(/^const __filename =.*\nconst __dirname =.*\n/m,'');
  content=content.replaceAll('Google Calendar API','ProInspect scheduling').replaceAll('Google Calendar','ProInspect calendar');
  contract.bundledRoutes=(content.match(/app\.(get|post|patch|put|delete)\(/g)||[]).length;
  if(contract.sourceRoutes-contract.bundledRoutes!==1)throw new Error('Unexpected removal of API routes');
  return {contents:content,loader:'ts',resolveDir:path.dirname(args.path)};
 });
 b.onLoad({filter:/\/src\/server\/(email|tenantEmail)\.ts$/},async args=>{
  let content=await readFile(args.path,'utf8');
  content="import {mailFetch,mailIsConfigured} from '../cloudflare/mail.ts';\n"+content;
  content=content.replaceAll("fetch('https://api.resend.com/emails',","mailFetch('cloudflare:email',");
  content=content.replaceAll('process.env.RESEND_API_KEY?.trim()','(mailIsConfigured() ? "worker-binding" : "")');
  content=content.replaceAll("status: 'sent'","status: 'queued'");
  return {contents:content,loader:'ts',resolveDir:path.dirname(args.path)};
 });
}};
await mkdir('.cloudflare',{recursive:true});
// Only Node built-ins remain external. A valid virtual file URL avoids assuming
// import.meta.url is populated by the Workers runtime.
const banner={js:"import { createRequire as __createRequire } from 'node:module'; const require = __createRequire('file:///worker.mjs');"};
const result=await build({entryPoints:['src/cloudflare/worker.ts'],outfile:'.cloudflare/worker.mjs',bundle:true,format:'esm',platform:'node',target:'es2022',external:['node:*','cloudflare:*'],conditions:['workerd','worker','node'],banner,sourcemap:true,metafile:true,plugins:[plugin],define:{'process.env.NODE_ENV':'"production"'},logLevel:'info'});
const inputs=Object.keys(result.metafile.inputs);
const forbidden=inputs.filter(x=>/node_modules\/(firebase|firebase-admin|google-auth-library|@google-cloud)\//.test(x)||x.endsWith('src/server/firebaseAdmin.ts')||x.endsWith('src/server/calendar.ts'));
if(forbidden.length)throw new Error('Google dependency in Worker bundle: '+forbidden.join(','));
await writeFile('.cloudflare/bundle-audit.json',JSON.stringify({...contract,googleRuntimeInputs:forbidden,inputs:inputs.length},null,2)+'\n');
console.log('Preserved API routes:',contract.bundledRoutes,'Google runtime modules:',forbidden.length);
await build({entryPoints:['tests/cloudflare-api/entry.ts'],outfile:'.cloudflare/api-test.mjs',bundle:true,format:'esm',platform:'node',target:'es2022',packages:'external',plugins:[plugin],define:{'process.env.NODE_ENV':'"production"'},logLevel:'info'});
