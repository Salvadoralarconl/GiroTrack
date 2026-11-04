import {currentUser,safeMutation,unauthorized} from '../../../lib/accounts';
import {checkPlacement,checkSignature,DEFAULT_PLACEMENT,signersOf} from '../../../lib/signatures.mjs';
import { env } from 'cloudflare:workers';
const headers={'Cache-Control':'no-store, private','Pragma':'no-cache'};
// A stored signature: the image and where it sits on the line.
const read=async(userId?:string)=>{if(!userId)return null;const row=await env.DB!.prepare('SELECT data FROM workspace WHERE id=?').bind('signature:'+userId).first<{data:string}>();if(!row)return null;const d=JSON.parse(row.data);return {image:d.image as string,placement:d.placement||DEFAULT_PLACEMENT};};
const save=(userId:string,value:any)=>env.DB!.prepare('INSERT INTO workspace (id,data,version) VALUES (?,?,0) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=version+1').bind('signature:'+userId,JSON.stringify({...value,updatedAt:new Date().toISOString()})).run();
// GET: your own signature. GET ?request=<id>: the signatures that payment request may show (requester; approver once approved).
export async function GET(request:Request){const user=await currentUser(request);if(!user)return unauthorized();try{const id=new URL(request.url).searchParams.get('request');
 if(!id){const own=await read(user.id);return Response.json({image:own?.image||null,placement:own?.placement||DEFAULT_PLACEMENT},{headers});}
 const main=await env.DB!.prepare('SELECT data FROM workspace WHERE id=?').bind('main').first<{data:string}>();
 const found=(JSON.parse(main?.data||'{}').paymentRequests||[]).find((r:any)=>r.id===id);if(!found)return Response.json({error:'Payment request not found.'},{status:404,headers});
 const who=signersOf(found);return Response.json({requested:await read(who.requested),approved:await read(who.approved)},{headers});}catch{return Response.json({error:'Signatures unavailable. Please retry.'},{status:503,headers});}}
// PUT {image}: save a new signature (placed at the default position). PUT {placement}: move or resize the saved one. DELETE: remove it.
export async function PUT(request:Request){const user=await currentUser(request);if(!user)return unauthorized();if(!safeMutation(request))return Response.json({error:'Invalid origin'},{status:403});try{if(Number(request.headers.get('content-length'))>450*1024)return Response.json({error:'The image is larger than 300 KB.'},{status:413,headers});const body=await request.json() as any;
 if(body.image!==undefined){const checked=checkSignature(body.image);if(checked.error)return Response.json({error:checked.error},{status:400,headers});await save(user.id,{image:checked.image,placement:DEFAULT_PLACEMENT});return Response.json({image:checked.image,placement:DEFAULT_PLACEMENT},{headers});}
 const checked=checkPlacement(body.placement);if(checked.error)return Response.json({error:checked.error},{status:400,headers});
 const own=await read(user.id);if(!own)return Response.json({error:'Upload a signature first.'},{status:400,headers});
 await save(user.id,{image:own.image,placement:checked.placement});return Response.json({image:own.image,placement:checked.placement},{headers});}catch{return Response.json({error:'Could not save the signature. Please retry.'},{status:503,headers});}}
export async function DELETE(request:Request){const user=await currentUser(request);if(!user)return unauthorized();if(!safeMutation(request))return Response.json({error:'Invalid origin'},{status:403});try{await env.DB!.prepare('DELETE FROM workspace WHERE id=?').bind('signature:'+user.id).run();return Response.json({removed:true},{headers});}catch{return Response.json({error:'Could not remove the signature. Please retry.'},{status:503,headers});}}