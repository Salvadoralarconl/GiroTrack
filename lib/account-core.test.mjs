import test from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,publicUser,attributedActivity,base32,totpCode,matchTotp} from './account-core.mjs';
test('passwords are salted and verified without storing plaintext',async()=>{const a=await hashPassword('test-password-only'),b=await hashPassword('test-password-only');assert.notEqual(a.salt,b.salt);assert.notEqual(a.hash,b.hash);assert.equal(await verifyPassword('test-password-only',a),true);assert.equal(await verifyPassword('incorrect',a),false);assert.ok(!JSON.stringify(a).includes('test-password-only'));});
test('public profiles omit password hashes',()=>{assert.deepEqual(publicUser({id:'1',name:'Name',email:'a@example.com',hash:'secret',salt:'secret'}),{id:'1',name:'Name',email:'a@example.com',role:'Member',authenticator:false});});
test('server attribution ignores forged names and preserves existing activity',()=>{const previous=[{id:'old',actor:'Original',text:'Original text',time:'before'}];const user={id:'real-id',name:'Real person'};const result=attributedActivity(previous,[{id:'new',actor:'Forged',actorId:'fake',text:'Invoice updated',time:'fake'},{id:'old',actor:'Forged',text:'Changed history'}],user,'now');assert.equal(result[0].actor,'Real person');assert.equal(result[0].actorId,'real-id');assert.equal(result[0].time,'now');assert.deepEqual(result[1],previous[0]);});

test('new passwords use versioned memory-hard hashes and legacy passwords still verify',async()=>{
 const value=await hashPassword('temporary-test-password');
 assert.equal(value.algorithm,'scrypt');
 assert.equal(value.N,32768);assert.equal(value.r,8);assert.equal(value.p,3);
 const salt='00112233445566778899aabbccddeeff';
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('legacy-password'),'PBKDF2',false,['deriveBits']);
 const bytes=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256);
 const hash=Buffer.from(bytes).toString('hex');
 assert.equal(await verifyPassword('legacy-password',{salt,hash}),true);
 assert.equal(await verifyPassword('incorrect',{salt,hash}),false);
 assert.equal(await verifyPassword('x',{algorithm:'invalid',salt,hash}),false);
});
test('authenticator codes match the RFC 6238 example and reject reuse and stale codes',()=>{
 const secret=base32(new TextEncoder().encode('12345678901234567890'));
 assert.equal(secret,'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
 assert.equal(totpCode(secret,1),'287082');assert.equal(totpCode(secret,37037036),'081804');
 const now=59000;assert.equal(matchTotp(secret,'287082',-1,now),1);
 assert.equal(matchTotp(secret,'287082',1,now),null);
 assert.equal(matchTotp(secret,totpCode(secret,5),-1,now),null);
 assert.equal(matchTotp(secret,'12345',-1,now),null);
});
