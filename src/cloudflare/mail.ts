import { randomUUID } from 'node:crypto';
import { context } from './context.ts';
import { seal, unseal } from './crypto.ts';
export async function enqueueMail(payload:any):Promise<string>{
 const {env}=context();if(!env.EMAIL||!env.JOBS)throw new Error('EMAIL_BINDING_REQUIRED');
 const copy={...payload,from:payload.from||env.BOOKING_EMAIL_FROM};
 if(env.PLATFORM_ENVIRONMENT==='staging'){
   if(!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(env.STAGING_EMAIL_RECIPIENT||''))throw new Error('STAGING_EMAIL_SINK_REQUIRED');
   copy.to=[env.STAGING_EMAIL_RECIPIENT];delete copy.cc;delete copy.bcc;
 }
 const id=randomUUID(),now=Date.now();
 const encrypted=seal(env,Buffer.from(JSON.stringify(copy)),'mail:'+id).toString('base64');
 await env.DB.prepare("INSERT INTO email_outbox(id,encrypted_payload,created_at,updated_at) VALUES(?,?,?,?)").bind(id,encrypted,now,now).run();
 await env.JOBS.send({id});return id;
}
/** Compatibility for the reviewed HTML templates. It never calls Resend. */
export async function mailFetch(_url:string,init:RequestInit):Promise<Response>{
 const payload=JSON.parse(String(init.body));const id=await enqueueMail(payload);
 return Response.json({id:'outbox:'+id,status:'queued'},{status:202});
}
export async function deliverMail(env:any,id:string):Promise<void>{
 if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('INVALID_EMAIL_JOB');
 const now=Date.now();
 const row=await env.DB.prepare("UPDATE email_outbox SET state='sending',attempts=attempts+1,lease_until=?,updated_at=? WHERE id=? AND (state='pending' OR (state='sending' AND lease_until<?)) RETURNING encrypted_payload").bind(now+180000,now,id,now).first();
 if(!row){
   const existing=await env.DB.prepare('SELECT state FROM email_outbox WHERE id=?').bind(id).first();
   if(existing?.state==='sent')return;
   throw new Error('EMAIL_JOB_NOT_READY');
 }
 try{
  const payload=JSON.parse(unseal(env,Buffer.from(row.encrypted_payload,'base64'),'mail:'+id).toString());
  const result=await env.EMAIL.send({from:payload.from,to:payload.to,subject:payload.subject,html:payload.html,text:payload.text,...(payload.reply_to?{replyTo:payload.reply_to}:{}),...(payload.attachments?{attachments:payload.attachments}:{})});
  await env.DB.prepare("UPDATE email_outbox SET state='sent',provider_id=?,lease_until=NULL,updated_at=? WHERE id=?").bind(result.messageId||result.id||id,Date.now(),id).run();
  await env.DB.prepare("UPDATE bookings SET data=json_set(data,'$.confirmationEmail.status','sent') WHERE json_extract(data,'$.confirmationEmail.providerMessageId')=?").bind('outbox:'+id).run();
 }catch(error){
  await env.DB.prepare("UPDATE email_outbox SET state='pending',lease_until=NULL,error_code='DELIVERY_FAILED',updated_at=? WHERE id=?").bind(Date.now(),id).run();
  throw new Error('EMAIL_DELIVERY_FAILED');
 }
}
export async function retryMail(env:any){
 const now=Date.now();
 const pending=await env.DB.prepare("SELECT id FROM email_outbox WHERE (state='pending' OR (state='sending' AND lease_until<?)) AND attempts<8 ORDER BY created_at LIMIT 100").bind(now).all();
 for(const row of pending.results)await env.JOBS.send({id:row.id});
 await env.DB.prepare("UPDATE email_outbox SET state='failed' WHERE attempts>=8 AND state='pending'").run();
 await env.DB.prepare("UPDATE bookings SET data=json_set(data,'$.confirmationEmail.status','sent') WHERE json_extract(data,'$.confirmationEmail.status')='queued' AND substr(json_extract(data,'$.confirmationEmail.providerMessageId'),8) IN (SELECT id FROM email_outbox WHERE state='sent')").run();
}
export function mailIsConfigured(){const {env}=context();return Boolean(env.EMAIL&&env.JOBS&&env.ACCESS_DATA_ENCRYPTION_KEY&&env.BOOKING_EMAIL_FROM);}
