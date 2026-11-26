import type { PrismaClient } from "@prisma/client";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import prisma from "../../lib/prisma";
import { authenticatedUserId, requireAccountAuth } from "../auth/auth.middleware";
import { ENTRY_SOURCES } from "../transactions/assistant-entries";
import { classificationGuide } from "./classification-guide";
import { InstructionError, InstructionService, type InstructionActor } from "./instructions.service";

/**
 * /api/agent/instructions: the user's classification instructions, for API
 * tokens and the web and mobile apps' Settings (as the trusted frontend).
 * instructions:read lists them (so do the scopes of agents that classify:
 * transactions:write, transactions:review, drafts:read); instructions:write
 * adds, edits and disables them. Fortuna sets the author from who called:
 * the apps are the user, a token is the assistant.
 * /api/agent/classification-guide is the one guide every agent follows.
 */
export const READ_SCOPES = ["instructions:read", "instructions:write", "transactions:write", "transactions:review", "drafts:read"];

/** Any one of the scopes, for a token; the trusted frontend passes as the user. */
function anyOf(scopes: string[]) {
  const authenticate = requireAccountAuth();
  return (request: Request, response: Response, next: NextFunction) =>
    authenticate(request, response, (error?: unknown) => {
      if (error) return next(error);
      const granted = new Set(request.apiAuth?.scopes ?? []);
      if (granted.has("*") || scopes.some((scope) => granted.has(scope))) return next();
      return response.status(403).json({ error: "API token does not grant the required scope", anyOfScopes: scopes });
    });
}

export function createInstructionsRouter(db: PrismaClient = prisma) {
  const router = Router();
  const service = new InstructionService(db);
  const read = anyOf(READ_SCOPES);
  const write = requireAccountAuth(["instructions:write"]);

  const actor = (request: Request): InstructionActor => ({
    actorType: request.apiAuth?.actorType || "api_token",
    actorId: request.apiAuth?.tokenId,
    requestId: request.header("x-request-id") || undefined,
  });
  const author = (request: Request) => (request.apiAuth?.actorType === "trusted_service" ? "user" : "assistant");

  type Handler = (request: Request, response: Response, userId: string) => Promise<unknown>;
  const handle = (work: Handler) => async (request: Request, response: Response, next: NextFunction) => {
    try {
      response.setHeader("Cache-Control", "no-store");
      await work(request, response, authenticatedUserId(request));
    } catch (error) {
      if (error instanceof z.ZodError)
        return response
          .status(400)
          .json({ error: error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
      if (error instanceof InstructionError) return response.status(error.status).json({ error: error.message });
      next(error);
    }
  };

  const optional = z.string().trim().min(1).max(200).optional();
  const ListQuery = z
    .object({
      status: z.enum(["active", "all"]).default("all"),
      transactionId: optional,
      accountId: optional,
      cardId: optional,
      accountIdentifier: optional,
      entrySource: z.enum(ENTRY_SOURCES).optional(),
      description: z.string().trim().min(1).max(500).optional(),
    })
    .strict();

  router.get(
    "/instructions",
    read,
    handle(async (request, response, userId) => {
      const { status, ...entry } = ListQuery.parse(request.query);
      const filtered = Object.values(entry).some(Boolean);
      response.json({
        instructions: await service.list(userId, { status, ...(filtered ? { entry } : {}) }),
        ...(filtered ? { appliesTo: entry, note: "Only active instructions that cover this entry (unscoped ones cover every entry)." } : {}),
      });
    }),
  );

  router.get(
    "/instructions/:id",
    read,
    handle(async (request, response, userId) => {
      const [instruction] = (await service.list(userId)).filter((i) => i.id === request.params.id);
      if (!instruction) throw new InstructionError(404, "Instruction not found");
      response.json({ instruction });
    }),
  );

  router.post(
    "/instructions",
    write,
    handle(async (request, response, userId) => {
      response
        .status(201)
        .json({ instruction: await service.create(userId, request.body, author(request), actor(request)) });
    }),
  );

  router.patch(
    "/instructions/:id",
    write,
    handle(async (request, response, userId) => {
      response.json({ instruction: await service.update(userId, request.params.id, request.body, actor(request)) });
    }),
  );

  router.get(
    "/classification-guide",
    read,
    handle(async (_request, response) => {
      response.json(classificationGuide("mcp"));
    }),
  );

  return router;
}
