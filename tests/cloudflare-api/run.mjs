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

test('public document requests persist across residential commercial and strata workflows',async()=>{
 const baseDetails={streetAddress:'19 Bonnard Crescent',suburb:'Ashby',state:'WA',postcode:'6065',customerName:'Controlled Requester',customerEmail:'controlled@example.test',customerPhone:'0432432554'};
 const today=new Date().toISOString().slice(0,10),entry=new Date(Date.now()+8*86400000).toISOString().slice(0,10);
 const cases=[
  {documentId:'notice-proposed-entry-form-19',documentCategory:'residential',workflow:{version:1,requesterRole:'property-manager',lessors:[{id:'lessor-1',name:'Controlled Owner'}],tenants:[{id:'tenant-1',name:'Controlled Tenant'}],answers:{entryDate:entry,entryPeriod:'before-noon',entryReason:'routine-inspection',noticeDate:today,negotiationContact:'0432432554',issuedBy:'property-manager'}}},
  {documentId:'commercial-lease',documentCategory:'commercial',workflow:{version:1,requesterRole:'other',lessors:[],tenants:[],answers:{instructions:'Prepare a controlled commercial lease draft for review.'}}},
  {documentId:'strata-owner-notice',documentCategory:'strata-building',workflow:{version:1,requesterRole:'other',lessors:[],tenants:[],answers:{instructions:'Prepare a controlled strata owner notice for review.'}}}
 ];
 for(const item of cases){
  const result=await api('/api/document-requests',{method:'POST',body:{...item,details:baseDetails}});
  assert.equal(result.status,201,item.documentId+': '+JSON.stringify(result.data));
  assert.equal(result.data.request.documentCategory,item.documentCategory);
 }
 const stored=await db.collection('documentRequests').get();assert.ok(stored.size>=3);
});
test('tenant request to work order, contractor and client approval stays on the canonical graph',async()=>{
 const tenantRequest=await api('/api/tenant/requests',{actor:'tenant',method:'POST',body:{tenancyId:'ten1',requestType:'maintenance',title:'Leaking kitchen tap',details:'Tap is leaking continuously under normal use.',priority:'normal',accessPermission:true}});
 assert.equal(tenantRequest.status,201,JSON.stringify(tenantRequest.data));
 const contractor=await api('/api/admin/contractors',{actor:'admin',method:'POST',body:{name:'Controlled Plumbing',trade:'Plumbing',email:'contractor@example.test'}});
 assert.equal(contractor.status,201,JSON.stringify(contractor.data));
 const workOrder=await api('/api/admin/work-orders',{actor:'admin',method:'POST',body:{sourceType:'tenant_request',sourceId:tenantRequest.data.request.id,propertyId:'p1',clientId:'c1',tenancyId:'ten1',title:'Repair leaking kitchen tap',description:'Inspect and repair the leaking kitchen tap.',priority:'routine'}});
 assert.equal(workOrder.status,201,JSON.stringify(workOrder.data));
 const assigned=await api('/api/admin/work-orders/'+workOrder.data.workOrder.id,{actor:'admin',method:'PATCH',body:{status:'assigned',contractorId:contractor.data.contractor.id,accessNotes:'PRIVATE-WORK-ORDER-ACCESS'}});
 assert.equal(assigned.status,200,JSON.stringify(assigned.data));
 const approval=await api('/api/admin/approvals',{actor:'admin',method:'POST',body:{clientId:'c1',propertyId:'p1',clientUserId:'cu',workOrderId:workOrder.data.workOrder.id,type:'quote',title:'Approve plumbing repair',summary:'Controlled approval',amountExGst:100}});
 assert.equal(approval.status,201,JSON.stringify(approval.data));
 const response=await api('/api/client/approvals/'+approval.data.approval.id+'/respond',{actor:'client',method:'POST',body:{status:'approved'}});
 assert.equal(response.status,200,JSON.stringify(response.data));
 assert.equal((await db.collection('workOrders').doc(workOrder.data.workOrder.id).get()).data().status,'approved');
 const complete=await api('/api/admin/work-orders/'+workOrder.data.workOrder.id,{actor:'admin',method:'PATCH',body:{status:'completed',completionNotes:'Controlled completion recorded.'}});
 assert.equal(complete.status,200,JSON.stringify(complete.data));
 const inspectionStart=new Date(Date.now()+3*86400000).toISOString();
 const inspection=await api('/api/admin/tenant-inspections',{actor:'admin',method:'POST',body:{tenancyId:'ten1',propertyId:'p1',type:'routine',scheduledStart:inspectionStart}});
 assert.equal(inspection.status,201,JSON.stringify(inspection.data));
 const dashboard=await api('/api/client/dashboard',{actor:'client'});assert.equal(dashboard.status,200);
 assert.ok(dashboard.data.dashboard.workOrders.some(item=>item.id===workOrder.data.workOrder.id));
 assert.ok(dashboard.data.dashboard.inspections.some(item=>item.id===inspection.data.inspection.id));
 assert.ok(!JSON.stringify(dashboard.data).includes('PRIVATE-WORK-ORDER-ACCESS'));
 assert.ok(!JSON.stringify(dashboard.data).includes('Controlled completion recorded.'));
 const audits=await db.collection('auditEvents').where('entityId','==',workOrder.data.workOrder.id).get();assert.ok(audits.size>=2);
});
test('WA statutory workflow creates a client approval and propagates the response',async()=>{
 const created=await api('/api/tenant/forms',{actor:'tenant',method:'POST',body:{tenancyId:'ten1',formDefinitionId:'form-24-furniture-safety',payload:{furnitureDescription:'Tall bedroom cabinet',location:'Bedroom',safetyReason:'child'}}});
 assert.equal(created.status,201,JSON.stringify(created.data));assert.ok(created.data.request.clientApprovalId);
 const responded=await api('/api/client/approvals/'+created.data.request.clientApprovalId+'/respond',{actor:'client',method:'POST',body:{status:'approved'}});
 assert.equal(responded.status,200,JSON.stringify(responded.data));
 assert.equal((await db.collection('tenantFormRequests').doc(created.data.request.id).get()).data().status,'approved');
});
test('all non-sensitive WA statutory V1 workflows validate and persist',async()=>{
 const cases=[
  ['form-25-pet-request',{petType:'dog',petName:'Milo',petDescription:'Small desexed dog'}],
  ['form-26-minor-modification',{modificationType:'picture hooks',location:'Living room',description:'Install removable picture hooks'}],
  ['form-27-major-modification',{description:'Install accessibility handrail',location:'Bathroom'}],
  ['security-bond-release',{tenancyEndDate:'2026-12-31',totalBondAmount:1000,proposedDistributions:[{recipient:'tenant',amount:900},{recipient:'lessor',amount:100}]}],
  ['security-bond-variation',{changeType:'tenant_details'}],
  ['form-1-pcr-response',{sourceDocumentId:'pcr-doc',responses:[{itemId:'entry-1',agreement:'disagree',comments:'Existing mark recorded by tenant.'},{itemId:'entry-2',agreement:'agree',comments:''}]}]
 ];
 for(const [formDefinitionId,payload] of cases){
  const response=await api('/api/tenant/forms',{actor:'tenant',method:'POST',body:{tenancyId:'ten1',formDefinitionId,payload}});
  assert.equal(response.status,201,formDefinitionId+': '+JSON.stringify(response.data));
  assert.equal(response.data.request.formDefinitionId,formDefinitionId);
  assert.equal((await db.collection('tenantFormRequests').doc(response.data.request.id).get()).exists,true);
 }
});
test('restricted Form 2 evidence remains outside ordinary client and operations views',async()=>{
 const termination=new Date(Date.now()+10*86400000).toISOString().slice(0,10);
 const draft=await api('/api/tenant/forms-sensitive',{actor:'tenant',method:'POST',body:{tenancyId:'ten1',formDefinitionId:'form-2-family-violence',payload:{evidenceType:'dvo',proposedTerminationDate:termination,privateNote:'restricted-test-marker'}}});
 assert.equal(draft.status,201,JSON.stringify(draft.data));
 const evidence=await api('/api/tenant/forms-sensitive/'+draft.data.request.id+'/evidence',{actor:'tenant',method:'POST',rawBody:Buffer.from('%PDF-1.4\ncontrolled private evidence'),headers:{'Content-Type':'application/pdf','X-File-Name':'evidence.pdf'}});
 assert.equal(evidence.status,201,JSON.stringify(evidence.data));
 const submitted=await api('/api/tenant/forms-sensitive/'+draft.data.request.id+'/submit',{actor:'tenant',method:'POST',body:{}});
 assert.equal(submitted.status,200,JSON.stringify(submitted.data));
 const client=await api('/api/client/dashboard',{actor:'client'});assert.equal(client.status,200);assert.ok(!JSON.stringify(client.data).includes('restricted-test-marker'));assert.ok(!JSON.stringify(client.data).includes(draft.data.request.id));
 const ordinary=await api('/api/admin/operations',{actor:'admin'});assert.equal(ordinary.status,200);assert.ok(!JSON.stringify(ordinary.data).includes('restricted-test-marker'));
 const restricted=await api('/api/admin/sensitive-tenant-forms',{actor:'admin'});assert.equal(restricted.status,200);assert.ok(JSON.stringify(restricted.data).includes(draft.data.request.id));
});
test('Report Tool ingestion stores a verified PDF once and exposes it through canonical audiences',async()=>{
 const headers={'Content-Type':'application/pdf','X-Report-Ingest-Token':process.env.REPORT_INGEST_TOKEN,'X-Property-Id':'p1','X-Tenancy-Id':'ten1','X-Document-Title':'Controlled inspection report','X-File-Name':'controlled-report.pdf','X-Document-Category':'inspection_report','X-Document-Audiences':'client,tenant','X-Report-Source-Id':'controlled-source-1'};
 const first=await api('/api/integrations/reports',{method:'POST',rawBody:Buffer.from('%PDF-1.4\ncontrolled report'),headers});assert.equal(first.status,201,JSON.stringify(first.data));
 const second=await api('/api/integrations/reports',{method:'POST',rawBody:Buffer.from('%PDF-1.4\ncontrolled report'),headers});assert.equal(second.status,200,JSON.stringify(second.data));assert.equal(second.data.idempotent,true);
 const client=await api('/api/client/dashboard',{actor:'client'});assert.ok(JSON.stringify(client.data).includes('Controlled inspection report'));
 const tenant=await api('/api/tenant/dashboard',{actor:'tenant'});assert.ok(JSON.stringify(tenant.data).includes('Controlled inspection report'));
});
test('payment checkout creation, authenticated status updates and portal visibility share one canonical record',async()=>{
 const created=await api('/api/admin/payments',{actor:'admin',method:'POST',body:{clientId:'c1',propertyId:'p1',sourceType:'work_order',sourceId:'controlled-work-order',description:'Controlled payment',amountExGst:100,provider:'external'}});
 assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(created.data.payment.status,'payment_required');assert.match(created.data.payment.checkoutUrl,/^https:\/\/payments\.example\.test\/pay\//);assert.equal(created.data.payment.totalAmount,110);
 const webhook=await api('/api/integrations/payments/'+created.data.payment.id+'/status',{method:'POST',headers:{'X-Payment-Webhook-Token':process.env.PAYMENT_WEBHOOK_TOKEN},body:{status:'paid'}});
 assert.equal(webhook.status,200,JSON.stringify(webhook.data));assert.equal(webhook.data.payment.status,'paid');
 const client=await api('/api/client/dashboard',{actor:'client'});assert.equal(client.status,200);assert.ok(JSON.stringify(client.data).includes(created.data.payment.reference));
 const staff=await api('/api/admin/operations',{actor:'admin'});assert.equal(staff.status,200);assert.ok(JSON.stringify(staff.data).includes(created.data.payment.reference));
 const audits=await db.collection('auditEvents').where('entityId','==',created.data.payment.id).get();assert.ok(audits.size>=2);
});
