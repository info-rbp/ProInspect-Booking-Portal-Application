import { httpServerHandler } from 'cloudflare:node';
import { app } from 'proinspect:app';
import { requestContext, type Bindings } from './context.ts';
import { authRoute, checkRate, sameOrigin, sessionIdentity, verifyAccess, verifyTurnstile } from './auth.ts';
import { constantEqual } from './crypto.ts';
import { downloadFile } from './storage.ts';
import { deliverMail, retryMail } from './mail.ts';
import { calendarInvitation } from './calendar.ts';
import { adminDb } from './platform.ts';

app.listen(3000);
const handler=httpServerHandler({port:3000});
const WRITE=new Set(['POST','PUT','PATCH','DELETE']);
function apiError(message:string,status:number){return Response.json({error:message},{status});}
function security(response:Response,path:string):Response {
 const h=new Headers(response.headers);
 h.set('X-Content-Type-Options','nosniff');h.set('Referrer-Policy','no-referrer');
 h.set('X-Frame-Options','DENY');h.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 h.set('Strict-Transport-Security','max-age=31536000; includeSubDomains');
 h.set('Content-Security-Policy',"default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
 if(path.startsWith('/api')||path==='/_files'||path.startsWith('/manage'))h.set('Cache-Control','private, no-store');
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h});
}
function pathName(request:Request){
 const path=decodeURIComponent(new URL(request.url).pathname).toLowerCase();
 if(path.includes('\\')||path.includes('\0')||path.includes('//'))throw new Error('INVALID_PATH');return path.replace(/\/+$/,'')||'/';
}
async function readBodyBounded(request:Request,max:number){
 if(Number(request.headers.get('Content-Length')||0)>max)throw new Error('BODY_TOO_LARGE');
 if(!request.body)return new Uint8Array();
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new Error('BODY_TOO_LARGE');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes;
}
export async function dispatch(request:Request,env:Bindings,ctx:any):Promise<Response>{
 let path='/';
 try {
  path=pathName(request);
  if(path==='/healthz')return security(Response.json({ok:true,platform:'cloudflare',release:env.RELEASE_SHA||'development',mode:env.LAUNCH_MODE}),path);
  if(env.LAUNCH_MODE==='maintenance')return security(apiError('ProInspect is undergoing maintenance.',503),path);
  if(!['preview','live'].includes(env.LAUNCH_MODE))return security(apiError('Application not configured.',503),path);
  if(new URL(request.url).origin!==new URL(env.APP_URL).origin)return security(apiError('Unrecognized application origin',403),path);
  const access=await verifyAccess(request,env);
  if(env.LAUNCH_MODE==='preview'&&!access)return security(apiError('This preview requires Cloudflare Access.',401),path);
  const session=await sessionIdentity(request,env);
  const identity=access||session;
  if(path.startsWith('/api/admin')&&!identity)return security(apiError('Staff authentication required.',401),path);
  const payload=WRITE.has(request.method)?await readBodyBounded(request,path.includes('/attachments')||path.includes('/documents')||path==='/api/integrations/reports'?30*1024*1024:256*1024):undefined;
  const headers=new Headers(request.headers);
  headers.delete('Authorization');headers.delete('X-ProInspect-Identity');
  if(identity)headers.set('Authorization','Bearer cf-session');
  const normalized=new Request(request.url,{method:request.method,headers,...(payload?{body:payload}:{}),redirect:'manual'});
  return await requestContext.run({env,request:normalized,identity,waitUntil:p=>ctx.waitUntil(p)},async()=>{
   const auth=await authRoute(normalized,env,identity);if(auth)return security(auth,path);
   if(path==='/api/platform/config')return security(Response.json({platform:'cloudflare',turnstileSiteKey:env.TURNSTILE_SITE_KEY,addressEntry:'manual',calendarProvider:'ProInspect',environment:env.PLATFORM_ENVIRONMENT}),path);
   if(path==='/_files')return security(await downloadFile(normalized),path);
   if(path.startsWith('/api/')){
    const ip=request.headers.get('CF-Connecting-IP')||'unknown';
    if(!await checkRate(env,'api:'+ip,WRITE.has(request.method)?90:600,60000))return security(apiError('Rate limit exceeded',429),path);
    if(WRITE.has(request.method)&&!path.startsWith('/api/integrations/')){
     if(!sameOrigin(normalized,env))return security(apiError('Origin not allowed',403),path);
     if(identity?.provider==='session'&&!constantEqual(identity.csrf||'',request.headers.get('X-CSRF-Token')||''))return security(apiError('Invalid session request',403),path);
     if(!identity&&(path==='/api/bookings/create'||path==='/api/document-requests')){
      if(!await verifyTurnstile(normalized,env,request.headers.get('X-Turnstile-Token'),'submission'))return security(apiError('Complete the security check',400),path);
     }
    }
    const match=path.match(/^\/api\/bookings\/manage\/(pi_[a-z0-9_-]{24,})\/calendar$/i);
    if(match&&request.method==='GET'){
     const token=new URL(request.url).pathname.split('/')[4];
     const rows=await adminDb.collection('bookings').where('managementToken','==',token).limit(1).get();
     if(rows.empty)return security(apiError('Booking not found',404),path);
     const b=rows.docs[0].data();return security(new Response(calendarInvitation(b,b.status==='cancelled'),{headers:{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'attachment; filename="proinspect-appointment.ics"'}}),path);
    }
    return security(await handler.fetch(normalized,env,ctx),path);
   }
   if(path==='/signin')return Response.redirect(new URL('/client',env.APP_URL).href,302);
   return security(await env.ASSETS.fetch(normalized),path);
  });
 }catch(error){
  const message=error instanceof Error?error.message:'';
  const status=message==='BODY_TOO_LARGE'?413:message.includes('ACCESS')?401:503;
  console.error('PLATFORM_REQUEST_FAILED',{code:status,path:path.slice(0,100).replace(/pi_[\w-]+/g,'[token]')});
  return security(apiError(status===413?'Request too large':'The operation could not be completed safely.',status),path);
 }
}
export class BookingCoordinator {
 env:Bindings;ctx:any;tail:Promise<any>=Promise.resolve();
 constructor(ctx:any,env:Bindings){this.ctx=ctx;this.env=env;}
 fetch(request:Request){const work=this.tail.then(()=>dispatch(request,this.env,this.ctx));this.tail=work.catch(()=>{});return work;}
}
export default {
 async fetch(request:Request,env:Bindings,ctx:any){
  const path=new URL(request.url).pathname.toLowerCase();
  if(WRITE.has(request.method)&&(path.startsWith('/api/bookings/')||path.startsWith('/api/admin/bookings'))){
   if(!env.BOOKING_COORDINATOR)return apiError('Scheduling not configured',503);
   return env.BOOKING_COORDINATOR.get(env.BOOKING_COORDINATOR.idFromName('scheduling-v1')).fetch(request);
  }
  return dispatch(request,env,ctx);
 },
 async queue(batch:any,env:Bindings){for(const m of batch.messages){try{await deliverMail(env,m.body.id);m.ack();}catch{m.retry({delaySeconds:60});}}},
 async scheduled(_event:any,env:Bindings,ctx:any){ctx.waitUntil((async()=>{
  await retryMail(env);
  await env.DB.batch([
   env.DB.prepare('DELETE FROM login_challenges WHERE expires_at<?').bind(Date.now()),
   env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at<?').bind(Date.now()),
   env.DB.prepare('DELETE FROM rate_windows WHERE window_start<?').bind(Date.now()-86400000)
  ]);
 })());}
};
