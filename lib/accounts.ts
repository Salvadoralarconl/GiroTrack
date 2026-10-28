import {env} from 'cloudflare:workers';
import {createAccountService} from './account-service.mjs';
export {safeMutation,sessionCookie,unauthorized} from './account-service.mjs';
export const readAuthRow=(id:string)=>createAccountService(env.DB!,env.GIROTRACK_VAULT_KEY).readAuthRow(id);
export const writeAuthRow=(id:string,value:any)=>createAccountService(env.DB!,env.GIROTRACK_VAULT_KEY).writeAuthRow(id,value);
export const currentUser=(request:Request)=>createAccountService(env.DB!,env.GIROTRACK_VAULT_KEY).currentUser(request);
