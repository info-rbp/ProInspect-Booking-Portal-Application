import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {calendarInterval} from '../../scripts/cloudflare/calendar-interval.mjs';

test('migration library does not execute its CLI when imported by apply-production-migration',()=>{
 const module=new URL('../../scripts/cloudflare/migration.mjs',import.meta.url).href;
 const script="process.argv=['node','/tmp/apply-production-migration.mjs','NOT_AN_EXPORT','NOT_AN_OUTPUT'];await import("+JSON.stringify(module)+");console.log('import-only');";
 const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),'import-only');
});
test('all-day Calendar blocks preserve Perth local boundaries',()=>{
 assert.deepEqual(calendarInterval({start:{date:'2026-10-04'},end:{date:'2026-10-05'}},'Australia/Perth'),{start:'2026-10-03T16:00:00.000Z',end:'2026-10-04T16:00:00.000Z',allDay:true});
});
test('all-day Calendar blocks handle daylight-saving boundary changes',()=>{
 const interval=calendarInterval({start:{date:'2026-10-04'},end:{date:'2026-10-05'}},'Australia/Sydney');
 assert.equal((Date.parse(interval.end)-Date.parse(interval.start))/3600000,23);
 assert.equal(interval.start,'2026-10-03T14:00:00.000Z');assert.equal(interval.end,'2026-10-04T13:00:00.000Z');
});
test('cancelled and transparent events do not block; malformed busy events stop migration',()=>{
 assert.equal(calendarInterval({status:'cancelled'}),null);
 assert.equal(calendarInterval({transparency:'transparent'}),null);
 assert.throws(()=>calendarInterval({start:{date:'2026-02-30'},end:{date:'2026-03-02'}},'Australia/Perth'),/Invalid/);
 assert.throws(()=>calendarInterval({start:{date:'2026-10-04'},end:{date:'2026-10-05'}}),/timezone/);
 assert.throws(()=>calendarInterval({start:{},end:{}}),/complete/);
 assert.deepEqual(calendarInterval({start:{dateTime:'2026-10-04T10:00:00+08:00'},end:{dateTime:'2026-10-04T11:00:00+08:00'}}),{start:'2026-10-04T02:00:00.000Z',end:'2026-10-04T03:00:00.000Z',allDay:false});
});
test('production control source, acceptance receipt and protected environment remain explicit',()=>{
 const workflow=readFileSync(new URL('../../.github/workflows/cloudflare-production.yml',import.meta.url),'utf8');
 assert.match(workflow,/environment: production/);
 assert.match(workflow,/require\('cloudflare\/staging-rehearsal'\)/);
 assert.match(workflow,/staging\.get\('sourceSha'\)!=source/);
 assert.match(workflow,/ref: \$\{\{ github\.sha \}\}\n\s+path: \.control/);
 assert.match(workflow,/validate-acceptance\.mjs pretraffic \.control\/ops\/cloudflare-production-acceptance\.json/);
 assert.match(workflow,/validate-acceptance\.mjs live \.control\/ops\/cloudflare-production-acceptance\.json/);
 assert.match(workflow,/--data-binary @\/tmp\/phase-failure\.json/);
 const blocks=[...workflow.matchAll(/^\s+python3 - <<'PY'[^\n]*\n([\s\S]*?)^\s+PY$/gm)];
 assert.ok(blocks.length>=4);
 for(const match of blocks){
  const child=spawnSync('python3',['-c','import ast,sys;ast.parse(sys.stdin.read())'],{input:match[1].replace(/^          /gm,''),encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
 }
});
test('remote smoke cannot accept an older deployed release',()=>{
 const source=readFileSync(new URL('../../scripts/cloudflare/remote-smoke.mjs',import.meta.url),'utf8');
 assert.match(source,/candidate\.release===source/);
 assert.match(source,/exactSourceVerified:true/);
 assert.match(source,/SOURCE_SHA\|\|process\.env\.RELEASE_SHA/);
});
