// Runs the built app (pnpm run build first) on this machine only: 127.0.0.1,
// so people reach it through the reverse proxy (IIS), never directly.
// GIROTRACK_PORT picks the port (default 8788), GIROTRACK_LOCAL_STATE the data
// folder (default .wrangler/state) and GIROTRACK_SECRETS_FILE the secrets file
// (default .dev.vars; see secrets-file.mjs).
//
// Secrets reach the app through this process's environment only: no copy of
// the key file is written into the project or build folders. Wrangler gets a
// minimal environment (CLOUDFLARE_INCLUDE_PROCESS_ENV exposes all of it to the
// app), and the start is refused when the key is missing or malformed.
import {existsSync,rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {loadSecrets,secretsPath} from './secrets-file.mjs';

const config='dist/server/wrangler.json';
const fail=(message)=>{console.error(message);process.exit(1);};
if(!existsSync(config))fail('No build found. Run pnpm run build first.');
// Earlier versions copied the secrets beside the build; Wrangler would still read that copy, so it goes.
rmSync(path.join(path.dirname(config),'.dev.vars'),{force:true});

let secrets;
try{secrets=loadSecrets();}catch(error){fail(`GiroTrack did not start: ${error.message}`);}

const port=process.env.GIROTRACK_PORT||'8788';
if(!/^\d{2,5}$/.test(port))fail('GIROTRACK_PORT must be a port number.');
const state=path.resolve(process.env.GIROTRACK_LOCAL_STATE||'.wrangler/state');

const KEEP=['SystemRoot','SYSTEMROOT','windir','SystemDrive','ComSpec','PATH','Path','PATHEXT','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','HOME','APPDATA','LOCALAPPDATA','ProgramData','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','OS','LANG'];
const childEnv={...Object.fromEntries(KEEP.filter(name=>process.env[name]!==undefined).map(name=>[name,process.env[name]])),CLOUDFLARE_INCLUDE_PROCESS_ENV:'true',...secrets};
console.log(`Starting GiroTrack on http://127.0.0.1:${port} (data: ${state}; secrets: ${secretsPath()}).`);
const child=spawn(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','dev','--config',config,'--local','--persist-to',state,'--ip','127.0.0.1','--port',port,'--inspector-port','0','--show-interactive-dev-session=false'],{stdio:'inherit',env:childEnv});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',(code)=>process.exit(code??1));
