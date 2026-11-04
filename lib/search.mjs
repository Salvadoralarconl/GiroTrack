// Invoice list search: every word typed must appear somewhere in the item —
// invoice #, vendor, description, account #, instructions, notes, amount (125, 125.00,
// $125.00, 1,250), dates in several spellings (2026-11-11, 11/11/2026, 11/11, Nov 11,
// November 11), status and how it repeats.
const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
function dateWords(iso){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(iso||''))return '';
 const [y,m,d]=iso.split('-').map(Number),name=MONTHS[m-1];
 return [iso,`${m}/${d}/${y}`,`${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')}/${y}`,`${m}/${d}`,`${name} ${d}`,`${name.slice(0,3)} ${d}`,name,String(y)].join(' ');
}
function amountWords(n){
 if(n===null||n===undefined||n===''||!Number.isFinite(Number(n)))return '';
 const v=Number(n);
 return [String(v),v.toFixed(2),'$'+v.toFixed(2),v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),'$'+v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})].join(' ');
}
/** All the searchable text of one list item (an invoice, or a scheduled payment with `scheduled`). */
export function searchText(item,{payerName='',status='',repeat=''}={}){
 return [item.number,item.title,payerName,item.account,item.instructions,item.notes,item.group,status,repeat,amountWords(item.amount),dateWords(item.due||item.date),dateWords(item.paidAt),...(item.payments||[]).flatMap(p=>[dateWords(p.date),amountWords(p.amount),p.method,p.reference])].filter(Boolean).join(' ').toLowerCase();
}
/** True when every word of `query` is in `text` (an empty query matches everything). */
export function matchesSearch(text,query){
 const words=String(query||'').toLowerCase().split(/\s+/).filter(Boolean);
 return words.every(w=>text.includes(w));
}
