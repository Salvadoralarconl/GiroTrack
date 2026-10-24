import {env} from 'cloudflare:workers';
import {digest,publicUser} from './account-core.mjs';
export async function readAuthRow(id:string){const row=await env.DB!.prepare('SELECT data FROM workspace WHERE id=?').bind(id).first<{data:string}>();return row?JSON.parse(row.data):null;}
export async function writeAuthRow(id:string,value:any){await env.DB!.prepare('INSERT INTO workspace (id,data,version) VALUES (?,?,0) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=version+1').bind(id,JSON.stringify(value)).run();}
export async function currentUser(request:Request){const token=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('girotrack_session='))?.slice(18);if(!token||!/^[a-f0-9]{64}$/.test(token))return null;const session=await readAuthRow('auth:session:'+await digest(token));if(!session||session.expires<Date.now())return null;const user=await readAuthRow('auth:user:'+session.userId);return user?publicUser(user):null;}
export function safeMutation(request:Request){const origin=request.headers.get('origin');return !origin||origin===new URL(request.url).origin;}
export const unauthorized=()=>Response.json({error:'Sign in to continue.'},{status:401,headers:{'Cache-Control':'no-store'}});
export function sessionCookie(request:Request,token:string,age=604800){return `girotrack_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
