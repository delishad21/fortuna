import {Prisma,PrismaClient,ChatRun} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {ChatError} from './contracts';
export type ClaimedRun=ChatRun & {leaseToken:string};
export class RunRepository {
 constructor(private db:PrismaClient){}
 async claimRun():Promise<ClaimedRun|null>{return this.db.$transaction(async tx=>{
  await tx.chatRun.updateMany({where:{status:'running',leaseUntil:{lt:new Date()},attempts:{gte:3}},data:{status:'failed',error:'Run interrupted repeatedly. Your saved data is preserved.'}});
  const ids=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM chat_runs WHERE cancel_requested=false AND (status='queued' OR (status='running' AND lease_until<NOW() AND attempts<3)) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`;
  if(!ids.length)return null;
  return await tx.chatRun.update({where:{id:ids[0].id},data:{status:'running',leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+60000),attempts:{increment:1}}}) as ClaimedRun;
 });}
 async heartbeat(run:ClaimedRun){const result=await this.db.chatRun.updateMany({where:{id:run.id,leaseToken:run.leaseToken,status:'running',cancelRequested:false,leaseUntil:{gt:new Date()}},data:{leaseUntil:new Date(Date.now()+60000)}});return result.count===1;}
 async appendEvent(run:ClaimedRun,payload:Prisma.InputJsonValue){return this.db.$transaction(async tx=>{
  const updated=await tx.chatRun.updateMany({where:{id:run.id,userId:run.userId,leaseToken:run.leaseToken,status:'running',cancelRequested:false,leaseUntil:{gt:new Date()}},data:{nextSequence:{increment:1}}});if(!updated.count)throw new ChatError(409,'Run is no longer active');
  const latest=await tx.chatRun.findUniqueOrThrow({where:{id:run.id}});
  return tx.chatRunEvent.create({data:{userId:run.userId,conversationId:run.conversationId,runId:run.id,sequence:latest.nextSequence,payload}});
 });}
 async listEvents(userId:string,runId:string,after:number){if(!Number.isSafeInteger(after)||after<0)throw new ChatError(400,'Invalid event cursor');const run=await this.db.chatRun.findFirst({where:{id:runId,userId,conversation:{deletedAt:null}}});if(!run)throw new ChatError(404,'Run not found');const events=await this.db.chatRunEvent.findMany({where:{userId,runId,sequence:{gt:after}},orderBy:{sequence:'asc'},take:100});return {events,status:run.status,error:run.error,cursor:events.at(-1)?.sequence||after};}
 async cancelRun(userId:string,runId:string){return this.db.$transaction(async tx=>{
  const count=await tx.chatRun.updateMany({where:{id:runId,userId,status:{in:['queued','running','awaiting_confirmation']}},data:{cancelRequested:true,status:'cancelled'}});
  await tx.chatActionProposal.updateMany({where:{userId,runId,status:'pending'},data:{status:'rejected',decidedAt:new Date()}});return {cancelled:count.count>0};
 });}
 async finish(run:ClaimedRun,status:'completed'|'awaiting_confirmation'|'failed',blocks:Prisma.InputJsonValue,error?:string){
  return this.db.$transaction(async tx=>{
   const changed=await tx.chatRun.updateMany({where:{id:run.id,leaseToken:run.leaseToken,status:'running',cancelRequested:false,leaseUntil:{gt:new Date()}},data:{status,error:error||null,leaseUntil:null}});
   if(!changed.count)throw new ChatError(409,'Run is no longer active');
   await tx.chatMessage.create({data:{userId:run.userId,conversationId:run.conversationId,role:'assistant',blocks}});
  });
 }
}
