import assert from 'node:assert/strict';
const base='http://127.0.0.1:5173';
const get=async()=>{const r=await fetch(base+'/api/workspace');assert.equal(r.status,200);return r.json()};
const original=await get(); let version=original.version;
const save=async(data,v=version)=>{const r=await fetch(base+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({data,version:v})});const j=await r.json();if(r.ok)version=j.version;return {r,j}};
let data=structuredClone(original.data);
try {
 data.payers.push({id:'qa-payer',name:'QA payer',category:'Utilities'});
 data.invoices.push({id:'qa-invoice',payer:'qa-payer',amount:100,due:'2026-10-01',group:'Utilities',bank:'4821',payments:[],attachments:[]});
 assert.equal((await save(data)).r.status,200);
 assert.ok((await get()).data.invoices.some(i=>i.id==='qa-invoice'));
 assert.equal((await save(data,original.version)).r.status,409);
 data.invoices.at(-1).payments.push({id:'qa-payment',amount:40,date:'2026-10-24',method:'Bank transfer',reference:'DEMO ONLY',receipts:[]});
 assert.equal((await save(data)).r.status,200);
 assert.equal((await get()).data.invoices.at(-1).payments[0].amount,40);
 const invalid=structuredClone(data);invalid.invoices.at(-1).payments[0].amount=101;
 assert.equal((await save(invalid)).r.status,400);
 data.events=[...(data.events||[]),{id:'qa-event',title:'Call payer',date:'2026-10-24',time:'09:30',type:'Reminder',payer:'qa-payer',completed:false}];
 assert.equal((await save(data)).r.status,200);
 assert.equal((await get()).data.events.find(e=>e.id==='qa-event').time,'09:30');
 data.events.find(e=>e.id==='qa-event').date='2026-11-02';
 data.events.find(e=>e.id==='qa-event').completed=true;
 assert.equal((await save(data)).r.status,200);
 assert.equal((await get()).data.events.find(e=>e.id==='qa-event').completed,true);
 const invalidEvent=structuredClone(data);invalidEvent.events.at(-1).date='2026-02-30';
 assert.equal((await save(invalidEvent)).r.status,400);
 console.log('PASS: scheduled calendar items persist, can move dates and complete, invalid dates rejected.');
 for(const [name,type] of [['invoice.pdf','application/pdf'],['invoice.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['receipt.png','image/png']]){
 const body=new FormData();body.append('file',new File(['Demo file for QA only'],name,{type}));const r=await fetch(base+'/api/files',{method:'POST',body});assert.equal(r.status,200);const f=await r.json();const download=await fetch(base+'/api/files?id='+f.id);assert.equal(download.status,200);assert.equal(await download.text(),'Demo file for QA only');assert.ok(download.headers.get('content-disposition').includes(name));}
 const body=new FormData();body.append('file',new File(['x'],'bad.exe'));assert.equal((await fetch(base+'/api/files',{method:'POST',body})).status,400);
 console.log('PASS: payer and invoice persistence, conflict detection, partial payments, overpayment rejection, PDF/Word/receipt uploads and downloads, invalid-file rejection.');
} finally {assert.equal((await save(original.data)).r.status,200);console.log('Original local demo records restored.');}

