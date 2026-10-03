import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';

const phase=(process.argv[2]||'').trim();
const resourcesPath=process.argv[3]||'.cloudflare/production-resources.json';
if(!['pre-migration','post-migration'].includes(phase))throw new Error('Bookmark phase must be pre-migration or post-migration');
const resources=JSON.parse(readFileSync(resourcesPath,'utf8'));
const token=(process.env.CLOUDFLARE_API_TOKEN||'').trim();
if(!token)throw new Error('CLOUDFLARE_API_TOKEN is required');
if(!/^[a-f0-9]{32}$/i.test(resources.accountId)||!/^[a-f0-9-]{36}$/i.test(resources.database?.id))throw new Error('Production Cloudflare resource descriptor is invalid');
const url='https://api.cloudflare.com/client/v4/accounts/'+resources.accountId+'/d1/database/'+resources.database.id+'/time_travel/bookmark';
const response=await fetch(url,{headers:{Authorization:'Bearer '+token}});
const payload=await response.json().catch(()=>({}));
if(!response.ok||payload.success!==true||!payload.result?.bookmark)throw new Error('Unable to capture D1 Time Travel bookmark ('+response.status+')');
const evidence={schemaVersion:1,phase,databaseName:resources.database.name,databaseId:resources.database.id,bookmark:String(payload.result.bookmark),sourceSha:process.env.SOURCE_SHA||process.env.GITHUB_SHA||'',capturedAt:new Date().toISOString()};
mkdirSync('.cloudflare',{recursive:true});
writeFileSync('.cloudflare/d1-'+phase+'-bookmark.json',JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({phase,databaseName:evidence.databaseName,bookmarkCaptured:true,capturedAt:evidence.capturedAt},null,2));
