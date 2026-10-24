import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentWatch} from './payment-watch.mjs';
test('scheduled payments appear without invoices, become overdue, and linked invoices replace occurrences',()=>{
 const schedule={id:'s',payer:'p',title:'FPL',start:'2026-10-23',frequency:'weekly',weekday:5};
 const data={paymentSchedules:[schedule],invoices:[]};
 let w=paymentWatch(data,'2026-10-24');
 assert.equal(w.overdue[0].due,'2026-10-23');
 assert.equal(w.upcoming[0].due,'2026-10-30');
 assert.ok(w.pending.length>w.overdue.length);
 data.invoices.push({id:'i',scheduleId:'s',scheduledDate:'2026-10-23',amount:10,payments:[{amount:10}],due:'2026-10-23'});
 w=paymentWatch(data,'2026-10-24');assert.equal(w.overdue.length,0);
});
