/** No Firebase, Calendar, email, storage or seeding code is loaded here. */
import { createServer } from 'node:http';
const server=createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.url==='/healthz') {
    res.setHeader('Content-Type','application/json');
    res.writeHead(200);
    return res.end(JSON.stringify({ok:true,maintenance:true,revision:process.env.K_REVISION,
      sourceSha:process.env.PRODUCTION_SOURCE_SHA,releaseId:process.env.PRODUCTION_RELEASE_ID}));
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Retry-After','60');
  res.writeHead(503);
  res.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>ProInspect update</title><main><h1>ProInspect is being updated</h1><p>Bookings and portal access are temporarily paused. Please try again shortly.</p></main></html>');
});
server.listen(Number(process.env.PORT || 8080),'0.0.0.0');
