const PROJECT='business-plan-applicatio-17047';
const DATABASE='ai-studio-7242850f-c156-4268-aeb7-c8d47ff6931a';
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);

/** Decode Firestore REST Values into the migration engine's lossless codec. */
export function decodeSourceValue(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1)throw new Error('Invalid Firestore Value in source export');
 if(own(value,'nullValue'))return null;
 if(own(value,'booleanValue')){if(typeof value.booleanValue!=='boolean')throw new Error('Invalid boolean');return value.booleanValue;}
 if(own(value,'stringValue')){if(typeof value.stringValue!=='string')throw new Error('Invalid string');return value.stringValue;}
 if(own(value,'integerValue')){
  const text=String(value.integerValue);if(!/^-?\d+$/.test(text))throw new Error('Invalid source integer');
  const number=Number(text);if(!Number.isSafeInteger(number))throw new Error('Source integer exceeds lossless JavaScript range; explicit conversion required');
  return number;
 }
 if(own(value,'doubleValue')){
  const number=Number(value.doubleValue);
  if(!Number.isFinite(number)){
   if(!['NaN','Infinity','-Infinity'].includes(String(value.doubleValue)))throw new Error('Invalid source double');
   return {$stage3:'number',value:String(value.doubleValue)};
  }
  return number;
 }
 if(own(value,'timestampValue')){
  const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value.timestampValue);
  if(!match)throw new Error('Unsupported source timestamp representation');
  const seconds=Date.parse(match[1]+'Z')/1000;
  if(!Number.isSafeInteger(seconds))throw new Error('Invalid source timestamp');
  return {$stage3:'timestamp',seconds,nanoseconds:Number((match[2]||'').padEnd(9,'0'))};
 }
 if(own(value,'bytesValue'))return {$stage3:'bytes',value:value.bytesValue};
 if(own(value,'geoPointValue'))return {$stage3:'geopoint',latitude:value.geoPointValue.latitude,longitude:value.geoPointValue.longitude};
 if(own(value,'referenceValue')){
  const match=/^projects\/([^/]+)\/databases\/([^/]+)\/documents\/(.+)$/.exec(value.referenceValue);
  if(!match||match[1]!==PROJECT||match[2]!==DATABASE)throw new Error('Cross-database source reference requires explicit review');
  return {$stage3:'reference',projectId:match[1],databaseId:match[2],path:match[3]};
 }
 if(own(value,'arrayValue'))return (value.arrayValue.values||[]).map(decodeSourceValue);
 if(own(value,'mapValue'))return decodeSourceFields(value.mapValue.fields||{});
 throw new Error('Unsupported Firestore source type');
}
export function decodeSourceFields(fields){
 if(!fields||typeof fields!=='object'||Array.isArray(fields)||own(fields,'$stage3'))throw new Error('Invalid or reserved source map');
 return Object.fromEntries(Object.keys(fields).sort().map(key=>[key,decodeSourceValue(fields[key])]));
}

/** Reads only the supplied approved collections at one server read timestamp.
 * No SDK default credentials, writes, IAM changes or source data logging. */
export async function sourceSnapshot({project,database,token,collections,fetchImpl=fetch}){
 if(project!==PROJECT||database!==DATABASE||!token)throw new Error('Reviewed source and explicit migration token required');
 if(!Array.isArray(collections)||!collections.length||new Set(collections).size!==collections.length||collections.some(name=>!/^\w+$/.test(name)))throw new Error('Explicit unique source collections required');
 const root='projects/'+project+'/databases/'+database+'/documents';
 const endpoint='https://firestore.googleapis.com/v1/'+root+':runQuery';
 const output={};let total=0,readTime='';
 for(const collection of collections){
  const documents={};let cursor='';
  for(;;){
   const limit=Math.min(500,20001-total);
   const body={structuredQuery:{from:[{collectionId:collection}],orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit,...(cursor?{startAt:{values:[{referenceValue:cursor}],before:false}}:{})},...(readTime?{readTime}:{})};
   const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
   const rows=await response.json().catch(()=>null);
   if(!response.ok||!Array.isArray(rows)||rows.some(row=>row.error))throw new Error('Source snapshot read failed for '+collection+' (HTTP '+response.status+'); no writes made');
   const serverReadTime=[...rows].reverse().find(row=>row.readTime)?.readTime;
   if(!readTime){
    if(!serverReadTime||!Number.isFinite(Date.parse(serverReadTime)))throw new Error('Source snapshot did not return a valid server read timestamp');
    readTime=serverReadTime;
   }
   const found=rows.filter(row=>row.document).map(row=>row.document);
   for(const document of found){
    const prefix=root+'/'+collection+'/';
    if(!document.name?.startsWith(prefix))throw new Error('Source returned a document outside the reviewed collection');
    const id=document.name.slice(prefix.length);
    if(!id||id.includes('/')||own(documents,id))throw new Error('Duplicate or invalid source document');
    total++;if(total>20000)throw new Error('Snapshot exceeds 20,000 documents; no writes made');
    Object.defineProperty(documents,id,{value:decodeSourceFields(document.fields||{}),enumerable:true,configurable:true});
   }
   if(found.length<limit)break;
   const next=found.at(-1)?.name;
   if(!next||next===cursor)throw new Error('Source pagination made no progress');
   cursor=next;
  }
  output[collection]=documents;
 }
 console.log(JSON.stringify({check:'source-snapshot',collections:collections.length,documents:total,readTime,readOnly:true}));
 return output;
}
