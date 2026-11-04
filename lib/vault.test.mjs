import test from 'node:test';
import assert from 'node:assert/strict';
import {credentialAad,decryptSecret,encryptSecret,keyIdOf,keyring,needsReencryption,totpAad,VaultError} from './vault.mjs';
const key=n=>Buffer.alloc(32,n).toString('base64');

test('AES-256-GCM with a fresh nonce per value, bound to its owner',async()=>{
 const ring=keyring({GIROTRACK_VAULT_KEY:key(1)});
 const a=await encryptSecret(ring,'portal-test-value',credentialAad('p1')),b=await encryptSecret(ring,'portal-test-value',credentialAad('p1'));
 assert.equal(a.v,2);assert.equal(a.kid,'1');assert.notEqual(a.iv,b.iv);assert.notEqual(a.data,b.data);
 assert.ok(!JSON.stringify(a).includes('portal-test-value'));
 assert.equal(await decryptSecret(ring,a,credentialAad('p1')),'portal-test-value');
 // Moved onto another vendor or tampered with: refused.
 await assert.rejects(decryptSecret(ring,a,credentialAad('p2')),VaultError);
 const bytes=Buffer.from(a.data,'base64');bytes[0]^=1;
 await assert.rejects(decryptSecret(ring,{...a,data:bytes.toString('base64')},credentialAad('p1')),VaultError);
 await assert.rejects(decryptSecret(keyring({GIROTRACK_VAULT_KEY:key(2)}),a,credentialAad('p1')),VaultError);
});

test('values from before versioning still open with key 1, and are flagged for re-encryption',async()=>{
 const raw=Buffer.alloc(32,1),cryptoKey=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},cryptoKey,new TextEncoder().encode('old-portal-value')));
 const legacyCredential={iv:Array.from(iv),cipher:Array.from(cipher)};
 const legacyTotp={iv:Buffer.from(iv).toString('base64'),data:Buffer.from(cipher).toString('base64')};
 const ring=keyring({GIROTRACK_VAULT_KEY:key(1)});
 assert.equal(await decryptSecret(ring,legacyCredential,credentialAad('p1')),'old-portal-value');
 assert.equal(await decryptSecret(ring,legacyTotp,totpAad('u1')),'old-portal-value');
 assert.equal(keyIdOf(legacyCredential),'1');assert.equal(needsReencryption(ring,legacyCredential),true);
 // After rotation the old key is listed as an old key and keeps working.
 const rotated=keyring({GIROTRACK_VAULT_KEY:key(2),GIROTRACK_VAULT_KEY_ID:'2',GIROTRACK_VAULT_OLD_KEYS:`1:${key(1)}`});
 assert.equal(await decryptSecret(rotated,legacyCredential,credentialAad('p1')),'old-portal-value');
 const fresh=await encryptSecret(rotated,'new-value',credentialAad('p1'));
 assert.equal(fresh.kid,'2');assert.equal(needsReencryption(rotated,fresh),false);
 assert.equal(needsReencryption(rotated,await encryptSecret(ring,'x',credentialAad('p1'))),true);
 // Without the old key, older values are refused with a message naming the key id only.
 const forgotten=keyring({GIROTRACK_VAULT_KEY:key(2),GIROTRACK_VAULT_KEY_ID:'2'});
 await assert.rejects(decryptSecret(forgotten,legacyCredential,credentialAad('p1')),error=>error instanceof VaultError&&/"1" is not configured/.test(error.message)&&!error.message.includes(key(1)));
});

test('missing or malformed keys fail safely, without echoing the key',()=>{
 assert.equal(keyring({}),null);assert.equal(keyring(undefined),null);
 for(const bad of [{GIROTRACK_VAULT_KEY:'short'},{GIROTRACK_VAULT_KEY:key(1),GIROTRACK_VAULT_KEY_ID:'bad id'},{GIROTRACK_VAULT_KEY:key(1),GIROTRACK_VAULT_OLD_KEYS:'1:'+key(2)},{GIROTRACK_VAULT_KEY:key(1),GIROTRACK_VAULT_OLD_KEYS:'nocolon'},{GIROTRACK_VAULT_KEY:key(1),GIROTRACK_VAULT_OLD_KEYS:'2:short'}])
  assert.throws(()=>keyring(bad),error=>error instanceof VaultError&&!error.message.includes(key(1))&&!error.message.includes(key(2)));
 return assert.rejects(encryptSecret(null,'x','aad'),/not configured/);
});
