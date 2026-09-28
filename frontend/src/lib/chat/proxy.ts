const routes:Array<[string,RegExp]>=[
 ['GET',/^conversations$/],['POST',/^conversations$/],
 ['GET',/^conversations\/[\w-]+$/],['DELETE',/^conversations\/[\w-]+$/],
 ['POST',/^conversations\/[\w-]+\/messages$/],
 ['GET',/^runs\/[\w-]+\/events$/],['POST',/^runs\/[\w-]+\/cancel$/],
 ['POST',/^files$/],['GET',/^settings$/],['PUT',/^settings$/],
 ['POST',/^connections\/(codex|openrouter)\/(start|test|disconnect)$/],
 ['GET',/^connections\/codex\/login\/[\w-]+$/],
 ['POST',/^proposals\/[\w-]+\/(approve|reject)$/]
];
export async function forwardChatRequest(request:Request,userId:string,path:string[],config:{url:string;token:string}) {
 const name=path.join('/');
 const fail=(status:number,message:string):never=>{throw Object.assign(new Error(message),{status});};
 if(!routes.some(([method,pattern])=>method===request.method&&pattern.test(name))) return fail(404,'Chat endpoint not found');
 if(!config.token) return fail(503,'Chat service is not configured');
 const headers:Record<string,string>={'x-internal-service-token':config.token,'x-authenticated-user-id':userId};
 let body:Uint8Array|undefined;
 if(!['GET','HEAD'].includes(request.method)){
  const type=request.headers.get('content-type')||'application/json';
  const limit=name==='files'?25*1024*1024+65536:256*1024;
  if(Number(request.headers.get('content-length')||0)>limit) return fail(413,'Request is too large');
  // Enforce the limit while reading; untrusted Content-Length is not a bound.
  const reader=request.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
  if(reader) try {for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>limit){await reader.cancel();return fail(413,'Request is too large');}chunks.push(chunk.value);}}finally{reader.releaseLock();}
  body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
  headers['content-type']=type;
 }
 const target=new URL('/api/chat/'+name,config.url);
 if(name.endsWith('/events')) target.searchParams.set('after',new URL(request.url).searchParams.get('after')||'0');
 const response=await fetch(target,{method:request.method,headers,body:body as BodyInit|undefined,cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(60000)])});
 return new Response(response.body,{status:response.status,headers:{'content-type':response.headers.get('content-type')||'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
}
