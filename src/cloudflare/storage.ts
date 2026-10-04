import { context } from './context.ts';
import { sign, constantEqual, seal, unseal } from './crypto.ts';
function checkPath(path:string){if(!path||path.length>1000||path.startsWith('/')||path.split('/').some(x=>!x||x==='.'||x==='..')||/[\\\x00-\x1f]/.test(path))throw new Error('INVALID_STORAGE_PATH');return path;}
function target(env:any,path:string){return path.startsWith('tenant-sensitive/')?env.SENSITIVE:env.DOCUMENTS;}
export const adminBucket={
 file(storagePath:string){
  const path=checkPath(storagePath);
  return {
   async save(bytes:Uint8Array,options:any={}){
    const {env}=context();if(!bytes.byteLength||bytes.byteLength>30*1024*1024)throw new Error('FILE_SIZE_INVALID');
    const restricted=path.startsWith('tenant-sensitive/');const body=restricted?seal(env,bytes,'r2:'+path):bytes;
    await target(env,path).put(path,body,{httpMetadata:{contentType:restricted?'application/octet-stream':options.contentType,cacheControl:'private, no-store'},customMetadata:{contentType:options.contentType||'application/octet-stream',encrypted:restricted?'PIE1':'none'}});
   },
   async delete(_options:any={}){const {env}=context();await target(env,path).delete(path);},
   async getSignedUrl(options:any){
    const {env,identity}=context();if(!identity)throw new Error('AUTHENTICATION_REQUIRED');
    const expiry=Math.min(Number(options.expires),Date.now()+15*60_000);if(!Number.isFinite(expiry)||expiry<=Date.now())throw new Error('INVALID_EXPIRY');
    const value=Buffer.from(path).toString('base64url');const signature=sign(env.FILE_SIGNING_KEY,[value,identity.uid,expiry].join('\n'));
    const query=new URLSearchParams({p:value,u:identity.uid,e:String(expiry),s:signature});
    return [env.APP_URL+'/_files?'+query];
   }
  };
 }
};
export async function downloadFile(request:Request):Promise<Response>{
 const {env,identity}=context();if(!identity)return new Response('Authentication required',{status:401});
 const q=new URL(request.url).searchParams;const value=q.get('p')||'',uid=q.get('u')||'',expiry=Number(q.get('e'));
 if(uid!==identity.uid||!Number.isFinite(expiry)||expiry<Date.now()||expiry>Date.now()+15*60_000)return new Response('Link expired',{status:403});
 const expected=sign(env.FILE_SIGNING_KEY,[value,uid,expiry].join('\n'));
 if(!constantEqual(expected,q.get('s')||''))return new Response('Invalid link',{status:403});
 const path=checkPath(Buffer.from(value,'base64url').toString());const object=await target(env,path).get(path);
 if(!object)return new Response('File not found',{status:404});
 const metadata=object.customMetadata||{};
 const bytes=metadata.encrypted==='PIE1'?unseal(env,new Uint8Array(await object.arrayBuffer()),'r2:'+path):object.body;
 const fileName=path.split('/').pop()!.replace(/[^A-Za-z0-9._-]/g,'_').slice(0,120);
 return new Response(bytes as any,{headers:{'Content-Type':metadata.contentType||'application/octet-stream','Content-Disposition':`attachment; filename="${fileName}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
