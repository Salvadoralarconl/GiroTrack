import { test } from 'node:test';
import assert from 'node:assert/strict';
import { status, remaining, inView, withFullPayment } from './finance.mjs';
test('partial payments leave a balance and overdue follows local date',()=>{const i={amount:100,due:'2026-10-10',payments:[{amount:40}]}; assert.equal(remaining(i),60); assert.equal(status(i,'2026-10-24'),'Overdue');});
test('fully paid invoices never become overdue',()=>assert.equal(status({amount:100,due:'2020-01-01',payments:[{amount:100}]},'2026-10-24'),'Paid'));
test('due today remains pending',()=>assert.equal(status({amount:100,due:'2026-10-24',payments:[]},'2026-10-24'),'Pending'));
test('views filter records without copying them',()=>{const i={payer:'p1',group:'Utilities',bank:'4821'};assert.ok(inView(i,{kind:'group',value:'Utilities'}));assert.ok(inView(i,{kind:'bank',value:'4821'}));assert.ok(!inView(i,{kind:'payer',value:'p2'}));});

test('mark as paid records only the remaining amount and avoids duplicate full payments',()=>{const i={amount:100,payments:[{amount:40}]};const paid=withFullPayment(i,{id:'paid',date:'2026-10-24'});assert.equal(paid.payments[1].amount,60);assert.equal(status(paid,'2026-10-24'),'Paid');assert.equal(withFullPayment(paid,{id:'again'}).payments.length,2);});
