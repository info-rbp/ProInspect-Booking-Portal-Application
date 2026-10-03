import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';

const resources=JSON.parse(readFileSync(process.argv[2]||'.cloudflare/production-resources.json','utf8'));
const mode=process.env.CLOUDFLARE_LAUNCH_MODE||'maintenance';
const sha=(process.env.GITHUB_SHA||process.env.RELEASE_SHA||'').trim();
if(!/^[a-f0-9]{40}$/.test(sha))throw new Error('Exact release SHA is required');
if(!['maintenance','live'].includes(mode))throw new Error('Launch mode must be maintenance or live');
if(!/^[a-f0-9]{32}$/i.test(resources.accountId)||!/^[a-f0-9-]{36}$/i.test(resources.database?.id))throw new Error('Provisioned Cloudflare account/D1 identifiers are required');
if(resources.workerName!=='proinspect-platform')throw new Error('Production Worker name changed unexpectedly');
if(new URL(resources.appUrl).origin!==resources.appUrl||new URL(resources.appUrl).protocol!=='https:')throw new Error('Production APP_URL must be an HTTPS origin');

const config={
 $schema:'node_modules/wrangler/config-schema.json',
 name:resources.workerName,
 main:'.cloudflare/worker.mjs',
 account_id:resources.accountId,
 compatibility_date:'2026-10-03',
 compatibility_flags:['nodejs_compat'],
 no_bundle:true,
 workers_dev:true,
 preview_urls:false,
 assets:{directory:'./dist',binding:'ASSETS',not_found_handling:'single-page-application',run_worker_first:true},
 d1_databases:[{binding:'DB',database_name:resources.database.name,database_id:resources.database.id,migrations_dir:'migrations/cloudflare'}],
 r2_buckets:[{binding:'DOCUMENTS',bucket_name:resources.documentsBucket},{binding:'SENSITIVE',bucket_name:resources.sensitiveBucket}],
 durable_objects:{bindings:[{name:'BOOKING_COORDINATOR',class_name:'BookingCoordinator'}]},
 migrations:[{tag:'cf-v1',new_sqlite_classes:['BookingCoordinator']}],
 queues:{producers:[{binding:'JOBS',queue:resources.queue}],consumers:[{queue:resources.queue,max_batch_size:10,max_retries:8,dead_letter_queue:resources.deadLetterQueue}]},
 send_email:[{name:'EMAIL'}],
 vars:{
  APP_URL:resources.appUrl,
  PLATFORM_ENVIRONMENT:'production',
  LAUNCH_MODE:mode,
  BOOKING_EMAIL_FROM:'bookings@proinspect.systems',
  BOOKING_EMAIL_REPLY_TO:'info@proinspect.systems',
  ACCESS_DATA_ENCRYPTION_KEY_ID:'v1',
  RELEASE_SHA:sha,
  TURNSTILE_SITE_KEY:resources.turnstileSiteKey,
  ACCESS_TEAM_DOMAIN:'',
  ACCESS_AUDIENCE:'',
  ADMIN_EMAILS:'info@proinspect.systems,info@remotebusinesspartner.com.au'
 },
 observability:{enabled:true},
 triggers:{crons:['*/5 * * * *']}
};
mkdirSync('.cloudflare',{recursive:true});
writeFileSync('.cloudflare/wrangler.production.json',JSON.stringify(config,null,2)+'\n',{mode:0o600});
console.log('Prepared full Cloudflare production runtime for '+sha+' in '+mode+' mode.');
