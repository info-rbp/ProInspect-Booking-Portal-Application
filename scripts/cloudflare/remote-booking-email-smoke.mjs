import {createStagingTestSession} from './staging-test-session.mjs';
const base=(process.env.CLOUDFLARE_SMOKE_URL||'').replace(/\/$/,'');
const email=(process.env.CLOUDFLARE_SMOKE_EMAIL||'info@proinspect.systems').trim().toLowerCase();
if(!/^https:\/\//.test(base))throw new Error('CLOUDFLARE_SMOKE_URL is required');
if(!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email))throw new Error('Controlled smoke email is required');
let session,headers={},authentication='',delivery;
async function rawRequest(path,init={}){
 const response=await fetch(base+path,{...init,redirect:'error',signal:AbortSignal.timeout(60000),headers:{Origin:base,...headers,...init.headers}});
 if(!response.ok)throw new Error((init.method||'GET')+' '+path.replace(/manage\/[^/]+/,'manage/[redacted]')+' failed ('+response.status+')');
 return response;
}
async function request(path,init={}){return (await rawRequest(path,init)).json();}
function perthDateKey(date){return new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Perth',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
async function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function findSlot(serviceId){
 for(let offset=3;offset<=21;offset++){
  const date=perthDateKey(new Date(Date.now()+offset*86400000));
  const availability=await request('/api/calendar/availability?date='+encodeURIComponent(date)+'&serviceId='+encodeURIComponent(serviceId));
  if(Array.isArray(availability.slots)&&availability.slots[0])return availability.slots[0];
 }
 throw new Error('No controlled booking slot is available in the next 21 days');
}
let token='',reference='',cleanupStatus='not-required';
try{
 const config=await request('/api/platform/config');
 if(config.environment==='staging'){
  session=await createStagingTestSession(base);headers=session.headers;authentication='isolated-unprivileged-staging-fixture';
 }else{
  const cookie=(process.env.CLOUDFLARE_SMOKE_SESSION_COOKIE||'').trim(),csrf=(process.env.CLOUDFLARE_SMOKE_CSRF||'').trim();
  const turnstile=(process.env.CLOUDFLARE_SMOKE_TURNSTILE_TOKEN||'').trim();
  if(cookie&&csrf){
   if(!/^__Host-proinspect-session=[A-Za-z0-9_-]{43}$/.test(cookie))throw new Error('Valid operator session required');
   headers={Cookie:cookie,'X-CSRF-Token':csrf};authentication='operator-session';
  }else if(turnstile){headers={'X-Turnstile-Token':turnstile};authentication='public-turnstile';}
  else throw new Error('Production smoke requires a real operator session or Turnstile token; no production test identity is manufactured.');
 }
 const services=(await request('/api/services')).services||[];
 const service=services.find(x=>x.id==='routine-inspection')||services.find(x=>Array.isArray(x.categories)&&x.categories.length)||services[0];
 if(!service)throw new Error('No public service is available');
 const category=Array.isArray(service.categories)&&service.categories.length?service.categories[0]:service.category;
 if(!category)throw new Error('Selected service has no booking category');
 const slot=await findSlot(service.id);
 const created=await request('/api/bookings/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
  serviceId:service.id,serviceCategory:category,
  property:{streetAddress:'19 Bonnard Crescent',suburb:'Ashby',state:'WA',postcode:'6065',propertyType:'House',customerName:'ProInspect Cloudflare Acceptance',customerEmail:email,customerPhone:'0432432554',clientReference:'CF-'+Date.now()},
  access:{method:'meet_onsite',meetOnsite:{contactName:'ProInspect Cloudflare Acceptance',contactPhone:'0432432554',relationship:'Other',specialInstructions:'Controlled deployment acceptance booking; cancel immediately after email delivery.'}},
  appointment:{start:slot.start}
 })});
 reference=created.booking?.bookingReference||'';token=created.booking?.managementToken||'';
 if(!reference||!token)throw new Error('Booking creation did not return secure management details');
 const ics=await (await rawRequest('/api/bookings/manage/'+encodeURIComponent(token)+'/calendar')).text();
 if(!ics.includes('BEGIN:VCALENDAR')||!ics.includes('BEGIN:VEVENT'))throw new Error('Booking calendar invitation is invalid');
 let sent=false;
 for(let attempt=0;attempt<24;attempt++){
  if(session){
   delivery=await session.mailStatus(reference);
   if(delivery.state==='sent'){sent=true;break;}
   if(delivery.state==='failed'||['E_SENDER_NOT_VERIFIED','E_SENDER_DOMAIN_NOT_AVAILABLE','E_RECIPIENT_NOT_ALLOWED','E_VALIDATION_ERROR','E_FIELD_MISSING'].includes(delivery.code))throw new Error('Native email delivery blocked: '+delivery.code);
  }else{
   const managed=await request('/api/bookings/manage/'+encodeURIComponent(token));
   if(managed.booking?.confirmationEmailStatus==='sent'){sent=true;break;}
   if(managed.booking?.confirmationEmailStatus==='failed')throw new Error('Worker email delivery entered failed state');
  }
  await sleep(8000);
 }
 if(!sent)throw new Error('Worker email delivery did not reach provider-accepted state');
 const managed=await request('/api/bookings/manage/'+encodeURIComponent(token));
 if(managed.booking?.confirmationEmailStatus!=='sent')throw new Error('Provider acceptance was not reflected in the booking API');
 const cancelled=await request('/api/bookings/manage/'+encodeURIComponent(token)+'/cancel',{method:'POST'});
 if(cancelled.booking?.status!=='cancelled')throw new Error('Controlled booking cancellation failed');
 const final=await request('/api/bookings/manage/'+encodeURIComponent(token));
 if(final.booking?.status!=='cancelled')throw new Error('Controlled booking cancellation did not persist');
 cleanupStatus='cancelled';
 console.log(JSON.stringify({status:'passed',base,bookingReference:reference,authentication,emailProviderAccepted:true,inboxDeliveryVerified:false,publicTurnstileVerified:authentication==='public-turnstile',calendarInvitationVerified:true,finalStatus:'cancelled'},null,2));
}catch(error){
 if(token){try{await request('/api/bookings/manage/'+encodeURIComponent(token)+'/cancel',{method:'POST'});cleanupStatus='cancelled';}catch{cleanupStatus='failed-needs-review';}}
 console.error(JSON.stringify({status:'failed',bookingReference:reference||null,cleanupStatus,delivery,error:error instanceof Error?error.message:String(error)},null,2));process.exitCode=1;
}finally{
 if(session){try{await session.cleanup();}catch{console.error('Staging fixture cleanup failed; review isolated auth records.');process.exitCode=1;}}
}
