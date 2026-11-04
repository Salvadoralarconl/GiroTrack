import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {confirmCopy,credentialHistory,recordCredentialEvent} from './credential-log.mjs';
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE workspace(id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0)');
 const db={prepare(query){let args=[];return {bind(...values){args=values;return this},async first(){return sql.prepare(query).get(...args)||null},async run(){sql.prepare(query).run(...args);return {meta:{}}},async all(){return {results:sql.prepare(query).all(...args)}}}}};
 return {sql,db};
}
const ana={id:'u1',name:'Ana'},luis={id:'u2',name:'Luis'};
test('each retrieval and change is kept per vendor with employee, vendor, action, time and outcome — newest first',async()=>{
 const {sql,db}=fixture();
 await recordCredentialEvent(db,'p1',ana,{action:'retrieve',purpose:'view',outcome:'ok'},new Date('2026-10-28T14:00:00Z'));
 await recordCredentialEvent(db,'p1',luis,{action:'retrieve',purpose:'copy',outcome:'ok'},new Date('2026-10-28T15:00:00Z'));
 await recordCredentialEvent(db,'p1',ana,{action:'change',outcome:'ok'},new Date('2026-10-28T16:00:00Z'));
 await recordCredentialEvent(db,'p1',luis,{action:'retrieve',purpose:'view',outcome:'failed'},new Date('2026-10-28T17:00:00Z'));
 // Same instant, two people: both kept.
 await recordCredentialEvent(db,'p10',ana,{action:'retrieve',purpose:'view',outcome:'ok'},new Date('2026-10-28T16:00:00Z'));
 await recordCredentialEvent(db,'p10',luis,{action:'retrieve',purpose:'view',outcome:'ok'},new Date('2026-10-28T16:00:00Z'));
 const history=await credentialHistory(db,'p1');
 assert.deepEqual(history.map(h=>[h.name,h.action,h.purpose,h.outcome]),[['Luis','retrieve','view','failed'],['Ana','change',undefined,'ok'],['Luis','retrieve','copy','ok'],['Ana','retrieve','view','ok']]);
 assert.deepEqual(Object.keys(history[0]).sort(),['action','at','name','outcome','payer','purpose','userId']);
 assert.equal(history[0].payer,'p1');assert.equal(history[0].userId,'u2');
 assert.equal((await credentialHistory(db,'p10')).length,2);
 assert.deepEqual(await credentialHistory(db,'p2'),[]);
 assert.equal((await credentialHistory(db,'p1',1)).length,1);
 // Only log rows: never the password row or the workspace.
 assert.equal(sql.prepare("SELECT count(*) n FROM workspace WHERE id NOT LIKE 'credential-log:%'").get().n,0);
});
test('a copy is confirmed only by the person who retrieved it, soon after, once',async()=>{
 const {db}=fixture();
 const copy=await recordCredentialEvent(db,'p1',ana,{action:'retrieve',purpose:'copy',outcome:'ok'});
 const view=await recordCredentialEvent(db,'p1',ana,{action:'retrieve',purpose:'view',outcome:'ok'});
 assert.equal(await confirmCopy(db,'p1',luis,copy),false,'someone else');
 assert.equal(await confirmCopy(db,'p1',ana,view),false,'not a copy');
 assert.equal(await confirmCopy(db,'p2',ana,copy),false,'another vendor');
 assert.equal(await confirmCopy(db,'p1',ana,'../../auth:user:x'),false,'malformed id');
 assert.equal(await confirmCopy(db,'p1',ana,copy,Date.now()+6*60000),false,'too late');
 assert.equal(await confirmCopy(db,'p1',ana,copy),true);
 assert.equal(await confirmCopy(db,'p1',ana,copy),false,'only once');
 assert.ok((await credentialHistory(db,'p1')).find(h=>h.purpose==='copy').confirmedAt);
});
test('unknown events are refused',async()=>{
 const {db}=fixture();
 await assert.rejects(recordCredentialEvent(db,'p1',ana,{action:'delete',outcome:'ok'}),/Unknown credential event/);
 await assert.rejects(recordCredentialEvent(db,'p1',ana,{action:'retrieve',outcome:'ok'}),/Unknown credential event/);
});
