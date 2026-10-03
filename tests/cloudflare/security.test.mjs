import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,generateKeyPairSync,sign as rsaSign} from 'node:crypto';
import {fixture} from './fixture.mjs';
import {requestContext} from '../../src/cloudflare/context.ts';
import {seal,unseal,digest,randomToken} from '../../src/cloudflare/crypto.ts';
import {consumeChallenge,sessionIdentity,verifyAccess,sameOrigin,checkRate} from '../../src/cloudflare/auth.ts';
import {adminBucket,downloadFile} from '../../src/cloudflare/storage.ts';
import {enqueueMail,deliverMail} from '../../src/cloudflare/mail.ts';
import {DEFAULT_DOCUMENT_PRODUCTS} from '../../src/documents/defaultDocumentProducts.ts';
import {getDocumentWorkflowDefinition} from '../../src/documents/documentWorkflowDefinitions.ts';
const baseEnv=()=>({ACCESS_DATA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),ACCESS_DATA_ENCRYPTION_KEY_ID:'v1',FILE_SIGNING_KEY:randomToken(),APP_URL:'https://test.proinspect.systems',PLATFORM_ENVIRONMENT:'staging',STAGING_EMAIL_RECIPIENT:'controlled@example.test',BOOKING_EMAIL_FROM:'bookings@proinspect.systems'});
const identity={uid:'alice',email:'alice@example.test',email_verified:true,provider:'session'};
test('every public document product has a reviewed workflow across all V1 property categories',()=>{
 const active=DEFAULT_DOCUMENT_PRODUCTS.filter(product=>product.active&&product.publiclyRequestable);
 const categories=new Set(active.flatMap(product=>product.categories));
 assert.deepEqual([...categories].sort(),['commercial','residential','strata-building']);
 assert.ok(active.filter(product=>product.categories.includes('residential')).length>=17);
 assert.ok(active.filter(product=>product.categories.includes('commercial')).length>=5);
 assert.ok(active.filter(product=>product.categories.includes('strata-building')).length>=5);
 for(const product of active)assert.ok(getDocumentWorkflowDefinition(product.id),product.id+' is missing a workflow');
});

test('encrypted values authenticate domain, integrity and key version',()=>{
 const env=baseEnv(),plain=Buffer.from('sensitive evidence');const c=seal(env,plain,'file:a');assert.equal(unseal(env,c,'file:a').toString(),plain.toString());
 assert.throws(()=>unseal(env,c,'file:b'));const altered=Buffer.from(c);altered[altered.length-1]^=1;assert.throws(()=>unseal(env,altered,'file:a'));
 const next={...env,ACCESS_DATA_ENCRYPTION_KEY_ID:'v2',ACCESS_DATA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),ENCRYPTION_KEYS_JSON:JSON.stringify({v1:env.ACCESS_DATA_ENCRYPTION_KEY})};
 assert.equal(unseal(next,c,'file:a').toString(),plain.toString());
});
test('magic links are one-time, email/audience bound, and sessions are revocable',async()=>{
 const {binding}=fixture(),env={...baseEnv(),DB:binding};const token=randomToken();
 await binding.prepare('INSERT INTO login_challenges VALUES(?,?,?,?,?)').bind(digest(token),identity.email,'tenant',Date.now()+10000,Date.now()).run();
 await assert.rejects(consumeChallenge(env,token,'other@example.test','tenant'));
 await assert.rejects(consumeChallenge(env,token,identity.email,'client'));
 const result=await consumeChallenge(env,token,identity.email,'tenant');assert.match(result.cookie,/Secure; HttpOnly; SameSite=Lax/);
 await assert.rejects(consumeChallenge(env,token,identity.email,'tenant'));
 const req=new Request(env.APP_URL,{headers:{cookie:result.cookie}});assert.equal((await sessionIdentity(req,env)).email,identity.email);
 await binding.prepare('DELETE FROM auth_sessions').run();assert.equal(await sessionIdentity(req,env),undefined);
});
test('legacy linked IDs survive without trusting a supplied UID',async()=>{
 const {db,binding}=fixture(),env={...baseEnv(),DB:binding};await db.collection('tenantUsers').doc('tenant').set({email:identity.email,firebaseUid:'old-firebase-id'});
 const token=randomToken();await binding.prepare('INSERT INTO login_challenges VALUES(?,?,?,?,?)').bind(digest(token),identity.email,'tenant',Date.now()+10000,Date.now()).run();
 assert.equal((await consumeChallenge(env,token,identity.email,'tenant')).identity.uid,'old-firebase-id');
});
test('staff magic links preserve the authorised admin record identity',async()=>{
 const {db,binding}=fixture(),env={...baseEnv(),DB:binding};const email='staff@example.test';
 await db.collection('adminUsers').doc('staff-record').set({id:'staff-record',email,role:'administrator',active:true});
 const token=randomToken();await binding.prepare('INSERT INTO login_challenges VALUES(?,?,?,?,?)').bind(digest(token),email,'admin',Date.now()+10000,Date.now()).run();
 const result=await consumeChallenge(env,token,email,'admin');assert.equal(result.identity.uid,'staff-record');assert.equal(result.identity.email,email);
});
test('rate windows enforce counts and origin checks reject cross-origin',async()=>{
 const {binding}=fixture(),env={...baseEnv(),DB:binding};assert.equal(await checkRate(env,'a',2,60000),true);assert.equal(await checkRate(env,'a',2,60000),true);assert.equal(await checkRate(env,'a',2,60000),false);
 assert.equal(sameOrigin(new Request(env.APP_URL,{headers:{Origin:'https://evil.test'}}),env),false);
 assert.equal(sameOrigin(new Request(env.APP_URL,{headers:{Origin:env.APP_URL}}),env),true);
});
test('Access requires a trusted issuer, valid RSA signature and correct audience',async()=>{
 const {binding}=fixture(),env={...baseEnv(),DB:binding,ACCESS_TEAM_DOMAIN:'proinspect-test.cloudflareaccess.com',ACCESS_AUDIENCE:'staff'};
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});const jwk={...publicKey.export({format:'jwk'}),kid:'test-key'};
 const make=(claims,key=privateKey)=>{const encoded=[Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key'})).toString('base64url'),Buffer.from(JSON.stringify(claims)).toString('base64url')].join('.');return encoded+'.'+rsaSign('RSA-SHA256',Buffer.from(encoded),key).toString('base64url');};
 const claims={iss:'https://'+env.ACCESS_TEAM_DOMAIN,aud:['staff'],sub:'staff1',email:'staff@example.test',exp:Math.floor(Date.now()/1000)+60};
 const previous=global.fetch;global.fetch=async url=>{assert.equal(url,'https://'+env.ACCESS_TEAM_DOMAIN+'/cdn-cgi/access/certs');return Response.json({keys:[jwk]});};
 try{
  const request=token=>new Request(env.APP_URL,{headers:{'Cf-Access-Jwt-Assertion':token}});
  assert.equal((await verifyAccess(request(make(claims)),env)).provider,'access');
  await assert.rejects(verifyAccess(request(make({...claims,aud:['wrong']})),env));
  await assert.rejects(verifyAccess(request(make({...claims,exp:1})),env));
  await assert.rejects(verifyAccess(request(make({...claims,iss:'https://evil.test'})),env));
  const bad=make(claims).slice(0,-5)+'abcde';await assert.rejects(verifyAccess(request(bad),env));
 }finally{global.fetch=previous;}
});
function bucket(){const objects=new Map();return {objects,async put(k,b,opts){objects.set(k,{bytes:Buffer.from(b),...opts});},async get(k){const o=objects.get(k);return o?{...o,body:o.bytes,arrayBuffer:async()=>o.bytes}:null;},async delete(k){objects.delete(k);}};}
test('R2 sensitive evidence is encrypted and download links bind to identity',async()=>{
 const env={...baseEnv(),DOCUMENTS:bucket(),SENSITIVE:bucket()};const path='tenant-sensitive/forms/a/evidence.pdf';let url;
 await requestContext.run({env,identity,request:new Request(env.APP_URL),waitUntil(){}},async()=>{
  await adminBucket.file(path).save(Buffer.from('%PDF confidential'),{contentType:'application/pdf'});
  assert.equal(env.DOCUMENTS.objects.size,0);assert.equal(env.SENSITIVE.objects.get(path).bytes.includes('confidential'),false);
  url=(await adminBucket.file(path).getSignedUrl({expires:Date.now()+60000}))[0];
  assert.equal(await (await downloadFile(new Request(url))).text(),'%PDF confidential');
 });
 await requestContext.run({env,identity:{...identity,uid:'bob'},request:new Request(env.APP_URL),waitUntil(){}},async()=>{assert.equal((await downloadFile(new Request(url))).status,403);});
 await requestContext.run({env,request:new Request(env.APP_URL),waitUntil(){}},async()=>{await assert.rejects(adminBucket.file(path).getSignedUrl({expires:Date.now()+60000}));});
});
test('email queue contains no PII, staging delivery is redirected and repeated jobs are acknowledged',async()=>{
 const {binding}=fixture(),sent=[],jobs=[];const env={...baseEnv(),DB:binding,JOBS:{send:async x=>jobs.push(x)},EMAIL:{send:async x=>{sent.push(x);return {messageId:'m1'};}}};let id;
 await requestContext.run({env,identity,request:new Request(env.APP_URL),waitUntil(){}},async()=>{id=await enqueueMail({to:['customer@example.test'],subject:'private subject',text:'secret'});});
 assert.deepEqual(jobs,[{id}]);const row=await binding.prepare('SELECT encrypted_payload FROM email_outbox WHERE id=?').bind(id).first();assert.ok(!row.encrypted_payload.includes('secret'));
 await deliverMail(env,id);await deliverMail(env,id);assert.equal(sent.length,1);assert.deepEqual(sent[0].to,['controlled@example.test']);
});
