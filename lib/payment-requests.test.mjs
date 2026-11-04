import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewPaymentRequests} from './payment-requests.mjs';

const manager={id:'m1',name:'Maria Manager',role:'Manager'},member={id:'u1',name:'Ana Member',role:'Member'},other={id:'u2',name:'Luis Member',role:'Member'};
const invoices=[{id:'i1'}];
const draft={id:'r1',invoice:'i1',payer:'p1',date:'2026-10-22',vendor:'Jackson Jacques',amount:75,account:'01-6050-0011500',description:'Landscape Svcs',number:'INV-7',instructions:'Pay by check'};
const NOW='2026-10-22T15:00:00.000Z';

test('a new request is pending and stamped with whoever is signed in, whatever the browser sent',()=>{
 const {requests,error}=reviewPaymentRequests([],[{...draft,status:'approved',approvedById:'m1',requestedById:'m1',requestedBy:'Someone else'}],member,invoices,NOW);
 assert.equal(error,undefined);
 assert.deepEqual(requests[0],{...draft,status:'pending',requestedById:'u1',requestedBy:'Ana Member',requestedAt:NOW});
});

test('only the Manager can approve; the server stamps the approver and time',()=>{
 const [saved]=reviewPaymentRequests([],[draft],member,invoices,NOW).requests;
 assert.match(reviewPaymentRequests([saved],[{...saved,status:'approved'}],member,invoices).error,/Only the Manager/);
 const {requests}=reviewPaymentRequests([saved],[{...saved,status:'approved',approvedBy:'Forged',approvedAt:'1999-01-01'}],manager,invoices,'2026-10-23T09:00:00.000Z');
 assert.equal(requests[0].status,'approved');assert.equal(requests[0].approvedById,'m1');assert.equal(requests[0].approvedBy,'Maria Manager');assert.equal(requests[0].approvedAt,'2026-10-23T09:00:00.000Z');
});

test('someone the Manager allows approves in the Manager’s name, and who clicked is kept',()=>{
 const [saved]=reviewPaymentRequests([],[draft],member,invoices,NOW).requests;
 const delegate={...other,approvesFor:{id:'m1',name:'Maria Manager'}};
 const {requests,error}=reviewPaymentRequests([saved],[{...saved,status:'approved'}],delegate,invoices,'2026-10-23T09:00:00.000Z');
 assert.equal(error,undefined);
 assert.equal(requests[0].approvedById,'m1');assert.equal(requests[0].approvedBy,'Maria Manager');
 assert.equal(requests[0].approvedForById,'u2');assert.equal(requests[0].approvedForBy,'Luis Member');
 // Approval access doesn't let them delete approved requests.
 assert.match(reviewPaymentRequests(requests,[],delegate,invoices).error,/Only the Manager/);
});

test('saved requests can’t be edited, approvals can’t be undone or reassigned',()=>{
 const [saved]=reviewPaymentRequests([],[draft],member,invoices,NOW).requests;
 assert.match(reviewPaymentRequests([saved],[{...saved,amount:750}],member,invoices).error,/can’t be edited/);
 assert.match(reviewPaymentRequests([saved],[{...saved,requestedById:'u2'}],manager,invoices).error,/can’t be edited/);
 const [approved]=reviewPaymentRequests([saved],[{...saved,status:'approved'}],manager,invoices,NOW).requests;
 assert.match(reviewPaymentRequests([approved],[{...approved,status:'pending'}],manager,invoices).error,/approved payment request can’t be changed/);
 assert.match(reviewPaymentRequests([approved],[{...approved,approvedById:'u1'}],manager,invoices).error,/can’t be changed/);
 assert.deepEqual(reviewPaymentRequests([approved],[approved],member,invoices).requests,[approved],'unchanged is fine for anyone');
});

test('deleting: pending by its requester or the Manager; approved only by the Manager',()=>{
 const [saved]=reviewPaymentRequests([],[draft],member,invoices,NOW).requests;
 assert.match(reviewPaymentRequests([saved],[],other,invoices).error,/Only the person who created/);
 assert.deepEqual(reviewPaymentRequests([saved],[],member,invoices).requests,[]);
 const [approved]=reviewPaymentRequests([saved],[{...saved,status:'approved'}],manager,invoices,NOW).requests;
 assert.match(reviewPaymentRequests([approved],[],member,invoices).error,/Only the Manager can delete/);
 assert.deepEqual(reviewPaymentRequests([approved],[],manager,invoices).requests,[]);
});

test('content is checked',()=>{
 for(const [bad,message] of [[{amount:0},/above zero/],[{amount:'75'},/above zero/],[{date:'10/22/2026'},/date/],[{invoice:'gone'},/no longer exists/],[{vendor:'  '},/vendor/],[{instructions:'x'.repeat(1001)},/too long/]])
  assert.match(reviewPaymentRequests([],[{...draft,...bad}],member,invoices).error,message);
 assert.match(reviewPaymentRequests([],[draft,draft],member,invoices).error,/Invalid/,'duplicate ids');
 assert.deepEqual(reviewPaymentRequests([{id:'x'}],undefined,member,invoices).requests,[{id:'x'}],'older clients that don’t send the list keep it');
});
