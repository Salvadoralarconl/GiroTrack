'use client';
import {createPortal} from 'react-dom';
import {X,ArrowUpRight,Pencil,EyeOff,RotateCcw} from 'lucide-react';
import {DeleteScheduledPayment} from './schedule-menu-actions';
import {repeatLabel} from '../lib/payment-schedules.mjs';
import {paidDate,today} from '../lib/finance.mjs';
// A calendar date's payment: a quick summary and the settings for that date (edit the schedule,
// ignore or restore this date, delete it), plus a button to open its invoice.
const money=(n:number)=>Number(n).toLocaleString('en-US',{style:'currency',currency:'USD'});
const pretty=(iso:string)=>new Date(iso+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
export default function CalendarPaymentPopup({item,data,busy,onSave,onEdit,onToggleIgnore,onOpenInvoice,onClose}:any){
 const vendor=data.payers.find((p:any)=>p.id===item.payer);const invoice=data.invoices.find((i:any)=>i.scheduleId===item.scheduleId&&i.scheduledDate===item.date);
 const autopay=item.schedule?.autopay??vendor?.autopay;const paid=invoice&&paidDate(invoice);
 const status=item.ignored?'Ignored':paid?'Paid '+new Date(paid+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):invoice?'Invoice added, not paid':'No invoice yet';
 // What it's for: the invoice's description, else the schedule's notes, else the vendor's category.
 const description=invoice?.title||item.schedule?.notes||(item.title!==vendor?.name?item.title:'')||vendor?.category;const amount=invoice?.amount??item.amount;
 const facts=[['Vendor',vendor?.name],['Date',<>{pretty(item.date)}{item.overdue&&<em className="approval-due late">Overdue</em>}{item.date===today()&&!item.overdue&&<em className="approval-due today">Today</em>}</>],['Repeats',repeatLabel(item.schedule)],['Autopay',autopay?'On':'Off'],['Status',status],['Description',description]].filter(([,v])=>v);
 return createPortal(<div className="modal-overlay" onClick={()=>!busy&&onClose()}><section className="modal calendar-payment-popup" role="dialog" aria-modal="true" aria-label="Calendar payment" onClick={e=>e.stopPropagation()}>
  <div className="modal-header"><h2>Calendar payment</h2><button aria-label="Close" disabled={busy} onClick={onClose}><X size={20}/></button></div>
  <div className="approval-summary">
   <div className="approval-summary-head"><span>{vendor?.name||item.title}</span><strong>{amount!==undefined&&amount!==null&&amount!==''?money(amount):'No amount'}</strong></div>
   <dl>{facts.map(([k,v]:any)=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
   <div className="calendar-payment-manage">
    <button type="button" disabled={busy} onClick={onEdit}><Pencil size={14}/> Edit schedule</button>
    <button type="button" disabled={busy} onClick={onToggleIgnore}>{item.ignored?<><RotateCcw size={14}/> Restore this date</>:<><EyeOff size={14}/> Ignore this date</>}</button>
    <DeleteScheduledPayment scheduleId={item.scheduleId} date={item.date} title={item.title} data={data} onSave={onSave} onDone={onClose} disabled={busy}/>
   </div>
   <div className="form-actions"><button type="button" onClick={onClose}>Close</button><button type="button" onClick={onOpenInvoice}>{invoice?'Invoice details':'Add invoice'} <ArrowUpRight size={13}/></button></div>
  </div>
 </section></div>,document.body);
}
