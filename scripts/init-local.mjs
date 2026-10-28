import './sites-env.mjs';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

// Local-only and idempotent: never deletes rows or replaces an existing vault key.
mkdirSync('.openai',{recursive:true});
const filename='.openai/hosting.json';
const hosting=existsSync(filename)?JSON.parse(readFileSync(filename,'utf8')):{};
if(hosting.d1&&hosting.d1!=='DB'||hosting.r2&&hosting.r2!=='BUCKET')throw Error('Expected GiroTrack bindings DB and BUCKET; existing configuration was preserved.');
writeFileSync(filename,JSON.stringify({...hosting,d1:'DB',r2:'BUCKET'},null,2)+'\n');
const state=path.resolve(process.env.GIROTRACK_LOCAL_STATE||'.wrangler/state');
const result=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','wrangler.local.json','--persist-to',state,'--command','CREATE TABLE IF NOT EXISTS workspace (id TEXT PRIMARY KEY NOT NULL,data TEXT NOT NULL,version INTEGER DEFAULT 0 NOT NULL)'],{stdio:'inherit'});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status||1);
if(!existsSync('.dev.vars'))writeFileSync('.dev.vars','GIROTRACK_VAULT_KEY='+randomBytes(32).toString('base64')+'\n',{flag:'wx',mode:0o600});
console.log('GiroTrack local database ready at '+state+'. Existing records and vault keys preserved.');
