/** One-time, read-only migration tool. Never imported into the Worker bundle. */
import {applicationDefault,initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {mkdirSync,writeFileSync} from 'node:fs';
import {snapshot,validateSources,planningDatabase,validateIntegrity,digestOf} from '../stage3/migration-engine.js';
import {transform} from '../migrate-unified-portal.js';
import {createImportPlan} from './migration.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const i=a.indexOf('=');return [a.slice(0,i),a.slice(i+1)];}));
const project=args['--project'],database=args['--database'],out=args['--out'];
if(project!=='business-plan-applicatio-17047'||database!=='ai-studio-7242850f-c156-4268-aeb7-c8d47ff6931a'||!out)throw new Error('Reviewed ProInspect source project/database and a private output directory are required.');
const app=initializeApp({projectId:project,credential:applicationDefault()},'cloudflare-readonly-export');
try{
 const db=getFirestore(app,database),before=await snapshot(db);validateSources(before);
 const capturedAt=new Date().toISOString();const shadow=planningDatabase(before);await transform(shadow.db);validateIntegrity(shadow.data);
 const after=await snapshot(db);if(digestOf(before)!==digestOf(after))throw new Error('Source changed during export. Freeze writers before a final migration; this snapshot is rejected.');
 const normalize=(v:any):any=>{
  if(Array.isArray(v))return v.map(normalize);
  if(v&&typeof v==='object'){
   if(v.$stage3==='timestamp')return new Date(v.seconds*1000+v.nanoseconds/1e6).toISOString();
   if(v.$stage3==='date')return v.value;
   if(v.$stage3)throw new Error('A tagged source value needs an explicit conversion: '+v.$stage3);
   return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)]));
  }
  return v;
 };
 const collections:any=normalize(shadow.data);collections.nativeCalendarEvents={};
 for(const [id,b] of Object.entries(collections.bookings) as any){
  if(b.status==='cancelled'||!b.appointment?.start||!b.appointment?.end)continue;
  const service=collections.services[b.serviceId]||{};
  collections.nativeCalendarEvents['event_'+id]={id:'event_'+id,bookingId:id,resourceId:service.calendarId||'proinspect-primary',start:b.appointment.start,end:b.appointment.end,createdAt:capturedAt};
 }
 const exported={schemaVersion:1,capturedAt,source:{projectId:project,databaseId:database,sourceHash:digestOf(before)},collections};
 const plan=createImportPlan(exported);mkdirSync(out,{recursive:true,mode:0o700});
 writeFileSync(out+'/source-archive.json',JSON.stringify({capturedAt,source:before})+'\n',{mode:0o600});
 writeFileSync(out+'/canonical-export.json',JSON.stringify(exported)+'\n',{mode:0o600});
 writeFileSync(out+'/d1-import-plan.json',JSON.stringify(plan)+'\n',{mode:0o600});
 console.log(JSON.stringify({digest:plan.digest,counts:plan.counts,externalCalendarBusyImportRequired:true,objectCopyRequired:true}));
 // This does not attest writer freeze, migrate files, or approve production.
}finally{await deleteApp(app);}
