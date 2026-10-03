import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {fixture} from '../cloudflare/fixture.mjs';
const {db,binding}=fixture();
process.env.NODE_ENV='production';
process.env.ACCESS_DATA_ENCRYPTION_KEY=randomBytes(32).toString('base64');
process.env.ACCESS_DATA_ENCRYPTION_KEY_ID='v1';
process.env.APP_URL='https://test.proinspect.systems';
process.env.BOOKING_EMAIL_FROM='bookings@proinspect.systems';
process.env.STAGING_EMAIL_RECIPIENT='controlled@example.test';
const {app,requestContext}=await import('../../.cloudflare/api-test.mjs');
const env={DB:binding,APP_URL:process.env.APP_URL,PLATFORM_ENVIRONMENT:'staging',STAGING_EMAIL_RECIPIENT:'controlled@example.test',ACCESS_DATA_ENCRYPTION_KEY:process.env.ACCESS_DATA_ENCRYPTION_KEY,ACCESS_DATA_ENCRYPTION_KEY_ID:'v1',BOOKING_EMAIL_FROM:process.env.BOOKING_EMAIL_FROM,FILE_SIGNING_KEY:randomBytes(32).toString('base64url'),JOBS:{send:async()=>{}},EMAIL:{send:async()=>({messageId:'test'})}};
const actors={
 tenant:{uid:'t-uid',email:'tenant@example.test',email_verified:true,provider:'session'},
 otherTenant:{uid:'t2-uid',email:'other@example.test',email_verified:true,provider:'session'},
 client:{uid:'c-uid',email:'client@example.test',email_verified:true,provider:'session'},
 admin:{uid:'staff-uid',email:'info@proinspect.systems',email_verified:true,provider:'access'},
 reader:{uid:'reader-uid',email:'reader@example.test',email_verified:true,provider:'access'},
};
const server=createServer((req,res)=>{
 const identity=actors[req.headers['x-test-actor']];
 if(identity)req.headers.authorization='Bearer test-only';
 requestContext.run({env,identity,request:new Request(env.APP_URL),waitUntil(){}},()=>app(req,res));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
after(()=>new Promise(resolve=>server.close(resolve)));
async function api(path,options={}){
 const {actor,body,...rest}=options;const r=await fetch(base+path,{...rest,headers:{...(actor?{'X-Test-Actor':actor}:{}),...(body?{'Content-Type':'application/json'}:{}),...rest.headers},...(body?{body:JSON.stringify(body)}:{})});
 return {status:r.status,data:await r.json().catch(()=>({}))};
}
const now=new Date().toISOString();
await db.collection('clients').doc('c1').set({id:'c1',name:'Agency',status:'active',updatedAt:now,createdAt:now});
for(const id of ['p1','p2'])await db.collection('properties').doc(id).set({id,addressLine1:id+' Test St',suburb:'Ashby',postcode:'6065',state:'WA',status:'active',primaryClientId:'c1',updatedAt:now,createdAt:now});
for(const [id,propertyId,uid,email] of [['ten1','p1','t-uid','tenant@example.test'],['ten2','p2','t2-uid','other@example.test']]){
 await db.collection('tenancies').doc(id).set({id,propertyId,status:'active',startDate:'2026-01-01',updatedAt:now,createdAt:now});
 await db.collection('tenantUsers').doc(uid).set({id:uid,firebaseUid:uid,email,emailLower:email,active:true,tenancyIds:[id],displayName:email,updatedAt:now,createdAt:now});
}
await db.collection('clientUsers').doc('cu').set({id:'cu',firebaseUid:'c-uid',email:'client@example.test',emailLower:'client@example.test',active:true,clientIds:['c1'],clientRoles:{c1:'owner'},updatedAt:now,createdAt:now});
await db.collection('clientMemberships').doc('cm').set({id:'cm',clientId:'c1',clientUserId:'cu',role:'owner',active:true,status:'active',updatedAt:now,createdAt:now});
await db.collection('clientPropertyLinks').doc('link').set({id:'link',clientId:'c1',propertyId:'p1',role:'owner',active:true,updatedAt:now,createdAt:now});
await db.collection('propertyDocuments').doc('private-doc').set({id:'private-doc',propertyId:'p2',tenancyId:'ten2',clientIds:[],audiences:['tenant'],storagePath:'test/private.pdf',category:'correspondence',status:'active',updatedAt:now,createdAt:now});
await db.collection('sensitiveTenantForms').doc('restricted').set({id:'restricted',tenantUserId:'t2-uid',tenancyId:'ten2',propertyId:'p2',secret:'must-not-leak',updatedAt:now,createdAt:now});
await db.collection('adminUsers').doc('reader-uid').set({id:'reader-uid',email:'reader@example.test',role:'read_only',active:true,updatedAt:now,createdAt:now});
test('actual public API serves catalogues through D1',async()=>{
 const r=await api('/api/services');assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(r.data.services.length>10);
 const docs=await api('/api/document-products');assert.equal(docs.status,200,JSON.stringify(docs.data));
});
test('actual portal APIs deny unauthenticated callers',async()=>{
 for(const path of ['/api/admin/session','/api/client/session','/api/tenant/session'])assert.equal((await api(path)).status,401,path);
});
test('tenant dashboard is tenancy scoped and excludes other sensitive records',async()=>{
 const r=await api('/api/tenant/dashboard',{actor:'tenant'});assert.equal(r.status,200,JSON.stringify(r.data));
 assert.ok(!JSON.stringify(r.data).includes('must-not-leak'));
 assert.ok(!JSON.stringify(r.data).includes('private-doc'));
 const download=await api('/api/tenant/documents/private-doc/download',{actor:'tenant'});assert.equal(download.status,404,JSON.stringify(download.data));
});
test('client cannot download a document outside canonical property links',async()=>{
 const r=await api('/api/client/documents/private-doc/download',{actor:'client'});assert.equal(r.status,404,JSON.stringify(r.data));
});
test('staff permissions prevent read-only writes',async()=>{
 const r=await api('/api/admin/work-orders',{actor:'reader',method:'POST',body:{title:'forbidden'}});assert.equal(r.status,403,JSON.stringify(r.data));
 assert.equal((await api('/api/admin/session',{actor:'admin'})).status,200);
});
test('real booking API reserves once, persists, queues email, manages and cancels',async()=>{
 const services=(await api('/api/services')).data.services;const service=services.find(x=>x.id==='routine-inspection')||services[0];let slot;
 for(let day=3;day<15&&!slot;day++){
  const date=new Date(Date.now()+day*86400000).toISOString().slice(0,10);
  const r=await api('/api/calendar/availability?date='+date+'&serviceId='+service.id);assert.equal(r.status,200,JSON.stringify(r.data));slot=r.data.slots[0];
 }
 assert.ok(slot,'An available future slot is required');
 const payload={serviceId:service.id,serviceCategory:service.categories[0],property:{streetAddress:'19 Bonnard Crescent',suburb:'Ashby',state:'WA',postcode:'6065',propertyType:'House',customerName:'Controlled Test',customerEmail:'controlled@example.test',customerPhone:'0432432554'},access:{method:'tenant',tenant:{tenantName:'Controlled Tenant',tenantPhone:'0432432554',noticeIssued:'yes'}},appointment:{start:slot.start}};
 const created=await api('/api/bookings/create',{method:'POST',body:payload});assert.equal(created.status,201,JSON.stringify(created.data));
 const booking=created.data.booking;assert.ok(booking.managementToken);
 const duplicate=await api('/api/bookings/create',{method:'POST',body:payload});assert.equal(duplicate.status,409,JSON.stringify(duplicate.data));
 assert.equal((await db.collection('bookings').doc(booking.id).get()).exists,true);
 const mail=await binding.prepare('SELECT count(*) n FROM email_outbox').first();assert.ok(mail.n>=1);
 const managed=await api('/api/bookings/manage/'+booking.managementToken);assert.equal(managed.status,200,JSON.stringify(managed.data));
 const cancelled=await api('/api/bookings/manage/'+booking.managementToken+'/cancel',{method:'POST',body:{}});assert.equal(cancelled.status,200,JSON.stringify(cancelled.data));
 assert.equal((await db.collection('bookings').doc(booking.id).get()).data().status,'cancelled');
});
