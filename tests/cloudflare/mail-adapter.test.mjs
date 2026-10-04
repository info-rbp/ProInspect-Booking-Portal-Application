import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emailMessage,safeMailErrorCode} from '../../src/cloudflare/mail.ts';

test('native email adapter adds required attachment type and disposition',()=>{
 const message=emailMessage({from:'bookings@example.test',to:['recipient@example.test'],subject:'Booking',html:'<p>Booked</p>',reply_to:'support@example.test',attachments:[{filename:'booking.ics',content:'QkVHSU46VkNBTEVOREFS'}]});
 assert.deepEqual(message.attachments,[{filename:'booking.ics',content:'QkVHSU46VkNBTEVOREFS',type:'text/calendar',disposition:'attachment'}]);
 assert.equal(message.replyTo,'support@example.test');
 assert.equal(message.text,undefined);
});
test('native email adapter preserves explicitly provided MIME type',()=>{
 const message=emailMessage({attachments:[{filename:'report.pdf',content:'JVBERi0=',content_type:'application/pdf'}]});
 assert.equal(message.attachments[0].type,'application/pdf');
 assert.equal(message.attachments[0].disposition,'attachment');
 assert.throws(()=>emailMessage({attachments:[{filename:'bad\nfile',content:'abc'}]}),/attachment/);
});
test('delivery diagnostics retain documented codes but discard private provider messages',()=>{
 assert.equal(safeMailErrorCode({code:'E_SENDER_NOT_VERIFIED',message:'private address'}),'E_SENDER_NOT_VERIFIED');
 assert.equal(safeMailErrorCode({code:'private@example.test',message:'private payload'}),'DELIVERY_FAILED');
 assert.equal(safeMailErrorCode(new Error('recipient secret')),'DELIVERY_FAILED');
});
