import {PrismaClient} from '@prisma/client';
import {ChatRepository} from './chat.repository';
import {ChatError,submitMessageSchema} from './contracts';
export class ChatService extends ChatRepository {
 constructor(private client:PrismaClient){super(client);}
 async submitMessage(userId:string,conversationId:string,raw:unknown){
  const input=submitMessageSchema.parse(raw);
  return this.client.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
   const conversation=await tx.chatConversation.findFirst({where:{id:conversationId,userId,deletedAt:null}});
   if(!conversation)throw new ChatError(404,'Conversation not found');
   const repeated=await tx.chatRun.findUnique({where:{userId_conversationId_idempotencyKey:{userId,conversationId,idempotencyKey:input.idempotencyKey}}});
   if(repeated)return {runId:repeated.id};
   if(await tx.chatRun.count({where:{userId,status:{in:['queued','running','awaiting_confirmation']}}}))throw new ChatError(409,'Finish or stop your current conversation run first');
   const connection=await tx.chatConnection.findFirst({where:{userId,selected:true,status:'connected'}});
   if(!connection)throw new ChatError(409,'Connect an AI provider in Settings first');
   const files=await tx.chatAttachment.findMany({where:{id:{in:input.attachmentIds},userId,conversationId},include:{statementFile:true}});
   if(files.length!==input.attachmentIds.length||files.some(f=>f.statementFile.deletedAt||(!f.statementFile.retained&&f.statementFile.expiresAt<=new Date())))throw new ChatError(400,'An attachment is missing or expired. Please upload it again.');
   await tx.chatMessage.create({data:{userId,conversationId,role:'user',blocks:[{type:'text',text:input.text},...files.map(f=>({type:'attachment',id:f.id,filename:f.statementFile.filename}))]}});
   await tx.chatConversation.update({where:{id:conversationId},data:{updatedAt:new Date(),...(conversation.title==='New conversation'?{title:input.text.slice(0,80)||'Statement import'}:{})}});
   const run=await tx.chatRun.create({data:{userId,conversationId,idempotencyKey:input.idempotencyKey,provider:connection.provider,model:connection.provider==='codex'?'gpt-6-luna':'openai/gpt-6-luna-pro',effort:connection.provider==='codex'?'max':null,connectionGeneration:connection.generation}});
   return {runId:run.id};
  });
 }
}
