import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {DocumentDatabase} from '../../src/cloudflare/database.ts';
export function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../../migrations/cloudflare/0001_platform.sql',import.meta.url),'utf8'));
 const binding={
  prepare(sql){
   const statement=sqlite.prepare(sql);let args=[];
   return {bind(...values){args=values;return this;},async first(){return statement.get(...args)??null;},async all(){return {success:true,results:statement.all(...args)};},async run(){const r=statement.run(...args);return {success:true,meta:{changes:Number(r.changes)}};}};
  },
  async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}
 };
 return {db:new DocumentDatabase(()=>binding),binding,sqlite};
}
