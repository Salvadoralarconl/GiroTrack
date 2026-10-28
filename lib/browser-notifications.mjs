import {paymentWatch} from './payment-watch.mjs';
import {remaining,paidDate} from './finance.mjs';
import {dateKey} from './calendar.mjs';
// Browser notifications shown while GiroTrack is open. Each type is shown at most once per day per browser;
// summaries wait until 8 AM, payment alerts show whenever GiroTrack is open.
export const SUMMARY_HOUR=8;
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
const plural=(n,word)=>`${n} ${word}${n===1?'':'s'}`;
const addDays=(now,days)=>dateKey(new Date(now.getFullYear(),now.getMonth(),now.getDate()+days));
const label=(data,item)=>data.payers?.find(p=>p.id===item.payer)?.name||item.title||'Payment';
const amountOf=item=>item.scheduled?item.amount:item.amount==null?undefined:remaining(item);
const shortDate=key=>new Date(key+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
// Overdue and upcoming payments include their due date, so repeated payments to one vendor can be told apart.
function describe(data,items,withDate=false,limit=3){
 const names=items.slice(0,limit).map(item=>{const details=[amountOf(item)&&money(amountOf(item)),withDate&&shortDate(item.due)].filter(Boolean);return details.length?`${label(data,item)} (${details.join(', ')})`:label(data,item);});
 return names.join(', ')+(items.length>limit?` and ${items.length-limit} more`:'');
}
const total=items=>items.reduce((sum,item)=>sum+(amountOf(item)||0),0);
export function notificationsToShow(data,settings,now=new Date(),sent={}){
 const day=dateKey(now),watch=paymentWatch(data,day);
 const overdue=watch.overdue,dueToday=watch.pending.filter(i=>i.due===day);
 const soon=watch.pending.filter(i=>i.due>day&&i.due<=addDays(now,3)),week=watch.pending.filter(i=>i.due>=day&&i.due<=addDays(now,6));
 const out=[],add=(type,title,body)=>{const key=`${type}:${day}`;if(settings?.[type]&&!sent[key])out.push({key,type,title,body});};
 if(now.getHours()>=SUMMARY_HOUR){
  const parts=[overdue.length&&`${plural(overdue.length,'payment')} overdue`,dueToday.length&&`${plural(dueToday.length,'payment')} due today`,soon.length&&`${soon.length} coming up in the next 3 days`].filter(Boolean);
  add('daily','Today in GiroTrack',parts.length?parts.join(' · '):'Nothing due today. You are all caught up.');
  if(now.getDay()===1){
   const lastWeek=(data.invoices||[]).filter(i=>{const paid=paidDate(i);return paid&&paid>=addDays(now,-7)&&paid<day;});
   const ahead=week.length?`${plural(week.length,'payment')} due this week${total(week)?` (${money(total(week))})`:''}`:'No payments due this week';
   add('weekly','This week in GiroTrack',[ahead,overdue.length&&`${overdue.length} overdue`,`${lastWeek.length} paid last week`].filter(Boolean).join(' · '));
  }
 }
 if(overdue.length)add('overdue',`${plural(overdue.length,'payment')} overdue`,describe(data,overdue,true));
 if(dueToday.length)add('due',`${plural(dueToday.length,'payment')} due today`,describe(data,dueToday));
 if(soon.length)add('upcoming',`${plural(soon.length,'payment')} coming up`,`${describe(data,soon,true)} in the next 3 days`);
 return out;
}
// Keep two weeks of "already shown" keys.
export function pruneSent(sent,now=new Date()){const cutoff=addDays(now,-14);return Object.fromEntries(Object.entries(sent||{}).filter(([key])=>key.slice(key.indexOf(':')+1)>=cutoff));}
