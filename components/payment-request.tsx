'use client';
import {useState} from 'react';
import {Printer,Plus,CheckCheck,Trash2} from 'lucide-react';
import {requestDefaults,requestDocument} from '../lib/payment-request.mjs';
import {canApprove} from '../lib/payment-requests.mjs';
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
const pretty=(iso:string)=>new Date(iso.length===10?iso+'T12:00:00':iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
// Printing goes through a hidden frame, so the print dialog (or "Save as PDF") shows only the form.
function printDocument(html:string){
 const frame=document.createElement('iframe');
 frame.setAttribute('aria-hidden','true');frame.style.cssText='position:fixed;width:0;height:0;border:0;right:0;bottom:0';
 frame.srcdoc=html;
 frame.onload=()=>{const w=frame.contentWindow;const go=()=>{w?.focus();w?.print();setTimeout(()=>frame.remove(),60000);};const pending=[...(frame.contentDocument?.images||[])].filter(i=>!i.complete);if(!pending.length)go();else Promise.all(pending.map(i=>new Promise(r=>{i.onload=i.onerror=r;}))).then(go);};
 document.body.appendChild(frame);
}
/** Print a saved request with the signatures it may show (the requester's; the approver's once approved). */
export async function printRequest(request:any){
 const r=await fetch('/api/signature?request='+encodeURIComponent(request.id),{cache:'no-store'});const s:any=r.ok?await r.json():{};
 printDocument(requestDocument(request,{logo:location.origin+'/girosol-logo.png',requestedSignature:s.requested||undefined,approvedSignature:s.approved||undefined}));
}
// An invoice's payment requests: create one (it waits for the Manager's approval), print, approve (Manager) or delete.
export default function PaymentRequest({invoice,payer,user,requests,onCreate,onApprove,onDelete,onClose}:any){
 const manager=user.role==='Manager';
 const [creating,C]=useState(!requests.length),[values,V]=useState(()=>requestDefaults(invoice,payer)),[busy,B]=useState(false),[error,E]=useState(''),[confirmDelete,CD]=useState('');
 const set=(key:string)=>(e:any)=>V((v:any)=>({...v,[key]:e.target.value}));
 const run=async(work:()=>Promise<any>)=>{B(true);E('');try{await work();}catch(e:any){E(e.message||'Something went wrong. Please retry.');}finally{B(false);}};
 if(creating)return <form onSubmit={e=>{e.preventDefault();run(async()=>{if(await onCreate({...values,amount:Number(values.amount)}))C(false);});}}>
  <label className="field">Date of request<input type="date" value={values.date} onChange={set('date')} required/></label>
  <label className="field">Vendor<input value={values.vendor} onChange={set('vendor')} maxLength={200} required/></label>
  <label className="field">Amount<input type="number" min="0.01" step="0.01" value={values.amount} onChange={set('amount')} required/></label>
<div className="form-grid"><label className="field">Acct #<input value={values.account} onChange={set('account')} maxLength={120} autoComplete="off"/></label><label className="field">Invoice #<input value={values.number} onChange={set('number')} maxLength={120} autoComplete="off"/></label></div>
  <label className="field">Description <input value={values.description} onChange={set('description')} maxLength={200} placeholder="Printed beside the account number, e.g. Landscape Svcs" autoComplete="off"/></label>
  <label className="field">Instructions<textarea value={values.instructions} onChange={set('instructions')} rows={3} maxLength={1000}/></label>
  <p className="muted">Requested by <b>{user.name}</b>. It goes to the Manager for approval; your signature (Your account › Signature) is printed on it.</p>
  {error&&<div className="error" role="alert">{error}</div>}
  <div className="form-actions"><button type="button" disabled={busy} onClick={()=>requests.length?C(false):onClose()}>{requests.length?'Back':'Cancel'}</button><button className="primary" disabled={busy}>{busy?'Saving…':'Submit for approval'}</button></div>
 </form>;
 return <div className="payment-requests">
  {requests.map((r:any)=>{const mayDelete=manager||(r.status==='pending'&&r.requestedById===user.id);return <div className="payment-request-card" key={r.id}>
   <div className="payment-request-top"><b>{money(r.amount)}</b><span className={'badge '+(r.status==='approved'?'Paid':'Pending')}>{r.status==='approved'?'Approved':'Waiting for approval'}</span></div>
   <p className="muted">Requested by {r.requestedBy} · {pretty(r.requestedAt||r.date)}{r.status==='approved'&&<> · Approved by {r.approvedBy}{r.approvedForBy?` (by ${r.approvedForBy})`:''} · {pretty(r.approvedAt)}</>}</p>
   {confirmDelete===r.id?<div className="form-actions"><span className="muted">Delete this payment request?</span><button type="button" disabled={busy} onClick={()=>CD('')}>Keep</button><button type="button" className="account-remove" disabled={busy} onClick={()=>run(async()=>{if(await onDelete(r.id))CD('');})}>Delete</button></div>
   :<div className="payment-request-actions"><button type="button" disabled={busy} onClick={()=>run(()=>printRequest(r))}><Printer size={14}/> Print</button>{canApprove(user)&&r.status==='pending'&&<button type="button" className="primary" disabled={busy} onClick={()=>run(()=>onApprove(r.id))}><CheckCheck size={14}/> Approve</button>}{mayDelete&&<button type="button" className="account-remove account-remove-icon" title="Delete payment request" aria-label="Delete payment request" disabled={busy} onClick={()=>CD(r.id)}><Trash2 size={14}/></button>}</div>}
  </div>;})}
  {error&&<div className="error" role="alert">{error}</div>}
  <div className="form-actions"><button type="button" onClick={onClose}>Close</button><button type="button" disabled={busy} onClick={()=>{V(requestDefaults(invoice,payer));C(true);}}><Plus size={14}/> New payment request</button></div>
 </div>;
}
