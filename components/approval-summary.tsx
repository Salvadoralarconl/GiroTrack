'use client';
import {BadgeCheck,ArrowUpRight} from 'lucide-react';
import {today} from '../lib/finance.mjs';
// Quick look at a payment request from Ready for approval: what's due, then Approve.
const money=(n:number)=>Number(n).toLocaleString('en-US',{style:'currency',currency:'USD'});
const pretty=(iso:string)=>iso?new Date(iso.slice(0,10)+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'Not set';
export default function ApprovalSummary({request:r,invoice,busy,onApprove,onDetails,onClose}:any){
 const due=invoice?.due||'',late=due&&due<today(),now=due===today();
 const facts=[['Invoice #',r.number],['Due date',<>{pretty(due)}{late&&<em className="approval-due late">Overdue</em>}{now&&<em className="approval-due today">Today</em>}</>],['Description',r.description],['Acct #',r.account],['Instructions',r.instructions],['Requested by',`${r.requestedBy||'Someone'} · ${pretty(r.requestedAt||r.date)}`]].filter(([,v])=>v);
 return <div className="approval-summary">
  <div className="approval-summary-head"><span>{r.vendor}</span><strong>{money(r.amount)}</strong></div>
  <dl>{facts.map(([k,v]:any)=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
  <div className="form-actions"><button type="button" onClick={onClose}>Close</button>{invoice&&<button type="button" onClick={onDetails}>Invoice details <ArrowUpRight size={13}/></button>}<button type="button" className="primary" disabled={busy} onClick={onApprove}><BadgeCheck size={15}/> Approve</button></div>
 </div>;
}
