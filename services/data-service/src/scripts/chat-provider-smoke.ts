import {CodexRuntime} from '../modules/chat/providers/codex-runtime';
import {CodexProvider,restrictedThreadParams} from '../modules/chat/providers/codex';
async function main(){
 const runtime=new CodexRuntime(process.env.CHAT_CODEX_ROOT);
 const userId=process.env.CHAT_SMOKE_USER_ID;
 if(!userId)throw new Error('Set CHAT_SMOKE_USER_ID to a synthetic test user');
 try{
  const session=await runtime.getClient(userId);
  if(process.argv.includes('--protocol-only')){
   const account=await session.rpc.call('account/read',{refreshToken:false});
   console.log(JSON.stringify({initialized:true,accountConnected:!!account.account}));
   const thread=await session.rpc.call('thread/start',restrictedThreadParams([]));
   console.log(JSON.stringify({threadCreated:!!thread.thread?.id,environmentAccess:false}));return;
  }
  if(process.argv.includes('--login')){console.log(await runtime.startLogin(userId));return;}
  const provider=new CodexProvider(runtime);console.log(await provider.testConnection(userId));
 }finally{runtime.close();}
}
void main().catch(e=>{console.error(e.message);process.exitCode=1;});
