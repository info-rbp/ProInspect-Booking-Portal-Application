/** Legacy module boundary, backed exclusively by Cloudflare bindings. */
import { context } from './context.ts';
import { DocumentDatabase } from './database.ts';
export { adminBucket } from './storage.ts';
export const adminDb=new DocumentDatabase(()=>context().env.DB);
export const adminAuth={async verifyIdToken(_legacyHeader:string,_checkRevoked=true){
 const identity=context().identity;if(!identity)throw new Error('AUTHENTICATION_REQUIRED');return identity;
}};
export function getFirebaseRuntimeInfo(){return {provider:'cloudflare',database:'D1',storage:'R2',credentialMode:'worker-bindings'};}
