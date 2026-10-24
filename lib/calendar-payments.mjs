import {occurrences} from './payment-schedules.mjs';
import {remaining} from './finance.mjs';
export function calendarPayments(data,from,to,now){
 const start=(data.paymentSchedules||[]).reduce((min,s)=>s.start&&s.start<min?s.start:min,from);
 return occurrences(data.paymentSchedules||[],start,to).filter(o=>!(data.deletedPayments||[]).some(d=>d.scheduleId===o.scheduleId&&d.date===o.date)).map(o=>{const invoice=data.invoices.find(i=>i.scheduleId===o.scheduleId&&i.scheduledDate===o.date);const ignored=(data.ignoredPayments||[]).some(i=>i.scheduleId===o.scheduleId&&i.date===o.date);const completed=!!invoice&&invoice.amount!=null&&remaining(invoice)===0;return {...o,completed,ignored,overdue:o.date<now&&!completed&&!ignored};}).filter(o=>o.date>=from||(o.overdue&&from<=now&&to>=now));
}
