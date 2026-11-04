// Payment requests saved in the workspace (data.paymentRequests). Anyone signed
// in can create one for an invoice; only a Manager (or someone the Manager lets
// approve in their name) can approve it. The server
// checks every change against the previous version and stamps who requested
// and who approved, and when — so these can't be faked from the browser.

const TEXT_LIMITS={vendor:200,account:120,description:200,number:120,instructions:1000};
const isDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// What the requester fills in; fixed once the request exists.
const CONTENT=['invoice','payer','date','vendor','amount','account','description','number','instructions'];

/** The Manager, or a person the Manager lets approve in their name. */
export const canApprove=user=>user?.role==='Manager'||!!user?.approvesFor?.id;

function validContent(r,invoices){
 if(!r||typeof r!=='object'||typeof r.id!=='string'||!r.id||r.id.length>80)return 'Invalid payment request.';
 if(!invoices.some(i=>i.id===r.invoice))return 'That invoice no longer exists.';
 if(!isDate(r.date))return 'Choose the date of the request.';
 if(!(typeof r.amount==='number'&&Number.isFinite(r.amount)&&r.amount>0))return 'Enter an amount above zero.';
 for(const [key,max] of Object.entries(TEXT_LIMITS))if(r[key]!==undefined&&(typeof r[key]!=='string'||r[key].length>max))return `The ${key} is too long.`;
 if(!r.vendor?.trim())return 'Enter the vendor name.';
 return null;
}

/**
 * Check the submitted requests against the stored ones and return the list to
 * save (with server stamps), or {error}. `user` is the signed-in person.
 */
export function reviewPaymentRequests(previous=[],submitted,user,invoices,now=new Date().toISOString()){
 if(submitted===undefined)return {requests:previous};
 if(!Array.isArray(submitted))return {error:'Invalid payment requests.'};
 const before=new Map(previous.map(r=>[r.id,r]));
 const ids=new Set();const out=[];
 for(const r of submitted){
  if(ids.has(r?.id))return {error:'Invalid payment request.'};ids.add(r?.id);
  const old=before.get(r?.id);
  if(!old){
   // New: always pending, requested by whoever is signed in.
   const problem=validContent(r,invoices);if(problem)return {error:problem};
   out.push({...Object.fromEntries(CONTENT.filter(k=>r[k]!==undefined).map(k=>[k,typeof r[k]==='string'?r[k].trim():r[k]])),id:r.id,status:'pending',requestedById:user.id,requestedBy:user.name,requestedAt:now});
   continue;
  }
  if(CONTENT.some(k=>!same(r[k],old[k]))||r.requestedById!==old.requestedById)return {error:'A saved payment request can’t be edited. Delete it and create a new one.'};
  if(old.status==='approved'){
   if(r.status!=='approved'||r.approvedById!==old.approvedById||r.approvedAt!==old.approvedAt)return {error:'An approved payment request can’t be changed.'};
   out.push(old);continue;
  }
  if(r.status==='approved'){
   if(!canApprove(user))return {error:'Only the Manager can approve payment requests.'};
   // Approving for the Manager: signed in the Manager's name, and who clicked is kept.
   const behalf=user.role!=='Manager'?{approvedById:user.approvesFor.id,approvedBy:user.approvesFor.name,approvedForById:user.id,approvedForBy:user.name}:{approvedById:user.id,approvedBy:user.name};
   out.push({...old,status:'approved',...behalf,approvedAt:now});continue;
  }
  if(r.status!=='pending')return {error:'Invalid payment request status.'};
  out.push(old);
 }
 // Removing: a pending request by its requester or the Manager; an approved one only by the Manager.
 for(const old of previous){
  if(ids.has(old.id))continue;
  const allowed=user.role==='Manager'||(old.status==='pending'&&old.requestedById===user.id);
  if(!allowed)return {error:old.status==='approved'?'Only the Manager can delete an approved payment request.':'Only the person who created this payment request, or the Manager, can delete it.'};
 }
 return {requests:out};
}
