import {test} from 'node:test';import assert from 'node:assert/strict';import {occurrences,validSchedule,upcomingPaymentsThisWeek,repeatLabel} from './payment-schedules.mjs';
const base={id:'fpl',title:'FPL',payer:'p1',start:'2026-01-01',frequency:'monthly',day:15};
test('FPL appears on the 15th of each month without invoices',()=>{const a=occurrences([base],'2026-01-01','2026-12-31');assert.equal(a.length,12);assert.ok(a.every(x=>x.date.endsWith('-15')));});
test('weekly schedules include every Monday in the chosen month',()=>assert.deepEqual(occurrences([{...base,frequency:'weekly',weekday:1}],'2026-10-01','2026-10-31').map(x=>x.date),['2026-10-05','2026-10-12','2026-10-19','2026-10-26']));
test('31st uses last day in shorter months, including leap years',()=>assert.deepEqual(occurrences([{...base,start:'2028-01-01',day:31}],'2028-02-01','2028-03-31').map(x=>x.date),['2028-02-29','2028-03-31']));
test('respects start, end, and paused schedules',()=>{assert.equal(occurrences([{...base,start:'2026-10-16'}],'2026-10-01','2026-10-31').length,0);assert.equal(occurrences([{...base,paused:true}],'2026-01-01','2026-12-31').length,0);assert.equal(occurrences([{...base,end:'2026-01-31'}],'2026-01-01','2026-12-31').length,1);});
test('validates recurrence rules',()=>{assert.ok(validSchedule(base));assert.ok(!validSchedule({...base,day:0}));assert.ok(!validSchedule({...base,start:'2026-02-30'}));assert.ok(!validSchedule({...base,frequency:'weekly',weekday:7}));});

test('upcoming list is payer-specific and ends on Sunday, without attached invoices',()=>{const schedules=[{...base,day:24},{...base,id:'tomorrow',day:25},{...base,id:'nextweek',day:26},{...base,id:'other',payer:'p2',day:24}];assert.deepEqual(upcomingPaymentsThisWeek(schedules,[],'p1','2026-10-24').map(x=>x.scheduleId),['fpl','tomorrow']);assert.deepEqual(upcomingPaymentsThisWeek(schedules,[{scheduleId:'fpl',scheduledDate:'2026-10-24'}],'p1','2026-10-24').map(x=>x.scheduleId),['tomorrow']);assert.equal(upcomingPaymentsThisWeek([{...base,day:15}],[],'p1','2026-10-24').length,0);});
test('every 2 weeks starts on the first chosen weekday on or after the start, then every 14 days',()=>{
 const biweekly={...base,frequency:'biweekly',start:'2026-10-01',weekday:5};
 assert.deepEqual(occurrences([biweekly],'2026-10-01','2026-11-30').map(x=>x.date),['2026-10-02','2026-10-16','2026-10-30','2026-11-13','2026-11-27']);
 assert.deepEqual(occurrences([biweekly],'2026-11-01','2026-11-30').map(x=>x.date),['2026-11-13','2026-11-27']);
 assert.deepEqual(occurrences([{...biweekly,start:'2026-03-02',weekday:1}],'2026-03-01','2026-04-30').map(x=>x.date),['2026-03-02','2026-03-16','2026-03-30','2026-04-13','2026-04-27']);
 assert.equal(repeatLabel(biweekly),'Every other Friday');assert.ok(!validSchedule({...biweekly,weekday:undefined}));
});
test('every year repeats on the start date, with Feb 29 on Feb 28 in other years',()=>{
 const yearly={...base,frequency:'yearly',start:'2026-03-15'};
 assert.deepEqual(occurrences([yearly],'2026-01-01','2029-12-31').map(x=>x.date),['2026-03-15','2027-03-15','2028-03-15','2029-03-15']);
 assert.deepEqual(occurrences([{...yearly,start:'2028-02-29'}],'2028-01-01','2030-12-31').map(x=>x.date),['2028-02-29','2029-02-28','2030-02-28']);
 assert.equal(repeatLabel(yearly),'Every year on March 15');assert.ok(validSchedule(yearly));
});
