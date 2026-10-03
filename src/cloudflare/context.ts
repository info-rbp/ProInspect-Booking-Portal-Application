import { AsyncLocalStorage } from 'node:async_hooks';
import type { DatabaseBinding } from './database.ts';
export interface Identity { uid:string; email:string; email_verified:true; name?:string; provider:'session'|'access'; csrf?:string }
export interface Bindings {
 DB: DatabaseBinding; DOCUMENTS:any; SENSITIVE:any; JOBS:any; BOOKING_COORDINATOR:any; ASSETS:any; EMAIL:any;
 APP_URL:string; PLATFORM_ENVIRONMENT:'staging'|'production'; LAUNCH_MODE:'preview'|'maintenance'|'live';
 ACCESS_TEAM_DOMAIN:string; ACCESS_AUDIENCE:string; TURNSTILE_SITE_KEY:string; TURNSTILE_SECRET_KEY:string;
 ACCESS_DATA_ENCRYPTION_KEY:string; ACCESS_DATA_ENCRYPTION_KEY_ID:string; ENCRYPTION_KEYS_JSON?:string;
 FILE_SIGNING_KEY:string; BOOKING_EMAIL_FROM:string; BOOKING_EMAIL_REPLY_TO?:string; STAGING_EMAIL_RECIPIENT?:string;
 REPORT_INGEST_TOKEN:string; REPORT_HANDOFF_SIGNING_KEY:string; PAYMENT_WEBHOOK_TOKEN?:string; RELEASE_SHA:string;
 [key:string]:any;
}
export interface RequestContext {env:Bindings;request:Request;identity?:Identity;waitUntil:(p:Promise<unknown>)=>void}
export const requestContext=new AsyncLocalStorage<RequestContext>();
export function context():RequestContext {const value=requestContext.getStore();if(!value)throw new Error('REQUEST_CONTEXT_REQUIRED');return value;}
