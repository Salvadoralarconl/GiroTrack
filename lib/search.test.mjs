import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesSearch,searchText} from './search.mjs';

const invoice={number:'TEST-0001',title:'',account:'0082 4910 6621',instructions:'Remit to PO Box 1',amount:1250,due:'2026-11-11',payments:[{date:'2026-10-28',amount:100,method:'Check'}]};
const text=searchText(invoice,{payerName:'FPL - Lights',status:'Pending',repeat:'Monthly · day 11'});

test('finds invoices by number, vendor, account, instructions, status and repeat',()=>{
 for(const q of ['test-0001','fpl','lights fpl','4910','po box','pending','monthly','check'])assert.ok(matchesSearch(text,q),q);
});
test('finds amounts and dates however they are typed',()=>{
 for(const q of ['1250','1250.00','$1,250.00','1,250','2026-11-11','11/11/2026','11/11','nov 11','november 11','november','10/28','100.00'])assert.ok(matchesSearch(text,q),q);
});
test('every word must match; an empty search shows everything',()=>{
 assert.equal(matchesSearch(text,'fpl water'),false);
 assert.equal(matchesSearch(text,'december'),false);
 assert.ok(matchesSearch(text,''));assert.ok(matchesSearch(text,'   '));
});
