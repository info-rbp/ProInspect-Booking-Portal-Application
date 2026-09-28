/** Dedicated staging report-ingest gateway. No portal routes or database access. */
import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { GoogleAuth } from 'google-auth-library';

export function validGatewaySecret(expected: string | undefined, supplied: unknown): boolean {
  if (!expected || expected.length < 32 || typeof supplied !== 'string') return false;
  const left=Buffer.from(expected), right=Buffer.from(supplied);
  return left.length===right.length && timingSafeEqual(left,right);
}
export function validateGatewayTarget(target: string, audience: string, environment: string | undefined) {
  if(environment!=='staging') throw new Error('Report gateway is restricted to staging.');
  const url=new URL(target), aud=new URL(audience);
  if(url.protocol!=='https:' || aud.protocol!=='https:' || !url.hostname.endsWith('.run.app') || !aud.hostname.endsWith('.run.app') || url.username || aud.username || url.password || aud.password || url.search || aud.search || url.hash || aud.hash || url.pathname!=='/api/integrations/reports' || aud.pathname!=='/') throw new Error('An explicit Cloud Run report endpoint and audience are required.');
}
export function createGateway(options: {target:string; audience:string; secret:string; identityToken:()=>Promise<string>; transport?:typeof fetch}) {
  validateGatewayTarget(options.target,options.audience,process.env.PLATFORM_ENVIRONMENT);
  if(options.secret.length<32) throw new Error('A pinned report ingest secret is required.');
  const app=express(); app.disable('x-powered-by');
  app.get('/health',(_req,res)=>{res.json({ok:true,purpose:'report-ingest-gateway'});});
  app.post('/api/integrations/reports',(req,res,next)=>{
    if(!validGatewaySecret(options.secret,req.headers['x-report-ingest-token'])) {res.status(401).json({error:'Report integration authentication failed.'});return;}
    next();
  },express.raw({type:'application/pdf',limit:'20mb'}),async(req,res)=>{
    if(!Buffer.isBuffer(req.body) || req.body.subarray(0,5).toString()!=='%PDF-') {res.status(400).json({error:'A PDF report is required.'});return;}
    try {
      const headers: Record<string,string>={'Content-Type':'application/pdf','X-Report-Ingest-Token':options.secret,'X-Serverless-Authorization':'Bearer '+await options.identityToken()};
      for(const name of ['x-property-id','x-document-title','x-file-name','x-document-category','x-tenancy-id','x-booking-id','x-work-order-id','x-request-id','x-document-audiences','x-report-source-id']) {
        const value=req.headers[name]; if(typeof value==='string') headers[name]=value;
      }
      const result=await (options.transport||fetch)(options.target,{method:'POST',headers,body:new Uint8Array(req.body),redirect:'error',signal:AbortSignal.timeout(90000)});
      const data=await result.json(); res.status(result.status).json(data);
    } catch { res.status(502).json({error:'Report publication is temporarily unavailable; retry the same report source ID.'}); }
  });
  app.use((_req,res)=>{res.status(404).json({error:'Unknown report gateway route.'});});
  app.use((error: any,_req: express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(error?.status===413?413:400).json({error:'Report request rejected.'});});
  return app;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const target=process.env.CORE_REPORT_INGEST_URL||'',audience=process.env.CORE_REPORT_INGEST_AUDIENCE||'';
  const auth=new GoogleAuth();
  createGateway({target,audience,secret:process.env.REPORT_INGEST_TOKEN||'',identityToken:async()=>{
    const client=await auth.getIdTokenClient(audience); return client.idTokenProvider.fetchIdToken(audience);
  }}).listen(Number(process.env.PORT)||8080,'0.0.0.0');
}
