import {ConnectionService} from './connections.service';
import {RunRepository} from './run.repository';
import {providerSchema} from './contracts';
import {Router,Request,Response,NextFunction} from 'express';
import {PrismaClient} from '@prisma/client';
import {timingSafeEqual} from 'node:crypto';
import {ZodError} from 'zod';
import {ChatService} from './chat.service';
import {ChatError,idSchema} from './contracts';
export function createChatRouter(db:PrismaClient){
 const router=Router();const service=new ChatService(db);const connections=new ConnectionService(db);const runs=new RunRepository(db);
 router.use(async(req,res,next)=>{
  const expected=process.env.INTERNAL_SERVICE_TOKEN||'';const supplied=req.header('x-internal-service-token')||'';
  const a=Buffer.from(expected),b=Buffer.from(supplied);
  if(!a.length||a.length!==b.length||!timingSafeEqual(a,b))return res.status(401).json({error:'Authentication required'});
  const userId=req.header('x-authenticated-user-id');
  if(!userId)return res.status(401).json({error:'Authentication required'});
  try{if(!await db.user.findUnique({where:{id:userId},select:{id:true}}))return res.status(401).json({error:'Authentication required'});res.locals.userId=userId;next();}catch(e){next(e);}
 });
 const route=(fn:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{Promise.resolve(fn(req,res)).catch(next);};
 router.get('/conversations',route(async(_req,res)=>res.json(await service.listConversations(res.locals.userId))));
 router.post('/conversations',route(async(_req,res)=>res.status(201).json(await service.createConversation(res.locals.userId))));
 router.get('/conversations/:id',route(async(req,res)=>{const found=await service.getConversation(res.locals.userId,idSchema.parse(req.params.id));if(!found)throw new ChatError(404,'Conversation not found');return res.json(found);}));
 router.delete('/conversations/:id',route(async(req,res)=>res.json(await service.deleteConversation(res.locals.userId,idSchema.parse(req.params.id)))));
 router.post('/conversations/:id/messages',route(async(req,res)=>res.status(202).json(await service.submitMessage(res.locals.userId,idSchema.parse(req.params.id),req.body))));
 router.get('/settings',route(async(_req,res)=>res.json(await connections.settings(res.locals.userId))));
 router.put('/settings',route(async(req,res)=>res.json(await connections.update(res.locals.userId,req.body))));
 router.post('/connections/:provider/start',route(async(req,res)=>{const provider=providerSchema.parse(req.params.provider);return res.json(provider==='codex'?await connections.startLogin(res.locals.userId):await connections.update(res.locals.userId,{provider,key:req.body.key}));}));
 router.post('/connections/:provider/test',route(async(req,res)=>res.json(await connections.test(res.locals.userId,providerSchema.parse(req.params.provider)))));
 router.post('/connections/:provider/disconnect',route(async(req,res)=>res.json(await connections.disconnect(res.locals.userId,providerSchema.parse(req.params.provider)))));
 router.get('/connections/codex/login/:id',route(async(req,res)=>res.json(await connections.loginStatus(res.locals.userId,idSchema.parse(req.params.id)))));
 router.get('/runs/:id/events',route(async(req,res)=>res.json(await runs.listEvents(res.locals.userId,idSchema.parse(req.params.id),Number(req.query.after||0)))));
 router.post('/runs/:id/cancel',route(async(req,res)=>res.json(await runs.cancelRun(res.locals.userId,idSchema.parse(req.params.id)))));
 router.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
  const status=error instanceof ChatError?error.status:error instanceof ZodError?400:500;
  res.status(status).json({error:status===500?'Unable to complete chat request':error instanceof ZodError?'Invalid chat request':(error as Error).message});
 });
 return router;
}
