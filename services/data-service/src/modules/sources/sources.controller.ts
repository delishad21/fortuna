import { Prisma } from "@prisma/client";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import prisma from "../../lib/prisma";
import { authenticatedUserId, requireAccountAuth } from "../auth/auth.middleware";
import { SOURCE_KINDS, SourceInputSchema, SourceUpdateSchema } from "./sources";
import {
  createSource,
  deleteSource,
  getSource,
  listSources,
  sourceSuggestions,
  sourceWatchList,
  updateSource,
  type PublicSource,
} from "./sources.service";

/**
 * /api/agent/sources: how each account's or card's transactions reach the
 * assistant, for API tokens (accounts:read / accounts:write) and the web and
 * mobile apps (trusted frontend). Writes need confirmed: true, as for accounts.
 * The assistant reads the enabled ones grouped by kind from /watchlist, or from
 * /api/agent/transactions/context/sources with its transactions scope.
 */
export const sourcesRouter = Router();

const read = requireAccountAuth(["accounts:read"]);
const write = requireAccountAuth(["accounts:write"]);
const confirmed = { confirmed: z.literal(true) };

type Handler = (request: Request, response: Response, userId: string) => Promise<unknown>;
const handle = (work: Handler) => async (request: Request, response: Response, next: NextFunction) => {
  try {
    response.setHeader("Cache-Control", "no-store");
    await work(request, response, authenticatedUserId(request));
  } catch (error) {
    if (error instanceof z.ZodError)
      return response.status(400).json({ error: error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
    const status = (error as { status?: number }).status;
    if (typeof status === "number") return response.status(status).json({ error: (error as Error).message });
    next(error);
  }
};

const snapshot = (source: PublicSource) =>
  ({
    kind: source.kind,
    name: source.name,
    accountId: source.accountId,
    cardId: source.cardId,
    senders: source.senders,
    subjectPatterns: source.subjectPatterns,
    textPatterns: source.textPatterns,
    identifiers: source.identifiers,
    channel: source.channel,
    enabled: source.enabled,
    notes: source.notes,
  }) satisfies Prisma.InputJsonValue;

async function audit(
  tx: Prisma.TransactionClient,
  userId: string,
  request: Request,
  input: { toolName: string; targetId: string; beforeValue?: Prisma.InputJsonValue; afterValue?: Prisma.InputJsonValue },
) {
  await tx.agentAuditEvent.create({
    data: {
      userId,
      actorType: request.apiAuth?.actorType || "api_token",
      actorId: request.apiAuth?.tokenId,
      requestId: request.header("x-request-id") || undefined,
      targetType: "transaction_source",
      ...input,
    },
  });
}

const run = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(work, { timeout: 30000 });

sourcesRouter.get(
  "/",
  read,
  handle(async (request, response, userId) => {
    const filter = z
      .object({
        accountId: z.string().min(1).optional(),
        kind: z.enum(SOURCE_KINDS).optional(),
        enabled: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
      })
      .parse(request.query);
    response.json({ sources: await listSources(prisma, userId, filter) });
  }),
);

sourcesRouter.get(
  "/watchlist",
  read,
  handle(async (_request, response, userId) => {
    response.json(await sourceWatchList(prisma, userId));
  }),
);

sourcesRouter.get(
  "/suggestions",
  read,
  handle(async (_request, response, userId) => {
    response.json({ suggestions: await sourceSuggestions(prisma, userId) });
  }),
);

sourcesRouter.get(
  "/:sourceId",
  read,
  handle(async (request, response, userId) => {
    response.json({ source: await getSource(prisma, userId, request.params.sourceId) });
  }),
);

sourcesRouter.post(
  "/",
  write,
  handle(async (request, response, userId) => {
    const { confirmed: _confirmed, ...body } = z.object(confirmed).passthrough().parse(request.body);
    const input = SourceInputSchema.parse(body);
    const source = await run(async (tx) => {
      const saved = await createSource(tx, userId, input);
      await audit(tx, userId, request, { toolName: "create_source", targetId: saved.id, afterValue: snapshot(saved) });
      return saved;
    });
    response.status(201).json({ source });
  }),
);

sourcesRouter.patch(
  "/:sourceId",
  write,
  handle(async (request, response, userId) => {
    const { confirmed: _confirmed, ...body } = z.object(confirmed).passthrough().parse(request.body);
    const input = SourceUpdateSchema.parse(body);
    const source = await run(async (tx) => {
      const before = await getSource(tx, userId, request.params.sourceId);
      const saved = await updateSource(tx, userId, before.id, input);
      await audit(tx, userId, request, {
        toolName: "update_source",
        targetId: saved.id,
        beforeValue: snapshot(before),
        afterValue: snapshot(saved),
      });
      return saved;
    });
    response.json({ source });
  }),
);

sourcesRouter.delete(
  "/:sourceId",
  write,
  handle(async (request, response, userId) => {
    z.object(confirmed).parse(request.body ?? {});
    await run(async (tx) => {
      const removed = await deleteSource(tx, userId, request.params.sourceId);
      await audit(tx, userId, request, { toolName: "delete_source", targetId: removed.id, beforeValue: snapshot(removed) });
    });
    response.json({ deleted: true });
  }),
);
