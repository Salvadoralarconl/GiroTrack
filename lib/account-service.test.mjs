import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createAccountService,clientAddress,sessionCookie,SIGN_IN_LIMIT,TAB_IDLE_MS} from './account-service.mjs';
import {digest,totpCode} from './account-core.mjs';
const KEY=Buffer.alloc(32,7).toString('base64');
function fixture(config={GIROTRACK_VAULT_KEY:KEY}){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE workspace(id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0)');
 const db={prepare(query){let args=[];return {bind(...values){args=values;return this},async first(){return sql.prepare(query).get(...args)||null},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}}},async all(){return {results:sql.prepare(query).all(...args)}}}},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results}catch(e){sql.exec('ROLLBACK');throw e}}};
 const service=createAccountService(db,config);
 // A signed-in tab: the browser's session cookie plus the tab's own token.
 const request=(body,tab,origin='http://localhost:5174',extra={})=>new Request('http://localhost:5174/api/account',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(tab?.cookie?{Cookie:tab.cookie}:{}),...(tab?.tab?{'x-girotrack-tab':tab.tab}:{}),...extra},body:JSON.stringify(body)});
 const post=(body,tab,origin,extra)=>service.POST(request(body,tab,origin,extra));
 return {sql,db,service,post};
}
const first={action:'create',name:'Temporary Owner',email:'owner@example.test',password:'Test-only-long-password-42'};
const cookieOf=r=>r.headers.get('set-cookie')?.split(';')[0];
/** The tab a sign-in response creates (cookie carried over when the browser already had one). */
const tabOf=async(r,previous)=>({cookie:cookieOf(r)||previous?.cookie,tab:(await r.json()).tabToken});
const as=tab=>new Request('http://localhost',{headers:{...(tab.cookie?{Cookie:tab.cookie}:{}),...(tab.tab?{'x-girotrack-tab':tab.tab}:{})}});
const login=(post,email,password,browser)=>post({action:'login',email,password},browser?{cookie:browser.cookie}:undefined);

test('first setup, protected creation, added user, sessions, logout, business data preserved',async()=>{
 const {sql,service,post}=fixture();sql.prepare('INSERT INTO workspace VALUES(?,?,?)').run('main','{"payers":["preserve"]}',7);
 assert.equal((await (await service.GET(new Request('http://localhost/api/account'))).json()).needsSetup,true);
 const created=await post(first);assert.equal(created.status,200);const owner=await tabOf(created);
 assert.equal((await service.currentUser(as(owner))).email,first.email);
 assert.equal((await post({...first,email:'other@example.test'})).status,401);
 const added=await post({...first,name:'Temporary Added',email:'added@example.test'},owner);assert.equal(added.status,200);assert.equal(added.headers.get('set-cookie'),null);
 assert.equal((await post({action:'logout'},owner)).status,200);
 assert.equal(await service.currentUser(as(owner)),null);
 assert.equal((await login(post,'added@example.test',first.password)).status,200);
 assert.deepEqual({...sql.prepare("SELECT data,version FROM workspace WHERE id='main'").get()},{data:'{"payers":["preserve"]}',version:7});
});

test('the session cookie alone is not enough: every request needs a valid token of one of its tabs',async()=>{
 const {db,service,post}=fixture();const owner=await tabOf(await post(first));
 assert.equal(await service.currentUser(as({cookie:owner.cookie})),null);
 assert.equal(await service.currentUser(as({tab:owner.tab})),null);
 assert.equal(await service.currentUser(as({cookie:owner.cookie,tab:'ab'.repeat(32)})),null);
 assert.equal((await post({action:'notifications'},{cookie:owner.cookie})).status,401);
 // Another browser's tab token doesn't work with this cookie.
 const elsewhere=await tabOf(await login(post,first.email,first.password));
 assert.equal(await service.currentUser(as({cookie:owner.cookie,tab:elsewhere.tab})),null);
 // A tab that stopped checking in for longer than the idle limit has ended.
 const tabId='auth:tab:'+await digest(owner.tab),row=JSON.parse((await db.prepare('SELECT data FROM workspace WHERE id=?').bind(tabId).first()).data);
 await db.prepare('UPDATE workspace SET data=? WHERE id=?').bind(JSON.stringify({...row,expires:Date.now()-1}),tabId).run();
 assert.equal(await service.currentUser(as(owner)),null);
});

test('invalid and expired sessions fail closed, including missing expiry',async()=>{
 const {db,service,post}=fixture();const owner=await tabOf(await post(first));
 const id='auth:session:'+await digest(owner.cookie.split('=')[1]);
 for(const expires of [Date.now()-1,null,'tomorrow']){
  await db.prepare('UPDATE workspace SET data=? WHERE id=?').bind(JSON.stringify({userId:await digest(first.email),expires}),id).run();
  assert.equal(await service.currentUser(as(owner)),null);
 }
});

test('checking in keeps a tab alive; a reload trades its token once, so a copied token stops working',async()=>{
 const {db,service,post}=fixture();const owner=await tabOf(await post(first));
 const tabId='auth:tab:'+await digest(owner.tab),stored=async id=>JSON.parse((await db.prepare('SELECT data FROM workspace WHERE id=?').bind(id).first()).data);
 const row=await stored(tabId);
 await db.prepare('UPDATE workspace SET data=? WHERE id=?').bind(JSON.stringify({...row,expires:Date.now()+60000}),tabId).run();
 assert.ok(await service.currentUser(as(owner)));
 assert.ok((await stored(tabId)).expires>Date.now()+TAB_IDLE_MS-5000,'a request extends the tab');
 // Reload: the stored token is traded for a new one.
 const resumed=await post({action:'tab-resume'},owner);assert.equal(resumed.status,200);
 const reloaded={cookie:owner.cookie,tab:(await resumed.json()).tabToken};
 assert.notEqual(reloaded.tab,owner.tab);
 assert.ok(await service.currentUser(as(reloaded)));
 assert.equal(await service.currentUser(as(owner)),null);
 assert.equal((await post({action:'tab-resume'},owner)).status,401);
 // Two copies of one token (Duplicate tab, restored session) resuming at once: only one gets in.
 const both=await Promise.all([post({action:'tab-resume'},reloaded),post({action:'tab-resume'},reloaded)]);
 assert.deepEqual(both.map(r=>r.status).sort(),[200,401]);
 // An expired tab can't resume (e.g. reopened long after closing).
 const later=await tabOf(both.find(r=>r.ok),reloaded);const laterId='auth:tab:'+await digest(later.tab);
 await db.prepare('UPDATE workspace SET data=? WHERE id=?').bind(JSON.stringify({...await stored(laterId),expires:Date.now()-1}),laterId).run();
 assert.equal((await post({action:'tab-resume'},later)).status,401);
});

test('a page going away suspends its token: nothing but resuming works, and only within 15 seconds',async()=>{
 const {db,service,post}=fixture();const owner=await tabOf(await post(first));
 assert.equal((await post({action:'tab-suspend'},{cookie:owner.cookie})).status,401,'needs the tab token');
 assert.equal((await post({action:'tab-suspend'},owner)).status,200);
 const tabId='auth:tab:'+await digest(owner.tab),row=JSON.parse((await db.prepare('SELECT data FROM workspace WHERE id=?').bind(tabId).first()).data);
 assert.equal(row.suspended,true);assert.ok(row.expires<=Date.now()+15000&&row.expires>Date.now()+10000,'15-second hand-off');
 // A suspended token is refused for normal requests (an old page can't keep using it).
 assert.equal(await service.currentUser(as(owner)),null);
 assert.equal((await post({action:'notifications'},owner)).status,401);
 // A reload within the hand-off resumes and gets a fresh, normal token.
 const resumed=await post({action:'tab-resume'},owner);assert.equal(resumed.status,200);
 const reloaded={cookie:owner.cookie,tab:(await resumed.json()).tabToken};
 assert.ok(await service.currentUser(as(reloaded)));
 // Closed and reopened later than the hand-off: refused.
 await post({action:'tab-suspend'},reloaded);
 const laterId='auth:tab:'+await digest(reloaded.tab),later=JSON.parse((await db.prepare('SELECT data FROM workspace WHERE id=?').bind(laterId).first()).data);
 await db.prepare('UPDATE workspace SET data=? WHERE id=?').bind(JSON.stringify({...later,expires:Date.now()-1}),laterId).run();
 assert.equal((await post({action:'tab-resume'},reloaded)).status,401);
});

test('each tab signs in on its own; signing out of one leaves the others signed in',async()=>{
 const {service,post,sql}=fixture();const tabA=await tabOf(await post(first));
 // A new tab in the same browser sends the cookie but has no token: it must sign in, and reuses the browser session.
 assert.equal(await service.currentUser(as({cookie:tabA.cookie})),null);
 const second=await login(post,first.email,first.password,tabA);assert.equal(second.status,200);assert.equal(second.headers.get('set-cookie'),null);
 const tabB=await tabOf(second,tabA);
 assert.ok(await service.currentUser(as(tabA)));assert.ok(await service.currentUser(as(tabB)));
 const out=await post({action:'logout'},tabA);assert.equal(out.headers.get('set-cookie'),null);
 assert.equal(await service.currentUser(as(tabA)),null);
 assert.ok(await service.currentUser(as(tabB)),'the other tab is unaffected');
 const last=await post({action:'logout'},tabB);assert.match(last.headers.get('set-cookie'),/Max-Age=0/);
 assert.equal(sql.prepare("SELECT count(*) n FROM workspace WHERE substr(id,1,13)='auth:session:' OR substr(id,1,9)='auth:tab:'").get().n,0);
});

test('concurrent bootstrap creates only one first account; the cookie is HttpOnly, Strict and not persistent',async()=>{
 const {post,sql}=fixture();
 const results=await Promise.all([post(first),post({...first,email:'racing@example.test'})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal(sql.prepare("SELECT count(*) n FROM workspace WHERE substr(id,1,10)='auth:user:'").get().n,1);
 const created=results.find(r=>r.ok),setCookie=created.headers.get('set-cookie');
 assert.match(setCookie,/HttpOnly; SameSite=Strict/);assert.doesNotMatch(setCookie,/Max-Age|Expires/i);
 const out=await post({action:'logout'},await tabOf(created));assert.match(out.headers.get('set-cookie'),/Max-Age=0/);
 assert.match(sessionCookie(new Request('https://girotrack.test/api/account'),'t'),/; Secure$/);
 assert.doesNotMatch(sessionCookie(new Request('http://localhost/api/account'),'t'),/Secure/);
});

test('10 failed passwords per account: attempts 1–9 fail normally, the 10th locks for 15 minutes, a correct password is refused while locked',async()=>{
 const {post,db}=fixture();await post(first);
 for(let n=1;n<SIGN_IN_LIMIT;n++){const r=await login(post,first.email,'wrong-'+n);assert.equal(r.status,401,`attempt ${n}`);assert.equal((await r.json()).error,'Email or password is incorrect.');}
 const tenth=await login(post,first.email,'wrong-10');assert.equal(tenth.status,429);assert.match((await tenth.json()).error,/15 minutes/);
 const lockId='auth:lock:'+await digest(first.email),locked=JSON.parse((await db.prepare('SELECT data FROM workspace WHERE id=?').bind(lockId).first()).data);
 assert.ok(locked.lock>Date.now()+14*60000&&locked.lock<=Date.now()+15*60000);
 assert.equal((await login(post,first.email,first.password)).status,429,'correct password refused while locked');
 for(let n=0;n<5;n++)assert.equal((await login(post,first.email,'again')).status,429);
 const after=JSON.parse((await db.prepare('SELECT data FROM workspace WHERE id=?').bind(lockId).first()).data);
 assert.equal(after.lock,locked.lock,'attempts during the lockout never extend it');
 // The same email typed differently counts against the same account.
 assert.equal((await login(post,'  OWNER@Example.TEST ',first.password)).status,429);
 // Once the lockout ends, a fresh set of attempts.
 await db.prepare('UPDATE workspace SET data=? WHERE id=?').bind(JSON.stringify({...after,lock:Date.now()-1}),lockId).run();
 for(let n=1;n<SIGN_IN_LIMIT;n++)assert.equal((await login(post,first.email,'wrong')).status,401);
 assert.equal((await login(post,first.email,first.password)).status,200,'9 failures then the right password');
});

test('a successful sign-in before the lockout resets the count',async()=>{
 const {post}=fixture();await post(first);
 for(let n=0;n<7;n++)assert.equal((await login(post,first.email,'wrong')).status,401);
 assert.equal((await login(post,first.email,first.password)).status,200);
 for(let n=1;n<SIGN_IN_LIMIT;n++)assert.equal((await login(post,first.email,'wrong')).status,401,`fresh attempt ${n}`);
 assert.equal((await login(post,first.email,'wrong')).status,429);
});

test('parallel attempts cannot get more than 10 password checks past the limit; restarts keep the count',async()=>{
 const {post,db}=fixture();await post(first);
 const attempts=await Promise.all(Array.from({length:25},()=>login(post,first.email,'wrong')));
 assert.equal(attempts.filter(r=>r.status===401).length,SIGN_IN_LIMIT-1);
 assert.equal(attempts.filter(r=>r.status===429).length,25-(SIGN_IN_LIMIT-1));
 // A new service instance on the same database (an app restart, another browser) sees the lockout.
 const restarted=createAccountService(db,{GIROTRACK_VAULT_KEY:KEY});
 const r=await restarted.POST(new Request('http://localhost:5174/api/account',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:5174'},body:JSON.stringify({action:'login',email:first.email,password:first.password})}));
 assert.equal(r.status,429);
});

test('unknown emails get exactly the same answers and lockout as real accounts',async()=>{
 const {post}=fixture();await post(first);
 for(let n=1;n<SIGN_IN_LIMIT;n++){const r=await login(post,'nobody@example.test','wrong');assert.equal(r.status,401);assert.equal((await r.json()).error,'Email or password is incorrect.');}
 const tenth=await login(post,'nobody@example.test','wrong');assert.equal(tenth.status,429);assert.match((await tenth.json()).error,/15 minutes/);
 assert.equal((await login(post,first.email,first.password)).status,200,'other accounts are unaffected');
});

test('addresses: X-Forwarded-For counts only with the proxy secret; one address with many failures is blocked, others are not',async()=>{
 const secret='s'.repeat(40);
 assert.equal(clientAddress(new Request('http://x',{headers:{'x-forwarded-for':'10.0.0.5'}}),{GIROTRACK_PROXY_SECRET:secret}),'direct');
 assert.equal(clientAddress(new Request('http://x',{headers:{'x-forwarded-for':'1.1.1.1, 10.0.0.5:51234','x-girotrack-proxy':secret}}),{GIROTRACK_PROXY_SECRET:secret}),'10.0.0.5');
 assert.equal(clientAddress(new Request('http://x',{headers:{'x-forwarded-for':'[2001:DB8::1]:443','x-girotrack-proxy':secret}}),{GIROTRACK_PROXY_SECRET:secret}),'2001:db8::1');
 assert.equal(clientAddress(new Request('http://x',{headers:{'x-forwarded-for':'10.0.0.5','x-girotrack-proxy':'wrong'}}),{GIROTRACK_PROXY_SECRET:secret}),'direct');
 assert.equal(clientAddress(new Request('http://x',{headers:{'x-forwarded-for':'10.0.0.5'}}),{}),'direct');
 const {post}=fixture({GIROTRACK_VAULT_KEY:KEY,GIROTRACK_PROXY_SECRET:secret});await post(first);
 const from=ip=>({'x-forwarded-for':ip,'x-girotrack-proxy':secret});
 // 100 failures spread over many accounts from one address (each account stays under its own limit).
 for(let n=0;n<100;n++)assert.equal((await post({action:'login',email:`user${n%20}@example.test`,password:'wrong'},undefined,undefined,from('10.0.0.66'))).status,401);
 assert.equal((await post({action:'login',email:first.email,password:first.password},undefined,undefined,from('10.0.0.66'))).status,429);
 assert.equal((await post({action:'login',email:first.email,password:first.password},undefined,undefined,from('10.0.0.7'))).status,200,'a colleague on another address signs in');
});

test('throttling counts recovery codes separately; origin checks reject cross-site writes',async()=>{
 const {post}=fixture();await post(first);
 for(let n=0;n<SIGN_IN_LIMIT;n++)await login(post,first.email,'wrong');
 const r=await post({action:'recover',email:first.email,code:'123456'});assert.equal(r.status,401,'a locked password does not use up code attempts');
 assert.equal((await post({action:'logout'},undefined,'https://elsewhere.test')).status,403);
});

test('first account is the Manager; only the Manager adds people and resets passwords',async()=>{
 const {service,post}=fixture();const manager=await tabOf(await post(first));
 assert.equal((await service.currentUser(as(manager))).role,'Manager');
 assert.equal((await post({...first,name:'Temporary Member',email:'member@example.test'},manager)).status,200);
 const member=await tabOf(await login(post,'member@example.test',first.password));
 assert.equal((await service.currentUser(as(member))).role,'Member');
 assert.equal((await post({...first,email:'blocked@example.test'},member)).status,403);
 assert.equal((await post({action:'people'},member)).status,403);
 const {people}=await (await post({action:'people'},manager)).json();
 assert.deepEqual(people.map(p=>[p.email,p.role]),[[first.email,'Manager'],['member@example.test','Member']]);
 for(const p of people)assert.deepEqual(Object.keys(p).sort(),['approvesFor','authenticator','createdAt','email','id','name','role'],'never a hash, salt or password');
 const userId=people[1].id;
 assert.equal((await post({action:'reset',userId,password:'short'},manager)).status,400);
 assert.equal((await post({action:'reset',userId,password:'New-test-only-password-7'},manager)).status,200);
 assert.equal(await service.currentUser(as(member)),null);
 assert.equal((await login(post,'member@example.test',first.password)).status,401);
 assert.equal((await login(post,'member@example.test','New-test-only-password-7')).status,200);
 assert.equal((await service.currentUser(as(manager))).email,first.email);
});

test('accounts created before roles: the earliest becomes the Manager',async()=>{
 const {sql,service,post}=fixture();const owner=await tabOf(await post(first));
 await post({...first,name:'Temporary Later',email:'later@example.test'},owner);
 for(const row of sql.prepare("SELECT id,data FROM workspace WHERE substr(id,1,10)='auth:user:'").all()){const {role,...rest}=JSON.parse(row.data);sql.prepare('UPDATE workspace SET data=? WHERE id=?').run(JSON.stringify(rest),row.id);}
 const later=await tabOf(await login(post,'later@example.test',first.password));
 assert.equal((await service.currentUser(as(later))).role,'Member');
 assert.equal((await service.currentUser(as(owner))).role,'Manager');
});

test('existing password hashes keep working: scrypt as is, older PBKDF2 upgraded on sign-in',async()=>{
 const {sql,post}=fixture();await post(first);
 const id=await digest(first.email),user=JSON.parse(sql.prepare('SELECT data FROM workspace WHERE id=?').get('auth:user:'+id).data);
 assert.equal(user.algorithm,'scrypt');assert.ok(!JSON.stringify(user).includes(first.password));
 // A PBKDF2 account from before scrypt.
 const salt='a1f3c9e7b2d4f6a8c0e2b4d6f8a1c3e5',key=await crypto.subtle.importKey('raw',new TextEncoder().encode(first.password),'PBKDF2',false,['deriveBits']);
 const hash=Buffer.from(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256)).toString('hex');
 const {algorithm,N,r,p,...rest}=user;sql.prepare('UPDATE workspace SET data=? WHERE id=?').run(JSON.stringify({...rest,salt,hash}),'auth:user:'+id);
 assert.equal((await login(post,first.email,first.password)).status,200);
 assert.equal(JSON.parse(sql.prepare('SELECT data FROM workspace WHERE id=?').get('auth:user:'+id).data).algorithm,'scrypt');
});

test('the Manager removes a person, who is signed out and cannot sign in again',async()=>{
 const {service,post}=fixture();const manager=await tabOf(await post(first));const managerId=(await service.currentUser(as(manager))).id;
 await post({...first,name:'Temporary Member',email:'member@example.test'},manager);
 const member=await tabOf(await login(post,'member@example.test',first.password));const memberId=(await service.currentUser(as(member))).id;
 assert.equal((await post({action:'remove',userId:managerId},member)).status,403);
 assert.equal((await post({action:'remove',userId:managerId},manager)).status,400);
 assert.equal((await post({action:'remove',userId:memberId},manager)).status,200);
 assert.equal(await service.currentUser(as(member)),null);
 assert.equal((await login(post,'member@example.test',first.password)).status,401);
 assert.equal((await post({action:'remove',userId:memberId},manager)).status,404);
 assert.deepEqual((await (await post({action:'people'},manager)).json()).people.map(p=>p.email),[first.email]);
});

test('each person saves their own notification choices',async()=>{
 const {post}=fixture();const manager=await tabOf(await post(first));
 await post({...first,name:'Temporary Member',email:'member@example.test'},manager);
 const member=await tabOf(await login(post,'member@example.test',first.password));
 assert.deepEqual((await (await post({action:'notifications'},member)).json()).settings,{daily:false,weekly:false,upcoming:true,due:true,overdue:true});
 assert.equal((await post({action:'notifications',settings:{daily:'yes'}},member)).status,400);
 assert.equal((await post({action:'notifications',settings:{unknown:true}},member)).status,400);
 assert.equal((await post({action:'notifications',settings:{daily:true,overdue:false}},member)).status,200);
 assert.deepEqual((await (await post({action:'notifications'},member)).json()).settings,{daily:true,weekly:false,upcoming:true,due:true,overdue:false});
 assert.equal((await (await post({action:'notifications'},manager)).json()).settings.daily,false);
 assert.equal((await post({action:'notifications'})).status,401);
});

test('authenticator setup needs the password and a working code; recovery resets the password once per code',async()=>{
 const {service,post,sql}=fixture();const manager=await tabOf(await post(first));
 await post({...first,name:'Temporary Member',email:'member@example.test'},manager);
 const member=await tabOf(await login(post,'member@example.test',first.password));
 assert.equal((await post({action:'authenticator-begin',password:'wrong-password-123'},member)).status,401);
 const begun=await (await post({action:'authenticator-begin',password:first.password},member)).json();
 assert.match(begun.secret,/^[A-Z2-7]{32}$/);assert.match(begun.uri,/^otpauth:\/\/totp\/GiroTrack:member%40example\.test\?secret=/);
 const step=Math.floor(Date.now()/30000);
 assert.equal((await post({action:'authenticator-confirm',code:'000000'===totpCode(begun.secret,step)?'111111':'000000'},member)).status,400);
 const confirmed=await (await post({action:'authenticator-confirm',code:totpCode(begun.secret,step)},member)).json();
 assert.equal(confirmed.user.authenticator,true);
 // The seed is stored encrypted with a key id, never in the clear.
 const stored=sql.prepare('SELECT data FROM workspace WHERE id=?').get('auth:user:'+await digest('member@example.test')).data;
 assert.ok(!stored.includes(begun.secret));assert.equal(JSON.parse(stored).totp.box.v,2);assert.equal(JSON.parse(stored).totp.box.kid,'1');
 const same={action:'recover',email:'member@example.test'},newPassword='Recovered-test-password-9';
 assert.equal((await post({...same,code:totpCode(begun.secret,step)})).status,401);
 assert.equal((await post({...same,email:'nobody@example.test',code:totpCode(begun.secret,step+1)})).status,401);
 assert.equal((await post({...same,email:first.email,code:'123456'})).status,401);
 const permitted=await post({...same,code:totpCode(begun.secret,step+1)});assert.equal(permitted.status,200);assert.equal(permitted.headers.get('set-cookie'),null);
 const {resetToken}=await permitted.json();assert.match(resetToken,/^[a-f0-9]{64}$/);
 assert.ok(!sql.prepare("SELECT group_concat(id) ids FROM workspace").get().ids.includes(resetToken),'only a hash of the reset token is stored');
 assert.ok(await service.currentUser(as(member)));
 assert.equal((await post({...same,code:totpCode(begun.secret,step+1)})).status,401);
 assert.equal((await post({action:'recover-complete',token:resetToken,password:'short'})).status,400);
 const recovered=await post({action:'recover-complete',token:resetToken,password:newPassword});assert.equal(recovered.status,200);
 assert.match(recovered.headers.get('set-cookie'),/girotrack_session=[a-f0-9]{64}/);assert.match((await recovered.json()).tabToken,/^[a-f0-9]{64}$/);
 assert.equal(await service.currentUser(as(member)),null,'every earlier session ends');
 assert.equal((await post({action:'recover-complete',token:resetToken,password:'Another-test-password-1'})).status,410);
 assert.equal((await login(post,'member@example.test',first.password)).status,401);
 const fresh=await tabOf(await login(post,'member@example.test',newPassword));
 assert.equal((await post({action:'authenticator-remove',password:first.password},fresh)).status,401);
 assert.equal((await (await post({action:'authenticator-remove',password:newPassword},fresh)).json()).user.authenticator,false);
 assert.equal((await post({action:'authenticator-begin',password:newPassword})).status,401);
});

test('authenticator seeds saved before key versions can still be used',async()=>{
 const {sql,post}=fixture();await post(first);
 const id=await digest(first.email),secret='JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
 const iv=crypto.getRandomValues(new Uint8Array(12)),key=await crypto.subtle.importKey('raw',Buffer.from(KEY,'base64'),{name:'AES-GCM'},false,['encrypt']);
 const box={iv:Buffer.from(iv).toString('base64'),data:Buffer.from(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(secret))).toString('base64')};
 const user=JSON.parse(sql.prepare('SELECT data FROM workspace WHERE id=?').get('auth:user:'+id).data);
 sql.prepare('UPDATE workspace SET data=? WHERE id=?').run(JSON.stringify({...user,totp:{box,lastStep:0}}),'auth:user:'+id);
 const r=await post({action:'recover',email:first.email,code:totpCode(secret,Math.floor(Date.now()/30000))});assert.equal(r.status,200);
});

test('without a vault key, authenticator setup fails safely instead of storing anything readable',async()=>{
 const {post}=fixture({});const owner=await tabOf(await post(first));
 assert.equal((await post({action:'authenticator-begin',password:first.password},owner)).status,503);
 const {post:post2}=fixture({GIROTRACK_VAULT_KEY:'too-short'});const other=await tabOf(await post2(first));
 assert.equal((await post2({action:'authenticator-begin',password:first.password},other)).status,503);
});

test('recovery codes are throttled per email',async()=>{
 const {post}=fixture();await post(first);
 const tries=await Promise.all(Array.from({length:7},()=>post({action:'recover',email:first.email,code:'123456'})));
 assert.equal(tries.filter(r=>r.status===401).length,5);assert.equal(tries.filter(r=>r.status===429).length,2);
});

test('an expired reset permission cannot set a password',async()=>{
 const {db,post}=fixture();await post(first);const token='ab'.repeat(32);
 await db.prepare('INSERT INTO workspace(id,data) VALUES(?,?)').bind('auth:reset:'+await digest(token),JSON.stringify({userId:await digest(first.email),expires:Date.now()-1})).run();
 const r=await post({action:'recover-complete',token,password:'Recovered-test-password-9'});assert.equal(r.status,410);assert.equal((await r.json()).expired,true);
 assert.equal((await login(post,first.email,first.password)).status,200);
});

test('stale setup marker does not block first account when no accounts exist',async()=>{
 const {db,post}=fixture();await db.prepare('INSERT INTO workspace(id,data) VALUES(?,?)').bind('auth:setup','{}').run();
 assert.equal((await post(first)).status,200);
});
