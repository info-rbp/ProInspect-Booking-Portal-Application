import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeSourceFields,decodeSourceValue,sourceSnapshot} from '../../scripts/cloudflare/source-snapshot.mjs';
const project='business-plan-applicatio-17047',database='ai-studio-7242850f-c156-4268-aeb7-c8d47ff6931a';
const root='projects/'+project+'/databases/'+database+'/documents';
const readTime='2026-10-04T02:00:00.123456Z';
const options={project,database,token:'synthetic-token',collections:['services','bookings']};

test('REST source codec preserves timestamps, arrays, empty maps and nested values',()=>{
 assert.deepEqual(decodeSourceFields({z:{arrayValue:{values:[{nullValue:null},{integerValue:'12'},{booleanValue:false}]}},a:{mapValue:{}},time:{timestampValue:'2026-10-04T02:00:00.123456789Z'}}),{a:{},time:{$stage3:'timestamp',seconds:1791079200,nanoseconds:123456789},z:[null,12,false]});
 assert.deepEqual(decodeSourceValue({bytesValue:'YWJj'}),{$stage3:'bytes',value:'YWJj'});
 assert.deepEqual(decodeSourceValue({doubleValue:'NaN'}),{$stage3:'number',value:'NaN'});
 assert.deepEqual(decodeSourceValue({referenceValue:root+'/properties/p1'}),{$stage3:'reference',projectId:project,databaseId:database,path:'properties/p1'});
});
test('REST source codec refuses lossy integers, reserved maps and unknown values',()=>{
 assert.throws(()=>decodeSourceValue({integerValue:'9223372036854775807'}),/lossless/);
 assert.throws(()=>decodeSourceFields({$stage3:{stringValue:'unsafe'}}),/reserved/);
 assert.throws(()=>decodeSourceValue({unknown:123}),/Unsupported/);
 assert.throws(()=>decodeSourceValue({referenceValue:'projects/other/databases/default/documents/p/1'}),/Cross-database/);
});
test('REST snapshot uses explicit source token and one server timestamp across collections',async()=>{
 const calls=[];
 const result=await sourceSnapshot({...options,fetchImpl:async(url,init)=>{
  calls.push({url,init,body:JSON.parse(init.body)});
  const collection=JSON.parse(init.body).structuredQuery.from[0].collectionId;
  return Response.json(collection==='services'?[{document:{name:root+'/services/s1',fields:{name:{stringValue:'Inspection'}}},readTime}]:[{readTime}]);
 }});
 assert.deepEqual(result,{services:{s1:{name:'Inspection'}},bookings:{}});
 assert.equal(calls.length,2);
 assert.equal(calls[0].init.headers.Authorization,'Bearer synthetic-token');
 assert.equal(calls[1].body.readTime,readTime);
 assert.ok(calls.every(call=>call.url==='https://firestore.googleapis.com/v1/'+root+':runQuery'));
});
test('REST snapshot refuses foreign documents and permission failures',async()=>{
 await assert.rejects(sourceSnapshot({...options,project:'wrong'}),/Reviewed source/);
 await assert.rejects(sourceSnapshot({...options,fetchImpl:async()=>Response.json({error:{code:403}},{status:403})}),/HTTP 403/);
 await assert.rejects(sourceSnapshot({...options,fetchImpl:async()=>Response.json([{document:{name:root+'/private/s1',fields:{}},readTime}])}),/outside/);
});
