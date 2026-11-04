export const today = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
export const remaining = i => Math.max(0, Math.round((Number(i.amount)-(i.payments||[]).reduce((s,p)=>s+Number(p.amount),0))*100)/100);
// Paid: fully paid, or — with no amount entered — marked as paid (paidAt).
export const isPaid = i => i.amount===null||i.amount===undefined||i.amount==='' ? !!i.paidAt : remaining(i)<=0;
export const status = (i,now=today()) => isPaid(i)?'Paid':i.due&&i.due<now?'Overdue':'Pending';
export const inView = (i,v) => !v || v.kind==='all' || i[v.kind]===v.value;
export function withFullPayment(invoice,payment){const balance=remaining(invoice);return balance<=0?invoice:{...invoice,payments:[...(invoice.payments||[]),{...payment,amount:balance}]};}

export const paidDate = invoice => isPaid(invoice) ? invoice.paidAt||(invoice.payments||[]).map(p=>p.date).filter(Boolean).sort().at(-1)||'' : '';

/** What an invoice is for: its description, else its category, else its vendor's category. */
export const description = (invoice, payers = []) => invoice.title || invoice.group || payers.find(p => p.id === invoice.payer)?.category || '';
