import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createImportPlan} from './migration.mjs';
import {calendarInterval} from './calendar-interval.mjs';

const directory=process.argv[2]||'private-migration';
const defaultCalendar=(process.env.GOOGLE_CALENDAR_ID||'').trim();
if(!defaultCalendar)throw new Error('The reviewed legacy calendar ID is required');
const exportPath=directory+'/canonical-export.json',planPath=directory+'/d1-import-plan.json';
const data=JSON.parse(readFileSync(exportPath,'utf8'));
if(data.source?.projectId!=='business-plan-applicatio-17047')throw new Error('Reviewed source project required for Calendar import');
const principal='proinspect-booking-runtime@business-plan-applicatio-17047.iam.gserviceaccount.com';
let token=(process.env.GOOGLE_CALENDAR_ACCESS_TOKEN||'').trim();
if(!token){
 let baseToken;
 try{baseToken=execFileSync('gcloud',['auth','print-access-token','--project=business-plan-applicatio-17047'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}).trim();}
 catch{throw new Error('Unable to obtain the authorized migration-controller token');}
 const response=await fetch('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'+principal+':generateAccessToken',{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+baseToken,'Content-Type':'application/json'},body:JSON.stringify({scope:['https://www.googleapis.com/auth/calendar.readonly'],lifetime:'900s'})});
 const result=await response.json().catch(()=>({}));
 if(!response.ok||!result.accessToken)throw new Error('Read-only Calendar token mint failed (HTTP '+response.status+')');
 token=result.accessToken;baseToken='';
}
const collections=data.collections||{};
const services=collections.services||{},bookings=collections.bookings||{};
const resources=new Map();resources.set('proinspect-primary',defaultCalendar);
for(const service of Object.values(services))if(service?.calendarId)resources.set(service.calendarId,service.calendarId);
const known=new Set();
for(const booking of Object.values(bookings))if(booking?.calendarEventId)known.add(String(booking.calendarEventId));
const start=new Date();start.setUTCDate(start.getUTCDate()-2);
const end=new Date();end.setUTCFullYear(end.getUTCFullYear()+2);
async function events(calendarId,pageToken){
 const url=new URL('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendarId)+'/events');
 url.searchParams.set('timeMin',start.toISOString());url.searchParams.set('timeMax',end.toISOString());
 url.searchParams.set('singleEvents','true');url.searchParams.set('orderBy','startTime');url.searchParams.set('maxResults','2500');
 if(pageToken)url.searchParams.set('pageToken',pageToken);
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+token}});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok){
  const reason=String(payload.error?.errors?.[0]?.reason||'unknown').replace(/[^A-Za-z_]/g,'').slice(0,80);
  throw new Error('Legacy calendar read failed (HTTP '+response.status+', reason '+reason+'); source event access remains required');
 }
 return payload;
}
let imported=0,allDayImported=0,skippedKnown=0,skippedFree=0;
for(const [resourceId,calendarId] of resources){
 let pageToken;
 do{
  const page=await events(calendarId,pageToken);
  for(const event of page.items||[]){
   if(known.has(String(event.id||''))){skippedKnown++;continue;}
   const interval=calendarInterval(event,page.timeZone);
   if(!interval){skippedFree++;continue;}
   const {start:s,end:e,allDay}=interval;
   const hash=createHash('sha256').update(resourceId+'\0'+String(event.id||'')+'\0'+s+'\0'+e).digest('hex').slice(0,32);
   const id='legacy_busy_'+hash;
   collections.nativeCalendarEvents[id]={id,resourceId,start:s,end:e,source:'legacy-google-busy',legacyEventId:String(event.id||''),createdAt:data.capturedAt};
   imported++;if(allDay)allDayImported++;
  }
  pageToken=page.nextPageToken;
 }while(pageToken);
}
const plan=createImportPlan(data);
writeFileSync(exportPath,JSON.stringify(data)+'\n',{mode:0o600});
writeFileSync(planPath,JSON.stringify(plan)+'\n',{mode:0o600});
console.log(JSON.stringify({calendarResources:resources.size,externalBusyImported:imported,allDayImported,knownBookingEventsSkipped:skippedKnown,cancelledOrTransparentSkipped:skippedFree,digest:plan.digest,counts:plan.counts},null,2));
