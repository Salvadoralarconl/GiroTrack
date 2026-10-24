import {occurrences,repeatLabel} from './payment-schedules.mjs';
import {remaining,status,today} from './finance.mjs';
import {dateKey} from './calendar.mjs';
export function overview(data,now=today()){
 const invoices=data.invoices||[];const future=new Date(now+'T12:00:00');future.setDate(future.getDate()+30);const until=dateKey(future);
 const open=invoices.filter(i=>remaining(i)>0).sort((a,b)=>a.due.localeCompare(b.due));
 const payments=invoices.flatMap(i=>i.payments.map(p=>({...p,invoice:i}))).sort((a,b)=>b.date.localeCompare(a.date));
 const events=[...(data.events||[]),...occurrences(data.paymentSchedules||[],now,until).map(s=>({...s,type:repeatLabel(s.schedule)}))].filter(e=>!e.completed&&!e.archived).sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||''));
 return {balance:open.reduce((s,i)=>s+remaining(i),0),open,overdue:open.filter(i=>status(i,now)==='Overdue'),pending:open.filter(i=>status(i,now)==='Pending'),upcoming:open.filter(i=>i.due>=now&&i.due<=until),paid:payments.reduce((s,p)=>s+p.amount,0),payments,todayItems:events.filter(e=>e.date===now),events:events.filter(e=>e.date>=now&&e.date<=until),overdueTasks:events.filter(e=>e.date<now),until};
}

