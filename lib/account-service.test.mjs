import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createAccountService} from './account-service.mjs';
import {digest,totpCode} from './account-core.mjs';
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE workspace(id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0)');
 const db={prepare(query){let args=[];return {bind(...values){args=values;return this},async first(){return sql.prepare(query).get(...args)||null},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}}},async all(){return {results:sql.prepare(query).all(...args)}}}},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results}catch(e){sql.exec('ROLLBACK');throw e}}};
 const service=createAccountService(db,Buffer.alloc(32,7).toString('base64'));
 const request=(body,cookie,origin='http://localhost:5174')=>new Request('http://localhost:5174/api/account',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
 const post=(body,cookie,origin)=>service.POST(request(body,cookie,origin));
 return {sql,db,service,post};
}
const first={action:'create',name:'Temporary Owner',email:'owner@example.test',password:'Test-only-long-password-42'};
const cookie=r=>r.headers.get('set-cookie').split(';')[0];
test('first setup, protected creation, added user, sessions, logout, business data preserved',async()=>{
 const {sql,service,post}=fixture();sql.prepare('INSERT INTO workspace VALUES(?,?,?)').run('main','{"payers":["preserve"]}',7);
 assert.equal((await (await service.GET(new Request('http://localhost/api/account'))).json()).needsSetup,true);
 const created=await post(first);assert.equal(created.status,200);const session=cookie(created);
 assert.equal((await service.currentUser(new Request('http://localhost',{headers:{Cookie:session}}))).email,first.email);
 assert.equal((await post({...first,email:'other@example.test'})).status,401);
 const added=await post({...first,name:'Temporary Added',email:'added@example.test'},session);assert.equal(added.status,200);assert.equal(added.headers.get('set-cookie'),null);
 assert.equal((await post({action:'logout'},session)).status,200);
 assert.equal(await service.currentUser(new Request('http://localhost',{headers:{Cookie:session}})),null);
 assert.equal((await post({action:'login',email:'added@example.test',password:first.password})).status,200);
 assert.deepEqual({...sql.prepare("SELECT data,version FROM workspace WHERE id='main'").get()},{data:'{"payers":["preserve"]}',version:7});
});
test('invalid and expired sessions fail closed, including missing expiry',async()=>{
 const {db,service,post}=fixture();const session=cookie(await post(first));const token=session.split('=')[1];
 const id='auth:session:'+await digest(token);
 for(const expires of [Date.now()-1,null,'tomorrow']){
  await db.prepare('UPDATE workspace SET data=? WHERE id=?').bind(JSON.stringify({userId:await digest(first.email),expires}),id).run();
  assert.equal(await service.currentUser(new Request('http://localhost',{headers:{Cookie:session}})),null);
 }
});
test('throttling is atomic under concurrent attempts and origin checks reject cross-site writes',async()=>{
 const {post}=fixture();await post(first);
 const attempts=await Promise.all(Array.from({length:8},()=>post({action:'login',email:first.email,password:'wrong'})));
 assert.equal(attempts.filter(r=>r.status===401).length,5);assert.equal(attempts.filter(r=>r.status===429).length,3);
 assert.equal((await post({action:'login',email:first.email,password:first.password})).status,429);
 assert.equal((await post({action:'logout'},null,'https://elsewhere.test')).status,403);
});
test('stale setup marker does not block first account when no accounts exist',async()=>{
 const {db,post}=fixture();await db.prepare('INSERT INTO workspace(id,data) VALUES(?,?)').bind('auth:setup','{}').run();
 assert.equal((await post(first)).status,200);
});

test('concurrent bootstrap creates only one first account and cookies expire securely',async()=>{
 const {post,sql}=fixture();
 const results=await Promise.all([post(first),post({...first,email:'racing@example.test'})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal(sql.prepare("SELECT count(*) n FROM workspace WHERE substr(id,1,10)='auth:user:'").get().n,1);
 const created=results.find(r=>r.ok);
 assert.match(created.headers.get('set-cookie'),/HttpOnly; SameSite=Strict; Max-Age=604800/);
 const out=await post({action:'logout'},cookie(created));assert.match(out.headers.get('set-cookie'),/Max-Age=0/);
});
test('throttle window expires, successful login resets failures, invalid requests are rejected',async()=>{
 const {post,db}=fixture();await post(first);
 for(let n=0;n<5;n++)assert.equal((await post({action:'login',email:first.email,password:'wrong'})).status,401);
 assert.equal((await post({action:'login',email:first.email,password:first.password})).status,429);
 await db.prepare('UPDATE workspace SET data=? WHERE id=?').bind(JSON.stringify({count:5,until:Date.now()-1}),'auth:attempt:'+await digest(first.email)).run();
 assert.equal((await post({action:'login',email:first.email,password:first.password})).status,200);
 assert.equal((await post({action:'login',email:first.email,password:'wrong'})).status,401);
 assert.equal((await post(null)).status,400);
 assert.equal((await post({action:'login',email:first.email,password:'x'.repeat(5000)})).status,413);
});

const signedIn=session=>new Request('http://localhost',{headers:{Cookie:session}});
test('first account is the Manager; only the Manager adds people and resets passwords',async()=>{
 const {service,post}=fixture();const manager=cookie(await post(first));
 assert.equal((await service.currentUser(signedIn(manager))).role,'Manager');
 assert.equal((await post({...first,name:'Temporary Member',email:'member@example.test'},manager)).status,200);
 const member=cookie(await post({action:'login',email:'member@example.test',password:first.password}));
 assert.equal((await service.currentUser(signedIn(member))).role,'Member');
 assert.equal((await post({...first,email:'blocked@example.test'},member)).status,403);
 assert.equal((await post({action:'people'},member)).status,403);
 const {people}=await (await post({action:'people'},manager)).json();
 assert.deepEqual(people.map(p=>[p.email,p.role]),[[first.email,'Manager'],['member@example.test','Member']]);assert.equal('hash' in people[0],false);
 const userId=people[1].id;
 assert.equal((await post({action:'reset',userId,password:'short'},manager)).status,400);
 assert.equal((await post({action:'reset',userId,password:'New-test-only-password-7'},manager)).status,200);
 assert.equal(await service.currentUser(signedIn(member)),null);
 assert.equal((await post({action:'login',email:'member@example.test',password:first.password})).status,401);
 assert.equal((await post({action:'login',email:'member@example.test',password:'New-test-only-password-7'})).status,200);
 assert.equal((await service.currentUser(signedIn(manager))).email,first.email);
});
test('accounts created before roles: the earliest becomes the Manager',async()=>{
 const {sql,service,post}=fixture();const owner=cookie(await post(first));
 await post({...first,name:'Temporary Later',email:'later@example.test'},owner);
 for(const row of sql.prepare("SELECT id,data FROM workspace WHERE substr(id,1,10)='auth:user:'").all()){const {role,...rest}=JSON.parse(row.data);sql.prepare('UPDATE workspace SET data=? WHERE id=?').run(JSON.stringify(rest),row.id);}
 const later=cookie(await post({action:'login',email:'later@example.test',password:first.password}));
 assert.equal((await service.currentUser(signedIn(later))).role,'Member');
 assert.equal((await service.currentUser(signedIn(owner))).role,'Manager');
});
test('the Manager removes a person, who is signed out and cannot sign in again',async()=>{
 const {service,post}=fixture();const manager=cookie(await post(first));const managerId=(await service.currentUser(signedIn(manager))).id;
 await post({...first,name:'Temporary Member',email:'member@example.test'},manager);
 const member=cookie(await post({action:'login',email:'member@example.test',password:first.password}));const memberId=(await service.currentUser(signedIn(member))).id;
 assert.equal((await post({action:'remove',userId:managerId},member)).status,403);
 assert.equal((await post({action:'remove',userId:managerId},manager)).status,400);
 assert.equal((await post({action:'remove',userId:memberId},manager)).status,200);
 assert.equal(await service.currentUser(signedIn(member)),null);
 assert.equal((await post({action:'login',email:'member@example.test',password:first.password})).status,401);
 assert.equal((await post({action:'remove',userId:memberId},manager)).status,404);
 assert.deepEqual((await (await post({action:'people'},manager)).json()).people.map(p=>p.email),[first.email]);
});
test('each person saves their own notification choices',async()=>{
 const {post}=fixture();const manager=cookie(await post(first));
 await post({...first,name:'Temporary Member',email:'member@example.test'},manager);
 const member=cookie(await post({action:'login',email:'member@example.test',password:first.password}));
 assert.deepEqual((await (await post({action:'notifications'},member)).json()).settings,{daily:false,weekly:false,upcoming:true,due:true,overdue:true});
 assert.equal((await post({action:'notifications',settings:{daily:'yes'}},member)).status,400);
 assert.equal((await post({action:'notifications',settings:{unknown:true}},member)).status,400);
 assert.equal((await post({action:'notifications',settings:{daily:true,overdue:false}},member)).status,200);
 assert.deepEqual((await (await post({action:'notifications'},member)).json()).settings,{daily:true,weekly:false,upcoming:true,due:true,overdue:false});
 assert.equal((await (await post({action:'notifications'},manager)).json()).settings.daily,false);
 assert.equal((await post({action:'notifications'})).status,401);
 assert.equal((await post({action:'login',email:'member@example.test',password:first.password})).status,200);
});
test('authenticator setup needs the password and a working code; recovery resets the password once per code',async()=>{
 const {service,post}=fixture();const manager=cookie(await post(first));
 await post({...first,name:'Temporary Member',email:'member@example.test'},manager);
 const member=cookie(await post({action:'login',email:'member@example.test',password:first.password}));
 assert.equal((await post({action:'authenticator-begin',password:'wrong-password-123'},member)).status,401);
 const begun=await (await post({action:'authenticator-begin',password:first.password},member)).json();
 assert.match(begun.secret,/^[A-Z2-7]{32}$/);assert.match(begun.uri,/^otpauth:\/\/totp\/GiroTrack:member%40example\.test\?secret=/);
 const step=Math.floor(Date.now()/30000);
 assert.equal((await post({action:'authenticator-confirm',code:'000000'===totpCode(begun.secret,step)?'111111':'000000'},member)).status,400);
 const confirmed=await (await post({action:'authenticator-confirm',code:totpCode(begun.secret,step)},member)).json();
 assert.equal(confirmed.user.authenticator,true);
 const same={action:'recover',email:'member@example.test'},newPassword='Recovered-test-password-9';
 assert.equal((await post({...same,code:totpCode(begun.secret,step)})).status,401);
 assert.equal((await post({...same,email:'nobody@example.test',code:totpCode(begun.secret,step+1)})).status,401);
 assert.equal((await post({...same,email:first.email,code:'123456'})).status,401);
 const permitted=await post({...same,code:totpCode(begun.secret,step+1)});assert.equal(permitted.status,200);assert.equal(permitted.headers.get('set-cookie'),null);
 const {resetToken}=await permitted.json();assert.match(resetToken,/^[a-f0-9]{64}$/);
 assert.equal(await service.currentUser(signedIn(member))!==null,true);
 assert.equal((await post({...same,code:totpCode(begun.secret,step+1)})).status,401);
 assert.equal((await post({action:'recover-complete',token:resetToken,password:'short'})).status,400);
 const recovered=await post({action:'recover-complete',token:resetToken,password:newPassword});assert.equal(recovered.status,200);assert.match(recovered.headers.get('set-cookie'),/girotrack_session=[a-f0-9]{64}/);
 assert.equal(await service.currentUser(signedIn(member)),null);
 assert.equal((await post({action:'recover-complete',token:resetToken,password:'Another-test-password-1'})).status,410);
 assert.equal((await post({action:'login',email:'member@example.test',password:first.password})).status,401);
 const same2={password:newPassword};
 const fresh=cookie(await post({action:'login',email:'member@example.test',password:same2.password}));
 assert.equal((await post({action:'authenticator-remove',password:first.password},fresh)).status,401);
 assert.equal((await (await post({action:'authenticator-remove',password:same2.password},fresh)).json()).user.authenticator,false);
 assert.equal((await post({action:'authenticator-begin',password:same2.password})).status,401);
});
test('recovery is throttled per email',async()=>{
 const {post}=fixture();await post(first);
 const tries=await Promise.all(Array.from({length:7},()=>post({action:'recover',email:first.email,code:'123456'})));
 assert.equal(tries.filter(r=>r.status===401).length,5);assert.equal(tries.filter(r=>r.status===429).length,2);
});
test('an expired reset permission cannot set a password',async()=>{
 const {db,post}=fixture();await post(first);const token='ab'.repeat(32);
 await db.prepare('INSERT INTO workspace(id,data) VALUES(?,?)').bind('auth:reset:'+await digest(token),JSON.stringify({userId:await digest(first.email),expires:Date.now()-1})).run();
 const r=await post({action:'recover-complete',token,password:'Recovered-test-password-9'});assert.equal(r.status,410);assert.equal((await r.json()).expired,true);
 assert.equal((await post({action:'login',email:first.email,password:first.password})).status,200);
});
