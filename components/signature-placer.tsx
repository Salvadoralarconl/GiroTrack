'use client';
import {useRef,useState} from 'react';
// Drag the signature onto its line and resize it, as it will print on payment requests.
// The area uses the printout's own CSS units (lib/payment-request.mjs: .sig 2.4in wide, .ink 46pt tall), so the browser
// lays both out identically: x/y are % of the area (y down), size × its height.
export const DEFAULT_PLACEMENT={x:0,y:0,size:1};
const clamp=(v:number,min:number,max:number)=>Math.min(max,Math.max(min,v));
export default function SignaturePlacer({image,placement,busy,onSave}:{image:string,placement:any,busy:boolean,onSave:(p:any)=>Promise<void>}){
 const [p,P]=useState(placement||DEFAULT_PLACEMENT);const drag=useRef<{x:number,y:number,w:number,h:number,start:any}|null>(null);const area=useRef<HTMLDivElement>(null);
 const dirty=JSON.stringify(p)!==JSON.stringify(placement||DEFAULT_PLACEMENT);
 return <div className="signature-placer">
  <div className="signature-placer-area" ref={area} style={{width:'2.4in',height:'46pt'}}>
   <img src={image} alt="Your signature" draggable={false} style={{left:p.x+'%',bottom:-p.y+'%',height:`calc(46pt * ${p.size})`}}
    onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);const r=area.current!.getBoundingClientRect();drag.current={x:e.clientX,y:e.clientY,w:r.width,h:r.height,start:p};}}
    onPointerMove={e=>{const d=drag.current;if(!d)return;P({...d.start,x:clamp(Math.round((d.start.x+(e.clientX-d.x)/d.w*100)*10)/10,-60,60),y:clamp(Math.round((d.start.y+(e.clientY-d.y)/d.h*100)*10)/10,-80,80)});}}
    onPointerUp={()=>{drag.current=null;}}/>
   <div className="signature-placer-line"/>
  </div>
  <label className="signature-placer-size">Size<input type="range" min="0.4" max="2.5" step="0.05" value={p.size} onChange={e=>P({...p,size:Number(e.target.value)})}/></label>
  <div className="signature-placer-actions"><small className="muted">Drag the signature so it sits on the line.</small><button type="button" disabled={busy} onClick={()=>P(DEFAULT_PLACEMENT)}>Reset</button><button type="button" className="primary" disabled={busy||!dirty} onClick={()=>onSave(p)}>{dirty?'Save position':'Saved'}</button></div>
 </div>;
}
/** Crop the empty margin (white or transparent) around a signature image so it starts close to the line. */
export function trimSignature(dataUrl:string):Promise<string>{
 return new Promise(resolve=>{const img=new Image();img.onload=()=>{try{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const g=c.getContext('2d')!;g.drawImage(img,0,0);const {data,width,height}=g.getImageData(0,0,c.width,c.height);let x0=width,y0=height,x1=-1,y1=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;if(data[i+3]>20&&(data[i]<235||data[i+1]<235||data[i+2]<235)){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}}
  if(x1<0){resolve(dataUrl);return;}const pad=4;x0=Math.max(0,x0-pad);y0=Math.max(0,y0-pad);x1=Math.min(width-1,x1+pad);y1=Math.min(height-1,y1+pad);
  const out=document.createElement('canvas');out.width=x1-x0+1;out.height=y1-y0+1;out.getContext('2d')!.drawImage(c,x0,y0,out.width,out.height,0,0,out.width,out.height);const trimmed=out.toDataURL('image/png');
  resolve(trimmed.length*0.75<=300*1024?trimmed:dataUrl);}catch{resolve(dataUrl);}};img.onerror=()=>resolve(dataUrl);img.src=dataUrl;});
}
