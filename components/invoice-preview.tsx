'use client';
import {useEffect,useRef,useState} from 'react';
export default function InvoicePreview({file,attachments=[]}:any){
 const host=useRef<HTMLDivElement>(null);
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(true);
 const pdf=attachments.find((f:any)=>/\.pdf$/i.test(f.name));
 const id=pdf?.id;
 useEffect(()=>{
  let cancelled=false,task:any;
  const container=host.current;
  if(container)container.replaceChildren();
  setError('');setLoading(true);
  if(!file&&!id){setLoading(false);return;}
  (async()=>{
   try{
    const pdfjs=await import('pdfjs-dist');
    if(cancelled)return;
    pdfjs.GlobalWorkerOptions.workerSrc='/invoice-tools/pdf.worker.min.mjs';
    const source=file?{data:new Uint8Array(await file.arrayBuffer())}:{url:'/api/files?id='+encodeURIComponent(id)+'&inline=1'};
    if(cancelled)return;
    task=pdfjs.getDocument({...source,standardFontDataUrl:'/invoice-tools/standard_fonts/',cMapUrl:'/invoice-tools/cmaps/',cMapPacked:true,wasmUrl:'/invoice-tools/wasm/'});
    const doc=await task.promise;
    for(let n=1;n<=doc.numPages&&!cancelled;n++){
     const page=await doc.getPage(n);
     if(cancelled)break;
     const viewport=page.getViewport({scale:Math.min(2,1600/page.getViewport({scale:1}).width)});
     const canvas=document.createElement('canvas');
     canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
     canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Invoice PDF page '+n);
     await page.render({canvas,viewport}).promise;
     if(cancelled)break;
     container?.appendChild(canvas);setLoading(false);page.cleanup();
    }
   }catch{if(!cancelled)setError('Could not display this PDF.');}
   finally{if(!cancelled)setLoading(false);}
  })();
  return()=>{cancelled=true;if(task)void task.destroy().catch(()=>{});container?.replaceChildren();};
 },[file,id]);
 if(!file&&!id)return null;
 return <section className="invoice-document-preview clean-pdf-preview" aria-label="Invoice PDF preview" onClick={e=>e.stopPropagation()}>{loading&&<p className="pdf-preview-message" role="status">Loading PDF…</p>}{error&&<p className="pdf-preview-message" role="alert">{error}</p>}<div ref={host} className="pdf-preview-pages"/></section>;
}

