import {isPaid,today} from './finance.mjs';
export function overdueFirst(a,b,now=today()){
 const overdue=i=>i.overdue!==undefined?i.overdue:!i.ignored&&!i.completed&&!!(i.due||i.date)&&(i.due||i.date)<now&&(i.scheduled||i.kind==='scheduled'||!isPaid(i));
 return Number(overdue(b))-Number(overdue(a))||(a.due||a.date||'9999').localeCompare(b.due||b.date||'9999')||(a.title||'').localeCompare(b.title||'');
}
