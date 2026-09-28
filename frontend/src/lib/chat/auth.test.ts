import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveChatIdentity } from './auth';
const deps={web:async()=>({user:{id:'alice'}}),mobile:async()=>({session:{user:{id:'bob'}}})};
test('cookie writes require configured same origin',async()=>{
 for(const origin of [undefined,'https://evil.test']){
  await assert.rejects(resolveChatIdentity(new Request('https://fortuna.test/api/chat/conversations',{method:'POST',headers:origin?{origin}:{}}),deps,'https://fortuna.test'));
 }
 assert.deepEqual(await resolveChatIdentity(new Request('https://fortuna.test/api/chat/conversations',{method:'POST',headers:{origin:'https://fortuna.test'}}),deps,'https://fortuna.test'),{userId:'alice'});
});
test('bearer identity cannot be mixed with web session or replaced by headers',async()=>{
 const request=new Request('https://fortuna.test/api/chat/conversations',{headers:{authorization:'Bearer fm_example','x-authenticated-user-id':'victim'}});
 await assert.rejects(resolveChatIdentity(request,deps,'https://fortuna.test'));
 assert.deepEqual(await resolveChatIdentity(request,{...deps,web:async()=>null},'https://fortuna.test'),{userId:'bob'});
 await assert.rejects(resolveChatIdentity(request,{web:async()=>null,mobile:async()=>null},'https://fortuna.test'));
});
