import { ReviewService } from "./reviews.service";
import { safeChatError } from "./errors";
import multer from "multer";
import { withDatabase } from "../../lib/database-context";
import { HermesWorkflowService } from "../imports/hermes-workflow.service";
import { CHAT_LIMITS } from "./contracts";
import { createToolRegistry } from "./tools/registry";
import { decisionSchema } from "./contracts";
import { ConnectionService } from "./connections.service";
import { RunRepository } from "./run.repository";
import { providerSchema } from "./contracts";
import { Router, Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { timingSafeEqual } from "node:crypto";
import { z, ZodError } from "zod";
import { ChatService } from "./chat.service";
import { ChatError, idSchema } from "./contracts";
export function createChatRouter(db: PrismaClient) {
  const router = Router();
  const service = new ChatService(db);
  const reviews = new ReviewService(db);
  const connections = new ConnectionService(db);
  const runs = new RunRepository(db);
  router.use(async (req, res, next) => {
    const expected = process.env.INTERNAL_SERVICE_TOKEN || "";
    const supplied = req.header("x-internal-service-token") || "";
    const a = Buffer.from(expected),
      b = Buffer.from(supplied);
    if (!a.length || a.length !== b.length || !timingSafeEqual(a, b))
      return res.status(401).json({ error: "Authentication required" });
    const userId = req.header("x-authenticated-user-id");
    if (!userId)
      return res.status(401).json({ error: "Authentication required" });
    try {
      if (
        !(await db.user.findUnique({
          where: { id: userId },
          select: { id: true },
        }))
      )
        return res.status(401).json({ error: "Authentication required" });
      res.locals.userId = userId;
      next();
    } catch (e) {
      next(e);
    }
  });
  const route =
    (fn: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve(fn(req, res)).catch(next);
    };
  router.get(
    "/reviews/:id",
    route(async (req, res) =>
      res.json(
        await reviews.get(res.locals.userId, idSchema.parse(req.params.id)),
      ),
    ),
  );
  router.put(
    "/reviews/:id",
    route(async (req, res) =>
      res.json(
        await reviews.update(
          res.locals.userId,
          idSchema.parse(req.params.id),
          req.body,
        ),
      ),
    ),
  );
  router.get(
    "/transactions/:id",
    route(async (req, res) => {
      const item = await db.transaction.findFirst({
        where: { id: idSchema.parse(req.params.id), userId: res.locals.userId },
        include: { category: true },
      });
      if (!item) throw new ChatError(404, "Transaction not found");
      return res.json(item);
    }),
  );
  router.get(
    "/conversations",
    route(async (_req, res) =>
      res.json(await service.listConversations(res.locals.userId)),
    ),
  );
  router.post(
    "/conversations",
    route(async (_req, res) =>
      res.status(201).json(await service.createConversation(res.locals.userId)),
    ),
  );
  router.get(
    "/conversations/:id",
    route(async (req, res) => {
      const found = await service.getConversation(
        res.locals.userId,
        idSchema.parse(req.params.id),
      );
      if (!found) throw new ChatError(404, "Conversation not found");
      return res.json(found);
    }),
  );
  router.delete(
    "/conversations/:id",
    route(async (req, res) =>
      res.json(
        await service.deleteConversation(
          res.locals.userId,
          idSchema.parse(req.params.id),
        ),
      ),
    ),
  );
  router.post(
    "/conversations/:id/messages",
    route(async (req, res) =>
      res
        .status(202)
        .json(
          await service.submitMessage(
            res.locals.userId,
            idSchema.parse(req.params.id),
            req.body,
          ),
        ),
    ),
  );
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: CHAT_LIMITS.fileBytes, files: 1, fields: 1 },
    fileFilter: (_req, file, cb) => {
      if (
        ![
          "application/pdf",
          "text/csv",
          "text/plain",
          "application/csv",
          "application/vnd.ms-excel",
          "application/octet-stream",
        ].includes(file.mimetype)
      )
        return cb(new ChatError(400, "Unsupported statement type"));
      cb(null, true);
    },
  });
  router.post(
    "/files",
    upload.single("file"),
    route(async (req, res) => {
      const userId = res.locals.userId;
      const conversationId = idSchema.parse(req.body.conversationId);
      if (!req.file) throw new ChatError(400, "Choose a statement file");
      if (
        !(await db.chatConversation.findFirst({
          where: { id: conversationId, userId, deletedAt: null },
        }))
      )
        throw new ChatError(404, "Conversation not found");
      if (
        (await db.chatAttachment.count({
          where: { conversationId, userId },
        })) >= 50
      )
        throw new ChatError(
          400,
          "Start another conversation to upload more statements",
        );
      const statement = await withDatabase(db, () =>
        HermesWorkflowService.registerStatement(userId, req.file!, {
          actorType: "user",
          actorId: userId,
        }),
      );
      const attachment = await db.chatAttachment.upsert({
        where: {
          conversationId_statementFileId: {
            conversationId,
            statementFileId: statement.id,
          },
        },
        create: { userId, conversationId, statementFileId: statement.id },
        update: {},
      });
      return res.status(201).json({
        attachmentId: attachment.id,
        statementFileId: statement.id,
        filename: statement.filename,
        expiresAt: statement.expiresAt,
      });
    }),
  );
  router.get(
    "/settings",
    route(async (_req, res) =>
      res.json(await connections.settings(res.locals.userId)),
    ),
  );
  router.put(
    "/settings",
    route(async (req, res) =>
      res.json(await connections.update(res.locals.userId, req.body)),
    ),
  );
  router.post(
    "/connections/:provider/start",
    route(async (req, res) => {
      const provider = providerSchema.parse(req.params.provider);
      return res.json(
        provider === "codex"
          ? await connections.startLogin(res.locals.userId)
          : await connections.update(res.locals.userId, {
              provider,
              key: req.body.key,
            }),
      );
    }),
  );
  router.post(
    "/connections/:provider/test",
    route(async (req, res) =>
      res.json(
        await connections.test(
          res.locals.userId,
          providerSchema.parse(req.params.provider),
        ),
      ),
    ),
  );
  router.post(
    "/connections/:provider/disconnect",
    route(async (req, res) =>
      res.json(
        await connections.disconnect(
          res.locals.userId,
          providerSchema.parse(req.params.provider),
        ),
      ),
    ),
  );
  router.get(
    "/connections/codex/login/:id",
    route(async (req, res) =>
      res.json(
        await connections.loginStatus(
          res.locals.userId,
          idSchema.parse(req.params.id),
        ),
      ),
    ),
  );
  router.get(
    "/runs/:id/events",
    route(async (req, res) =>
      res.json(
        await runs.listEvents(
          res.locals.userId,
          idSchema.parse(req.params.id),
          Number(req.query.after || 0),
        ),
      ),
    ),
  );
  router.post(
    "/runs/:id/cancel",
    route(async (req, res) =>
      res.json(
        await runs.cancelRun(res.locals.userId, idSchema.parse(req.params.id)),
      ),
    ),
  );
  router.post(
    "/proposals/:id/refresh",
    route(async (req, res) => {
      z.object({}).strict().parse(req.body);
      return res.json(
        await createToolRegistry(db).approvals.refreshAction(
          res.locals.userId,
          idSchema.parse(req.params.id),
        ),
      );
    }),
  );
  router.post(
    "/proposals/:id/:decision",
    route(async (req, res) => {
      const decision = decisionSchema.parse({
        ...z
          .object({ duplicateOverride: z.boolean().optional() })
          .strict()
          .parse(req.body),
        decision: req.params.decision,
      });
      return res.json(
        await createToolRegistry(db).approvals.decideAction(
          res.locals.userId,
          idSchema.parse(req.params.id),
          decision.decision,
          decision.duplicateOverride,
        ),
      );
    }),
  );
  router.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const status =
        error instanceof ChatError
          ? error.status
          : error instanceof ZodError
            ? 400
            : error instanceof multer.MulterError
              ? 413
              : safeChatError(error)
                ? (error as any).status
                : 500;
      res.status(status).json({
        error:
          status === 500
            ? "Unable to complete chat request"
            : error instanceof ZodError
              ? "Invalid chat request"
              : (error as Error).message,
      });
    },
  );
  return router;
}
