import { randomUUID } from 'node:crypto';
import { APPEND_ONLY, collectionName, type CollectionName } from './collections.ts';

export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{results: T[]; success?: boolean}>;
  run(): Promise<{success?: boolean; meta?: {changes?: number}}>;
}
export interface DatabaseBinding {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
}
const DELETE = Symbol.for('proinspect.delete-field');
export const FieldValue = { delete: () => DELETE };
const validId = (id: string) => {
  if (!id || id.includes('/') || id.length > 1500 || /[\x00-\x1f]/.test(id)) throw new Error('INVALID_DOCUMENT_ID');
  return id;
};
function fieldPath(field: string) {
  const parts=field.split('.');
  if(!parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p))) throw new Error('INVALID_FIELD_PATH');
  return '$.'+parts.map(p=>'"'+p+'"').join('.');
}
function dbValue(value: unknown) {
  if (value === undefined) throw new Error('UNDEFINED_QUERY_VALUE');
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return value;
}
function encode(value: unknown) {
  const json=JSON.stringify(value);
  if (!json || json.length > 1_000_000 || Array.isArray(value) || value === null || typeof value !== 'object') throw new Error('INVALID_DOCUMENT');
  return json;
}
function clone<T>(value:T):T { return value === undefined ? value : JSON.parse(JSON.stringify(value)); }

export class DocumentSnapshot {
  ref: DocumentReference; id: string; exists: boolean; version: number; private value: any;
  constructor(ref:DocumentReference, value:any, version=0) {
    this.ref=ref; this.id=ref.id; this.exists=value!==undefined; this.value=value; this.version=version;
  }
  data(): any { return clone(this.value); }
  get(field:string):any { return field.split('.').reduce((v,k)=>v?.[k],this.data()); }
}
export class QuerySnapshot {
  docs: DocumentSnapshot[]; size:number; empty:boolean;
  constructor(docs:DocumentSnapshot[]) {this.docs=docs;this.size=docs.length;this.empty=docs.length===0;}
  forEach(fn:(doc:DocumentSnapshot)=>void){this.docs.forEach(fn);}
}
type Filter={field:string;op:string;value:unknown};
export class Query {
  db:DocumentDatabase; name:CollectionName; filters:Filter[]; orders:Array<[string,string]>; max?:number;
  constructor(db:DocumentDatabase,name:CollectionName,filters:Filter[]=[],orders:Array<[string,string]>=[],max?:number){
    this.db=db;this.name=name;this.filters=filters;this.orders=orders;this.max=max;
  }
  where(field:string,op:string,value:unknown){
    fieldPath(field);
    if(!['==','!=','<','<=','>','>=','in','not-in','array-contains','array-contains-any'].includes(op)) throw new Error('UNSUPPORTED_QUERY_OPERATOR');
    return new Query(this.db,this.name,[...this.filters,{field,op,value}],this.orders,this.max);
  }
  orderBy(field:string,direction='asc'){
    fieldPath(field);if(!['asc','desc'].includes(direction))throw new Error('INVALID_SORT');
    return new Query(this.db,this.name,this.filters,[...this.orders,[field,direction]],this.max);
  }
  limit(max:number){if(!Number.isInteger(max)||max<1||max>10000)throw new Error('INVALID_LIMIT');return new Query(this.db,this.name,this.filters,this.orders,max);}
  async get():Promise<QuerySnapshot>{
    const args:unknown[]=[];const conditions:string[]=[];
    for(const {field,op,value} of this.filters){
      const path=fieldPath(field);
      if(op==='array-contains'||op==='array-contains-any'){
        const values=op==='array-contains'?[value]:value;
        if(!Array.isArray(values)||values.length>100)throw new Error('INVALID_ARRAY_FILTER');
        if(!values.length){conditions.push('0');continue;}
        conditions.push(`EXISTS(SELECT 1 FROM json_each(d.data,?) x WHERE x.value IN (${values.map(()=>'?').join(',')}))`);
        args.push(path,...values.map(dbValue));
      }else if(op==='in'||op==='not-in'){
        if(!Array.isArray(value)||value.length>100)throw new Error('INVALID_IN_FILTER');
        if(!value.length){conditions.push(op==='in'?'0':'1');continue;}
        conditions.push(`json_extract(d.data,?) ${op==='in'?'IN':'NOT IN'} (${value.map(()=>'?').join(',')})`);
        args.push(path,...value.map(dbValue));
      }else{
        const sqlOp=value===null?(op==='=='?'IS':op==='!='?'IS NOT':op):op==='=='?'=':op==='!='?'<>':op;
        conditions.push(`json_type(d.data,?) IS NOT NULL AND json_extract(d.data,?) ${sqlOp} ?`);
        args.push(path,path,dbValue(value));
      }
    }
    for(const [field] of this.orders){conditions.push('json_type(d.data,?) IS NOT NULL');args.push(fieldPath(field));}
    let sql=`SELECT d.id,d.data,v.version FROM "${this.name}" d LEFT JOIN _document_versions v ON v.collection=? AND v.id=d.id`;
    const allArgs:unknown[]=[this.name,...args];
    if(conditions.length)sql+=' WHERE '+conditions.map(s=>'('+s+')').join(' AND ');
    if(this.orders.length){sql+=' ORDER BY '+this.orders.map(([field,dir])=>{allArgs.push(fieldPath(field));return 'json_extract(d.data,?) '+dir;}).join(',')+',d.id';}
    else sql+=' ORDER BY d.id';
    sql+=' LIMIT ?';allArgs.push(this.max??10001);
    const result=await this.db.binding().prepare(sql).bind(...allArgs).all<any>();
    if(!this.max&&result.results.length>10000)throw new Error('QUERY_REQUIRES_PAGINATION');
    return new QuerySnapshot(result.results.map(row=>new DocumentSnapshot(new DocumentReference(this.db,this.name,row.id),JSON.parse(row.data),row.version)));
  }
}
export class CollectionReference extends Query {
  doc(id=randomUUID()){return new DocumentReference(this.db,this.name,validId(id));}
  async add(data:unknown){const doc=this.doc();await doc.create(data);return doc;}
}
export class DocumentReference {
  db:DocumentDatabase;name:CollectionName;id:string;path:string;
  constructor(db:DocumentDatabase,name:CollectionName,id:string){this.db=db;this.name=name;this.id=validId(id);this.path=name+'/'+id;}
  async get():Promise<DocumentSnapshot>{
    const row=await this.db.binding().prepare(`SELECT d.data,coalesce(v.version,0) version FROM (SELECT ? id) q LEFT JOIN "${this.name}" d ON d.id=q.id LEFT JOIN _document_versions v ON v.collection=? AND v.id=q.id`).bind(this.id,this.name).first<any>();
    return new DocumentSnapshot(this,row?.data===null||row?.data===undefined?undefined:JSON.parse(row.data),row?.version??0);
  }
  async set(data:unknown,options:{merge?:boolean}={}){return this.db.batch().set(this,data,options).commit();}
  async update(data:unknown){return this.db.batch().update(this,data).commit();}
  async create(data:unknown){return this.db.batch().create(this,data).commit();}
  async delete(){return this.db.batch().delete(this).commit();}
}
type Write={ref:DocumentReference;kind:'set'|'create'|'update'|'delete';data?:any;merge?:boolean};
function flatten(data:any,prefix:string[]=[],result:Array<[string,any]>=[]){
  for(const [key,value] of Object.entries(data)){
    if(value===undefined)continue;
    const parts=[...prefix,key];const path=fieldPath(parts.join('.'));
    if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length)flatten(value,parts,result);
    else result.push([path,value]);
  }
  return result;
}
export class WriteBatch {
  db:DocumentDatabase; writes:Write[]=[]; guards:Statement[]=[];
  constructor(db:DocumentDatabase){this.db=db;}
  set(ref:DocumentReference,data:unknown,options:{merge?:boolean}={}){this.writes.push({ref,kind:'set',data,merge:options.merge});return this;}
  update(ref:DocumentReference,data:unknown){this.writes.push({ref,kind:'update',data,merge:true});return this;}
  create(ref:DocumentReference,data:unknown){this.writes.push({ref,kind:'create',data});return this;}
  delete(ref:DocumentReference){this.writes.push({ref,kind:'delete'});return this;}
  protected check(sql:string,args:unknown[]){
    this.guards.push(this.db.binding().prepare('INSERT INTO _transaction_checks(id,ok) SELECT ?, CASE WHEN ('+sql+') THEN 1 ELSE 0 END').bind(randomUUID(),...args));
  }
  async commit(){
    const db=this.db.binding();const statements:Statement[]=[];
    for(const w of this.writes){
      if(w.ref.db!==this.db)throw new Error('CROSS_DATABASE_WRITE');
      if(APPEND_ONLY.has(w.ref.name)&&!['set','create'].includes(w.kind))throw new Error('APPEND_ONLY_AUDIT');
      const table='"'+w.ref.name+'"';
      if(w.kind==='delete'){statements.push(db.prepare(`DELETE FROM ${table} WHERE id=?`).bind(w.ref.id));continue;}
      if(w.kind==='update')this.check(`EXISTS(SELECT 1 FROM ${table} WHERE id=?)`,[w.ref.id]);
      if(!w.merge){
        const data=encode(w.data);
        const insert=`INSERT INTO ${table}(id,data) VALUES (?,?)`;
        statements.push(db.prepare(insert+((w.kind==='create'||APPEND_ONLY.has(w.ref.name))?'':' ON CONFLICT(id) DO UPDATE SET data=excluded.data')).bind(w.ref.id,data));
      }else{
        if(APPEND_ONLY.has(w.ref.name))throw new Error('APPEND_ONLY_AUDIT');
        encode(w.data);
        const fields:Array<[string,any]>=w.kind==='update'
          ? Object.entries(w.data).filter(([,v])=>v!==undefined).map(([k,v])=>[fieldPath(k),v])
          : flatten(w.data);
        statements.push(db.prepare(`INSERT INTO ${table}(id,data) VALUES (?, '{}') ON CONFLICT(id) DO NOTHING`).bind(w.ref.id));
        // Keep every statement below D1's parameter limit. The whole batch is atomic.
        for(let offset=0;offset<fields.length;offset+=20){
          let expr='data';const args:unknown[]=[];
          for(const [path,value] of fields.slice(offset,offset+20)){
            if(value===DELETE){expr='json_remove('+expr+',?)';args.push(path);}
            else {expr='json_set('+expr+',?,json(?))';args.push(path,JSON.stringify(value));}
          }
          statements.push(db.prepare(`UPDATE ${table} SET data=${expr} WHERE id=?`).bind(...args,w.ref.id));
        }
      }
    }
    if(!statements.length&&!this.guards.length)return [];
    return db.batch([...this.guards,...statements,db.prepare('DELETE FROM _transaction_checks')]);
  }
}
class Transaction extends WriteBatch {
  async get(ref:DocumentReference|Query):Promise<any>{
    if(this.writes.length)throw new Error('TRANSACTION_READ_AFTER_WRITE');
    if(ref instanceof DocumentReference){
      const snap=await ref.get();
      this.check('coalesce((SELECT version FROM _document_versions WHERE collection=? AND id=?),0)=?',[ref.name,ref.id,snap.version]);
      return snap;
    }
    const row=await this.db.binding().prepare('SELECT version FROM _collection_versions WHERE collection=?').bind(ref.name).first<any>();
    const snap=await ref.get();
    this.check('(SELECT version FROM _collection_versions WHERE collection=?)=?',[ref.name,row?.version??0]);
    return snap;
  }
  async getAll(...refs:DocumentReference[]){return Promise.all(refs.map(ref=>this.get(ref)));}
}
export class DocumentDatabase {
  binding:()=>DatabaseBinding;
  constructor(binding:()=>DatabaseBinding){this.binding=binding;}
  settings(_options:unknown){}
  collection(name:string){return new CollectionReference(this,collectionName(name));}
  doc(path:string){const [name,id,...rest]=path.split('/');if(rest.length)throw new Error('SUBCOLLECTION_NOT_SUPPORTED');return this.collection(name).doc(id);}
  batch(){return new WriteBatch(this);}
  async getAll(...refs:DocumentReference[]){return Promise.all(refs.map(ref=>ref.get()));}
  async runTransaction<T>(fn:(tx:Transaction)=>Promise<T>):Promise<T>{
    for(let attempt=0;attempt<5;attempt++){
      const tx=new Transaction(this);const result=await fn(tx);
      try{await tx.commit();return result;}catch(error){
        if(!/CHECK constraint failed.*ok\s*=\s*1/i.test(String(error))||attempt===4)throw error;
      }
    }
    throw new Error('TRANSACTION_RETRY_EXHAUSTED');
  }
}
