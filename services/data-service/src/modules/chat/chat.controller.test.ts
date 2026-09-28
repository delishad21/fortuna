import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {withChatDb} from './test-harness';
import {createChatRouter} from './chat.controller';
test('chat API requires a trusted identity and scopes every conversation',()=>withChatDb(async db=>{
 process.env.INTERNAL_SERVICE_TOKEN='chat-test-internal';
 const alice=await db.user.create({data:{username:'alice'}});
 const bob=await db.user.create({data:{username:'bob'}});
 const app=express();app.use(express.json());app.use('/api/chat',createChatRouter(db));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const url=`http://127.0.0.1:${(server.address() as any).port}/api/chat`;
 const headers={'content-type':'application/json','x-internal-service-token':'chat-test-internal','x-authenticated-user-id':alice.id};
 try {
  assert.equal((await fetch(url+'/conversations')).status,401);
  assert.equal((await fetch(url+'/conversations',{headers:{'x-authenticated-user-id':alice.id}})).status,401);
  const response=await fetch(url+'/conversations',{method:'POST',headers,body:'{}'});assert.equal(response.status,201);
  const conversation=await response.json() as {id:string};
  assert.equal((await fetch(url+'/conversations/'+conversation.id,{headers:{...headers,'x-authenticated-user-id':bob.id}})).status,404);
  assert.equal((await fetch(url+'/conversations/'+conversation.id,{headers})).status,200);
  assert.equal((await fetch(url+'/conversations/'+conversation.id+'/messages',{method:'POST',headers,body:JSON.stringify({text:'Hello',idempotencyKey:'one',userId:bob.id})})).status,400);
  assert.equal((await fetch(url+'/conversations/'+conversation.id,{method:'DELETE',headers})).status,200);
  assert.equal((await fetch(url+'/conversations/'+conversation.id,{headers})).status,404);
 } finally {await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}));
