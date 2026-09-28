import {spawn,ChildProcessWithoutNullStreams,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,rm,chmod} from 'node:fs/promises';
import path from 'node:path';
import {JsonRpcClient} from './json-rpc';
export const CODEX_VERSION='0.155.0-alpha.16.3';
export function codexUserDirectory(root:string,userId:string){return path.join(path.resolve(root),createHash('sha256').update(userId).digest('hex'));}
export type CodexSession={rpc:JsonRpcClient;child:ChildProcessWithoutNullStreams;busy:boolean;lastUsed:number;login?:{loginId:string;verificationUrl:string;userCode:string;expiresAt:string;status:string}};
export class CodexRuntime {
 private sessions=new Map<string,Promise<CodexSession>>();
 private timer:NodeJS.Timeout;
 constructor(private root=process.env.CHAT_CODEX_ROOT||'/data/chat-codex',private binary=process.env.CHAT_CODEX_BINARY||'codex'){
  this.timer=setInterval(()=>{for(const [id,promise]of this.sessions)void promise.then(session=>{if(!session.busy&&Date.now()-session.lastUsed>600000)this.stop(id);}).catch(()=>{});},60000);this.timer.unref();
 }
 async getClient(userId:string):Promise<CodexSession>{
  let session=this.sessions.get(userId);
  if(!session){if(this.sessions.size>=8)throw new Error('Codex runtime capacity reached. Try again shortly.');session=this.start(userId);this.sessions.set(userId,session);session.catch(()=>this.sessions.delete(userId));}
  const result=await session;result.lastUsed=Date.now();return result;
 }
 private async start(userId:string):Promise<CodexSession>{
  const version=execFileSync(this.binary,['--version'],{encoding:'utf8',timeout:10000}).trim();
  if(version!==`codex-cli ${CODEX_VERSION}`)throw new Error('Codex runtime version is not supported');
  const directory=codexUserDirectory(this.root,userId);const home=path.join(directory,'home');const cwd=path.join(directory,'empty');
  await mkdir(home,{recursive:true,mode:0o700});await mkdir(cwd,{recursive:true,mode:0o700});await chmod(directory,0o700);
  await writeFile(path.join(home,'config.toml'),'cli_auth_credentials_store = "file"\nweb_search = "disabled"\n[features]\nshell_tool = false\nmulti_agent = false\nmemories = false\n[tools]\nview_image = false\n[apps._default]\nenabled = false\n',{mode:0o600});
  const child=spawn(this.binary,['app-server'],{cwd,env:{PATH:process.env.PATH||'/usr/local/bin:/usr/bin:/bin',HOME:directory,CODEX_HOME:home,LANG:'en_US.UTF-8'},stdio:['pipe','pipe','pipe']});
  // Never forward raw runtime stderr: it can contain account and statement data.
  child.stderr.resume();
  const rpc=new JsonRpcClient(child.stdin,child.stdout);const session:CodexSession={rpc,child,busy:false,lastUsed:Date.now()};
  child.on('error',()=>rpc.close());child.on('exit',()=>{rpc.close();this.sessions.delete(userId);});
  rpc.on('notification',(method,params)=>{if(method==='account/login/completed'&&session.login&&session.login.loginId===params.loginId)session.login.status=params.success?'connected':'failed';});
  try{await rpc.call('initialize',{clientInfo:{name:'fortuna',title:'Fortuna',version:'1.0.0'},capabilities:{experimentalApi:true}});rpc.notify('initialized');return session;}catch(error){child.kill();throw error;}
 }
 async startLogin(userId:string){
  const session=await this.getClient(userId);
  if(session.busy)throw new Error('Finish the active conversation before reconnecting');
  if(session.login?.status==='pending'&&new Date(session.login.expiresAt)>new Date())return session.login;
  const result=await session.rpc.call('account/login/start',{type:'chatgptDeviceCode'});
  if(typeof result.loginId!=='string'||typeof result.userCode!=='string'||result.verificationUrl!=='https://auth.openai.com/codex/device')throw new Error('Unexpected Codex login response');
  session.login={loginId:result.loginId,verificationUrl:result.verificationUrl,userCode:result.userCode,expiresAt:new Date(Date.now()+15*60000).toISOString(),status:'pending'};
  return session.login;
 }
 async loginStatus(userId:string,loginId:string){const session=await this.getClient(userId);if(session.login?.loginId!==loginId)throw new Error('Login not found');if(new Date(session.login.expiresAt)<=new Date()&&session.login.status==='pending'){session.login.status='expired';await session.rpc.call('account/login/cancel',{loginId});}return session.login;}
 async disconnect(userId:string){const session=await this.sessions.get(userId);if(session)try{await session.rpc.call('account/logout',{});}finally{this.stop(userId);}await rm(codexUserDirectory(this.root,userId),{recursive:true,force:true});}
 stop(userId:string){const pending=this.sessions.get(userId);this.sessions.delete(userId);void pending?.then(s=>{s.rpc.close();s.child.kill();}).catch(()=>{});}
 close(){clearInterval(this.timer);for(const id of this.sessions.keys())this.stop(id);}
}
