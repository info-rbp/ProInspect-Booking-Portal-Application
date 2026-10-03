import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createImportPlan} from './migration.mjs';

const directory=process.argv[2]||'private-migration';
const token=(process.env.GOOGLE_OAUTH_ACCESS_TOKEN||'').trim();
const defaultCalendar=(process.env.GOOGLE_CALENDAR_ID||'').trim();
if(!token||!defaultCalendar)throw new Error('One-time Google Calendar migration token and default calendar ID are required');
const exportPath=directory+'/canonical-export.json';
const planPath=directory+'/d1-import-plan.json';
const data=JSON.parse(readFileSync(exportPath,'utf8'));
const collections=data.collections||{};
const services=collections.services||{},bookings=collections.bookings||{};
const resources=new Map();
resources.set('proinspect-primary',defaultCalendar);
for(const service of Object.values(services))if(service?.calendarId)resources.set(service.calendarId,service.calendarId);

const known=new Set();
for(const booking of Object.values(bookings)){
 if(booking?.calendarEventId)known.add(String(booking.calendarEventId));
}
const start=new Date();
start.setUTCDate(start.getUTCDate()-2);
const end=new Date();
end.setUTCFullYear(end.getUTCFullYear()+2);

async function events(calendarId,pageToken){
 const url=new URL('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendarId)+'/events');
 url.searchParams.set('timeMin',start.toISOString());url.searchParams.set('timeMax',end.toISOString());
 url.searchParams.set('singleEvents','true');url.searchParams.set('orderBy','startTime');url.searchParams.set('maxResults','2500');
 if(pageToken)url.searchParams.set('pageToken',pageToken);
 const response=await fetch(url,{headers:{Authorization:'Bearer '+token}});
 if(!response.ok)throw new Error('Legacy calendar read failed for a reviewed resource ('+response.status+')');
 return response.json();
}
let imported=0,skippedKnown=0,skippedInvalid=0;
for(const [resourceId,calendarId] of resources){
 let pageToken;
 do{
  const page=await events(calendarId,pageToken);
  for(const event of page.items||[]){
   if(known.has(String(event.id||''))){skippedKnown++;continue;}
   if(event.status==='cancelled')continue;
   const eventStart=event.start?.dateTime,eventEnd=event.end?.dateTime;
   if(!eventStart||!eventEnd){skippedInvalid++;continue;}
   const s=new Date(eventStart).toISOString(),e=new Date(eventEnd).toISOString();
   if(!(s<e)){skippedInvalid++;continue;}
   const hash=createHash('sha256').update(resourceId+'\0'+String(event.id||'')+'\0'+s+'\0'+e).digest('hex').slice(0,32);
   const id='legacy_busy_'+hash;
   collections.nativeCalendarEvents[id]={id,resourceId,start:s,end:e,source:'legacy-google-busy',legacyEventId:String(event.id||''),createdAt:data.capturedAt};
   imported++;
  }
  pageToken=page.nextPageToken;
 }while(pageToken);
}
const plan=createImportPlan(data);
writeFileSync(exportPath,JSON.stringify(data)+'\n',{mode:0o600});
writeFileSync(planPath,JSON.stringify(plan)+'\n',{mode:0o600});
console.log(JSON.stringify({calendarResources:resources.size,externalBusyImported:imported,knownBookingEventsSkipped:skippedKnown,nonTimedEventsSkipped:skippedInvalid,digest:plan.digest,counts:plan.counts},null,2));
