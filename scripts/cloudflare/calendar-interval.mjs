function localMidnight(date,timeZone){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!timeZone)throw new Error('All-day events require a valid date and calendar timezone');
 const desired=Date.parse(date+'T00:00:00Z');
 if(!Number.isFinite(desired)||new Date(desired).toISOString().slice(0,10)!==date)throw new Error('Invalid all-day date');
 const formatter=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 let candidate=desired;
 for(let attempt=0;attempt<5;attempt++){
  const p=Object.fromEntries(formatter.formatToParts(new Date(candidate)).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
  const rendered=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
  const delta=desired-rendered;
  if(delta===0)return new Date(candidate).toISOString();
  candidate+=delta;
 }
 throw new Error('All-day timezone conversion is ambiguous; explicit review is required');
}
export function calendarInterval(event,calendarTimeZone){
 if(event.status==='cancelled'||event.transparency==='transparent')return null;
 let start,end,allDay=false;
 if(event.start?.dateTime&&event.end?.dateTime){
  const a=Date.parse(event.start.dateTime),b=Date.parse(event.end.dateTime);
  if(!Number.isFinite(a)||!Number.isFinite(b))throw new Error('Invalid timed calendar interval');
  start=new Date(a).toISOString();end=new Date(b).toISOString();
 }else if(event.start?.date&&event.end?.date){
  start=localMidnight(event.start.date,event.start.timeZone||calendarTimeZone);
  end=localMidnight(event.end.date,event.end.timeZone||calendarTimeZone);allDay=true;
 }else throw new Error('Busy calendar event has no complete supported interval');
 if(!(start<end))throw new Error('Busy calendar interval must end after it starts');
 return {start,end,allDay};
}
