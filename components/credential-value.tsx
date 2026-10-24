'use client';
import {useEffect,useRef,useState} from 'react';
import {Copy,Check} from 'lucide-react';
export default function CredentialValue({payer,kind,displayValue=null}:{payer:any,kind:'username'|'password',displayValue?:string|null}){
 const [busy,B]=useState(false),[copied,C]=useState(false),[error,E]=useState('');const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
 async function copy(){if(busy)return;B(true);E('');C(false);try{let value=payer.username||'';if(kind==='password'){const r=await fetch('/api/credentials?payer='+encodeURIComponent(payer.id),{cache:'no-store'});const j:any=await r.json();if(!r.ok)throw Error(j.error||'Could not load password.');if(!j.exists||!j.password)throw Error('No password saved. Add one in View Credentials.');value=j.password;}if(!value)throw Error('No username saved.');if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable in this browser.');await navigator.clipboard.writeText(value);C(true);if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>C(false),2500);}catch(e:any){E(e.name==='NotAllowedError'?'Clipboard access was blocked. Allow clipboard access and retry.':e.message||'Could not copy. Please retry.');}finally{B(false);}}
 return <div className={'credential-value '+kind}><div><span className={kind==='password'&&displayValue===null?'password':''}>{kind==='password'?(displayValue??'••••••••••••'):payer.username||'Not added'}</span><button type="button" className="credential-copy" onClick={copy} disabled={busy||(kind==='username'&&!payer.username)} aria-label={copied?`${kind} copied`:`Copy ${kind}`} title={copied?'Copied!':busy?'Copying…':`Copy ${kind}`}>{copied?<Check size={13}/>:<Copy size={13}/>}</button></div>{(copied||error)&&<small role="status" className={error?'copy-error':'copy-success'}>{error||'Copied!'}</small>}</div>;
}

