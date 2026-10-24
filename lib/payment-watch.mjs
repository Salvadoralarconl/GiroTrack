import {occurrences} from './payment-schedules.mjs';
import {remaining,today} from './finance.mjs';
import {dateKey} from './calendar.mjs';
export function paymentWatch(data,now=today()){
 const end=new Date(now+'T12:00:00');end.setDate(end.getDate()+30);const until=dateKey(end);
 const start=(data.paymentSchedules||[]).reduce((min,s)=>s.start&&s.start<min?s.start:min,now);
 const scheduled=occurrences(data.paymentSchedules||[],start,until).filter(o=>![...(data.ignoredPayments||[]),...(data.deletedPayments||[])].some(i=>i.scheduleId===o.scheduleId&&i.date===o.date)).filter(o=>!data.invoices.some(i=>i.scheduleId===o.scheduleId&&i.scheduledDate===o.date)).map(o=>({...o,due:o.date,scheduled:true}));
 const open=data.invoices.filter(i=>i.amount==null||remaining(i)>0);
 return {pending:[...open,...scheduled].sort((a,b)=>a.due.localeCompare(b.due)),overdue:[...open,...scheduled].filter(i=>i.due<now).sort((a,b)=>a.due.localeCompare(b.due)),upcoming:[...open.filter(i=>i.due>=now&&i.due<=until),...scheduled.filter(i=>i.due>=now)].sort((a,b)=>a.due.localeCompare(b.due))};
}
