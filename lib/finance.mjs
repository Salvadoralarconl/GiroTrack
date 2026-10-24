export const today = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
export const remaining = i => Math.max(0, Math.round((Number(i.amount)-(i.payments||[]).reduce((s,p)=>s+Number(p.amount),0))*100)/100);
export const status = (i,now=today()) => i.amount!==null&&i.amount!==undefined&&remaining(i)<=0?'Paid':i.due<now?'Overdue':'Pending';
export const inView = (i,v) => !v || v.kind==='all' || i[v.kind]===v.value;
export function withFullPayment(invoice,payment){const balance=remaining(invoice);return balance<=0?invoice:{...invoice,payments:[...(invoice.payments||[]),{...payment,amount:balance}]};}

export const paidDate = invoice => invoice.amount!==null&&invoice.amount!==undefined&&remaining(invoice)===0 ? invoice.paidAt||(invoice.payments||[]).map(p=>p.date).filter(Boolean).sort().at(-1)||'' : '';
