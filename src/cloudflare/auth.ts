import { randomUUID } from 'node:crypto';
import { context, type Bindings, type Identity } from './context.ts';
import { digest, randomToken, constantEqual } from './crypto.ts';
import { enqueueMail } from './mail.ts';

const COOKIE='__Host-proinspect-session';
const EMAIL=/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const jwksCache=new Map<string,{expires:number;keys:any[]}>();
export function normalizedEmail(value:unknown):string {
 const email=typeof value==='string'?value.trim().toLowerCase():'';
 if(email.length>254||!EMAIL.test(email))throw new Error('INVALID_EMAIL');return email;
}
export function sameOrigin(request:Request,env:Bindings):boolean {
 const expected=new URL(env.APP_URL).origin;
 return request.headers.get('Origin')===expected && new URL(request.url).origin===expected;
}
export async function checkRate(env:Bindings,key:string,max:number,period:number):Promise<boolean>{
 const start=Math.floor(Date.now()/period)*period;
 const row:any=await env.DB.prepare('INSERT INTO rate_windows(key,window_start,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_windows.window_start=excluded.window_start THEN rate_windows.count+1 ELSE 1 END,window_start=excluded.window_start RETURNING count').bind(digest(key),start).first();
 return Number(row?.count)<=max;
}
export async function verifyTurnstile(request:Request,env:Bindings,token:unknown,action:string):Promise<boolean>{
 if(typeof token!=='string'||token.length<10||token.length>2048||!env.TURNSTILE_SECRET_KEY)return false;
 const form=new FormData();form.set('secret',env.TURNSTILE_SECRET_KEY);form.set('response',token);
 const ip=request.headers.get('CF-Connecting-IP');if(ip)form.set('remoteip',ip);
 const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:form});
 const result:any=await response.json();
 return result.success===true&&result.hostname===new URL(env.APP_URL).hostname&&result.action===action;
}
export async function verifyAccess(request:Request,env:Bindings):Promise<Identity|undefined>{
 const token=request.headers.get('Cf-Access-Jwt-Assertion');if(!token)return undefined;
 const host=env.ACCESS_TEAM_DOMAIN;
 if(!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(host||'')||!env.ACCESS_AUDIENCE)throw new Error('ACCESS_NOT_CONFIGURED');
 if(token.length>16384)throw new Error('INVALID_ACCESS_ASSERTION');
 const parts=token.split('.');if(parts.length!==3)throw new Error('INVALID_ACCESS_ASSERTION');
 const header=JSON.parse(Buffer.from(parts[0],'base64url').toString()),claims=JSON.parse(Buffer.from(parts[1],'base64url').toString());
 const now=Math.floor(Date.now()/1000);
 if(header.alg!=='RS256'||typeof header.kid!=='string'||claims.iss!=='https://'+host||
    !Array.isArray(claims.aud)||!claims.aud.includes(env.ACCESS_AUDIENCE)||
    typeof claims.exp!=='number'||claims.exp<=now||
    (typeof claims.nbf==='number'&&claims.nbf>now+30)||!claims.sub)throw new Error('INVALID_ACCESS_ASSERTION');
 let cached=jwksCache.get(host);
 if(!cached||cached.expires<Date.now()||!cached.keys.some(k=>k.kid===header.kid)){
  const response=await fetch('https://'+host+'/cdn-cgi/access/certs');if(!response.ok)throw new Error('ACCESS_KEY_LOOKUP_FAILED');
  const body:any=await response.json();if(!Array.isArray(body.keys)||body.keys.length>30)throw new Error('ACCESS_KEY_LOOKUP_FAILED');
  cached={expires:Date.now()+300000,keys:body.keys};jwksCache.set(host,cached);
 }
 const jwk=cached.keys.find(k=>k.kid===header.kid&&k.kty==='RSA');if(!jwk)throw new Error('INVALID_ACCESS_ASSERTION');
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,Buffer.from(parts[2],'base64url'),Buffer.from(parts[0]+'.'+parts[1])))throw new Error('INVALID_ACCESS_ASSERTION');
 const email=normalizedEmail(claims.email);const user=await identityForEmail(env,email);
 return {uid:user.id,email,email_verified:true,name:claims.name||email,provider:'access'};
}
export async function identityForEmail(env:Bindings,email:string):Promise<any>{
 let found:any=await env.DB.prepare('SELECT * FROM auth_identities WHERE email=?').bind(email).first();if(found)return found;
 const rows:any=await env.DB.prepare("SELECT json_extract(data,'$.firebaseUid') uid FROM clientUsers WHERE lower(json_extract(data,'$.email'))=? UNION SELECT json_extract(data,'$.firebaseUid') uid FROM tenantUsers WHERE lower(json_extract(data,'$.email'))=?").bind(email,email).all();
 const uids=[...new Set(rows.results.map((r:any)=>r.uid).filter(Boolean))];
 if(uids.length>1)throw new Error('IDENTITY_RECONCILIATION_REQUIRED');
 const id=String(uids[0]||randomUUID());
 await env.DB.prepare('INSERT INTO auth_identities(id,email,created_at) VALUES(?,?,?) ON CONFLICT(email) DO NOTHING').bind(id,email,Date.now()).run();
 found=await env.DB.prepare('SELECT * FROM auth_identities WHERE email=?').bind(email).first();if(!found)throw new Error('IDENTITY_CREATE_FAILED');return found;
}
export async function sessionIdentity(request:Request,env:Bindings):Promise<Identity|undefined>{
 const token=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
 if(!token||!TOKEN.test(token))return undefined;
 const row:any=await env.DB.prepare('SELECT s.user_id,s.csrf,u.email,u.display_name FROM auth_sessions s JOIN auth_identities u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(digest(token),Date.now()).first();
 if(!row)return undefined;
 return {uid:row.user_id,email:row.email,name:row.display_name||row.email,email_verified:true,provider:'session',csrf:row.csrf};
}
export function publicIdentity(identity?:Identity){return identity?{uid:identity.uid,email:identity.email,displayName:identity.name,provider:identity.provider,csrf:identity.csrf}:null;}
export async function consumeChallenge(env:Bindings,token:string,email:string,audience:string){
 if(!TOKEN.test(token)||!['client','tenant','admin'].includes(audience))throw new Error('INVALID_SIGNIN_LINK');
 const challenge:any=await env.DB.prepare('DELETE FROM login_challenges WHERE token_hash=? AND email=? AND audience=? AND expires_at>? RETURNING email').bind(digest(token),email,audience,Date.now()).first();
 if(!challenge)throw new Error('INVALID_SIGNIN_LINK');
 const user=await identityForEmail(env,email),session=randomToken(),csrf=randomToken(),now=Date.now();
 await env.DB.prepare('INSERT INTO auth_sessions(token_hash,user_id,csrf,expires_at,created_at) VALUES(?,?,?,?,?)').bind(digest(session),user.id,csrf,now+8*3600000,now).run();
 return {identity:{uid:user.id,email,email_verified:true,name:user.display_name||email,provider:'session',csrf} as Identity,cookie:COOKIE+'='+session+'; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800'};
}
export async function authRoute(request:Request,env:Bindings,identity?:Identity):Promise<Response|undefined>{
 const path=new URL(request.url).pathname;
 if(path==='/api/auth/session'||path==='/api/admin/auth-session'){
  if(request.method!=='GET')return Response.json({error:'Method not allowed'},{status:405});
  return Response.json({user:publicIdentity(identity)});
 }
 if(!['/api/auth/request','/api/auth/consume','/api/auth/logout'].includes(path))return;
 if(request.method!=='POST'||!sameOrigin(request,env))return Response.json({error:'Origin not allowed'},{status:403});
 if(path==='/api/auth/logout'){
  if(identity?.provider==='session'&&!constantEqual(identity.csrf||'',request.headers.get('X-CSRF-Token')||''))return Response.json({error:'Invalid session request'},{status:403});
  const token=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(token)await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(digest(token)).run();
  return Response.json({ok:true},{headers:{'Set-Cookie':COOKIE+'=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'}});
 }
 const body:any=await request.json();const email=normalizedEmail(body.email),audience=body.audience;
 if(!['client','tenant','admin'].includes(audience))return Response.json({error:'Invalid portal'},{status:400});
 const ip=request.headers.get('CF-Connecting-IP')||'unknown';
 if(!await checkRate(env,'auth:'+ip,20,900000)||!await checkRate(env,'auth:'+email,6,900000))return Response.json({error:'Too many attempts'},{status:429});
 if(path==='/api/auth/consume'){
  try{const result=await consumeChallenge(env,String(body.token||''),email,audience);return Response.json({user:publicIdentity(result.identity)},{headers:{'Set-Cookie':result.cookie}});}
  catch{return Response.json({error:'This sign-in link is invalid or expired. Request another link.'},{status:401});}
 }
 if(!await verifyTurnstile(request,env,body.turnstileToken,'login'))return Response.json({error:'Complete the security check'},{status:400});
 if(audience==='tenant'){
  const tenant=await env.DB.prepare("SELECT id FROM tenantUsers WHERE lower(json_extract(data,'$.email'))=? AND json_extract(data,'$.active') IS NOT 0 LIMIT 1").bind(email).first();
  if(!tenant)return Response.json({ok:true,message:'Check your inbox if this email is eligible.'});
 }
 if(audience==='admin'){
  const configured=new Set(['info@proinspect.systems','info@remotebusinesspartner.com.au',...String(env.ADMIN_EMAILS||'').split(',').map((value:string)=>value.trim().toLowerCase()).filter(Boolean)]);
  let eligible=configured.has(email);
  if(!eligible){
   const admin=await env.DB.prepare("SELECT id FROM adminUsers WHERE lower(json_extract(data,'$.email'))=? AND json_extract(data,'$.active') IS NOT 0 LIMIT 1").bind(email).first();
   eligible=Boolean(admin);
  }
  if(!eligible)return Response.json({ok:true,message:'Check your inbox if this email is eligible.'});
 }
 const token=randomToken(),expires=Date.now()+15*60000;
 await env.DB.prepare('INSERT INTO login_challenges(token_hash,email,audience,expires_at,created_at) VALUES(?,?,?,?,?)').bind(digest(token),email,audience,expires,Date.now()).run();
 const target=audience==='tenant'?'/tenant/complete-signin':audience==='admin'?'/admin':'/client';
 const url=new URL(target,env.APP_URL);url.searchParams.set('cf_token',token);
 await enqueueMail({to:[email],subject:'Your ProInspect sign-in link',text:'Sign in to the '+audience+' portal using this one-time link. It expires in 15 minutes.\n\n'+url.href+'\n\nDo not forward this link.'});
 return Response.json({ok:true,message:'Check your inbox if this email is eligible.'});
}
