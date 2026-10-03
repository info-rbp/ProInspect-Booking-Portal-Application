/** Cloudflare-backed browser sessions. No cloud credentials are exposed here. */
export interface User {uid:string;email:string;displayName?:string;photoURL?:string|null;phoneNumber?:string|null;provider:'session'|'access';getIdToken:(forceRefresh?:boolean)=>Promise<string>}
let csrf='';const listeners=new Set<{success?:(user:User)=>void;failure?:()=>void}>();
export const auth:{currentUser:User|null}={currentUser:null};
const nativeFetch=window.fetch.bind(window);
let configPromise:Promise<any>|undefined;
const config=()=>configPromise??=nativeFetch('/api/platform/config').then(async r=>{if(!r.ok)throw new Error('Application configuration is unavailable.');return r.json();});
function setUser(value:any){csrf=value?.csrf||'';auth.currentUser=value?{...value,getIdToken:async()=> 'cf-session'}:null;for(const l of listeners){if(auth.currentUser)l.success?.(auth.currentUser);else l.failure?.();}return auth.currentUser;}
export async function refreshSession(){const endpoint=location.pathname.startsWith('/admin')?'/api/admin/auth-session':'/api/auth/session';const r=await nativeFetch(endpoint,{credentials:'same-origin'});return setUser(r.ok?(await r.json()).user:null);}
export function initAuthListener(success?:(user:User)=>void,failure?:()=>void){const listener={success,failure};listeners.add(listener);void refreshSession().catch(()=>setUser(null));return ()=>{listeners.delete(listener);};}
export async function getCurrentIdToken(_forceRefresh=false){return auth.currentUser?'cf-session':null;}
export const getAdminIdToken=getCurrentIdToken;
export async function signInWithGoogle():Promise<{user:User}>{
 // Compatibility name for the existing staff UI; Cloudflare Access is the provider.
 const r=await nativeFetch('/api/admin/auth-session',{credentials:'same-origin'});const user=r.ok?(await r.json()).user:null;
 if(user?.provider==='access')return {user:setUser(user)!};
 window.location.assign('/admin');throw new Error('Continue through the protected Staff Portal.');
}
let turnstileScript:Promise<void>|undefined;
async function loadTurnstile(){
 if((window as any).turnstile)return;
 await (turnstileScript??=new Promise<void>((resolve,reject)=>{
  const s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.async=true;s.onload=()=>resolve();s.onerror=()=>{turnstileScript=undefined;reject(new Error('Security check could not load.'));};document.head.appendChild(s);
 }));
}
export async function securityCheck(action:string):Promise<string>{
 const settings=await config();if(!settings.turnstileSiteKey)throw new Error('Security verification is not configured.');await loadTurnstile();
 return new Promise((resolve,reject)=>{
  const dialog=document.createElement('dialog'),title=document.createElement('p'),holder=document.createElement('div'),close=document.createElement('button');
  title.textContent='Complete the ProInspect security check';close.textContent='Cancel';dialog.style.cssText='padding:24px;border:1px solid #aaa;border-radius:12px;max-width:95vw';
  dialog.append(title,holder,close);document.body.appendChild(dialog);dialog.showModal();let widget:any;let done=false;
  const finish=(error?:Error,token?:string)=>{if(done)return;done=true;clearTimeout(timer);if(widget!==undefined)(window as any).turnstile.remove(widget);dialog.close();dialog.remove();if(error)reject(error);else resolve(token!);};
  close.onclick=()=>finish(new Error('Security check cancelled.'));dialog.oncancel=e=>{e.preventDefault();finish(new Error('Security check cancelled.'));};
  const timer=window.setTimeout(()=>finish(new Error('Security check timed out. Try again.')),120000);
  widget=(window as any).turnstile.render(holder,{sitekey:settings.turnstileSiteKey,action,callback:(token:string)=>finish(undefined,token),'error-callback':()=>finish(new Error('Security check failed. Try again.')),'expired-callback':()=>finish(new Error('Security check expired. Try again.'))});
 });
}
// Existing API helpers continue using fetch; add security only on this origin.
window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
 const req=new Request(input,init),url=new URL(req.url,location.href);
 if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return nativeFetch(req);
 const headers=new Headers(req.headers);
 if(['POST','PUT','PATCH','DELETE'].includes(req.method)){
  if(csrf)headers.set('X-CSRF-Token',csrf);
  if(!auth.currentUser&&['/api/bookings/create','/api/document-requests'].includes(url.pathname))headers.set('X-Turnstile-Token',await securityCheck('submission'));
 }
 return nativeFetch(new Request(req,{headers,credentials:'same-origin'}));
};
export function tenantEmailLinkIsActive(){return new URLSearchParams(location.search).has('cf_token');}
export async function requestSignIn(email:string,audience:'client'|'tenant'){
 const turnstileToken=await securityCheck('login');
 const r=await nativeFetch('/api/auth/request',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({email,audience,turnstileToken})});
 const result=await r.json();if(!r.ok)throw new Error(result.error||'Unable to request sign-in.');
}
export async function sendTenantSignInLink(email:string){return requestSignIn(email,'tenant');}
export async function completeSignIn(email:string,audience:'client'|'tenant'):Promise<{user:User}>{
 const token=new URLSearchParams(location.search).get('cf_token');if(!token)throw new Error('Sign-in link missing.');
 const r=await nativeFetch('/api/auth/consume',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({email,audience,token})});
 const result=await r.json();if(!r.ok)throw new Error(result.error||'Unable to sign in.');
 const user=setUser(result.user)!;history.replaceState({},'',audience==='tenant'?'/tenant':'/client');return {user};
}
export async function completeTenantSignIn(email?:string){if(!email)throw new Error('Enter your email and select Complete Sign In.');return completeSignIn(email,'tenant');}
export async function logoutTenant(){const r=await nativeFetch('/api/auth/logout',{method:'POST',headers:{'X-CSRF-Token':csrf},credentials:'same-origin'});if(!r.ok)throw new Error('Sign-out could not be confirmed.');setUser(null);}
export async function logoutAdmin(){await logoutTenant();window.location.assign('/cdn-cgi/access/logout');}
