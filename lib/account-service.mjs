import {digest,hex,hashPassword,verifyPassword,publicUser,base32,matchTotp} from './account-core.mjs';
import {keyring,encryptSecret,decryptSecret,totpAad} from './vault.mjs';
// Server-side session lifetime (the cookie itself is a browser-session cookie, see sessionCookie).
export const SESSION_SECONDS=7*24*60*60;
// A tab's sign-in lasts while the tab keeps checking in (every minute, which background tabs still manage); 3 minutes
// after the last check-in it ends. When a page closes or reloads it reports it (tab-suspend): its token then only works
// to resume, for 15 seconds. The 3-minute limit covers pages that vanish without reporting (crash, killed browser).
export const TAB_IDLE_MS=3*60*1000,TAB_HANDOFF_MS=15*1000;
// Sign-in limits: 10 failed passwords per account start a 15-minute lockout; 100 failures from one address block it for 15 minutes.
export const SIGN_IN_LIMIT=10,SIGN_IN_LOCK_MS=15*60*1000,IP_FAILURE_LIMIT=100;
// Each person's notification choices; payment alerts start on, summaries start off.
export const NOTIFICATION_DEFAULTS={daily:false,weekly:false,upcoming:true,due:true,overdue:true};
const headers={'Cache-Control':'no-store'};
const LOCKED_MESSAGE='Too many failed sign-in attempts. Try again in 15 minutes.';
export const unauthorized=()=>Response.json({error:'Sign in to continue.'},{status:401,headers});
export function safeMutation(request){const origin=request.headers.get('origin');return request.headers.get('sec-fetch-site')!=='cross-site'&&(!origin||origin===new URL(request.url).origin);}
// No Max-Age: the browser drops it when the browser session ends. It alone never signs anyone in; every request also needs its tab's token (TAB_HEADER).
export function sessionCookie(request,token,clear=false){return `girotrack_session=${token}; Path=/; HttpOnly; SameSite=Strict${clear?'; Max-Age=0':''}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
export const TAB_HEADER='x-girotrack-tab';
/** Accounts are found by their email, trimmed and lower-cased; every sign-in path uses this. */
export const normalizeEmail=value=>String(value||'').trim().toLowerCase();
const TOKEN=/^[a-f0-9]{64}$/;
function tokenFor(request){const t=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('girotrack_session='))?.slice(18);return t&&TOKEN.test(t)?t:null;}
function tabTokenFor(request){const t=request.headers.get(TAB_HEADER);return t&&TOKEN.test(t)?t:null;}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
/**
 * The address sign-in throttling counts against. Behind IIS every request comes
 * from 127.0.0.1, so the visitor's address is IIS's X-Forwarded-For, trusted
 * only when IIS also sends the shared GIROTRACK_PROXY_SECRET (a client can't
 * forge it). Otherwise all requests share one bucket ("direct").
 */
export function clientAddress(request,config={}){
 const secret=config.GIROTRACK_PROXY_SECRET;
 if(!secret||!equal(request.headers.get('x-girotrack-proxy')||'',secret))return 'direct';
 const last=(request.headers.get('x-forwarded-for')||'').split(',').map(s=>s.trim()).filter(Boolean).pop();
 if(!last)return 'direct';
 // IIS may add the port: "203.0.113.5:51234" or "[2001:db8::1]:51234".
 const bracket=last.match(/^\[([^\]]+)\](?::\d+)?$/);if(bracket)return bracket[1].toLowerCase();
 return (/^[\d.]+:\d+$/.test(last)?last.slice(0,last.lastIndexOf(':')):last).toLowerCase();
}
export function createAccountService(db,config){
 const env=typeof config==='string'||config==null?{GIROTRACK_VAULT_KEY:config}:config;
 let ring;const vault=()=>(ring??=keyring(env));
 const readAuthRow=async id=>{const row=await db.prepare('SELECT data FROM workspace WHERE id=?').bind(id).first();return row?JSON.parse(row.data):null;};
 const writeAuthRow=async(id,value)=>{await db.prepare('INSERT INTO workspace (id,data,version) VALUES (?,?,0) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=version+1').bind(id,JSON.stringify(value)).run();};
 const removeRow=id=>db.prepare('DELETE FROM workspace WHERE id=?').bind(id).run();
 const hasAccounts=async()=>!!await db.prepare("SELECT id FROM workspace WHERE substr(id,1,10)='auth:user:' LIMIT 1").first();
 const allUsers=async()=>(await db.prepare("SELECT data FROM workspace WHERE substr(id,1,10)='auth:user:'").all()).results.map(row=>JSON.parse(row.data));
 // Accounts created before roles existed: the earliest one becomes the Manager, the rest Members.
 async function assignRoles(){
  const users=await allUsers();if(users.some(u=>u.role==='Manager'))return;
  users.sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||''))||a.id.localeCompare(b.id));
  for(const [index,user] of users.entries())await writeAuthRow('auth:user:'+user.id,{...user,role:index?'Member':'Manager'});
 }
 /** The cookie's session, when valid: {id, row}. */
 async function cookieSession(request){
  const token=tokenFor(request);if(!token)return null;
  const id='auth:session:'+await digest(token),row=await readAuthRow(id);
  if(!row||!Number.isFinite(row.expires)||row.expires<=Date.now()||typeof row.userId!=='string')return null;
  return {id,row};
 }
 /**
  * The signed-in person for this request: a valid session cookie AND a valid,
  * unexpired token for one of its tabs. Each request keeps the tab alive.
  */
 async function currentUser(request){
  const tab=tabTokenFor(request);if(!tab)return null;
  const session=await cookieSession(request);if(!session)return null;
  const tabId='auth:tab:'+await digest(tab),tabRow=await readAuthRow(tabId),now=Date.now();
  if(!tabRow||tabRow.suspended||tabRow.session!==session.id||tabRow.userId!==session.row.userId||!(tabRow.expires>now))return null;
  if(tabRow.expires-now<TAB_IDLE_MS-60000)await writeAuthRow(tabId,{...tabRow,expires:Math.min(now+TAB_IDLE_MS,session.row.expires)});
  let user=await readAuthRow('auth:user:'+session.row.userId);
  if(user&&!user.role){await assignRoles();user=await readAuthRow('auth:user:'+session.row.userId);}
  return user&&user.id===session.row.userId?publicUser(user):null;
 }
 const seal=(secret,userId)=>encryptSecret(vault(),secret,totpAad(userId));
 const unseal=(box,userId)=>decryptSecret(vault(),box,totpAad(userId));
 const tooMany=(until,message='Too many attempts. Please try again later.')=>Response.json({error:message},{status:429,headers:{...headers,'Retry-After':String(Math.max(1,Math.ceil((until-Date.now())/1000)))}});
 const newTab=async(sessionId,userId,expires)=>{const tab=hex(crypto.getRandomValues(new Uint8Array(32)));await writeAuthRow('auth:tab:'+await digest(tab),{session:sessionId,userId,expires:Math.min(Date.now()+TAB_IDLE_MS,expires),createdAt:new Date().toISOString()});return tab;};
 /** Sign this tab in. The browser's session cookie is reused for the same person (other signed-in tabs keep working). */
 async function signIn(request,user){
  const now=Date.now();
  // Abandoned tabs and sessions are removed here.
  await db.prepare("DELETE FROM workspace WHERE (substr(id,1,9)='auth:tab:' OR substr(id,1,13)='auth:session:') AND json_extract(data,'$.expires')<=?").bind(now).run();
  const existing=await cookieSession(request);let sessionId,expires,cookie=null;
  if(existing&&existing.row.userId===user.id){sessionId=existing.id;expires=existing.row.expires;}
  else{
   const token=hex(crypto.getRandomValues(new Uint8Array(32)));sessionId='auth:session:'+await digest(token);expires=now+SESSION_SECONDS*1000;
   await writeAuthRow(sessionId,{userId:user.id,expires});cookie=sessionCookie(request,token);
  }
  const tabToken=await newTab(sessionId,user.id,expires);
  return Response.json({user:publicUser(user),tabToken},{headers:cookie?{...headers,'Set-Cookie':cookie}:headers});
 }
 /** A reloaded tab trades its token for a new one; a copied token (duplicated tab) stops working once either copy resumes. */
 async function resumeTab(request){
  const tab=tabTokenFor(request),session=await cookieSession(request);
  if(!tab||!session)return unauthorized();
  const tabId='auth:tab:'+await digest(tab);
  // Deleting first makes the trade single-use even when two copies resume at once.
  const removed=await db.prepare('DELETE FROM workspace WHERE id=? RETURNING data').bind(tabId).first();
  const row=removed?JSON.parse(removed.data):null;
  if(!row||row.session!==session.id||row.userId!==session.row.userId||!(row.expires>Date.now()))return unauthorized();
  const user=await readAuthRow('auth:user:'+row.userId);if(!user)return unauthorized();
  return Response.json({user:publicUser(user),tabToken:await newTab(session.id,user.id,session.row.expires)},{headers});
 }
 /**
  * The page is going away (closed, reloaded, or left for another site). Its token
  * stops working for anything but resuming, and only for TAB_HANDOFF_MS: a reload
  * resumes in time; a tab reopened or restored later must sign in.
  */
 async function suspendTab(request){
  const tab=tabTokenFor(request),session=await cookieSession(request);if(!tab||!session)return unauthorized();
  const tabId='auth:tab:'+await digest(tab),row=await readAuthRow(tabId);
  if(!row||row.session!==session.id)return unauthorized();
  await writeAuthRow(tabId,{...row,suspended:true,expires:Math.min(row.expires,Date.now()+TAB_HANDOFF_MS)});
  return Response.json({ok:true},{headers});
 }
 /** Sign this tab out; the browser session ends too when no other tab is still signed in. */
 async function logout(request){
  const tab=tabTokenFor(request),session=await cookieSession(request);
  if(tab)await removeRow('auth:tab:'+await digest(tab));
  if(!session)return Response.json({ok:true},{headers:{...headers,'Set-Cookie':sessionCookie(request,'',true)}});
  const others=await db.prepare("SELECT 1 FROM workspace WHERE substr(id,1,9)='auth:tab:' AND json_extract(data,'$.session')=? AND json_extract(data,'$.expires')>? LIMIT 1").bind(session.id,Date.now()).first();
  if(others)return Response.json({ok:true},{headers});
  await removeRow(session.id);
  return Response.json({ok:true},{headers:{...headers,'Set-Cookie':sessionCookie(request,'',true)}});
 }
 /** End every session and tab of a person (optionally keeping one session). */
 async function endSessions(userId,keepSessionId=''){
  await db.batch([
   db.prepare("DELETE FROM workspace WHERE substr(id,1,13)='auth:session:' AND json_extract(data,'$.userId')=? AND id<>?").bind(userId,keepSessionId),
   db.prepare("DELETE FROM workspace WHERE substr(id,1,9)='auth:tab:' AND json_extract(data,'$.userId')=? AND json_extract(data,'$.session')<>?").bind(userId,keepSessionId),
  ]);
 }
 const clearLimits=id=>db.prepare("DELETE FROM workspace WHERE id IN (?,?,?,?)").bind('auth:lock:'+id,'auth:mfa:'+id,'auth:reauth:'+id,'auth:attempt:'+id).run();
 async function authenticator(body,actor){
  if(!actor)return unauthorized();
  let user=await readAuthRow('auth:user:'+actor.id);if(!user)return unauthorized();
  if(body.action==='authenticator-confirm'){
   if(!user.totpPending||Date.parse(user.totpPending.createdAt)<Date.now()-15*60000)return Response.json({error:'Setup expired. Start again.'},{status:400,headers});
   // Authenticator codes have their own limit, separate from passwords.
   const attempt=await reserveAttempt('auth:mfa:'+user.id,5,900000);if(!attempt.allowed)return tooMany(attempt.until);
   const step=matchTotp(await unseal(user.totpPending.box,user.id),String(body.code||'').replace(/\s/g,''));
   if(step===null)return Response.json({error:'That code is not right. Check the GiroTrack entry in your app and try again.'},{status:400,headers});
   const {totpPending,...rest}=user;user={...rest,totp:{box:totpPending.box,lastStep:step,addedAt:new Date().toISOString()}};
   await writeAuthRow('auth:user:'+user.id,user);await removeRow('auth:mfa:'+user.id);
   return Response.json({user:publicUser(user)},{headers});
  }
  // Starting or removing setup needs the current password, so a borrowed session cannot swap the authenticator.
  const attempt=await reserveAttempt('auth:reauth:'+user.id,5,900000);if(!attempt.allowed)return tooMany(attempt.until);
  if(!await verifyPassword(String(body.password||''),user))return Response.json({error:'Password is incorrect.'},{status:401,headers});
  await removeRow('auth:reauth:'+user.id);
  if(body.action==='authenticator-remove'){const {totp,totpPending,...rest}=user;await writeAuthRow('auth:user:'+user.id,rest);return Response.json({user:publicUser(rest)},{headers});}
  const secret=base32(crypto.getRandomValues(new Uint8Array(20)));
  await writeAuthRow('auth:user:'+user.id,{...user,totpPending:{box:await seal(secret,user.id),createdAt:new Date().toISOString()}});
  return Response.json({secret,uri:`otpauth://totp/GiroTrack:${encodeURIComponent(user.email)}?secret=${secret}&issuer=GiroTrack&algorithm=SHA1&digits=6&period=30`},{headers});
 }
 /** Requests from an address with too many recent failed sign-ins (or codes) are refused. */
 async function addressBlocked(address){const row=await readAuthRow('auth:ip:'+await digest(address));return row&&row.lock>Date.now()?row.lock:0;}
 async function addressFailed(address){await reserveFailures('auth:ip:'+await digest(address),IP_FAILURE_LIMIT,SIGN_IN_LOCK_MS,String(Math.random()));}
 // Step 1: email + authenticator code. A correct code gives a 10-minute, single-use permission to set a new password.
 async function recover(request,body){
  const email=normalizeEmail(body.email),code=String(body.code||'').replace(/\s/g,'');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return Response.json({error:'Enter a valid email address.'},{status:400,headers});
  const id=await digest(email),address=clientAddress(request,env);
  const blocked=await addressBlocked(address);if(blocked)return tooMany(blocked);
  const attempt=await reserveAttempt('auth:mfa:'+id,5,900000);if(!attempt.allowed)return tooMany(attempt.until);
  const user=await readAuthRow('auth:user:'+id);
  // Unknown emails, accounts without an authenticator and wrong codes all get the same answer.
  const step=user?.totp?matchTotp(await unseal(user.totp.box,id),code,user.totp.lastStep):null;
  if(step===null){await addressFailed(address);return Response.json({error:'Email or code is incorrect.'},{status:401,headers});}
  await writeAuthRow('auth:user:'+id,{...user,totp:{...user.totp,lastStep:step}});
  await removeRow('auth:mfa:'+id);
  const token=hex(crypto.getRandomValues(new Uint8Array(32)));
  await writeAuthRow('auth:reset:'+await digest(token),{userId:id,expires:Date.now()+10*60000});
  return Response.json({resetToken:token},{headers});
 }
 // Step 2: the new password, accepted once per permission.
 async function completeRecovery(request,body){
  const token=String(body.token||''),password=String(body.password||'');
  if(password.length<10||password.length>256)return Response.json({error:'Choose a new password of 10–256 characters.'},{status:400,headers});
  const resetId=TOKEN.test(token)?'auth:reset:'+await digest(token):'';
  const removed=resetId?await db.prepare('DELETE FROM workspace WHERE id=? RETURNING data').bind(resetId).first():null;
  const reset=removed?JSON.parse(removed.data):null;
  if(!reset||!Number.isFinite(reset.expires)||reset.expires<=Date.now())return Response.json({error:'This reset has expired. Start again with a new code.',expired:true},{status:410,headers});
  const user=await readAuthRow('auth:user:'+reset.userId);if(!user)return Response.json({error:'This reset has expired. Start again with a new code.',expired:true},{status:410,headers});
  const updated={...user,...await hashPassword(password),passwordResetAt:new Date().toISOString()};
  await writeAuthRow('auth:user:'+user.id,updated);
  await endSessions(user.id);await clearLimits(user.id);
  return signIn(request,updated);
 }
 async function notificationSettings(body,actor){
  if(!actor)return unauthorized();
  const user=await readAuthRow('auth:user:'+actor.id);if(!user)return unauthorized();
  let settings={...NOTIFICATION_DEFAULTS,...user.notifications};
  if(body.settings!==undefined){
   if(!body.settings||typeof body.settings!=='object'||Array.isArray(body.settings)||Object.entries(body.settings).some(([key,value])=>!(key in NOTIFICATION_DEFAULTS)||typeof value!=='boolean'))return Response.json({error:'Invalid notification settings.'},{status:400,headers});
   settings={...settings,...body.settings};await writeAuthRow('auth:user:'+actor.id,{...user,notifications:settings});
  }
  return Response.json({settings},{headers});
 }
 async function managePeople(request,body,actor){
  if(!actor)return unauthorized();
  if(actor.role!=='Manager')return Response.json({error:'Only the Manager can manage people.'},{status:403,headers});
  if(body.action==='people'){
   const people=(await allUsers()).map(u=>({...publicUser(u),createdAt:u.createdAt||null})).sort((a,b)=>(a.role==='Manager'?-1:b.role==='Manager'?1:0)||a.name.localeCompare(b.name));
   return Response.json({people},{headers});
  }
  const userId=String(body.userId||''),password=String(body.password||'');
  if(!TOKEN.test(userId))return Response.json({error:'Choose a person.'},{status:400,headers});
  if(body.action==='approver'){
   // Let a person approve payment requests in the Manager's name, or take that back.
   if(userId===actor.id)return Response.json({error:'The Manager already approves.'},{status:400,headers});
   const user=await readAuthRow('auth:user:'+userId);if(!user)return Response.json({error:'That person no longer exists.'},{status:404,headers});
   const {approvesFor,...rest}=user;const updated=body.allow===true?{...rest,approvesFor:{id:actor.id,name:actor.name}}:rest;
   await writeAuthRow('auth:user:'+userId,updated);return Response.json({user:publicUser(updated)},{headers});
  }
  if(body.action==='remove'){
   if(userId===actor.id)return Response.json({error:'The Manager cannot remove their own account.'},{status:400,headers});
   const user=await readAuthRow('auth:user:'+userId);if(!user)return Response.json({error:'That person no longer exists.'},{status:404,headers});
   // Removing an account signs it out everywhere; their past activity keeps their name.
   await removeRow('auth:user:'+userId);await removeRow('signature:'+userId);await endSessions(userId);await clearLimits(userId);
   return Response.json({removed:true,user:publicUser(user)},{headers});
  }
  if(password.length<10||password.length>256)return Response.json({error:'Enter a password of 10–256 characters.'},{status:400,headers});
  const user=await readAuthRow('auth:user:'+userId);if(!user)return Response.json({error:'That person no longer exists.'},{status:404,headers});
  await writeAuthRow('auth:user:'+userId,{...user,...await hashPassword(password),passwordResetAt:new Date().toISOString()});
  // Sign the person out everywhere (except the Manager's own current session) and clear any lockout.
  const own=await cookieSession(request);
  await endSessions(userId,own?.id||'');await clearLimits(userId);
  return Response.json({reset:true,user:publicUser(user)},{headers});
 }
 // Counts every attempt in a window from the first one (authenticator codes, password re-checks).
 async function reserveAttempt(id,limit,duration){
  const stamp=Date.now();
  const row=await db.prepare(`INSERT INTO workspace(id,data,version) VALUES(?,?,0)
   ON CONFLICT(id) DO UPDATE SET data=json_object('count',CASE WHEN json_extract(data,'$.until')>? THEN json_extract(data,'$.count')+1 ELSE 1 END,'until',CASE WHEN json_extract(data,'$.until')>? THEN json_extract(data,'$.until') ELSE ? END),version=version+1
   RETURNING data`).bind(id,JSON.stringify({count:1,until:stamp+duration}),stamp,stamp,stamp+duration).first();
  const value=JSON.parse(row.data);return {allowed:value.count<=limit,until:value.until};
 }
 /**
  * One atomic step of a failure counter: while locked nothing changes (so
  * attempts never extend a lockout); otherwise the count goes up — starting
  * over after an expired lockout or 15 quiet minutes — and reaching `limit`
  * locks it for `lockMs`. `nonce` tells the caller whether its own attempt was
  * counted (true) or refused because of a lockout (false).
  */
 async function reserveFailures(id,limit,lockMs,nonce){
  const now=Date.now(),fresh=`(json_extract(data,'$.lock')>0 OR json_extract(data,'$.last')<=${now-lockMs})`;
  const count=`CASE WHEN ${fresh} THEN 1 ELSE json_extract(data,'$.f')+1 END`;
  const row=await db.prepare(`INSERT INTO workspace(id,data,version) VALUES(?,json_object('f',1,'lock',CASE WHEN 1>=? THEN ? ELSE 0 END,'last',?,'n',?),0)
   ON CONFLICT(id) DO UPDATE SET data=CASE WHEN json_extract(data,'$.lock')>? THEN data ELSE json_object('f',${count},'lock',CASE WHEN ${count}>=? THEN ? ELSE 0 END,'last',?,'n',?) END,version=version+1
   RETURNING data`).bind(id,limit,now+lockMs,now,nonce,now,limit,now+lockMs,now,nonce).first();
  const value=JSON.parse(row.data);
  return {counted:value.n===nonce,locked:value.lock>now,until:value.lock};
 }
 /**
  * Password sign-in. The attempt is counted before the password is checked, so
  * parallel requests can't get more than 10 guesses past the limit; a correct
  * password then clears the count. Unknown emails go through the same counting
  * and the same hashing work, and get the same answers.
  */
 async function login(request,body){
  const email=normalizeEmail(body.email),password=String(body.password||'');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return Response.json({error:'Enter a valid email address.'},{status:400,headers});
  if(password.length>256)return Response.json({error:'Password must be at most 256 characters.'},{status:400,headers});
  const id=await digest(email),address=clientAddress(request,env);
  const blocked=await addressBlocked(address);if(blocked)return tooMany(blocked);
  const lock=await reserveFailures('auth:lock:'+id,SIGN_IN_LIMIT,SIGN_IN_LOCK_MS,hex(crypto.getRandomValues(new Uint8Array(8))));
  if(!lock.counted)return tooMany(lock.until,LOCKED_MESSAGE);
  let user=await readAuthRow('auth:user:'+id);
  const valid=user?await verifyPassword(password,user):!!(await hashPassword(password))&&false;
  if(!valid){
   await addressFailed(address);
   return lock.locked?tooMany(lock.until,LOCKED_MESSAGE):Response.json({error:'Email or password is incorrect.'},{status:401,headers});
  }
  await removeRow('auth:lock:'+id);
  if(user.algorithm!=='scrypt'){user={...user,...await hashPassword(password)};await writeAuthRow('auth:user:'+id,user);}
  return signIn(request,user);
 }
 async function GET(request){try{return Response.json({user:await currentUser(request),needsSetup:!await hasAccounts()},{headers});}catch{return Response.json({error:'Accounts unavailable. Please retry.'},{status:503,headers});}}
 async function POST(request){
  if(!safeMutation(request))return Response.json({error:'Invalid origin'},{status:403,headers});
  // Handlers are awaited so their failures land in the catch below (a 503, never an unhandled error).
  try{
   if(Number(request.headers.get('content-length'))>4096)return Response.json({error:'Account request is too large.'},{status:413,headers});
   let body;try{const text=await request.text();if(text.length>4096)return Response.json({error:'Account request is too large.'},{status:413,headers});body=JSON.parse(text);}catch{return Response.json({error:'Invalid account request.'},{status:400,headers});}
   if(!body||typeof body!=='object'||Array.isArray(body))return Response.json({error:'Invalid account request.'},{status:400,headers});
   if(body.action==='logout')return await logout(request);
   if(body.action==='tab-resume')return await resumeTab(request);
   if(body.action==='tab-suspend')return await suspendTab(request);
   if(body.action==='notifications')return await notificationSettings(body,await currentUser(request));
   if(['authenticator-begin','authenticator-confirm','authenticator-remove'].includes(body.action))return await authenticator(body,await currentUser(request));
   if(body.action==='recover')return await recover(request,body);
   if(body.action==='recover-complete')return await completeRecovery(request,body);
   if(['people','reset','remove','approver'].includes(body.action))return await managePeople(request,body,await currentUser(request));
   if(body.action==='login')return await login(request,body);
   if(body.action!=='create')return Response.json({error:'Unknown account action.'},{status:400,headers});
   const actor=await currentUser(request),setup=await hasAccounts();
   if(setup&&!actor)return unauthorized();
   if(setup&&actor.role!=='Manager')return Response.json({error:'Only the Manager can add people.'},{status:403,headers});
   const email=normalizeEmail(body.email),password=String(body.password||'');
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return Response.json({error:'Enter a valid email address.'},{status:400,headers});
   if(password.length>256)return Response.json({error:'Password must be at most 256 characters.'},{status:400,headers});
   const id=await digest(email),name=String(body.name||'').trim();
   if(!name||name.length>80||password.length<10)return Response.json({error:'Enter your name and a password of 10–256 characters.'},{status:400,headers});
   // People the Manager adds need a first and last name.
   if(setup&&name.split(/\s+/).filter(Boolean).length<2)return Response.json({error:'Enter a first and last name.'},{status:400,headers});
   const user={id,name,email,role:setup?'Member':'Manager',...await hashPassword(password),createdAt:new Date().toISOString()};
   const insert=db.prepare(`INSERT OR IGNORE INTO workspace(id,data,version) SELECT ?,?,0 ${setup?'':"WHERE NOT EXISTS(SELECT 1 FROM workspace WHERE substr(id,1,10)='auth:user:')"}`).bind('auth:user:'+id,JSON.stringify(user));
   const result=setup?await insert.run():(await db.batch([insert,db.prepare('INSERT INTO workspace(id,data,version) VALUES(?,?,0) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind('auth:setup',JSON.stringify({createdAt:user.createdAt}))]))[0];
   if(!result.meta.changes)return Response.json({error:setup?'An account with this email already exists.':'Setup has already been completed. Sign in instead.'},{status:409,headers});
   if(setup)return Response.json({created:true,user:publicUser(user)},{headers});
   return await signIn(request,user);
  }catch{return Response.json({error:'Account request failed. Please retry.'},{status:503,headers});}
 }
 return {GET,POST,currentUser,readAuthRow,writeAuthRow};
}
