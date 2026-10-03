import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';

const phase=(process.argv[2]||'').trim();
const receiptPath=process.argv[3]||'ops/cloudflare-production-acceptance.json';
const source=(process.argv[4]||process.env.SOURCE_SHA||'').trim();
if(!['pretraffic','live'].includes(phase))throw new Error('Acceptance phase must be pretraffic or live');
if(!/^[a-f0-9]{40}$/.test(source))throw new Error('Exact source SHA required');
const receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
if(receipt.schemaVersion!==1||receipt.sourceSha!==source)throw new Error('Acceptance receipt is not bound to the exact release source');
if(String(receipt.operatorEmail||'').trim().toLowerCase()!=='info@proinspect.systems')throw new Error('Acceptance operator must be the controlled ProInspect operator');
const required={
 pretraffic:['public','client','tenant','staff','d1R2','emailQueue','reportTool','sensitiveForm2','noGoogleRuntime'],
 live:['bookingCreate','bookingEmailIcs','bookingManageCancel','documentRequest','client','tenant','staff','reportTool','sensitiveForm2','observationClear']
}[phase];
const section=receipt[phase];
if(!section||typeof section!=='object')throw new Error('Acceptance receipt section is missing');
const missing=required.filter(key=>section[key]!==true);
if(missing.length)throw new Error('Acceptance receipt is incomplete: '+missing.join(', '));
const acceptedAt=String(receipt.acceptedAt||'');
if(!acceptedAt||!Number.isFinite(Date.parse(acceptedAt)))throw new Error('Acceptance receipt requires a valid acceptedAt timestamp');
const evidence={schemaVersion:1,phase,sourceSha:source,operatorEmail:'info@proinspect.systems',acceptedAt,note:String(receipt.note||'').slice(0,1000),checks:Object.fromEntries(required.map(key=>[key,true]))};
mkdirSync('.cloudflare',{recursive:true});
writeFileSync('.cloudflare/'+phase+'-acceptance-evidence.json',JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(evidence,null,2));
