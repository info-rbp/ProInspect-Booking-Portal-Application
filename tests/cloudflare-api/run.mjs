import {test} from 'node:test';
import assert from 'node:assert/strict';
import {api,db,binding} from './setup.mjs';
test('actual public API serves catalogues through D1',async()=>{const r=await api('/api/services');assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(r.data.services.length>10);assert.equal((await api('/api/document-products')).status,200);});
test('actual portal APIs deny unauthenticated callers',async()=>{for(const path of ['/api/admin/session','/api/client/session','/api/tenant/session'])assert.equal((await api(path)).status,401,path);});
test('tenant dashboard is tenancy scoped and excludes other sensitive records',async()=>{const r=await api('/api/tenant/dashboard',{actor:'tenant'});assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(!JSON.stringify(r.data).includes('must-not-leak'));assert.ok(!JSON.stringify(r.data).includes('private-doc'));assert.equal((await api('/api/tenant/documents/private-doc/download',{actor:'tenant'})).status,404);});
test('client cannot download a document outside canonical property links',async()=>{const r=await api('/api/client/documents/private-doc/download',{actor:'client'});assert.equal(r.status,404,JSON.stringify(r.data));});
test('staff permissions prevent read-only writes',async()=>{const r=await api('/api/admin/work-orders',{actor:'reader',method:'POST',body:{title:'forbidden'}});assert.equal(r.status,403,JSON.stringify(r.data));assert.equal((await api('/api/admin/session',{actor:'admin'})).status,200);});
test('real booking API reserves once, persists, queues email, manages and cancels',async()=>{
 const services=(await api('/api/services')).data.services;const service=services.find(x=>x.id==='routine-inspection')||services[0];let slot;
 for(let day=3;day<15&&!slot;day++){const date=new Date(Date.now()+day*86400000).toISOString().slice(0,10);const r=await api('/api/calendar/availability?date='+date+'&serviceId='+service.id);assert.equal(r.status,200,JSON.stringify(r.data));slot=r.data.slots[0];}
 assert.ok(slot,'An available future slot is required');
 const payload={serviceId:service.id,serviceCategory:service.categories[0],property:{streetAddress:'19 Bonnard Crescent',suburb:'Ashby',state:'WA',postcode:'6065',propertyType:'House',customerName:'Controlled Test',customerEmail:'controlled@example.test',customerPhone:'0432432554'},access:{method:'tenant',tenant:{tenantName:'Controlled Tenant',tenantPhone:'0432432554',noticeIssued:'yes',noticeDate:new Date(Date.now()-86400000).toISOString().slice(0,10)}},appointment:{start:slot.start}};
 const created=await api('/api/bookings/create',{method:'POST',body:payload});assert.equal(created.status,201,JSON.stringify(created.data));const booking=created.data.booking;assert.ok(booking.managementToken);
 // The public API deliberately does not disclose the internal document ID.
 const stored=await db.collection('bookings').where('managementToken','==',booking.managementToken).get();assert.equal(stored.size,1);
 const duplicate=await api('/api/bookings/create',{method:'POST',body:payload});assert.equal(duplicate.status,409,JSON.stringify(duplicate.data));
 assert.ok((await binding.prepare('SELECT count(*) n FROM email_outbox').first()).n>=1);
 assert.equal((await api('/api/bookings/manage/'+booking.managementToken)).status,200);
 const cancelled=await api('/api/bookings/manage/'+booking.managementToken+'/cancel',{method:'POST',body:{}});assert.equal(cancelled.status,200,JSON.stringify(cancelled.data));assert.equal((await stored.docs[0].ref.get()).data().status,'cancelled');
});
