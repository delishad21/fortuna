import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
export type EncryptedSecret={keyVersion:string;iv:string;ciphertext:string;tag:string};
function encryptionKey(version:string){
 if(version!=='V1')throw new Error('Unknown credential key version');
 const value=process.env.CHAT_ENCRYPTION_KEY_V1;const key=Buffer.from(value||'','base64');
 if(key.length!==32)throw new Error('Chat credential encryption is not configured');return key;
}
const aad=(userId:string,version:string)=>Buffer.from(JSON.stringify(['fortuna','openrouter',userId,version]));
export function sealCredential(userId:string,plaintext:string):EncryptedSecret{
 const keyVersion='V1',iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',encryptionKey(keyVersion),iv);cipher.setAAD(aad(userId,keyVersion));
 const ciphertext=Buffer.concat([cipher.update(plaintext,'utf8'),cipher.final()]);return {keyVersion,iv:iv.toString('base64'),ciphertext:ciphertext.toString('base64'),tag:cipher.getAuthTag().toString('base64')};
}
export function openCredential(userId:string,secret:EncryptedSecret){
 const decipher=createDecipheriv('aes-256-gcm',encryptionKey(secret.keyVersion),Buffer.from(secret.iv,'base64'));decipher.setAAD(aad(userId,secret.keyVersion));decipher.setAuthTag(Buffer.from(secret.tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext,'base64')),decipher.final()]).toString('utf8');
}
