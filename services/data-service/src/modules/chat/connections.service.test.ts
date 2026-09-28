import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withChatDb} from './test-harness';
import {ConnectionService} from './connections.service';
test('keys never appear in settings, cannot decrypt for another owner and disconnect cancels runs',()=>withChatDb(async db=>{
 process.env.CHAT_ENCRYPTION_KEY_V1=Buffer.alloc(32,5).toString('base64');
 const user=await db.user.create({data:{username:'connection-owner'}});
 const service=new ConnectionService(db);
 await service.update(user.id,{provider:'openrouter',key:'sk-test-secret'});
 assert.equal(JSON.stringify(await service.settings(user.id)).includes('sk-test-secret'),false);
 assert.equal(await service.keyForUser(user.id),'sk-test-secret');
 await assert.rejects(service.keyForUser('another-user'));
 const conv=await db.chatConversation.create({data:{userId:user.id}});
 const run=await db.chatRun.create({data:{userId:user.id,conversationId:conv.id,idempotencyKey:'one',provider:'openrouter',model:'test'}});
 await assert.rejects(service.update(user.id,{provider:'codex'}),/Stop/);
 await service.disconnect(user.id,'openrouter');
 await assert.rejects(service.keyForUser(user.id));
 assert.equal((await db.chatRun.findUniqueOrThrow({where:{id:run.id}})).cancelRequested,true);
}));
