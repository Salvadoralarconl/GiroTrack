import {env} from 'cloudflare:workers';
import {createAccountService} from './account-service.mjs';
export {safeMutation,sessionCookie,unauthorized} from './account-service.mjs';
// The whole environment goes in: vault keys (current and older) and the IIS proxy secret.
const service=()=>createAccountService(env.DB!,env);
export const readAuthRow=(id:string)=>service().readAuthRow(id);
export const writeAuthRow=(id:string,value:any)=>service().writeAuthRow(id,value);
export const currentUser=(request:Request)=>service().currentUser(request);
