import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FieldValue } from '../../src/cloudflare/database.ts';
import {fixture} from './fixture.mjs';
test('canonical domains are stored separately and nested fields survive',async()=>{
 const {db}=fixture();const p=db.collection('properties').doc('p1');
 await p.set({name:'House',address:{suburb:'Ashby',postcode:'6065'},active:true});
 await p.set({address:{suburb:'Perth'},note:null},{merge:true});
 assert.deepEqual((await p.get()).data(),{name:'House',address:{suburb:'Perth',postcode:'6065'},active:true,note:null});
 await p.update({note:FieldValue.delete()});assert.equal('note' in (await p.get()).data(),false);
});
test('filters, arrays, pagination, sort and field validation',async()=>{
 const {db}=fixture();const c=db.collection('clientUsers');
 await c.doc('b').set({email:'b',clientIds:['c1','c2'],order:2,flag:true});
 await c.doc('a').set({email:'a',clientIds:['c1'],order:1,flag:false});
 await c.doc('z').set({email:'z'});
 assert.deepEqual((await c.where('clientIds','array-contains','c1').orderBy('order','desc').get()).docs.map(x=>x.id),['b','a']);
 assert.equal((await c.where('flag','==',true).get()).docs[0].id,'b');
 assert.equal((await c.where('email','in',['b','a']).orderBy('order').limit(1).get()).docs[0].id,'a');
 assert.equal((await c.where('email','in',[]).get()).size,0);
 assert.throws(()=>c.where("email'); DROP TABLE clients;--",'==','x'));
 assert.throws(()=>db.collection('unknown'));
});
test('batch failure rolls back every preceding write',async()=>{
 const {db}=fixture();await db.collection('clients').doc('existing').set({name:'existing'});
 const batch=db.batch().set(db.collection('clients').doc('new'),{name:'new'}).create(db.collection('clients').doc('existing'),{});
 await assert.rejects(batch.commit());assert.equal((await db.collection('clients').doc('new').get()).exists,false);
});
test('missing update is rejected rather than silently succeeding',async()=>{
 const {db}=fixture();await assert.rejects(db.collection('clients').doc('missing').update({name:'wrong'}));
});
test('audit events cannot be rewritten or deleted',async()=>{
 const {db}=fixture();const ref=db.collection('sensitiveAuditEvents').doc('a1');await ref.set({actor:'a',action:'read'});
 await assert.rejects(ref.set({actor:'b'}));await assert.rejects(ref.delete());assert.equal((await ref.get()).data().actor,'a');
});
test('transaction detects concurrent update and retries from fresh values',async()=>{
 const {db}=fixture();const ref=db.collection('settings').doc('counter');await ref.set({n:0});let attempts=0;
 await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(++attempts===1)await ref.set({n:10});tx.set(ref,{n:snap.data().n+1});});
 assert.equal(attempts,2);assert.equal((await ref.get()).data().n,11);
});
test('transaction detects delete/recreate ABA instead of accepting stale read',async()=>{
 const {db}=fixture();const ref=db.collection('settings').doc('counter');await ref.set({n:0});let attempts=0;
 await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(++attempts===1){await ref.delete();await ref.set({n:20});}tx.set(ref,{n:snap.data().n+1});});
 assert.equal(attempts,2);assert.equal((await ref.get()).data().n,21);
});
test('query transaction guards phantom inserts',async()=>{
 const {db}=fixture();let attempts=0;
 await db.runTransaction(async tx=>{const rows=await tx.get(db.collection('clients'));if(++attempts===1)await db.collection('clients').doc('new').set({});tx.set(db.collection('settings').doc('count'),{n:rows.size});});
 assert.equal(attempts,2);assert.equal((await db.collection('settings').doc('count').get()).data().n,1);
});
test('unique booking references and tokens enforce database invariants',async()=>{
 const {db}=fixture();await db.collection('bookings').doc('one').set({bookingReference:'PI-1',managementToken:'secret'});
 await assert.rejects(db.collection('bookings').doc('two').set({bookingReference:'PI-1'}));
 await assert.rejects(db.collection('bookings').doc('three').set({managementToken:'secret'}));
});
test('large merges stay under D1 parameter limits and update maps replace rather than merge',async()=>{
 const {db,binding}=fixture();const original=binding.prepare.bind(binding);
 binding.prepare=sql=>{const stmt=original(sql);const bind=stmt.bind;stmt.bind=(...args)=>{assert.ok(args.length<=100);return bind.apply(stmt,args);};return stmt;};
 const ref=db.collection('properties').doc('wide');const fields=Object.fromEntries(Array.from({length:100},(_,i)=>['field'+i,i]));
 await ref.set(fields,{merge:true});assert.equal(Object.keys((await ref.get()).data()).length,100);
 await ref.set({map:{a:1,b:2}});await ref.update({map:{a:3}});assert.deepEqual((await ref.get()).data(),{map:{a:3}});
 await ref.set({map:{b:4}},{merge:true});assert.deepEqual((await ref.get()).data(),{map:{a:3,b:4}});
});
