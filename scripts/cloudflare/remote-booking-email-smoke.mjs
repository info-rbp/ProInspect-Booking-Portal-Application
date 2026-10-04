const base=(process.env.CLOUDFLARE_SMOKE_URL||'').replace(/\/$/,'');
const email=(process.env.CLOUDFLARE_SMOKE_EMAIL||'info@proinspect.systems').trim().toLowerCase();
if(!/^https:\/\//.test(base))throw new Error('CLOUDFLARE_SMOKE_URL is required');
if(!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email))throw new Error('Controlled smoke email is required');

async function request(path,init={}){
  const response=await fetch(base+path,{...init,redirect:'error',signal:AbortSignal.timeout(60000),headers:{Origin:base,...init.headers}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error((init.method||'GET')+' '+path.replace(/manage\/[^/]+/,'manage/[redacted]')+' failed ('+response.status+'): '+String(body.error||JSON.stringify(body)));
  return body;
}
function perthDateKey(date){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Perth',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
async function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function findSlot(serviceId){
  for(let offset=3;offset<=21;offset++){
    const date=perthDateKey(new Date(Date.now()+offset*86400000));
    const availability=await request('/api/calendar/availability?date='+encodeURIComponent(date)+'&serviceId='+encodeURIComponent(serviceId));
    if(Array.isArray(availability.slots)&&availability.slots[0])return availability.slots[0];
  }
  throw new Error('No controlled booking slot is available in the next 21 days');
}

let token='',reference='';
try{
  const services=(await request('/api/services')).services||[];
  const service=services.find(x=>x.id==='routine-inspection')||services.find(x=>Array.isArray(x.categories)&&x.categories.length)||services[0];
  if(!service)throw new Error('No public service is available');
  const category=Array.isArray(service.categories)&&service.categories.length?service.categories[0]:service.category;
  if(!category)throw new Error('Selected service has no booking category');
  const slot=await findSlot(service.id);
  const created=await request('/api/bookings/create',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      serviceId:service.id,
      serviceCategory:category,
      property:{
        streetAddress:'19 Bonnard Crescent',
        suburb:'Ashby',
        state:'WA',
        postcode:'6065',
        propertyType:'House',
        customerName:'ProInspect Cloudflare Acceptance',
        customerEmail:email,
        customerPhone:'0432432554',
        clientReference:'CF-'+Date.now()
      },
      access:{method:'meet_onsite',meetOnsite:{contactName:'ProInspect Cloudflare Acceptance',contactPhone:'0432432554',relationship:'Other',specialInstructions:'Controlled deployment acceptance booking; cancel immediately after email delivery.'}},
      appointment:{start:slot.start}
    })
  });
  reference=created.booking?.bookingReference||'';
  token=created.booking?.managementToken||'';
  if(!reference||!token)throw new Error('Booking creation did not return secure management details');

  let managed;
  for(let attempt=0;attempt<45;attempt++){
    managed=await request('/api/bookings/manage/'+encodeURIComponent(token));
    const status=managed.booking?.confirmationEmailStatus;
    if(status==='sent')break;
    if(status==='failed')throw new Error('Worker email delivery entered failed state');
    await sleep(2000);
  }
  if(managed?.booking?.confirmationEmailStatus!=='sent')throw new Error('Worker email delivery did not reach sent state');

  const cancelled=await request('/api/bookings/manage/'+encodeURIComponent(token)+'/cancel',{method:'POST'});
  if(cancelled.booking?.status!=='cancelled')throw new Error('Controlled booking cancellation failed');
  const final=await request('/api/bookings/manage/'+encodeURIComponent(token));
  if(final.booking?.status!=='cancelled')throw new Error('Controlled booking cancellation did not persist');

  console.log(JSON.stringify({status:'passed',base,bookingReference:reference,emailStatus:'sent',finalStatus:'cancelled'},null,2));
}catch(error){
  if(token){
    try{await request('/api/bookings/manage/'+encodeURIComponent(token)+'/cancel',{method:'POST'});}catch{}
  }
  console.error(JSON.stringify({status:'failed',bookingReference:reference||null,error:error instanceof Error?error.message:String(error)},null,2));
  process.exitCode=1;
}
