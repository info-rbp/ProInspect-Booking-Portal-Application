import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
export function configure(d,sha){
 if(!['staging','production'].includes(d.environment)||!/^[a-f0-9]{32}$/.test(d.accountId)||!/^[a-f0-9-]{36}$/.test(d.databaseId)||/^0{8}-/.test(d.databaseId))throw new Error('Real account and isolated D1 IDs are required');
 if(!/^[a-f0-9]{40}$/.test(sha))throw new Error('Exact release commit required');
 if(!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(d.accessTeamDomain)||!d.accessAudience||/REPLACE/.test(JSON.stringify(d)))throw new Error('Complete Cloudflare environment configuration required');
 if(new URL(d.appUrl).protocol!=='https:'||new URL(d.appUrl).origin!==d.appUrl)throw new Error('HTTPS origin required');
 if(d.environment==='staging'&&new URL(d.appUrl).hostname==='bookings.proinspect.systems')throw new Error('Staging cannot use the live hostname');
 for(const key of ['workerName','documentsBucket','sensitiveBucket','queue','deadLetterQueue'])if(!/^[a-z0-9-]+$/.test(d[key]||'')||!d[key].includes(d.environment))throw new Error('Explicit environment isolation required: '+key);
 if(d.documentsBucket===d.sensitiveBucket||d.queue===d.deadLetterQueue)throw new Error('Separate sensitive storage and dead-letter resources required');
 if(!d.emailSendingVerified)throw new Error('Cloudflare Email Sending onboarding and controlled delivery must be verified first');
 if(!d.turnstileSiteKey)throw new Error('Turnstile site key required');
 const base=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
 return {...base,name:d.workerName,main:path.resolve('.cloudflare/worker.mjs'),account_id:d.accountId,workers_dev:true,
  assets:{...base.assets,directory:path.resolve('dist')},
  d1_databases:[{binding:'DB',database_name:d.workerName,database_id:d.databaseId,migrations_dir:path.resolve('migrations/cloudflare')}],
  r2_buckets:[{binding:'DOCUMENTS',bucket_name:d.documentsBucket},{binding:'SENSITIVE',bucket_name:d.sensitiveBucket}],
  queues:{producers:[{binding:'JOBS',queue:d.queue}],consumers:[{queue:d.queue,max_batch_size:10,max_retries:8,dead_letter_queue:d.deadLetterQueue}]},
  vars:{...base.vars,APP_URL:d.appUrl,PLATFORM_ENVIRONMENT:d.environment,LAUNCH_MODE:'preview',ACCESS_TEAM_DOMAIN:d.accessTeamDomain,ACCESS_AUDIENCE:d.accessAudience,TURNSTILE_SITE_KEY:d.turnstileSiteKey,STAGING_EMAIL_RECIPIENT:d.stagingEmailRecipient||'',RELEASE_SHA:sha}
 };
}
if(process.argv[1]?.endsWith('configure.mjs')){
 const input=process.argv[2];if(!input)throw new Error('Usage: node scripts/cloudflare/configure.mjs private-descriptor.json');
 const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const result=configure(JSON.parse(readFileSync(input,'utf8')),sha);mkdirSync('.cloudflare',{recursive:true});
 writeFileSync('.cloudflare/wrangler.deploy.json',JSON.stringify(result,null,2)+'\n');console.log('Prepared protected '+result.vars.PLATFORM_ENVIRONMENT+' preview for '+sha);
}
