import './sites-env.mjs';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {secretsPath} from './secrets-file.mjs';

// Local-only and idempotent: never deletes rows or replaces an existing vault key.
mkdirSync('.openai',{recursive:true});
const filename='.openai/hosting.json';
const hosting=existsSync(filename)?JSON.parse(readFileSync(filename,'utf8')):{};
if(hosting.d1&&hosting.d1!=='DB'||hosting.r2&&hosting.r2!=='BUCKET')throw Error('Expected GiroTrack bindings DB and BUCKET; existing configuration was preserved.');
writeFileSync(filename,JSON.stringify({...hosting,d1:'DB',r2:'BUCKET'},null,2)+'\n');
const state=path.resolve(process.env.GIROTRACK_LOCAL_STATE||'.wrangler/state');
const d1=(command,extra=[])=>spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','wrangler.local.json','--persist-to',state,...extra,'--command',command],{stdio:extra.includes('--json')?['inherit','pipe','inherit']:'inherit',encoding:'utf8'});
const result=d1('CREATE TABLE IF NOT EXISTS workspace (id TEXT PRIMARY KEY NOT NULL,data TEXT NOT NULL,version INTEGER DEFAULT 0 NOT NULL)');
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status||1);
// A new server starts empty. Without this row the app fills in its sample records; INSERT OR IGNORE leaves an existing workspace alone.
if(process.env.GIROTRACK_EMPTY_WORKSPACE==='1'){const empty=JSON.stringify({payers:[],invoices:[],views:[{id:'all',name:'All records',kind:'all',value:''}],activity:[]});const row=d1(`INSERT OR IGNORE INTO workspace (id,data,version) VALUES ('main','${empty.replaceAll("'","''")}',0)`);if(row.status!==0)process.exit(row.status||1);}
const secrets=secretsPath();
if(!existsSync(secrets)){
 // A new key is only for a brand-new workspace: with encrypted values already stored, it would make them unreadable.
 const check=d1("SELECT count(*) AS n FROM workspace WHERE substr(id,1,11)='credential:' OR (substr(id,1,10)='auth:user:' AND (json_extract(data,'$.totp') IS NOT NULL OR json_extract(data,'$.totpPending') IS NOT NULL))",['--json']);
 let encrypted=NaN;try{encrypted=JSON.parse(check.stdout)[0].results[0].n;}catch{}
 if(encrypted!==0){console.error(`No secrets file at ${secrets}, and this workspace ${Number.isNaN(encrypted)?'could not be checked for':'already has'} encrypted passwords. Restore the file from your protected backup; no new key was created.`);process.exit(1);}
 writeFileSync(secrets,'GIROTRACK_VAULT_KEY='+randomBytes(32).toString('base64')+'\n',{flag:'wx',mode:0o600});
 console.log('Created a new vault key in '+secrets+'. Back it up with the database.');
}
console.log('GiroTrack local database ready at '+state+'. Existing records and vault keys preserved.');
