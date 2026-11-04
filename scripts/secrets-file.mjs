// GiroTrack's server secrets, read from one protected file:
//   development: .dev.vars in the project (created by pnpm run local:setup);
//   the Girosol server: GIROTRACK_SECRETS_FILE, e.g. C:\ProgramData\GiroTrack\secrets.env,
//   readable only by the GiroTrack service account and administrators.
// Format: NAME=value lines; # starts a comment. Values are never printed.
import {existsSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {keyring} from '../lib/vault.mjs';
import {parsePublicOrigin} from '../lib/public-origin.mjs';

export const SECRET_NAMES=['GIROTRACK_VAULT_KEY','GIROTRACK_VAULT_KEY_ID','GIROTRACK_VAULT_OLD_KEYS','GIROTRACK_PUBLIC_ORIGIN','GIROTRACK_PROXY_SECRET'];

export const secretsPath=()=>path.resolve(process.env.GIROTRACK_SECRETS_FILE||'.dev.vars');

export function readSecrets(file=secretsPath()){
 if(!existsSync(file))return null;
 const values={};
 for(const line of readFileSync(file,'utf8').split(/\r?\n/)){
  const text=line.trim();if(!text||text.startsWith('#'))continue;
  const at=text.indexOf('=');if(at<1)throw Error(`${file}: every line must look like NAME=value.`);
  values[text.slice(0,at).trim()]=text.slice(at+1).trim().replace(/^"(.*)"$/,'$1');
 }
 return values;
}

/** The secrets the app needs, checked: throws a message (never containing a secret) when something is missing or malformed. */
export function loadSecrets(file=secretsPath()){
 const values=readSecrets(file);
 if(!values)throw Error(`No secrets file at ${file}. Restore it from your protected backup (or, for a brand-new install only, run pnpm run local:setup).`);
 if(!values.GIROTRACK_VAULT_KEY)throw Error(`${file} has no GIROTRACK_VAULT_KEY. Restore it from your protected backup; a new key can't open existing passwords.`);
 keyring(values);
 parsePublicOrigin(values.GIROTRACK_PUBLIC_ORIGIN);
 if(values.GIROTRACK_PROXY_SECRET!==undefined&&values.GIROTRACK_PROXY_SECRET.length<32)throw Error('GIROTRACK_PROXY_SECRET must be at least 32 characters.');
 return Object.fromEntries(SECRET_NAMES.filter(name=>values[name]!==undefined).map(name=>[name,values[name]]));
}

/** Rewrite the file in place (same folder, so its permissions are inherited), keeping comments and unrelated lines. */
export function writeSecrets(file,updates){
 const lines=existsSync(file)?readFileSync(file,'utf8').split(/\r?\n/):[];
 const pending=new Map(Object.entries(updates));
 const out=lines.map(line=>{const at=line.indexOf('=');const name=at>0?line.slice(0,at).trim():'';if(!pending.has(name))return line;const value=pending.get(name);pending.delete(name);return value===null?null:`${name}=${value}`;}).filter(line=>line!==null);
 while(out.length&&out[out.length-1]==='')out.pop();
 for(const [name,value] of pending)if(value!==null)out.push(`${name}=${value}`);
 const temp=file+'.new';
 writeFileSync(temp,out.join('\n')+'\n',{mode:0o600});
 renameSync(temp,file);
}
