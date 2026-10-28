import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationsToShow,pruneSent} from './browser-notifications.mjs';
const all={daily:true,weekly:true,upcoming:true,due:true,overdue:true};
const data={payers:[{id:'p1',name:'FPL - Lights'},{id:'p2',name:'Comcast'}],paymentSchedules:[],ignoredPayments:[],deletedPayments:[],invoices:[
 {id:'a',payer:'p1',due:'2026-10-20',amount:120,payments:[]},
 {id:'b',payer:'p2',due:'2026-10-26',amount:80.5,payments:[]},
 {id:'c',payer:'p2',due:'2026-10-28',amount:40,payments:[]},
 {id:'d',payer:'p1',due:'2026-11-20',amount:10,payments:[]},
 {id:'e',payer:'p1',due:'2026-10-21',amount:50,payments:[{amount:50,date:'2026-10-22'}]}]};
const monday=new Date(2026,9,26,9,0);
test('each chosen type is shown once per day with payer names and amounts',()=>{
 const shown=notificationsToShow(data,all,monday);
 assert.deepEqual(shown.map(n=>n.key),['daily:2026-10-26','weekly:2026-10-26','overdue:2026-10-26','due:2026-10-26','upcoming:2026-10-26']);
 const by=Object.fromEntries(shown.map(n=>[n.type,n]));
 assert.equal(by.daily.body,'1 payment overdue · 1 payment due today · 1 coming up in the next 3 days');
 assert.equal(by.weekly.body,'2 payments due this week ($120.50) · 1 overdue · 1 paid last week');
 assert.equal(by.overdue.title,'1 payment overdue');assert.equal(by.overdue.body,'FPL - Lights ($120.00, Oct 20)');
 assert.equal(by.due.body,'Comcast ($80.50)');
 assert.equal(by.upcoming.body,'Comcast ($40.00, Oct 28) in the next 3 days');
});
test('nothing repeats, unchosen types stay quiet, summaries wait for 8 AM and weekly is Mondays only',()=>{
 const sent=Object.fromEntries(notificationsToShow(data,all,monday).map(n=>[n.key,true]));
 assert.deepEqual(notificationsToShow(data,all,monday,sent),[]);
 assert.deepEqual(notificationsToShow(data,{...all,daily:false,weekly:false,upcoming:false},monday).map(n=>n.type),['overdue','due']);
 assert.deepEqual(notificationsToShow(data,all,new Date(2026,9,26,7,59)).map(n=>n.type),['overdue','due','upcoming']);
 assert.deepEqual(notificationsToShow(data,all,new Date(2026,9,27,9,0)).map(n=>n.type),['daily','overdue','upcoming']);
});
test('a quiet day still gets the daily summary; old shown-keys are pruned',()=>{
 const quiet={...data,invoices:[]};
 assert.deepEqual(notificationsToShow(quiet,all,new Date(2026,9,27,9,0)).map(n=>[n.type,n.body]),[['daily','Nothing due today. You are all caught up.']]);
 assert.deepEqual(pruneSent({'daily:2026-10-01':true,'overdue:2026-10-20':true},monday),{'overdue:2026-10-20':true});
});
