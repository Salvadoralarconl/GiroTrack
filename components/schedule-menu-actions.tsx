'use client';
import {useState} from 'react';
import {createPortal} from 'react-dom';
import {Trash2,PauseCircle,X} from 'lucide-react';
export default function ScheduleMenuActions({item,data,onSave,onDone,deleteOnly=false}:any){
 const [action,A]=useState(''),[busy,B]=useState(false),[error,E]=useState('');
 async function confirm(){B(true);E('');const id=item.scheduleId||item.schedule.id;const schedules=action==='delete'?data.paymentSchedules.filter((s:any)=>s.id!==id):data.paymentSchedules.map((s:any)=>s.id===id?{...s,paused:true}:s);try{if(await onSave(action==='delete'?{...data,deletedPayments:[...(data.deletedPayments||[]),{scheduleId:id,date:item.date}]}:{...data,paymentSchedules:schedules},action==='delete'?'Payment occurrence deleted':'Payment schedule stopped')){A('');onDone();}else E('Could not save. Please retry.');}catch{E('Could not save. Please retry.');}finally{B(false);}}
 return <>{!deleteOnly&&<button role="menuitem" onClick={()=>A('stop')}><PauseCircle size={14}/>Stop payments</button>}<button role="menuitem" className="danger" onClick={()=>A('delete')}><Trash2 size={14}/>Delete payment</button>{action&&createPortal(<div className="modal-overlay payer-delete-overlay" onClick={e=>{e.stopPropagation();if(!busy)A('');}}><section className="modal payer-delete-dialog" role="alertdialog" aria-modal="true" aria-label={action==='delete'?'Delete payment':'Stop payments'} onClick={e=>e.stopPropagation()}><div className="modal-header"><h2>{action==='delete'?'Delete payment?':'Stop payments?'}</h2><button aria-label="Close confirmation" disabled={busy} onClick={()=>A('')}><X size={19}/></button></div><p>{action==='delete'?<>Delete <strong>{item.title}</strong> on {item.date}? Previous and future scheduled payments and existing invoices stay on file.</>:<>Stop future payments for <strong>{item.title}</strong>? You can resume this schedule later by editing it and clearing Pause.</>}</p>{error&&<div className="error" role="alert">{error}</div>}<div className="form-actions"><button autoFocus disabled={busy} onClick={()=>A('')}>Cancel</button><button className={action==='delete'?'delete-payer-confirm':'primary'} disabled={busy} onClick={confirm}>{busy?'Saving…':action==='delete'?'Delete payment':'Stop payments'}</button></div></section></div>,document.body)}</>;
}
/**
 * Delete a scheduled payment from its details: just this one (the rest stay), or this one and
 * every later one (the schedule ends the day before; earlier payments stay).
 */
export function DeleteScheduledPayment({scheduleId,date,title,data,onSave,onDone,disabled}:any){
 const [open,O]=useState(false),[busy,B]=useState(false),[error,E]=useState('');
 async function remove(scope:'one'|'following'){B(true);E('');try{
  let next;
  if(scope==='one')next={...data,deletedPayments:[...(data.deletedPayments||[]),{scheduleId,date}]};
  else{const d=new Date(date+'T12:00:00');d.setDate(d.getDate()-1);const end=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
   next={...data,paymentSchedules:(data.paymentSchedules||[]).flatMap((s:any)=>s.id!==scheduleId?[s]:end<s.start?[]:[{...s,end}])};}
  if(await onSave(next,scope==='one'?'Payment occurrence deleted':'Payment and the following ones deleted')){O(false);onDone();}else E('Could not save. Please retry.');
 }catch{E('Could not save. Please retry.');}finally{B(false);}}
 return <><button type="button" className="invoice-delete" disabled={disabled} onClick={()=>O(true)}><Trash2 size={14}/>Delete</button>{open&&createPortal(<div className="modal-overlay payer-delete-overlay" onClick={e=>{e.stopPropagation();if(!busy)O(false);}}><section className="modal payer-delete-dialog" role="alertdialog" aria-modal="true" aria-label="Delete payment" onClick={e=>e.stopPropagation()}><div className="modal-header"><h2>Delete payment?</h2><button aria-label="Close" disabled={busy} onClick={()=>O(false)}><X size={19}/></button></div><p>Delete <strong>{title}</strong> on {new Date(date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}. Earlier payments and saved invoices stay on file.</p>{error&&<div className="error" role="alert">{error}</div>}<div className="form-actions"><button autoFocus disabled={busy} onClick={()=>O(false)}>Cancel</button><button className="delete-payer-confirm" disabled={busy} onClick={()=>remove('following')}>This and the next ones</button><button className="delete-payer-confirm" disabled={busy} onClick={()=>remove('one')}>{busy?'Saving…':'Just this payment'}</button></div></section></div>,document.body)}</>;
}
