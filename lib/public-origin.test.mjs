import test from 'node:test';
import assert from 'node:assert/strict';
import {atPublicOrigin,parsePublicOrigin} from './public-origin.mjs';
import {safeMutation,sessionCookie} from './account-service.mjs';

test('the public origin must be a bare HTTPS address',()=>{
 assert.equal(parsePublicOrigin(''),null);
 assert.equal(parsePublicOrigin(undefined),null);
 assert.equal(parsePublicOrigin('https://girotrack.girosol.local'),'https://girotrack.girosol.local');
 assert.equal(parsePublicOrigin('https://girotrack.girosol.local/'),'https://girotrack.girosol.local');
 assert.equal(parsePublicOrigin('https://server:8443'),'https://server:8443');
 for(const bad of ['http://girotrack.girosol.local','https://girotrack.girosol.local/app','girotrack.girosol.local','not a url'])assert.throws(()=>parsePublicOrigin(bad),/GIROTRACK_PUBLIC_ORIGIN/);
});

test('behind the proxy, changes from the public page pass and cookies are Secure',async()=>{
 const origin='https://girotrack.girosol.local';
 const proxied=new Request('http://127.0.0.1:8788/api/workspace?x=1',{method:'PUT',headers:{origin,'content-type':'application/json'},body:'{"a":1}'});
 assert.equal(safeMutation(proxied),false);
 const seen=atPublicOrigin(proxied,origin);
 assert.equal(seen.url,origin+'/api/workspace?x=1');
 assert.equal(seen.method,'PUT');
 assert.equal(await seen.text(),'{"a":1}');
 assert.equal(safeMutation(seen),true);
 assert.match(sessionCookie(seen,'t'),/; Secure$/);
 // Another site is still refused.
 assert.equal(safeMutation(atPublicOrigin(new Request('http://127.0.0.1:8788/api/workspace',{method:'PUT',headers:{origin:'https://evil.example'}}),origin)),false);
 // Unset: requests are untouched.
 assert.equal(atPublicOrigin(proxied,null),proxied);
});
