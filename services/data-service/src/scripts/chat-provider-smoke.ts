import {CodexRuntime} from '../modules/chat/providers/codex-runtime';
import {CodexProvider,restrictedThreadParams} from '../modules/chat/providers/codex';
import {OpenRouterProvider} from '../modules/chat/providers/openrouter';
import {ChatProvider} from '../modules/chat/providers/provider';
async function main(){
 const userId=process.env.CHAT_SMOKE_USER_ID;
 if(!userId)throw new Error('Set CHAT_SMOKE_USER_ID to a synthetic test user');
 const runtime=new CodexRuntime(process.env.CHAT_CODEX_ROOT);
 try{
  let provider:ChatProvider;
  if(process.argv.includes('openrouter')){const key=process.env.CHAT_SMOKE_KEY;if(!key)throw new Error('Set CHAT_SMOKE_KEY in the process environment');provider=new OpenRouterProvider(async()=>key);}
  else{
   const session=await runtime.getClient(userId);
   if(process.argv.includes('--protocol-only')){const account=await session.rpc.call('account/read',{refreshToken:false});console.log(JSON.stringify({initialized:true,accountConnected:!!account.account}));const thread=await session.rpc.call('thread/start',restrictedThreadParams([]));console.log(JSON.stringify({threadCreated:!!thread.thread?.id,environmentAccess:false}));return;}
   if(process.argv.includes('--login')){const login=await runtime.startLogin(userId);console.log(JSON.stringify({verificationUrl:login.verificationUrl,userCode:login.userCode,expiresAt:login.expiresAt}));while((await runtime.loginStatus(userId,login.loginId)).status==='pending')await new Promise(resolve=>setTimeout(resolve,3000));}
   provider=new CodexProvider(runtime);
  }
  const status=await provider.testConnection(userId);console.log(status);if(!status.connected||!status.modelAvailable)throw new Error('Requested model is not available for this connection');
  let called=false,completed=false;
  for await(const event of provider.run({userId,messages:[{role:'user',content:'Call synthetic_total once, then report its result. This is a synthetic smoke test.'}],tools:[{name:'synthetic_total',description:'Returns a synthetic verified amount',inputSchema:{type:'object',properties:{},additionalProperties:false}}],executeTool:async name=>{if(name!=='synthetic_total')throw new Error('Unexpected tool');called=true;return {blocks:[{type:'data',title:'Synthetic amount',data:{currency:'SGD',amount:'3.14'}}]};}},AbortSignal.timeout(120000))){if(event.type==='completed')completed=true;}
  if(!called||!completed)throw new Error('Synthetic tool-use turn did not complete');console.log(JSON.stringify({toolCalled:called,completed}));
 }finally{runtime.close();}
}
void main().catch(e=>{console.error(e.message);process.exitCode=1;});
