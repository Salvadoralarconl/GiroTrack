import test from 'node:test';
import assert from 'node:assert/strict';
import {paidDate} from './finance.mjs';
test('paid date is blank until fully paid and uses the latest payment date',()=>{
 assert.equal(paidDate({amount:100,payments:[]}), '');
 assert.equal(paidDate({amount:100,payments:[{amount:40,date:'2026-10-23'}]}), '');
 assert.equal(paidDate({amount:100,payments:[{amount:60,date:'2026-10-24'},{amount:40,date:'2026-10-23'}]}), '2026-10-24');
});
