declare module 'cloudflare:node' {
 export function httpServerHandler(options:{port:number}):{fetch:(request:Request,env:any,ctx:any)=>Promise<Response>};
}
declare module 'proinspect:app' {
 import type {Express} from 'express';
 export const app:Express;
}
