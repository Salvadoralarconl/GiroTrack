import {test} from 'node:test';import assert from 'node:assert/strict';import {extractInvoiceFields} from './invoice-extraction.mjs';
test('reads labelled invoice number, US due date, amount, and description',()=>assert.deepEqual(extractInvoiceFields('Invoice #: INV-2026-432\nInvoice Date: 10/01/2026\nDue Date: 10/15/2026\nDescription: Electricity October\nSubtotal $100.00\nTotal Amount Due: $1,284.50'),{number:'INV-2026-432',due:'2026-10-15',amount:1284.5,title:'Electricity October'}));
test('supports multiline labels and written dates',()=>{const f=extractInvoiceFields('Invoice Number\nAB-8872\nPayment Due By\nNovember 5, 2026\nBalance Due\nUSD 95.00');assert.equal(f.number,'AB-8872');assert.equal(f.due,'2026-11-05');assert.equal(f.amount,95);});
test('never uses invoice date as due date or subtotal as total',()=>{const f=extractInvoiceFields('Invoice Date: 10/01/2026\nSubtotal: $50.00');assert.equal(f.due,undefined);assert.equal(f.amount,undefined);assert.equal(f.number,undefined);});
test('does not accept impossible dates',()=>assert.equal(extractInvoiceFields('Due Date: 02/30/2026').due,undefined));
test('finds the account number and how to pay, for payment requests',()=>{
 const f=extractInvoiceFields('FPL\nAccount Number: 0082 4910 6621\nInvoice #: INV-77\nAmount Due: $125.00\nPlease remit payment to:\nFPL General Mail Facility\nMiami, FL 33188-0001');
 assert.equal(f.account,'0082 4910 6621');assert.equal(f.instructions,'Remit payment to: FPL General Mail Facility, Miami, FL 33188-0001');
 assert.equal(extractInvoiceFields('Acct #: 01-6050-0011500').account,'01-6050-0011500');
 assert.equal(extractInvoiceFields('Customer No.\nC-88213').account,'C-88213');
 assert.equal(extractInvoiceFields('Make checks payable to: Jackson Jacques Landscaping').instructions,'Make checks payable to: Jackson Jacques Landscaping');
 assert.equal(extractInvoiceFields('Pay online at www.example.com/pay').instructions,'Pay online at: www.example.com/pay');
 // Not found: left out, so the form asks for it.
 const none=extractInvoiceFields('Invoice #: INV-1\nTotal: $10.00');assert.equal(none.account,undefined);assert.equal(none.instructions,undefined);
 assert.equal(extractInvoiceFields('Account Manager: Sam').account,undefined,'a label without a number is ignored');
});
