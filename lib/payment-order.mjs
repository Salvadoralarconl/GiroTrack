import {remaining,today} from './finance.mjs';
export function overdueFirst(a,b,now=today()){
 const overdue=i=>i.overdue!==undefined?i.overdue:!i.ignored&&!i.completed&&(i.due||i.date)<now&&(i.scheduled||i.kind==='scheduled'||i.amount==null||remaining(i)>0);
 return Number(overdue(b))-Number(overdue(a))||(a.due||a.date||'').localeCompare(b.due||b.date||'')||(a.title||'').localeCompare(b.title||'');
}
