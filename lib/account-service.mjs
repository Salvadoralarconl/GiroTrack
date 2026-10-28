import {digest,hex,hashPassword,verifyPassword,publicUser,base32,matchTotp} from './account-core.mjs';
export const SESSION_SECONDS=7*24*60*60;
// Each person's notification choices; payment alerts start on, summaries start off.
export const NOTIFICATION_DEFAULTS={daily:false,weekly:false,upcoming:true,due:true,overdue:true};
const headers={'Cache-Control':'no-store'};
export const unauthorized=()=>Response.json({error:'Sign in to continue.'},{status:401,headers});
export function safeMutation(request){const origin=request.headers.get('origin');return request.headers.get('sec-fetch-site')!=='cross-site'&&(!origin||origin===new URL(request.url).origin);}
export function sessionCookie(request,token,age=SESSION_SECONDS){return `girotrack_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
function tokenFor(request){return request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('girotrack_session='))?.slice(18);}
export function createAccountService(db,vaultKey){
 const readAuthRow=async id=>{const row=await db.prepare('SELECT data FROM workspace WHERE id=?').bind(id).first();return row?JSON.parse(row.data):null;};
 const writeAuthRow=async(id,value)=>{await db.prepare('INSERT INTO workspace (id,data,version) VALUES (?,?,0) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=version+1').bind(id,JSON.stringify(value)).run();};
 const hasAccounts=async()=>!!await db.prepare("SELECT id FROM workspace WHERE substr(id,1,10)='auth:user:' LIMIT 1").first();
 const allUsers=async()=>(await db.prepare("SELECT data FROM workspace WHERE substr(id,1,10)='auth:user:'").all()).results.map(row=>JSON.parse(row.data));
 // Accounts created before roles existed: the earliest one becomes the Manager, the rest Members.
 async function assignRoles(){
  const users=await allUsers();if(users.some(u=>u.role==='Manager'))return;
  users.sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||''))||a.id.localeCompare(b.id));
  for(const [index,user] of users.entries())await writeAuthRow('auth:user:'+user.id,{...user,role:index?'Member':'Manager'});
 }
 async function currentUser(request){
  const token=tokenFor(request);if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
  const session=await readAuthRow('auth:session:'+await digest(token));
  if(!session||!Number.isFinite(session.expires)||session.expires<=Date.now()||typeof session.userId!=='string')return null;
  let user=await readAuthRow('auth:user:'+session.userId);
  if(user&&!user.role){await assignRoles();user=await readAuthRow('auth:user:'+session.userId);}
  return user&&user.id===session.userId?publicUser(user):null;
 }
 // Authenticator keys are sealed with the same vault key as portal passwords.
 const bytes=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0)),text64=data=>btoa(String.fromCharCode(...new Uint8Array(data)));
 const vault=()=>{if(!vaultKey)throw Error('Authenticator storage is not configured.');return crypto.subtle.importKey('raw',bytes(vaultKey),{name:'AES-GCM'},false,['encrypt','decrypt']);};
 const seal=async secret=>{const iv=crypto.getRandomValues(new Uint8Array(12));return {iv:text64(iv),data:text64(await crypto.subtle.encrypt({name:'AES-GCM',iv},await vault(),new TextEncoder().encode(secret)))};};
 const unseal=async box=>new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(box.iv)},await vault(),bytes(box.data)));
 const tooMany=until=>Response.json({error:'Too many attempts. Please try again later.'},{status:429,headers:{...headers,'Retry-After':String(Math.max(1,Math.ceil((until-Date.now())/1000)))}});
 async function signIn(request,user){
  const oldToken=tokenFor(request);if(oldToken&&/^[a-f0-9]{64}$/.test(oldToken))await db.prepare('DELETE FROM workspace WHERE id=?').bind('auth:session:'+await digest(oldToken)).run();
  const token=hex(crypto.getRandomValues(new Uint8Array(32)));
  await writeAuthRow('auth:session:'+await digest(token),{userId:user.id,expires:Date.now()+SESSION_SECONDS*1000});
  return Response.json({user:publicUser(user)},{headers:{...headers,'Set-Cookie':sessionCookie(request,token)}});
 }
 async function authenticator(body,actor){
  if(!actor)return unauthorized();
  let user=await readAuthRow('auth:user:'+actor.id);if(!user)return unauthorized();
  if(body.action==='authenticator-confirm'){
   if(!user.totpPending||Date.parse(user.totpPending.createdAt)<Date.now()-15*60000)return Response.json({error:'Setup expired. Start again.'},{status:400,headers});
   const attempt=await reserveAttempt('auth:attempt:'+user.id,5,900000);if(!attempt.allowed)return tooMany(attempt.until);
   const step=matchTotp(await unseal(user.totpPending.box),String(body.code||'').replace(/\s/g,''));
   if(step===null)return Response.json({error:'That code is not right. Check the GiroTrack entry in your app and try again.'},{status:400,headers});
   const {totpPending,...rest}=user;user={...rest,totp:{box:totpPending.box,lastStep:step,addedAt:new Date().toISOString()}};
   await writeAuthRow('auth:user:'+user.id,user);await db.prepare('DELETE FROM workspace WHERE id=?').bind('auth:attempt:'+user.id).run();
   return Response.json({user:publicUser(user)},{headers});
  }
  // Starting or removing setup needs the current password, so a borrowed session cannot swap the authenticator.
  const attempt=await reserveAttempt('auth:attempt:'+user.id,5,900000);if(!attempt.allowed)return tooMany(attempt.until);
  if(!await verifyPassword(String(body.password||''),user))return Response.json({error:'Password is incorrect.'},{status:401,headers});
  await db.prepare('DELETE FROM workspace WHERE id=?').bind('auth:attempt:'+user.id).run();
  if(body.action==='authenticator-remove'){const {totp,totpPending,...rest}=user;await writeAuthRow('auth:user:'+user.id,rest);return Response.json({user:publicUser(rest)},{headers});}
  const secret=base32(crypto.getRandomValues(new Uint8Array(20)));
  await writeAuthRow('auth:user:'+user.id,{...user,totpPending:{box:await seal(secret),createdAt:new Date().toISOString()}});
  return Response.json({secret,uri:`otpauth://totp/GiroTrack:${encodeURIComponent(user.email)}?secret=${secret}&issuer=GiroTrack&algorithm=SHA1&digits=6&period=30`},{headers});
 }
 // Step 1: email + authenticator code. A correct code gives a 10-minute, single-use permission to set a new password.
 async function recover(request,body){
  const email=String(body.email||'').trim().toLowerCase(),code=String(body.code||'').replace(/\s/g,'');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return Response.json({error:'Enter a valid email address.'},{status:400,headers});
  const id=await digest(email);
  const global=await reserveAttempt('auth:attempt:workspace',50,60000),attempt=await reserveAttempt('auth:recover:'+id,5,900000);
  if(!global.allowed||!attempt.allowed)return tooMany(!global.allowed?global.until:attempt.until);
  const user=await readAuthRow('auth:user:'+id);
  // Unknown emails, accounts without an authenticator and wrong codes all get the same answer.
  const step=user?.totp?matchTotp(await unseal(user.totp.box),code,user.totp.lastStep):null;
  if(step===null)return Response.json({error:'Email or code is incorrect.'},{status:401,headers});
  await writeAuthRow('auth:user:'+id,{...user,totp:{...user.totp,lastStep:step}});
  await db.prepare('DELETE FROM workspace WHERE id=?').bind('auth:recover:'+id).run();
  const token=hex(crypto.getRandomValues(new Uint8Array(32)));
  await writeAuthRow('auth:reset:'+await digest(token),{userId:id,expires:Date.now()+10*60000});
  return Response.json({resetToken:token},{headers});
 }
 // Step 2: the new password, accepted once per permission.
 async function completeRecovery(request,body){
  const token=String(body.token||''),password=String(body.password||'');
  if(password.length<10||password.length>256)return Response.json({error:'Choose a new password of 10–256 characters.'},{status:400,headers});
  const resetId=/^[a-f0-9]{64}$/.test(token)?'auth:reset:'+await digest(token):'';
  const reset=resetId?await readAuthRow(resetId):null;
  if(resetId)await db.prepare('DELETE FROM workspace WHERE id=?').bind(resetId).run();
  if(!reset||!Number.isFinite(reset.expires)||reset.expires<=Date.now())return Response.json({error:'This reset has expired. Start again with a new code.',expired:true},{status:410,headers});
  const user=await readAuthRow('auth:user:'+reset.userId);if(!user)return Response.json({error:'This reset has expired. Start again with a new code.',expired:true},{status:410,headers});
  const updated={...user,...await hashPassword(password),passwordResetAt:new Date().toISOString()};
  await writeAuthRow('auth:user:'+user.id,updated);
  await db.prepare("DELETE FROM workspace WHERE substr(id,1,13)='auth:session:' AND json_extract(data,'$.userId')=?").bind(user.id).run();
  await db.prepare('DELETE FROM workspace WHERE id=?').bind('auth:attempt:'+user.id).run();
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
  if(!/^[a-f0-9]{64}$/.test(userId))return Response.json({error:'Choose a person.'},{status:400,headers});
  if(body.action==='remove'){
   if(userId===actor.id)return Response.json({error:'The Manager cannot remove their own account.'},{status:400,headers});
   const user=await readAuthRow('auth:user:'+userId);if(!user)return Response.json({error:'That person no longer exists.'},{status:404,headers});
   // Removing an account signs it out everywhere; their past activity keeps their name.
   await db.batch([db.prepare('DELETE FROM workspace WHERE id=? OR id=?').bind('auth:user:'+userId,'auth:attempt:'+userId),
    db.prepare("DELETE FROM workspace WHERE substr(id,1,13)='auth:session:' AND json_extract(data,'$.userId')=?").bind(userId)]);
   return Response.json({removed:true,user:publicUser(user)},{headers});
  }
  if(password.length<10||password.length>256)return Response.json({error:'Enter a password of 10–256 characters.'},{status:400,headers});
  const user=await readAuthRow('auth:user:'+userId);if(!user)return Response.json({error:'That person no longer exists.'},{status:404,headers});
  await writeAuthRow('auth:user:'+userId,{...user,...await hashPassword(password),passwordResetAt:new Date().toISOString()});
  // Sign the person out everywhere (except the Manager's own current session) and clear any lockout.
  const token=tokenFor(request),keep=token&&/^[a-f0-9]{64}$/.test(token)?'auth:session:'+await digest(token):'';
  await db.prepare("DELETE FROM workspace WHERE substr(id,1,13)='auth:session:' AND json_extract(data,'$.userId')=? AND id<>?").bind(userId,keep).run();
  await db.prepare('DELETE FROM workspace WHERE id=?').bind('auth:attempt:'+userId).run();
  return Response.json({reset:true,user:publicUser(user)},{headers});
 }
 async function reserveAttempt(id,limit,duration){
  const stamp=Date.now();
  const row=await db.prepare(`INSERT INTO workspace(id,data,version) VALUES(?,?,0)
   ON CONFLICT(id) DO UPDATE SET data=json_object('count',CASE WHEN json_extract(data,'$.until')>? THEN json_extract(data,'$.count')+1 ELSE 1 END,'until',CASE WHEN json_extract(data,'$.until')>? THEN json_extract(data,'$.until') ELSE ? END),version=version+1
   RETURNING data`).bind(id,JSON.stringify({count:1,until:stamp+duration}),stamp,stamp,stamp+duration).first();
  const value=JSON.parse(row.data);return {allowed:value.count<=limit,until:value.until};
 }
 async function GET(request){try{return Response.json({user:await currentUser(request),needsSetup:!await hasAccounts()},{headers});}catch{return Response.json({error:'Accounts unavailable. Please retry.'},{status:503,headers});}}
 async function POST(request){
  if(!safeMutation(request))return Response.json({error:'Invalid origin'},{status:403,headers});
  try{
   if(Number(request.headers.get('content-length'))>4096)return Response.json({error:'Account request is too large.'},{status:413,headers});
   let body;try{const text=await request.text();if(text.length>4096)return Response.json({error:'Account request is too large.'},{status:413,headers});body=JSON.parse(text);}catch{return Response.json({error:'Invalid account request.'},{status:400,headers});}
   if(!body||typeof body!=='object'||Array.isArray(body))return Response.json({error:'Invalid account request.'},{status:400,headers});
   if(body.action==='logout'){
    const token=tokenFor(request);if(token&&/^[a-f0-9]{64}$/.test(token))await db.prepare('DELETE FROM workspace WHERE id=?').bind('auth:session:'+await digest(token)).run();
    return Response.json({ok:true},{headers:{...headers,'Set-Cookie':sessionCookie(request,'',0)}});
   }
   if(body.action==='notifications')return notificationSettings(body,await currentUser(request));
   if(['authenticator-begin','authenticator-confirm','authenticator-remove'].includes(body.action))return authenticator(body,await currentUser(request));
   if(body.action==='recover')return recover(request,body);
   if(body.action==='recover-complete')return completeRecovery(request,body);
   if(['people','reset','remove'].includes(body.action))return managePeople(request,body,await currentUser(request));
   if(!['create','login'].includes(body.action))return Response.json({error:'Unknown account action.'},{status:400,headers});
   const actor=await currentUser(request),setup=await hasAccounts();
   if(body.action==='create'&&setup&&!actor)return unauthorized();
   if(body.action==='create'&&setup&&actor.role!=='Manager')return Response.json({error:'Only the Manager can add people.'},{status:403,headers});
   const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return Response.json({error:'Enter a valid email address.'},{status:400,headers});
   if(password.length>256)return Response.json({error:'Password must be at most 256 characters.'},{status:400,headers});
   const id=await digest(email);let user;
   if(body.action==='login'){
    const attemptId='auth:attempt:'+id;
    const global=await reserveAttempt('auth:attempt:workspace',50,60000);
    const attempt=await reserveAttempt(attemptId,5,900000);
    if(!global.allowed||!attempt.allowed)return Response.json({error:'Too many attempts. Please try again later.'},{status:429,headers:{...headers,'Retry-After':String(Math.max(1,Math.ceil(((!global.allowed?global.until:attempt.until)-Date.now())/1000)))}});
    user=await readAuthRow('auth:user:'+id);
    // Unknown emails perform the same expensive hash, without revealing membership.
    const valid=user?await verifyPassword(password,user):!!(await hashPassword(password))&&false;
    if(!valid)return Response.json({error:'Email or password is incorrect.'},{status:401,headers});
    if(user.algorithm!=='scrypt'){user={...user,...await hashPassword(password)};await writeAuthRow('auth:user:'+id,user);}
    await db.prepare('DELETE FROM workspace WHERE id=?').bind(attemptId).run();
   }else{
    const name=String(body.name||'').trim();
    if(!name||name.length>80||password.length<10)return Response.json({error:'Enter your name and a password of 10–256 characters.'},{status:400,headers});
    user={id,name,email,role:setup?'Member':'Manager',...await hashPassword(password),createdAt:new Date().toISOString()};
    const insert=db.prepare(`INSERT OR IGNORE INTO workspace(id,data,version) SELECT ?,?,0 ${setup?'':"WHERE NOT EXISTS(SELECT 1 FROM workspace WHERE substr(id,1,10)='auth:user:')"}`).bind('auth:user:'+id,JSON.stringify(user));
    const result=setup?await insert.run():(await db.batch([insert,db.prepare('INSERT INTO workspace(id,data,version) VALUES(?,?,0) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind('auth:setup',JSON.stringify({createdAt:user.createdAt}))]))[0];
    if(!result.meta.changes)return Response.json({error:setup?'An account with this email already exists.':'Setup has already been completed. Sign in instead.'},{status:409,headers});
    if(setup)return Response.json({created:true,user:publicUser(user)},{headers});
   }
   return signIn(request,user);
  }catch{return Response.json({error:'Account request failed. Please retry.'},{status:503,headers});}
 }
 return {GET,POST,currentUser,readAuthRow,writeAuthRow};
}
