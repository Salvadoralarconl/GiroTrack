import test from 'node:test';
import assert from 'node:assert/strict';
import {checkSignature,signersOf,SIGNATURE_MAX_BYTES} from './signatures.mjs';
const png=n=>'data:image/png;base64,'+Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(n)]).toString('base64');
const jpg='data:image/jpeg;base64,'+Buffer.from([0xff,0xd8,0xff,0xe0,0,0x10]).toString('base64');

test('only real PNG or JPEG images up to 300 KB are accepted',()=>{
 assert.ok(checkSignature(png(100)).image);assert.ok(checkSignature(jpg).image);
 assert.match(checkSignature(png(SIGNATURE_MAX_BYTES)).error,/300 KB/);
 assert.match(checkSignature('data:image/png;base64,'+Buffer.from('<svg onload=alert(1)>').toString('base64')).error,/not a real/);
 assert.match(checkSignature(jpg.replace('jpeg','png')).error,/not a real/,'declared type must match the bytes');
 for(const bad of ['data:image/svg+xml;base64,PHN2Zz4=','https://example.com/sig.png',null,42,'data:image/png;base64,***'])assert.ok(checkSignature(bad).error);
});

test('a request shows the requester’s signature, and the approver’s only once approved',()=>{
 assert.deepEqual(signersOf({requestedById:'u1',status:'pending',approvedById:'m1'}),{requested:'u1',approved:undefined});
 assert.deepEqual(signersOf({requestedById:'u1',status:'approved',approvedById:'m1'}),{requested:'u1',approved:'m1'});
 assert.deepEqual(signersOf(undefined),{});
});
import {checkPlacement} from './signatures.mjs';
test('signature positions stay within the area and sizes within limits',()=>{
 assert.deepEqual(checkPlacement({x:12.34,y:-20,size:1.234}).placement,{x:12.3,y:-20,size:1.23});
 for(const bad of [null,{x:0,y:0},{x:99,y:0,size:1},{x:0,y:-81,size:1},{x:0,y:0,size:5},{x:'a',y:0,size:1}])assert.ok(checkPlacement(bad).error);
});
