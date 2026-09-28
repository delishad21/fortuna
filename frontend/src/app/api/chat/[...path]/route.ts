import {auth} from '@/lib/auth';
import {authenticateMobile} from '@/lib/mobile/session';
import {resolveChatIdentity} from '@/lib/chat/auth';
import {forwardChatRequest} from '@/lib/chat/proxy';
export const runtime='nodejs';
async function handle(request:Request,context:{params:Promise<{path:string[]}>}) {
 try {
  const {userId}=await resolveChatIdentity(request,{web:auth,mobile:authenticateMobile},process.env.AUTH_URL||process.env.NEXTAUTH_URL||'');
  return await forwardChatRequest(request,userId,(await context.params).path,{url:process.env.DATA_SERVICE_URL||'http://localhost:4001',token:process.env.INTERNAL_SERVICE_TOKEN||''});
 }catch(error){
  const status=(error as {status?:number}).status||502;
  return Response.json({error:status===502?'Chat service is unavailable':(error as Error).message},{status,headers:{'Cache-Control':'no-store'}});
 }
}
export {handle as GET,handle as POST,handle as PUT,handle as DELETE};
