// Runs GiroTrack on a Windows PC with nothing else installed: the app stays on
// 127.0.0.1 (see start-server.mjs) and this process answers HTTPS for the
// network, doing the job IIS does in docs/girosol-server-setup.md.
// Usage: node scripts/windows-server.mjs <data folder>
// The folder holds server.json, secrets.env, girotrack.pfx, state\ and logs\.
import {existsSync,mkdirSync,openSync,readFileSync,renameSync,statSync} from 'node:fs';
import {spawn} from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pipeline} from 'node:stream';
import {readSecrets} from './secrets-file.mjs';

const MAX_BODY=20*1024*1024; // Uploads are capped at 15 MB by the app.
const MAX_LOG=10*1024*1024;

const dataDir=path.resolve(process.argv[2]||'');
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const {httpsPort,appPort}=JSON.parse(readFileSync(path.join(dataDir,'server.json'),'utf8'));
const secretsFile=path.join(dataDir,'secrets.env');
const secrets=readSecrets(secretsFile)||{};
const origin=secrets.GIROTRACK_PUBLIC_ORIGIN;
const proxySecret=secrets.GIROTRACK_PROXY_SECRET;
if(!origin||!proxySecret||!secrets.GIROTRACK_TLS_PASSPHRASE)throw Error(`${secretsFile} is incomplete. Run the installer again.`);
const publicHost=new URL(origin).host.toLowerCase();

const logs=path.join(dataDir,'logs');
mkdirSync(logs,{recursive:true});
const logFile=path.join(logs,'girotrack.log');
if(existsSync(logFile)&&statSync(logFile).size>MAX_LOG)renameSync(logFile,logFile+'.old');
const log=openSync(logFile,'a');

const app=spawn(process.execPath,['scripts/start-server.mjs'],{stdio:['ignore',log,log],env:{...process.env,GIROTRACK_PORT:String(appPort),GIROTRACK_LOCAL_STATE:path.join(dataDir,'state'),GIROTRACK_SECRETS_FILE:secretsFile}});
app.on('exit',(code)=>process.exit(code||1));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{app.kill(signal);process.exit(0);});

const agent=new http.Agent({keepAlive:true});
const plain=(res,status,text)=>{res.writeHead(status,{'content-type':'text/plain; charset=utf-8'});res.end(text);};

const server=https.createServer({pfx:readFileSync(path.join(dataDir,'girotrack.pfx')),passphrase:secrets.GIROTRACK_TLS_PASSPHRASE,minVersion:'TLSv1.2'},(req,res)=>{
 // The app accepts changes from one address only, so every other name for this PC is sent there.
 if((req.headers.host||'').toLowerCase()!==publicHost){res.writeHead(308,{location:origin+req.url});res.end();return;}
 if(Number(req.headers['content-length']||0)>MAX_BODY)return plain(res,413,'That file is too large.');
 const headers={...req.headers,host:`127.0.0.1:${appPort}`,'x-forwarded-for':req.socket.remoteAddress.replace(/^::ffff:/,''),'x-forwarded-proto':'https','x-girotrack-proxy':proxySecret};
 const upstream=http.request({host:'127.0.0.1',port:appPort,method:req.method,path:req.url,headers,agent},(answer)=>{
  res.writeHead(answer.statusCode,answer.headers);
  pipeline(answer,res,()=>{});
 });
 upstream.on('error',()=>{if(res.headersSent)res.destroy();else plain(res,503,'GiroTrack is starting. Try again in a moment.');});
 let received=0;
 req.on('data',(chunk)=>{received+=chunk.length;if(received>MAX_BODY){upstream.destroy();req.destroy();}});
 req.pipe(upstream);
});
server.on('error',(error)=>{console.error(error.message);app.kill();process.exit(1);});
server.listen(httpsPort,'0.0.0.0');
