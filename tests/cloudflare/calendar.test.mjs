import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {requestContext} from '../../src/cloudflare/context.ts';
import {createEvent,freeBusy,deleteEvent} from '../../src/cloudflare/calendar.ts';
test('native scheduling normalizes offsets and prevents overlapping bookings',async()=>{
 const {binding}=fixture();
 await requestContext.run({env:{DB:binding,APP_URL:'https://test.example'},request:new Request('https://test.example'),waitUntil(){}},async()=>{
  await createEvent({id:'one',appointment:{start:'2026-10-05T09:00:00+08:00',end:'2026-10-05T10:00:00+08:00'}});
  const busy=await freeBusy({timeMin:'2026-10-05T09:30:00+08:00',timeMax:'2026-10-05T09:45:00+08:00',timezone:'Australia/Perth'});
  assert.deepEqual(busy,[{start:'2026-10-05T01:00:00.000Z',end:'2026-10-05T02:00:00.000Z'}]);
  await assert.rejects(createEvent({id:'two',appointment:{start:'2026-10-05T01:30:00Z',end:'2026-10-05T02:30:00Z'}}),/SCHEDULE_CONFLICT/);
  await deleteEvent('event_one');
  assert.deepEqual(await freeBusy({timeMin:'2026-10-05T00:00:00Z',timeMax:'2026-10-06T00:00:00Z',timezone:'UTC'}),[]);
 });
});
