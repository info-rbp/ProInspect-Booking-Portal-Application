import {after} from 'node:test';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {fixture} from '../cloudflare/fixture.mjs';
export const {db,binding}=fixture();
Object.assign(process.env,{NODE_ENV:'production',ACCESS_DATA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),ACCESS_DATA_ENCRYPTION_KEY_ID:'v1',APP_URL:'https://test.proinspect.systems',BOOKING_EMAIL_FROM:'bookings@proinspect.systems',STAGING_EMAIL_RECIPIENT:'controlled@example.test'});
const {app,requestContext}=await import('../../.cloudflare/api-test.mjs');
export const env={DB:binding,APP_URL:process.env.APP_URL,PLATFORM_ENVIRONMENT:'staging',STAGING_EMAIL_RECIPIENT:'controlled@example.test',ACCESS_DATA_ENCRYPTION_KEY:process.env.ACCESS_DATA_ENCRYPTION_KEY,ACCESS_DATA_ENCRYPTION_KEY_ID:'v1',BOOKING_EMAIL_FROM:process.env.BOOKING_EMAIL_FROM,FILE_SIGNING_KEY:randomBytes(32).toString('base64url'),JOBS:{send:async()=>{}},EMAIL:{send:async()=>({messageId:'test'})}};
const actors={tenant:{uid:'t-uid',email:'tenant@example.test',email_verified:true,provider:'session'},client:{uid:'c-uid',email:'client@example.test',email_verified:true,provider:'session'},admin:{uid:'staff-uid',email:'info@proinspect.systems',email_verified:true,provider:'access'},reader:{uid:'reader-uid',email:'reader@example.test',email_verified:true,provider:'access'}};
const server=createServer((req,res)=>{const identity=actors[req.headers['x-test-actor']];if(identity)req.headers.authorization='Bearer test-only';requestContext.run({env,identity,request:new Request(env.APP_URL),waitUntil(){}},()=>app(req,res));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
after(()=>new Promise(resolve=>server.close(resolve)));
export async function api(path,options={}){const {actor,body,...rest}=options;const r=await fetch(base+path,{...rest,headers:{...(actor?{'X-Test-Actor':actor}:{}),...(body?{'Content-Type':'application/json'}:{}),...rest.headers},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json().catch(()=>({}))};}
const now=new Date().toISOString(),dates={createdAt:now,updatedAt:now};
await db.collection('clients').doc('c1').set({id:'c1',name:'Agency',status:'active',...dates});
for(const id of ['p1','p2'])await db.collection('properties').doc(id).set({id,addressLine1:id+' Test St',suburb:'Ashby',postcode:'6065',state:'WA',status:'active',primaryClientId:'c1',...dates});
for(const [id,propertyId,uid,email] of [['ten1','p1','t-uid','tenant@example.test'],['ten2','p2','t2-uid','other@example.test']]){await db.collection('tenancies').doc(id).set({id,propertyId,status:'active',startDate:'2026-01-01',...dates});await db.collection('tenantUsers').doc(uid).set({id:uid,firebaseUid:uid,email,emailLower:email,active:true,tenancyIds:[id],displayName:email,...dates});}
await db.collection('clientUsers').doc('cu').set({id:'cu',firebaseUid:'c-uid',email:'client@example.test',emailLower:'client@example.test',active:true,clientIds:['c1'],clientRoles:{c1:'owner'},...dates});
await db.collection('clientMemberships').doc('cm').set({id:'cm',clientId:'c1',clientUserId:'cu',role:'owner',active:true,status:'active',...dates});
await db.collection('clientPropertyLinks').doc('link').set({id:'link',clientId:'c1',propertyId:'p1',role:'owner',active:true,...dates});
await db.collection('propertyDocuments').doc('private-doc').set({id:'private-doc',propertyId:'p2',tenancyId:'ten2',clientIds:[],audiences:['tenant'],storagePath:'test/private.pdf',category:'correspondence',status:'active',...dates});
await db.collection('sensitiveTenantForms').doc('restricted').set({id:'restricted',tenantUserId:'t2-uid',tenancyId:'ten2',propertyId:'p2',secret:'must-not-leak',...dates});
await db.collection('adminUsers').doc('reader-uid').set({id:'reader-uid',email:'reader@example.test',role:'read_only',active:true,...dates});
