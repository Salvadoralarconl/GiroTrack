import {test} from 'node:test';
import assert from 'node:assert/strict';
import {monthCells,shiftDate,dateKey,validEvent} from './calendar.mjs';
test('month grid includes leap day and complete Monday-first weeks',()=>{const cells=monthCells(new Date(2028,1,1));assert.equal(cells.length%7,0);assert.equal(cells[0].getDay(),1);assert.ok(cells.some(d=>dateKey(d)==='2028-02-29'));});
test('month navigation clamps day without skipping February',()=>assert.equal(dateKey(shiftDate(new Date(2026,0,31),'month',1)),'2026-02-28'));
test('year navigation clamps leap day',()=>assert.equal(dateKey(shiftDate(new Date(2028,1,29),'year',1)),'2029-02-28'));
test('events require a real date and valid optional time',()=>{assert.ok(validEvent({id:'1',title:'Call payer',date:'2026-10-24',time:'09:30'}));assert.ok(!validEvent({id:'1',title:'Call',date:'2026-02-30'}));assert.ok(!validEvent({id:'1',title:'Call',date:'2026-10-24',time:'25:00'}));assert.ok(!validEvent({id:'1',title:' ',date:'2026-10-24'}));});

import {periodPayments} from './calendar.mjs';
test('payment agenda follows day, month, or year and sorts dates ascending',()=>{const items=[{id:'b',date:'2026-10-31',kind:'invoice'},{id:'a',date:'2026-10-01',kind:'payment'},{id:'next',date:'2026-11-01',kind:'invoice'},{id:'old',date:'2025-10-01',kind:'payment'},{id:'note',date:'2026-10-10',kind:'event'}];const d=new Date(2026,9,1);assert.deepEqual(periodPayments(items,d,'month').map(i=>i.id),['a','b']);assert.deepEqual(periodPayments(items,d,'day').map(i=>i.id),['a']);assert.deepEqual(periodPayments(items,d,'year').map(i=>i.id),['a','b','next']);});
