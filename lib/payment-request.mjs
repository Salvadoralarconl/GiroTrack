// The printed payment request, laid out like Girosol's paper form (FORM ACC107-1):
// logo, PMT REQUEST, Date, Vendor, Amount, Acct # (with description and amount,
// and the invoice number under it), Instructions, then Request By / Approved By
// with the signature above the line, the name below and the date beside.
import {remaining,today} from './finance.mjs';

const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
const dayDate=s=>s?new Date(s+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}):'';
const shortDate=iso=>{if(!iso)return '';const d=new Date(iso.length===10?iso+'T12:00:00':iso);return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${d.getFullYear()}`;};
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SIGNATURE=/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

/** A signature image placed on its line: x/y as % of the 2.4in × 46pt area (y down), size × the area height. */
function inkImage(signature){const s=typeof signature==='string'?{image:signature}:signature||{};if(!SIGNATURE.test(s.image||''))return '';const p=s.placement||{};const x=Number(p.x)||0,y=Number(p.y)||0,size=Number(p.size)||1;return `<img src="${s.image}" alt="" style="left:${x}%;bottom:${-y}%;height:${(46*size).toFixed(1)}pt">`;}

/** A new request's starting values, from the invoice (as scanned or typed in) first and the vendor second: what's still owed (or the full amount), account #, description, invoice #, instructions. */
export function requestDefaults(invoice,payer){
 const owed=invoice.amount==null?null:remaining(invoice);
 const how=payer?.method?`Pay by ${payer.method.toLowerCase()}`:'Pay';
 const due=invoice.due?` by ${new Date(invoice.due+'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}`:'';
 const mail=/check/i.test(payer?.method||'')&&payer?.address?`\nMail to: ${payer.address.replace(/\s*\n\s*/g,', ')}`:'';
 return {
  date:today(),
  vendor:payer?.name||'',
  amount:owed===null?'':String(owed>0?owed:invoice.amount),
  account:invoice.account||payer?.account||'',
  description:invoice.title||invoice.group||payer?.category||'',
  number:invoice.number||'',
  instructions:invoice.instructions||`${how}${due}.${mail}`,
 };
}

/**
 * A complete, self-contained printable page (letter size) for a saved request.
 * `logo` is an absolute URL; each signature is {image, placement} or a bare data URL (anything but an image data URL is ignored). Every value is escaped.
 */
export function requestDocument(r,{logo='',requestedSignature='',approvedSignature=''}={}){
 const amount=Number.isFinite(Number(r.amount))&&r.amount!==''?money(Number(r.amount)):'';
 const row=(label,value,extra='')=>`<div class="row"><div class="label">${label}</div><div class="value">${value}</div>${extra}</div>`;
 const sign=(label,signature,name,date)=>`<div class="sign"><div class="label">${label}</div><div class="sig"><div class="ink">${inkImage(signature)}</div><div class="line"></div><div class="name">${escape(name)}</div></div><div class="date"><b>Date:</b> ${escape(date)}</div></div>`;
 return `<!doctype html><html><head><meta charset="utf-8"><title>PMT REQUEST — ${escape(r.vendor)}</title><style>
@page{size:letter;margin:0}
*{box-sizing:border-box}
body{margin:0;padding:0.6in 0.7in;font:12pt/1.35 "Times New Roman",Times,serif;color:#000}
.box{border:1.5pt solid #000;padding:14pt 18pt 36pt;min-height:9.1in}
.head{text-align:center}
.head img{width:2.3in;height:auto}
.head h1{margin:2pt 0 18pt;font-size:12pt;font-style:italic;font-weight:bold;text-decoration:underline}
.label{width:1.6in;flex:none;font-weight:bold;text-decoration:underline}
.row{display:flex;align-items:baseline;gap:8pt;margin:0 0 30pt}
.value{flex:1;font-weight:bold;word-break:break-word}
.acct{display:flex;gap:16pt}.acct .acct-amount{margin-left:auto;text-align:right;white-space:nowrap}
.invoice{display:block;margin-top:6pt;font-weight:normal}
.instructions{white-space:pre-wrap;font-weight:bold}
.sign{display:flex;align-items:flex-end;gap:8pt;margin-top:34pt}
.sign>.label{margin-bottom:21pt}
.sig{width:2.4in;flex:none}
.ink{height:46pt;position:relative}
.ink img{position:absolute;max-width:none}
.line{border-bottom:1pt solid #000}
.name{min-height:16pt;margin-top:4pt;font-weight:bold}
.date{margin-left:auto;text-align:right;white-space:nowrap;align-self:center;font-weight:bold}
.date b{margin-right:4pt}
.form{margin-top:10pt;font:9pt Arial,sans-serif}
</style></head><body>
<div class="box">
<div class="head">${logo?`<img src="${escape(logo)}" alt="Girosol">`:'<div style="font:bold 26pt Arial">GIROSOL</div>'}<h1>PMT REQUEST</h1></div>
${row('DATE:',escape(dayDate(r.date)))}
${row('VENDOR:',escape(r.vendor))}
${row('AMOUNT :',escape(amount))}
${row('ACCT #',`<div class="acct">${r.account?`<span>${escape(r.account)}</span>`:''}${r.description?`<span>${escape(r.description)}</span>`:''}${amount?`<span class="acct-amount">${escape(amount)}</span>`:''}</div>${r.number?`<span class="invoice">Invoice #: ${escape(r.number)}</span>`:''}`)}
${row('INSTRUCTIONS:',`<div class="instructions">${escape(r.instructions)}</div>`)}
${sign('Request By:',requestedSignature,r.requestedBy,shortDate(r.requestedAt||r.date))}
${sign('Approved By:',approvedSignature,r.status==='approved'?r.approvedBy:'',r.status==='approved'?shortDate(r.approvedAt):'')}
</div>
<div class="form">FORM ACC107-1</div>
</body></html>`;
}
