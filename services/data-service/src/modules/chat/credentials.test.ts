import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sealCredential,openCredential} from './credentials';
test('credentials are authenticated to owner and tampering cannot decrypt',()=>{
 process.env.CHAT_ENCRYPTION_KEY_V1=Buffer.alloc(32,7).toString('base64');
 const secret=sealCredential('alice','test-key');
 assert.equal(openCredential('alice',secret),'test-key');
 assert.equal(JSON.stringify(secret).includes('test-key'),false);
 assert.throws(()=>openCredential('bob',secret));
 assert.throws(()=>openCredential('alice',{...secret,tag:Buffer.alloc(16).toString('base64')}));
 delete process.env.CHAT_ENCRYPTION_KEY_V1;
 assert.throws(()=>sealCredential('alice','test-key'),/configured/);
});
