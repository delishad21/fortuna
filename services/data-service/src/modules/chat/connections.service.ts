import {Prisma,PrismaClient} from '@prisma/client';
import {ChatError,connectionSchema,ProviderChoice} from './contracts';
import {sealCredential,openCredential,EncryptedSecret} from './credentials';
import {OpenRouterProvider} from './providers/openrouter';
export class ConnectionService {
 constructor(private db:PrismaClient){}
 settings(userId:string){return this.db.chatConnection.findMany({where:{userId},select:{provider:true,selected:true,keyHint:true,status:true,generation:true}});}
 async keyForUser(userId:string,generation?:number){const record=await this.db.chatConnection.findUnique({where:{userId_provider:{userId,provider:'openrouter'}}});if(!record?.secret||(generation!==undefined&&record.generation!==generation))throw new ChatError(409,'Reconnect your OpenRouter account');return openCredential(userId,record.secret as unknown as EncryptedSecret);}
 async update(userId:string,raw:unknown){const input=connectionSchema.parse(raw);if(input.key&&input.provider!=='openrouter')throw new ChatError(400,'Codex uses managed sign-in');
  await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
   if(await tx.chatRun.count({where:{userId,status:{in:['queued','running','awaiting_confirmation']}}}))throw new ChatError(409,'Stop or finish your current conversation before changing providers');
   await tx.chatConnection.updateMany({where:{userId},data:{selected:false}});
   const secret=input.key?sealCredential(userId,input.key):undefined;
   const data={selected:true,...(secret?{secret,keyHint:input.key!.slice(-4),status:'configured',generation:{increment:1}}:{})};
   await tx.chatConnection.upsert({where:{userId_provider:{userId,provider:input.provider}},create:{userId,provider:input.provider,selected:true,...(secret?{secret,keyHint:input.key!.slice(-4),status:'configured'}:{})},update:data});
  });return this.settings(userId);
 }
 async control(userId:string,operation:string,input:Record<string,unknown>={}){
  const token=process.env.INTERNAL_SERVICE_TOKEN;if(!token)throw new ChatError(503,'Chat worker is not configured');
  const response=await fetch(new URL('/codex/'+operation,process.env.CHAT_WORKER_URL||'http://chat-worker:4003'),{method:'POST',headers:{'Content-Type':'application/json','x-internal-service-token':token,'x-authenticated-user-id':userId},body:JSON.stringify(input),signal:AbortSignal.timeout(90000)});
  if(!response.ok)throw new ChatError(503,'Codex connection is unavailable. Try again shortly.');return response.json() as Promise<any>;
 }
 async startLogin(userId:string){await this.update(userId,{provider:'codex'});const result=await this.control(userId,'start');await this.db.chatConnection.update({where:{userId_provider:{userId,provider:'codex'}},data:{loginId:result.loginId,loginExpiresAt:new Date(result.expiresAt),status:'connecting'}});return result;}
 async loginStatus(userId:string,loginId:string){const connection=await this.db.chatConnection.findUnique({where:{userId_provider:{userId,provider:'codex'}}});if(connection?.loginId!==loginId)throw new ChatError(404,'Login not found');const result=await this.control(userId,'status',{loginId});if(result.status==='connected')await this.test(userId,'codex');return result;}
 async test(userId:string,provider:ProviderChoice){
  const connection=await this.db.chatConnection.findUnique({where:{userId_provider:{userId,provider}}});if(!connection)throw new ChatError(409,'Connect this provider first');
  const result=provider==='codex'?await this.control(userId,'test'):await new OpenRouterProvider(id=>this.keyForUser(id)).testConnection(userId);
  await this.db.chatConnection.updateMany({where:{id:connection.id,generation:connection.generation},data:{status:result.connected&&result.modelAvailable?'connected':result.needsReconnect?'disconnected':'unavailable'}});return result;
 }
 async disconnect(userId:string,provider:ProviderChoice){
  await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
   await tx.chatRun.updateMany({where:{userId,provider,status:{in:['queued','running','awaiting_confirmation']}},data:{cancelRequested:true,status:'cancelled'}});
   await tx.chatActionProposal.updateMany({where:{userId,status:'pending'},data:{status:'rejected',decidedAt:new Date()}});
   await tx.chatConnection.updateMany({where:{userId,provider},data:{selected:false,secret:Prisma.DbNull,keyHint:null,loginId:null,loginExpiresAt:null,status:'disconnected',generation:{increment:1}}});
  });if(provider==='codex')await this.control(userId,'disconnect');return this.settings(userId);
 }
}
