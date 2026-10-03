import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export function digest(value:string|Uint8Array){return createHash('sha256').update(value).digest('hex');}
export function randomToken(){return randomBytes(32).toString('base64url');}
export function constantEqual(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function sign(key:string,value:string){if(!key||key.length<32)throw new Error('SIGNING_KEY_REQUIRED');return createHmac('sha256',key).update(value).digest('base64url');}
function keyFor(env:any,id:string):Buffer{
 const keyring=env.ENCRYPTION_KEYS_JSON?JSON.parse(env.ENCRYPTION_KEYS_JSON):{};
 const value=keyring[id]||(id===env.ACCESS_DATA_ENCRYPTION_KEY_ID?env.ACCESS_DATA_ENCRYPTION_KEY:undefined);
 const key=Buffer.from(value||'','base64');if(key.length!==32)throw new Error('ENCRYPTION_KEY_UNAVAILABLE');return key;
}
export function seal(env:any,plain:Uint8Array,domain:string):Buffer{
 const id=env.ACCESS_DATA_ENCRYPTION_KEY_ID;if(!id||Buffer.byteLength(id)>100)throw new Error('KEY_VERSION_REQUIRED');
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keyFor(env,id),nonce);
 cipher.setAAD(Buffer.from(domain));const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
 return Buffer.concat([Buffer.from('PIE1'),Buffer.from([Buffer.byteLength(id)]),Buffer.from(id),nonce,cipher.getAuthTag(),encrypted]);
}
export function unseal(env:any,bytes:Uint8Array,domain:string):Buffer{
 const raw=Buffer.from(bytes);if(raw.length<34||raw.subarray(0,4).toString()!=='PIE1')throw new Error('INVALID_ENCRYPTED_PAYLOAD');
 const len=raw[4],id=raw.subarray(5,5+len).toString();const start=5+len;
 const decipher=createDecipheriv('aes-256-gcm',keyFor(env,id),raw.subarray(start,start+12));
 decipher.setAAD(Buffer.from(domain));decipher.setAuthTag(raw.subarray(start+12,start+28));
 return Buffer.concat([decipher.update(raw.subarray(start+28)),decipher.final()]);
}
