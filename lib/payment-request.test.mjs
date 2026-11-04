import test from 'node:test';
import assert from 'node:assert/strict';
import {requestDefaults,requestDocument} from './payment-request.mjs';
import {today} from './finance.mjs';

const payer={name:'Jackson Jacques',account:'01-6050-0011500',method:'Check',address:'128 Willow Street\nBrooklyn, NY 11201'};
const invoice={amount:100,due:'2026-11-15',number:'INV-7',title:'Landscape Svcs',payments:[{amount:25}]};
const sig='data:image/png;base64,iVBORw0KGgo=';

test('a new request starts from the invoice and vendor',()=>{
 const v=requestDefaults(invoice,payer);
 assert.deepEqual({...v,date:'x'},{date:'x',vendor:'Jackson Jacques',amount:'75',account:'01-6050-0011500',description:'Landscape Svcs',number:'INV-7',instructions:'Pay by check by November 15, 2026.\nMail to: 128 Willow Street, Brooklyn, NY 11201'});
 assert.equal(v.date,today());
 assert.equal(requestDefaults({...invoice,payments:[{amount:100}]},payer).amount,'100','already paid: the full amount');
 assert.equal(requestDefaults({...invoice,amount:null},payer).amount,'');
 assert.equal(requestDefaults({...invoice,number:''},{name:'X'}).number,'');
 assert.equal(requestDefaults({...invoice,title:''},{...payer,category:'Utilities'}).description,'Utilities','no description on the invoice: the vendor category');
 // What the invoice scan found (or was typed into the invoice) comes first.
 const scanned=requestDefaults({...invoice,account:'ACC-1',instructions:'Remit to: PO Box 1'},payer);assert.equal(scanned.account,'ACC-1');assert.equal(scanned.instructions,'Remit to: PO Box 1');
});

test('the printout follows the paper form, with the invoice number under the account number',()=>{
 const r={...requestDefaults(invoice,payer),date:'2026-10-22',amount:75,requestedBy:'Manuel Garcia',requestedAt:'2026-10-22T15:00:00.000Z',status:'pending'};
 const html=requestDocument(r,{logo:'http://127.0.0.1/girosol-logo.png',requestedSignature:sig});
 for(const label of ['PMT REQUEST','DATE:','VENDOR:','AMOUNT :','ACCT #','INSTRUCTIONS:','Request By:','Approved By:','FORM ACC107-1'])assert.ok(html.includes(label),label);
 assert.ok(html.includes('Thursday, October 22, 2026'));assert.ok(html.includes('$75.00'));
 assert.ok(html.indexOf('01-6050-0011500')<html.indexOf('Invoice #: INV-7'),'invoice number under the account');
 assert.ok(html.includes('Landscape Svcs'));
 assert.ok(html.includes(`<img src="${sig}"`),'requester signature');assert.ok(html.includes('Manuel Garcia'));
 assert.match(html,/<b>Date:<\/b> 10\/22\/2026/);
 // Not approved yet: no approver name, date or signature.
 assert.equal((html.match(/<img src="data:/g)||[]).length,1);
 assert.equal(requestDocument({...r,number:''}).includes('Invoice #'),false,'no invoice number line when there is none');
});

test('approval fills in the approver; anything unsafe is escaped or dropped',()=>{
 const html=requestDocument({date:'2026-10-22',vendor:'<script>x</script>',amount:75,account:'A',instructions:'"quoted" & <b>',requestedBy:'Ana',requestedAt:'2026-10-22T10:00:00Z',status:'approved',approvedBy:'Sergio Rodriguez',approvedAt:'2026-10-23T09:00:00Z'},{requestedSignature:'javascript:alert(1)',approvedSignature:sig});
 assert.ok(html.includes('Sergio Rodriguez'));assert.match(html,/10\/23\/2026/);
 assert.ok(!html.includes('<script>x'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&quot;quoted&quot; &amp; &lt;b&gt;'));
 assert.ok(!html.includes('javascript:'),'only image data URLs are used as signatures');
 assert.equal((html.match(/<img src="data:/g)||[]).length,1);
});
test('a placed signature prints where it was put, at its size',()=>{
 const html=requestDocument({date:'2026-10-22',vendor:'V',amount:1,requestedBy:'Ana',requestedAt:'2026-10-22T10:00:00Z',status:'pending'},{requestedSignature:{image:sig,placement:{x:10,y:-25,size:1.5}}});
 assert.match(html,/<img src="data:image\/png;base64,iVBORw0KGgo=" alt="" style="left:10%;bottom:25%;height:69\.0pt">/);
});
