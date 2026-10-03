import { adminDb } from './platform.ts';
import { context } from './context.ts';
import { randomUUID } from 'node:crypto';
export interface BusyInterval {start:string;end:string}
export function calendarIsConfigured(){return true;}
export function getCalendarId(resource?:string){return resource||'proinspect-primary';}
function utc(value:string){const date=new Date(value);if(!Number.isFinite(date.getTime()))throw new Error('INVALID_CALENDAR_DATE');return date.toISOString();}
export async function freeBusy(params:{timeMin:string;timeMax:string;timezone:string;calendarId?:string}):Promise<BusyInterval[]>{
 const rows=await adminDb.collection('nativeCalendarEvents').where('resourceId','==',getCalendarId(params.calendarId)).where('start','<',utc(params.timeMax)).where('end','>',utc(params.timeMin)).get();
 return rows.docs.map(d=>({start:d.data().start,end:d.data().end}));
}
export async function createEvent(booking:any,resource?:string){
 const id='event_'+booking.id;const ref=adminDb.collection('nativeCalendarEvents').doc(id);const start=utc(booking.appointment.start),end=utc(booking.appointment.end);if(start>=end)throw new Error('INVALID_CALENDAR_INTERVAL');
 await adminDb.runTransaction(async tx=>{
  const existing=await tx.get(ref);if(existing.exists)return;
  const busy=await tx.get(adminDb.collection('nativeCalendarEvents').where('resourceId','==',getCalendarId(resource)).where('start','<',end).where('end','>',start));
  if(!busy.empty)throw new Error('SCHEDULE_CONFLICT');
  tx.set(ref,{id,bookingId:booking.id,resourceId:getCalendarId(resource),start,end,createdAt:new Date().toISOString()});
 });
 return {eventId:id,htmlLink:context().env.APP_URL+'/admin'};
}
export async function deleteEvent(eventId:string,_resource?:string){await adminDb.collection('nativeCalendarEvents').doc(eventId).delete();}
const escapeICS=(s:string)=>s.replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
const icsDate=(s:string)=>new Date(s).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
export function calendarInvitation(booking:any,cancelled=false){
 const uid=booking.id||randomUUID();
 return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//ProInspect//Scheduling//EN','METHOD:'+(cancelled?'CANCEL':'REQUEST'),'BEGIN:VEVENT','UID:'+escapeICS(uid)+'@proinspect.systems','DTSTAMP:'+icsDate(new Date().toISOString()),'DTSTART:'+icsDate(booking.appointment.start),'DTEND:'+icsDate(booking.appointment.end),'SUMMARY:'+escapeICS(booking.serviceName),'STATUS:'+(cancelled?'CANCELLED':'CONFIRMED'),'SEQUENCE:'+(cancelled?'1':'0'),'END:VEVENT','END:VCALENDAR',''].join('\r\n');
}
