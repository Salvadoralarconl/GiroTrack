'use client';

import {useEffect,useId,useRef} from 'react';

const SWIRL='M370,385 C430,385 475,405 498,432 C522,458 522,500 492,538 C440,577 408,622 408,672 C408,762 478,830 565,843 C640,856 685,902 685,962 C685,1030 625,1085 550,1085 C470,1085 415,1025 415,962 L415,940 C415,862 370,802 300,772 C228,740 178,680 178,592 C178,480 262,385 370,385 Z';
const REVERSE=SWIRL.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g,(_,x,y)=>`${1260-Number(x)},${1260-Number(y)}`);
const DOT='M785,642A133,133 0 1,0 519,642A133,133 0 1,0 785,642Z';
const pieces=[
 {path:SWIRL,origin:[400/1250,720/1250],home:[.31,.50],rotation:18},
 {path:REVERSE,origin:[860/1250,540/1250],home:[.69,.50],rotation:-16},
 {path:DOT,origin:[652/1250,642/1250],home:[.50,.31],rotation:0},
];
const ease=(x:number)=>(1-Math.cos(Math.PI*x))/2;
const mix=(a:number,b:number,k:number)=>a+(b-a)*k;
function assembly(seconds:number){const t=seconds%56;if(t<22)return 0;if(t<32)return ease((t-22)/10);if(t<46)return 1;if(t<56)return 1-ease((t-46)/10);return 0;}

/** Local, decorative motion adapted from the supplied GiroTrack animation. */
export default function LoginAnimation(){
 const stage=useRef<HTMLDivElement>(null),shapes=useRef<(HTMLDivElement|null)[]>([]);
 const id=useId().replace(/:/g,'');
 useEffect(()=>{
  const root=stage.current;if(!root)return;
  const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
  let width=root.clientWidth,height=root.clientHeight,frame=0,start=performance.now();
  let mx=0,my=0,targetX=0,targetY=0;
  const resize=new ResizeObserver(()=>{width=root.clientWidth;height=root.clientHeight;sync();});resize.observe(root);
  const pointer=(event:PointerEvent)=>{
   if(event.pointerType==='touch')return;
   const bounds=root.getBoundingClientRect(),dx=event.clientX-(bounds.left+bounds.width/2),dy=event.clientY-(bounds.top+bounds.height/2);
   const radius=Math.max(1,Math.min(bounds.width,bounds.height)*.38),proximity=Math.max(0,1-Math.hypot(dx,dy)/radius);
   const influence=proximity*proximity*(3-2*proximity);
   targetX=dx/radius*influence*2;targetY=dy/radius*influence*2;
  };
  const pointerLeave=()=>{targetX=targetY=0;};
  function draw(now:number){
   if(document.hidden)return;
   const reduced=preference.matches,t=reduced?0:(now-start)/1000+12;
   const size=Math.min(width,height),logo=size*.44,k=reduced?0:assembly(t),amp=reduced?0:1;
   mx+=(targetX-mx)*.045;my+=(targetY-my)*.045;
   const breathe=1+.01*Math.sin(t*.5)*k;
   pieces.forEach((piece,i)=>{
    const element=shapes.current[i];if(!element)return;
    const orbit=reduced?0:t*.025,dx=(piece.home[0]-.5)*size,dy=(piece.home[1]-.5)*size;
    const homeX=width/2+dx*Math.cos(orbit)-dy*Math.sin(orbit),homeY=height/2+dx*Math.sin(orbit)+dy*Math.cos(orbit);
    const x=homeX+amp*3*Math.sin(t*.008*Math.PI*2+i*1.7)+(reduced?0:mx*(18+i*5));
    const y=homeY+amp*3*Math.sin(t*.007*Math.PI*2+i*2.3)+(reduced?0:my*(18+i*5));
    const rotation=piece.rotation+amp*2*Math.sin(t*.006*Math.PI*2+i*1.7);
    element.style.width=element.style.height=logo+'px';
    element.style.transform=`translate(${mix(x-piece.origin[0]*logo,width/2-logo/2+(reduced?0:mx*18),k)}px,${mix(y-piece.origin[1]*logo,height/2-logo/2+(reduced?0:my*18),k)}px) rotate(${mix(rotation,0,k)}deg) scale(${mix(.6,1,k)*breathe})`;
   });
   if(!reduced)frame=requestAnimationFrame(draw);
  }
  function sync(){cancelAnimationFrame(frame);if(!document.hidden)frame=requestAnimationFrame(draw);}
  const motionChanged=()=>{mx=my=targetX=targetY=0;start=performance.now();sync();};
  window.addEventListener('pointermove',pointer,{passive:true});document.addEventListener('pointerleave',pointerLeave);document.addEventListener('visibilitychange',sync);preference.addEventListener('change',motionChanged);sync();
  return()=>{cancelAnimationFrame(frame);resize.disconnect();window.removeEventListener('pointermove',pointer);document.removeEventListener('pointerleave',pointerLeave);document.removeEventListener('visibilitychange',sync);preference.removeEventListener('change',motionChanged);};
 },[]);
 return <div className="login-animation" ref={stage} aria-hidden="true">
  <svg className="login-animation-defs" width="0" height="0"><defs>
   <radialGradient id={id+'-ink'} cx=".34" cy=".26" r=".85"><stop offset="0" stopColor="#3a3d44"/><stop offset=".38" stopColor="#1d1f24"/><stop offset="1" stopColor="#08090b"/></radialGradient>
   <radialGradient id={id+'-blue'} cx=".34" cy=".26" r=".85"><stop offset="0" stopColor="#37414f"/><stop offset=".4" stopColor="#1b2029"/><stop offset="1" stopColor="#07080b"/></radialGradient>
  </defs></svg>
  {pieces.map((piece,i)=><div className="login-animation-shape login-animation-piece" key={i} ref={element=>{shapes.current[i]=element;}} style={{transformOrigin:`${piece.origin[0]*100}% ${piece.origin[1]*100}%`}}><svg viewBox="0 0 1250 1250"><path d={piece.path} fill={`url(#${id+(i===2?'-blue':'-ink')})`} fillRule="evenodd"/></svg></div>)}

 </div>;
}
