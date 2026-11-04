// Vault key maintenance (run with GiroTrack stopped, from the GiroTrack folder):
//   node scripts/vault-keys.mjs status                  which key each stored secret uses; can all be opened?
//   node scripts/vault-keys.mjs new-key                 add a new current key; the old one stays for reading
//   node scripts/vault-keys.mjs reencrypt --backup DIR  back up, re-encrypt everything with the current key, verify
//   node scripts/vault-keys.mjs drop-key --id ID        remove an old key once nothing uses it
// Uses GIROTRACK_SECRETS_FILE (default .dev.vars) and GIROTRACK_LOCAL_STATE (default .wrangler/state).
// Never prints keys, passwords or authenticator seeds.
import './sites-env.mjs';
import {cpSync,existsSync,mkdirSync,copyFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {getPlatformProxy} from 'wrangler';
import {credentialAad,decryptSecret,encryptSecret,keyIdOf,keyring,totpAad} from '../lib/vault.mjs';
import {loadSecrets,readSecrets,secretsPath,writeSecrets} from './secrets-file.mjs';

const [command,...args]=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
const fail=message=>{console.error(message);process.exit(1);};
const state=path.resolve(process.env.GIROTRACK_LOCAL_STATE||'.wrangler/state');

async function ensureStopped(){
 const port=process.env.GIROTRACK_PORT||'8788';
 const running=await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(1500)}).then(()=>true,()=>false);
 if(running)fail(`GiroTrack is answering on port ${port}. Stop it first (nssm stop GiroTrack).`);
}

async function openDb(){
 const proxy=await getPlatformProxy({configPath:'wrangler.local.json',persist:{path:path.join(state,'v3')}});
 return {db:proxy.env.DB,close:()=>proxy.dispose()};
}

/** Every stored secret: where it lives and how to read/write it. */
async function secretsIn(db){
 const items=[];
 for(const row of (await db.prepare("SELECT id,data FROM workspace WHERE substr(id,1,11)='credential:'").all()).results){
  const payer=row.id.slice(11);
  items.push({label:'vendor password',id:row.id,box:JSON.parse(row.data),aad:credentialAad(payer),store:async box=>db.prepare('UPDATE workspace SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify(box),row.id).run()});
 }
 for(const row of (await db.prepare("SELECT id,data FROM workspace WHERE substr(id,1,10)='auth:user:'").all()).results){
  const user=JSON.parse(row.data);
  for(const field of ['totp','totpPending']){
   if(!user[field]?.box)continue;
   items.push({label:'authenticator seed',id:row.id,box:user[field].box,aad:totpAad(user.id),store:async box=>{const fresh=JSON.parse((await db.prepare('SELECT data FROM workspace WHERE id=?').bind(row.id).first()).data);fresh[field]={...fresh[field],box};await db.prepare('UPDATE workspace SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify(fresh),row.id).run();}});
  }
 }
 return items;
}

async function check(ring,items){
 const byKey={},unreadable=[];
 for(const item of items){
  const kid=keyIdOf(item.box)??'unknown';byKey[kid]=(byKey[kid]||0)+1;
  try{item.plain=await decryptSecret(ring,item.box,item.aad);}catch{unreadable.push(`${item.label} (${item.id}, key ${kid})`);}
 }
 return {byKey,unreadable};
}

const report=({byKey,unreadable},ring)=>{
 console.log(`Current key: ${ring.currentId}. Configured keys: ${[...ring.keys.keys()].join(', ')}.`);
 console.log(`Stored secrets by key: ${Object.entries(byKey).map(([k,n])=>`${k}: ${n}`).join(', ')||'none'}.`);
 if(unreadable.length)console.log(`Cannot be opened with the configured keys (${unreadable.length}):\n  ${unreadable.join('\n  ')}`);
 else console.log('Every stored secret opens with the configured keys.');
};

if(command==='status'){
 const ring=keyring(loadSecrets());
 const {db,close}=await openDb();
 const result=await check(ring,await secretsIn(db));await close();
 report(result,ring);process.exit(result.unreadable.length?1:0);
}else if(command==='new-key'){
 const file=secretsPath(),values=loadSecrets(file),ring=keyring(values);
 const ids=[...ring.keys.keys()].map(Number).filter(Number.isInteger);
 const next=String((ids.length?Math.max(...ids):0)+1);
 if(ring.keys.has(next))fail('Could not pick a new key id; set GIROTRACK_VAULT_KEY_ID values by hand.');
 const old=[values.GIROTRACK_VAULT_OLD_KEYS,`${ring.currentId}:${values.GIROTRACK_VAULT_KEY}`].filter(Boolean).join(',');
 writeSecrets(file,{GIROTRACK_VAULT_KEY:randomBytes(32).toString('base64'),GIROTRACK_VAULT_KEY_ID:next,GIROTRACK_VAULT_OLD_KEYS:old});
 keyring(readSecrets(file));
 console.log(`Key ${next} is now current; key ${ring.currentId} moved to GIROTRACK_VAULT_OLD_KEYS (still used to read older values).`);
 console.log('Next: start GiroTrack, check it, stop it, then run: node scripts/vault-keys.mjs reencrypt --backup <folder>');
}else if(command==='reencrypt'){
 const backup=option('--backup');
 if(!backup)fail('Give a new, protected backup folder: --backup D:\\Backups\\GiroTrack\\before-rekey');
 if(existsSync(backup))fail(`${backup} already exists; choose a new folder.`);
 await ensureStopped();
 const ring=keyring(loadSecrets());
 // 1. Back up the data and the secrets file together, before anything changes.
 mkdirSync(backup,{recursive:true});
 cpSync(state,path.join(backup,'state'),{recursive:true});
 copyFileSync(secretsPath(),path.join(backup,path.basename(secretsPath())));
 console.log(`Backed up ${state} and the secrets file to ${backup} (keep it administrators-only).`);
 const {db,close}=await openDb();
 try{
  // 2. Everything must open first; nothing is written otherwise.
  const items=await secretsIn(db),before=await check(ring,items);
  report(before,ring);
  if(before.unreadable.length)fail('Nothing was changed. Add the missing keys to GIROTRACK_VAULT_OLD_KEYS and run again.');
  // 3. Re-encrypt what isn't on the current key.
  let moved=0;
  for(const item of items){if(item.box?.v===2&&item.box.kid===ring.currentId)continue;await item.store(await encryptSecret(ring,item.plain,item.aad));moved++;}
  // 4. Read everything back and compare.
  const after=await secretsIn(db),originals=new Map(items.map(i=>[i.label+i.id+i.aad,i.plain]));
  const wrong=[];
  for(const item of after){let plain=null;try{plain=await decryptSecret(ring,item.box,item.aad);}catch{}if(plain===null||plain!==originals.get(item.label+item.id+item.aad)||item.box.kid!==ring.currentId)wrong.push(item.id);}
  if(wrong.length)fail(`Verification failed for ${wrong.length} value(s). Restore ${backup} (state folder and secrets file) before starting GiroTrack.`);
  console.log(`Re-encrypted ${moved} value(s); all ${after.length} now use key ${ring.currentId} and match the originals.`);
  console.log('Old keys are still listed for safety. Remove one only with drop-key, after a protected copy of the backup exists.');
 }finally{await close();}
}else if(command==='drop-key'){
 const id=option('--id'),file=secretsPath(),values=loadSecrets(file),ring=keyring(values);
 if(!id||id===ring.currentId)fail('Give an old key id (not the current one): --id 1');
 if(!ring.keys.has(id))fail(`Key ${id} is not configured.`);
 await ensureStopped();
 const {db,close}=await openDb();const result=await check(ring,await secretsIn(db));await close();
 if(result.byKey[id])fail(`Key ${id} still opens ${result.byKey[id]} value(s). Run reencrypt first.`);
 if(result.unreadable.length)fail('Some values can\'t be opened; fix that before removing keys.');
 const remaining=String(values.GIROTRACK_VAULT_OLD_KEYS||'').split(',').map(s=>s.trim()).filter(s=>s&&s.slice(0,s.indexOf(':'))!==id).join(',');
 writeSecrets(file,{GIROTRACK_VAULT_OLD_KEYS:remaining||null});
 console.log(`Key ${id} removed from ${file}. Keep the protected backup that still has it until you are sure.`);
}else{
 fail('Usage: node scripts/vault-keys.mjs status | new-key | reencrypt --backup DIR | drop-key --id ID');
}
