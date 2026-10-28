import {scryptSync,timingSafeEqual,createHmac} from 'node:crypto';
export const hex = bytes => Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
export async function digest(text){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));}
export async function hashPassword(password,salt=hex(crypto.getRandomValues(new Uint8Array(16)))){
 const N=32768,r=8,p=3;
 const hash=scryptSync(password,salt,32,{N,r,p,maxmem:64*1024*1024}).toString('hex');
 return {algorithm:'scrypt',N,r,p,salt,hash};
}
export async function verifyPassword(password,user){
 if(!user||!/^([a-f0-9]{32})$/.test(user.salt)||!/^([a-f0-9]{64})$/.test(user.hash))return false;
 let hash;
 if(user.algorithm==='scrypt'){
  if(user.N!==32768||user.r!==8||user.p!==3)return false;
  hash=scryptSync(password,user.salt,32,{N:user.N,r:user.r,p:user.p,maxmem:64*1024*1024}).toString('hex');
 }else if(!user.algorithm){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  hash=hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(user.salt),iterations:100000,hash:'SHA-256'},key,256));
 }else return false;
 return timingSafeEqual(Buffer.from(hash,'hex'),Buffer.from(user.hash,'hex'));
}
export const publicUser=u=>({id:u.id,name:u.name,email:u.email,role:u.role==='Manager'?'Manager':'Member',authenticator:!!u.totp});
export function attributedActivity(previous,submitted,user,now){const known=new Set(previous.map(a=>a.id));const additions=submitted.filter(a=>!known.has(a.id));return [...additions.map(a=>({id:a.id,text:String(a.text||'Workspace updated').slice(0,1000),invoice:a.invoice||null,actor:user.name,actorId:user.id,time:now})),...previous];}
// Authenticator app codes (RFC 6238: SHA-1, 6 digits, 30-second steps), as Google Authenticator expects.
const BASE32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes){let bits=0,value=0,out='';for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){out+=BASE32[(value>>>(bits-5))&31];bits-=5;value&=(1<<bits)-1;}}return bits?out+BASE32[(value<<(5-bits))&31]:out;}
function fromBase32(text){let bits=0,value=0;const out=[];for(const char of text){const index=BASE32.indexOf(char);if(index<0)throw Error('Invalid authenticator key.');value=(value<<5)|index;bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8;value&=(1<<bits)-1;}}return Buffer.from(out);}
export function totpCode(secret,step){const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));const mac=createHmac('sha1',fromBase32(secret)).update(counter).digest();return String((mac.readUInt32BE(mac[19]&15)&0x7fffffff)%1000000).padStart(6,'0');}
// Accepts one step of clock drift either way; a step at or before `after` was already used.
export function matchTotp(secret,code,after=-1,now=Date.now()){if(!/^\d{6}$/.test(code))return null;const step=Math.floor(now/30000);for(const candidate of [step-1,step,step+1])if(candidate>after&&timingSafeEqual(Buffer.from(totpCode(secret,candidate)),Buffer.from(code)))return candidate;return null;}
