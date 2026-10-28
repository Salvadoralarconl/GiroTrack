'use client';
import {useEffect} from 'react';
import {notificationsToShow,pruneSent} from '../lib/browser-notifications.mjs';
import {NOTIFICATIONS_CHANGED,showNotification} from '../lib/browser-notify';
// Shows the person's chosen browser notifications while GiroTrack is open in any tab.
export default function PaymentNotifier({user}:any){
 useEffect(()=>{
  if(typeof window==='undefined'||!('Notification' in window))return;
  let stopped=false;const storeKey='girotrack-notified:'+user.id;
  async function check(){
   if(stopped||Notification.permission!=='granted')return;
   try{
    const [account,workspace]=await Promise.all([
     fetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'notifications'})}),
     fetch('/api/workspace',{cache:'no-store'})]);
    if(!account.ok||!workspace.ok)return;
    const {settings}:any=await account.json(),{data}:any=await workspace.json();
    let sent:Record<string,boolean>={};try{sent=JSON.parse(localStorage.getItem(storeKey)||'{}');}catch{}
    const now=new Date(),due=notificationsToShow(data,settings,now,sent);
    for(const note of due){showNotification(note.title,note.body,note.key);sent[note.key]=true;}
    try{localStorage.setItem(storeKey,JSON.stringify(pruneSent(sent,now)));}catch{}
   }catch{}
  }
  // One tab at a time, so several open tabs do not show the same notification.
  const run=()=>navigator.locks?navigator.locks.request('girotrack-notifier',check):check();
  run();const timer=setInterval(run,5*60000);
  const visible=()=>{if(document.visibilityState==='visible')run();};
  document.addEventListener('visibilitychange',visible);window.addEventListener(NOTIFICATIONS_CHANGED,run);
  return()=>{stopped=true;clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener(NOTIFICATIONS_CHANGED,run);};
 },[user.id]);
 return null;
}
