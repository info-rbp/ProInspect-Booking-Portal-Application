import {readFileSync} from 'node:fs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
/** Test fixtures are allowed only on the isolated staging database. This does
 * not certify inbox login or public Turnstile acceptance and never runs on production. */
export async function createStagingTestSession(base){
 const resources=JSON.parse(readFileSync('.cloudflare/staging-resources.json','utf8'));
 if(resources.environment!=='staging'||resources.appUrl!==base||resources.workerName!=='proinspect-platform-staging'||!String(resources.database?.name).startsWith('proinspect-platform-staging-'))throw new Error('Isolated staging fixture target required');
 if(new URL(base).hostname!=='proinspect-platform-staging.delicate-dream-e4c9.workers.dev')throw new Error('Staging fixture hostname mismatch');
 const apiToken=process.env.CLOUDFLARE_API_TOKEN;
 if(!apiToken)throw new Error('Staging fixture credential missing');
 const endpoint='https://api.cloudflare.com/client/v4/accounts/'+resources.accountId+'/d1/database/'+resources.database.id;
 const metadataResponse=await fetch(endpoint,{headers:{Authorization:'Bearer '+apiToken}});
 const metadata=await metadataResponse.json();
 if(!metadataResponse.ok||metadata.success!==true||metadata.result?.name!==resources.database.name)throw new Error('Staging database identity could not be verified');
 const configResponse=await fetch(base+'/api/platform/config');
 const config=await configResponse.json();
 if(!configResponse.ok||config.environment!=='staging')throw new Error('Live staging runtime required for fixture');
 async function query(sql,params){
  const response=await fetch(endpoint+'/query',{method:'POST',headers:{Authorization:'Bearer '+apiToken,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});
  const body=await response.json();
  if(!response.ok||body.success!==true||body.result?.some(row=>row.success===false))throw new Error('Isolated staging fixture query failed');
  return body.result?.[0]?.results||[];
 }
 const email='ci-'+randomUUID()+'@example.test',challenge=randomBytes(32).toString('base64url'),challengeHash=hash(challenge);
 let cookie='',userId='';
 const cleanup=async()=>{
  if(cookie){const value=cookie.slice(cookie.indexOf('=')+1);await query('DELETE FROM auth_sessions WHERE token_hash=?',[hash(value)]);}
  await query('DELETE FROM login_challenges WHERE token_hash=?',[challengeHash]);
  if(userId)await query('DELETE FROM auth_identities WHERE id=? AND email=?',[userId,email]);
 };
 try{
  await query('INSERT INTO login_challenges(token_hash,email,audience,expires_at,created_at) VALUES(?,?,?,?,?)',[challengeHash,email,'client',Date.now()+120000,Date.now()]);
  const response=await fetch(base+'/api/auth/consume',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email,audience:'client',token:challenge})});
  const body=await response.json();
  cookie=(response.headers.get('set-cookie')||'').split(';')[0];userId=body.user?.uid||'';
  if(!response.ok||!cookie.startsWith('__Host-proinspect-session=')||!userId||!body.user?.csrf)throw new Error('Staging fixture session could not be established');
  return {headers:{Cookie:cookie,'X-CSRF-Token':body.user.csrf},cleanup};
 }catch(error){await cleanup();throw error;}
}
