import type { PrismaClient } from "@prisma/client";
import { Router, type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import prisma from "../../lib/prisma";
import { withDatabase } from "../../lib/database-context";
import { authenticatedUserId, requireApiToken } from "../auth/auth.middleware";
import { CreateEntrySchema, ExternalIdSchema, UpdateEntrySchema } from "./assistant-entries";
import { AssistantEntries, EntryError, findEntry, publicEntry, type EntryActor } from "./assistant-entries.service";

/**
 * Transactions written by the outside assistant, for API tokens with the
 * transactions:write scope. Entries go straight into the ledger with
 * entrySource "assistant"; the same externalId updates instead of adding a row.
 * Possible duplicates are returned with each write rather than refused.
 */
export function createAgentTransactionsRouter(db: PrismaClient = prisma) {
  const router = Router();
  router.use((_request, _response, next) => void withDatabase(db, async () => next()));
  router.use(requireApiToken(["transactions:write"]));

  const actor = (request: Request): EntryActor => ({
    actorType: request.apiAuth?.actorType || "api_token",
    actorId: request.apiAuth?.tokenId,
    requestId: request.header("x-request-id") || undefined,
  });

  const handle =
    (work: (request: Request, response: Response) => Promise<unknown>) =>
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.setHeader("Cache-Control", "no-store");
        await work(request, response);
      } catch (error) {
        if (error instanceof ZodError)
          return response.status(400).json({ error: error.issues.map((issue) => issue.message).join("; ") });
        if (error instanceof EntryError)
          return response.status(error.status).json({ error: error.message, ...error.details });
        if (error instanceof Error && /date must be|time must be/.test(error.message))
          return response.status(400).json({ error: error.message });
        next(error);
      }
    };

  const refOf = (request: Request) =>
    request.params.externalId !== undefined
      ? { externalId: ExternalIdSchema.parse(request.params.externalId) }
      : { id: request.params.id };

  router.post(
    "/",
    handle(async (request, response) => {
      const input = CreateEntrySchema.parse(request.body);
      const result = await AssistantEntries.upsert(authenticatedUserId(request), input, actor(request));
      response.status(result.created ? 201 : 200).json(result);
    }),
  );

  for (const path of ["/external/:externalId", "/:id"]) {
    router.get(
      path,
      handle(async (request, response) => {
        const transaction = await findEntry(authenticatedUserId(request), refOf(request));
        response.json({ transaction: publicEntry(transaction) });
      }),
    );
    router.patch(
      path,
      handle(async (request, response) => {
        const input = UpdateEntrySchema.parse(request.body);
        response.json(
          await AssistantEntries.update(authenticatedUserId(request), refOf(request), input, actor(request)),
        );
      }),
    );
    router.delete(
      path,
      handle(async (request, response) => {
        response.json(await AssistantEntries.remove(authenticatedUserId(request), refOf(request), actor(request)));
      }),
    );
  }

  return router;
}
