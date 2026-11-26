import type { PrismaClient } from "@prisma/client";
import { Router, type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import prisma from "../../lib/prisma";
import { withDatabase } from "../../lib/database-context";
import {
  authenticatedUserId,
  requireAccountAuth,
  requireApiToken,
  requireApiTokenAnyOf,
} from "../auth/auth.middleware";
import { CreateEntrySchema, ExternalIdSchema, UpdateEntrySchema } from "./assistant-entries";
import { AssistantEntries, EntryError, findEntry, publicEntry, type EntryActor } from "./assistant-entries.service";
import { assistantEntryGuide } from "./assistant-entry-guide";
import { EntryContext, SimilarQuerySchema } from "./entry-context.service";
import {
  AnswerSchema,
  ConfirmAccountSchema,
  CorrectionSchema,
  MergeAccountSchema,
  ReviewQueueQuerySchema,
  ReviewStatusSchema,
} from "./entry-review";
import { TransactionReview } from "./transaction-review.service";
import { sourceWatchList } from "../sources/sources.service";
import { withInstructions } from "../instructions/instructions.service";

/**
 * Transactions written by the outside assistant. With transactions:write,
 * entries go straight into the ledger with entrySource "assistant" and are
 * queued for review: Fortuna detects transfers between the user's accounts
 * and applies enabled rules, the assistant's decision does the rest, and an
 * unknown card or account becomes a question. The same externalId updates instead of adding a
 * row, and possible duplicates come back with each write rather than refused.
 * With transactions:review, /review lists the queue (with the rules the
 * assistant created since the last review), corrects entries, answers their
 * questions and undoes rules;
 * the apps' To review screen calls /review too, as the trusted frontend.
 * /guide and /context/* are open to either scope; /context/sources (what to
 * watch) also to accounts:read. Entries come back with the classification
 * instructions that apply to them (instructions, and instructionIds per entry).
 */
export function createAgentTransactionsRouter(db: PrismaClient = prisma) {
  const router = Router();
  router.use((_request, _response, next) => void withDatabase(db, async () => next()));
  const write = requireApiToken(["transactions:write"]);
  // The web and phone apps' To review screen uses these same routes (as the
  // trusted frontend), so Fortuna and twee work through one queue.
  const review = requireAccountAuth(["transactions:review"]);
  const either = requireApiTokenAnyOf(["transactions:write", "transactions:review"]);
  // What to watch is also open to accounts:read, for a job that only reads.
  const watching = requireApiTokenAnyOf(["transactions:write", "transactions:review", "accounts:read"]);

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
        if (error instanceof Error && /date must be|time must be|not found$|is required/.test(error.message))
          return response.status(/not found$/.test(error.message) ? 404 : 400).json({ error: error.message });
        next(error);
      }
    };

  const refOf = (request: Request) =>
    request.params.externalId !== undefined
      ? { externalId: ExternalIdSchema.parse(request.params.externalId) }
      : { id: request.params.id };

  const withContext = <T extends { transaction?: unknown; transactions?: unknown }>(request: Request, body: T) =>
    withInstructions(db, authenticatedUserId(request), body);

  router.get("/guide", either, handle(async (request, response) => {
    response.json(assistantEntryGuide(await sourceWatchList(prisma, authenticatedUserId(request))));
  }));

  router.get("/context/accounts", either, handle(async (request, response) => {
    response.json(await EntryContext.accounts(authenticatedUserId(request)));
  }));
  router.get("/context/sources", watching, handle(async (request, response) => {
    response.json(await sourceWatchList(prisma, authenticatedUserId(request)));
  }));
  router.get("/context/categories", either, handle(async (request, response) => {
    response.json(await EntryContext.categories(authenticatedUserId(request)));
  }));
  router.get("/context/rules", either, handle(async (request, response) => {
    response.json(await EntryContext.rules(authenticatedUserId(request)));
  }));
  router.get("/context/similar", either, handle(async (request, response) => {
    response.json(await EntryContext.similar(authenticatedUserId(request), SimilarQuerySchema.parse(request.query)));
  }));

  router.get("/review", review, handle(async (request, response) => {
    const queue = await TransactionReview.queue(authenticatedUserId(request), ReviewQueueQuerySchema.parse(request.query));
    response.json(await withContext(request, queue));
  }));
  router.post("/review/correct", review, handle(async (request, response) => {
    response.json(
      await TransactionReview.correct(authenticatedUserId(request), CorrectionSchema.parse(request.body), actor(request)),
    );
  }));
  router.post("/review/status", review, handle(async (request, response) => {
    const input = ReviewStatusSchema.parse(request.body);
    response.json(await TransactionReview.setStatus(authenticatedUserId(request), input.ids, input.status, actor(request)));
  }));
  router.post("/review/questions/answer", review, handle(async (request, response) => {
    response.json(
      await TransactionReview.answer(authenticatedUserId(request), AnswerSchema.parse(request.body), actor(request)),
    );
  }));
  // Undo of a rule the assistant created by itself, shown with the review (newRules).
  router.post("/review/rules/:ruleId/undo", review, handle(async (request, response) => {
    response.json(await TransactionReview.undoRule(authenticatedUserId(request), request.params.ruleId, actor(request)));
  }));
  router.post("/review/accounts/:account/confirm", review, handle(async (request, response) => {
    response.json(
      await TransactionReview.confirmAccount(
        authenticatedUserId(request),
        request.params.account,
        ConfirmAccountSchema.parse(request.body ?? {}),
        actor(request),
      ),
    );
  }));
  router.post("/review/accounts/:account/merge", review, handle(async (request, response) => {
    const input = MergeAccountSchema.parse(request.body);
    response.json(
      await TransactionReview.mergeAccount(authenticatedUserId(request), request.params.account, input.into, actor(request)),
    );
  }));

  router.post(
    "/",
    write,
    handle(async (request, response) => {
      const input = CreateEntrySchema.parse(request.body);
      const result = await AssistantEntries.upsert(authenticatedUserId(request), input, actor(request));
      response.status(result.created ? 201 : 200).json(await withContext(request, result));
    }),
  );

  for (const path of ["/external/:externalId", "/:id"]) {
    router.get(
      path,
      write,
      handle(async (request, response) => {
        const transaction = await findEntry(authenticatedUserId(request), refOf(request));
        response.json(await withContext(request, { transaction: publicEntry(transaction) }));
      }),
    );
    router.patch(
      path,
      write,
      handle(async (request, response) => {
        const input = UpdateEntrySchema.parse(request.body);
        response.json(
          await withContext(
            request,
            await AssistantEntries.update(authenticatedUserId(request), refOf(request), input, actor(request)),
          ),
        );
      }),
    );
    router.delete(
      path,
      write,
      handle(async (request, response) => {
        response.json(await AssistantEntries.remove(authenticatedUserId(request), refOf(request), actor(request)));
      }),
    );
  }

  return router;
}
