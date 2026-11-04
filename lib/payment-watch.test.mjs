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
test('this week lists what is due Monday through Sunday of the current week',()=>{
 const inv=(id,due)=>({id,payer:'p',amount:10,due,payments:[]});
 const w=paymentWatch({payers:[],paymentSchedules:[],invoices:[inv('lastSun','2026-10-25'),inv('mon','2026-10-26'),inv('thu','2026-10-29'),inv('sun','2026-11-01'),inv('nextMon','2026-11-02')]},'2026-10-29');
 assert.deepEqual(w.week.map(i=>i.id),['mon','thu','sun']);
});
