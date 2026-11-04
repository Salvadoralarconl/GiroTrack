import {env} from 'cloudflare:workers';
import {createAccountService} from '../../../lib/account-service.mjs';
export const GET=(request:Request)=>createAccountService(env.DB!,env).GET(request);
export const POST=(request:Request)=>createAccountService(env.DB!,env).POST(request);
