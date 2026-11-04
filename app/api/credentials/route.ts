import {currentUser,safeMutation,unauthorized} from '../../../lib/accounts';
import {confirmCopy,credentialHistory,recordCredentialEvent} from '../../../lib/credential-log.mjs';
import {credentialAad,decryptSecret,encryptSecret,keyring,needsReencryption} from '../../../lib/vault.mjs';
import { env } from 'cloudflare:workers';
// Never stored by the browser, a proxy or a service worker.
const headers={'Cache-Control':'no-store, private','Pragma':'no-cache'};
const ring=()=>keyring(env);
async function payerExists(id:string){const row=await env.DB!.prepare('SELECT data FROM workspace WHERE id=?').bind('main').first<{data:string}>();return row&&JSON.parse(row.data).payers.some((p:any)=>p.id===id);}
const saveBox=(payer:string,box:any)=>env.DB!.prepare('INSERT INTO workspace (id,data,version) VALUES (?,?,0) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=version+1').bind('credential:'+payer,JSON.stringify(box)).run();
// Every signed-in person may open and change portal passwords (the existing rule); the session and tab are checked on each request.
// ?history=1 lists who retrieved or changed the password (reading the list isn't recorded).
// Otherwise the retrieval is recorded first (use=copy for the Copy button); when that fails, the password is withheld.
export async function GET(request:Request){const user=await currentUser(request);if(!user)return unauthorized();try{const url=new URL(request.url);const id=url.searchParams.get('payer')||'';if(!await payerExists(id))return Response.json({error:'Vendor not found'},{status:404,headers});if(url.searchParams.get('history')==='1')return Response.json({history:await credentialHistory(env.DB!,id)},{headers});
 const purpose=url.searchParams.get('use')==='copy'?'copy':'view';
 const row=await env.DB!.prepare('SELECT data FROM workspace WHERE id=?').bind('credential:'+id).first<{data:string}>();
 if(!row){await recordCredentialEvent(env.DB!,id,user,{action:'retrieve',purpose,outcome:'none'});return Response.json({password:'',exists:false},{headers});}
 const box=JSON.parse(row.data),keys=ring();let password:string;
 try{password=await decryptSecret(keys,box,credentialAad(id));}catch{await recordCredentialEvent(env.DB!,id,user,{action:'retrieve',purpose,outcome:'failed'}).catch(()=>{});return Response.json({error:'Unable to open credentials. Please retry.'},{status:503,headers});}
 const eventId=await recordCredentialEvent(env.DB!,id,user,{action:'retrieve',purpose,outcome:'ok'});
 // Values from an older key or format move to the current key once read successfully.
 if(needsReencryption(keys,box))await saveBox(id,await encryptSecret(keys,password,credentialAad(id))).catch(()=>{});
 return Response.json({password,exists:true,eventId},{headers});}catch{return Response.json({error:'Unable to open credentials. Please retry.'},{status:503,headers});}}
// The Copy button reports a successful clipboard write for the retrieval it made.
export async function POST(request:Request){const user=await currentUser(request);if(!user)return unauthorized();if(!safeMutation(request))return Response.json({error:'Invalid origin'},{status:403});try{const {action,payer,eventId}=await request.json() as any;if(action!=='copy-confirmed'||typeof payer!=='string')return Response.json({error:'Invalid request.'},{status:400,headers});return Response.json({confirmed:await confirmCopy(env.DB!,payer,user,eventId)},{headers});}catch{return Response.json({error:'Unable to record the copy.'},{status:503,headers});}}
export async function PUT(request:Request){const user=await currentUser(request);if(!user)return unauthorized();if(!safeMutation(request))return Response.json({error:'Invalid origin'},{status:403});let payerId='';try{const {payer,password}=await request.json() as any;if(typeof payer!=='string'||typeof password!=='string'||!password||password.length>2048||!await payerExists(payer))return Response.json({error:'Choose a vendor and enter a password.'},{status:400,headers});payerId=payer;
 await saveBox(payer,await encryptSecret(ring(),password,credentialAad(payer)));
 await recordCredentialEvent(env.DB!,payer,user,{action:'change',outcome:'ok'}).catch(()=>{});
 return Response.json({saved:true},{headers});}catch{if(payerId)await recordCredentialEvent(env.DB!,payerId,user,{action:'change',outcome:'failed'}).catch(()=>{});return Response.json({error:'Unable to save credentials. Please retry.'},{status:503,headers});}}
