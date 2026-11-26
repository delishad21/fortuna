import { Prisma } from "@prisma/client";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import prisma from "../../lib/prisma";
import { authenticatedUserId, requireAccountAuth } from "../auth/auth.middleware";
import {
  AccountInputSchema,
  AccountUpdateSchema,
  CardInputSchema,
  CardUpdateSchema,
  ColorSchema,
  IdentifierSchema,
  ImageInputSchema,
  Last4Schema,
  addCard,
  attachIdentifier,
  confirmAccount,
  createAccount,
  deleteAccount,
  deleteCard,
  detachIdentifier,
  getAccount,
  listAccounts,
  mergeAccount,
  resolveAccount,
  runInTransaction,
  setImage,
  updateAccount,
  updateCard,
} from "./accounts.service";

/**
 * /api/agent/accounts: accounts, their statement identifiers and cards, for
 * API tokens (accounts:read / accounts:write) and the web and mobile apps
 * (trusted frontend). Writes need confirmed: true, as the agent must ask first.
 */
export const accountsRouter = Router();

function actor(request: Request) {
  return {
    actorType: request.apiAuth?.actorType || ("api_token" as const),
    actorId: request.apiAuth?.tokenId,
    requestId: request.header("x-request-id") || undefined,
  };
}

async function audit(
  tx: Prisma.TransactionClient,
  userId: string,
  request: Request,
  input: {
    toolName: string;
    targetType: string;
    targetId: string;
    beforeValue?: Prisma.InputJsonValue;
    afterValue?: Prisma.InputJsonValue;
    metadata?: Prisma.InputJsonValue;
  },
) {
  await tx.agentAuditEvent.create({ data: { userId, ...actor(request), ...input } });
}

const confirmed = { confirmed: z.literal(true) };

type Handler = (request: Request, response: Response, userId: string) => Promise<unknown>;
const handle = (work: Handler) => async (request: Request, response: Response, next: NextFunction) => {
  try {
    await work(request, response, authenticatedUserId(request));
  } catch (error) {
    if (error instanceof z.ZodError)
      return response.status(400).json({ error: error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
    const status = (error as { status?: number }).status;
    if (typeof status === "number") return response.status(status).json({ error: (error as Error).message });
    next(error);
  }
};

const read = requireAccountAuth(["accounts:read"]);
const write = requireAccountAuth(["accounts:write"]);

accountsRouter.get(
  "/",
  read,
  handle(async (request, response, userId) => {
    const includeArchived = request.query.includeArchived === "true";
    const needsReview = request.query.needsReview === "true";
    response.json({ accounts: await listAccounts(prisma, userId, { includeArchived, needsReview }) });
  }),
);

/** Which account and card a notification or statement means: ?last4=1234 or ?identifier=… */
accountsRouter.get(
  "/resolve",
  read,
  handle(async (request, response, userId) => {
    const query = z
      .object({ last4: Last4Schema.optional(), identifier: IdentifierSchema.optional() })
      .refine((q) => q.last4 || q.identifier, "Send last4 or identifier")
      .parse(request.query);
    response.json({ matches: await resolveAccount(prisma, userId, query) });
  }),
);

// Creates an account. The older shape { accountIdentifier, color, label }
// still works: it saves the identifier and gives it an account (or updates the
// account it already has).
accountsRouter.post(
  "/",
  write,
  handle(async (request, response, userId) => {
    if (typeof request.body?.accountIdentifier === "string") {
      const input = z
        .object({
          accountIdentifier: IdentifierSchema,
          color: ColorSchema.default("#6366f1"),
          label: z.string().trim().max(80).nullable().optional(),
          ...confirmed,
        })
        .strict()
        .parse(request.body);
      const result = await runInTransaction(async (tx) => {
        const existing = await tx.accountIdentifier.findUnique({
          where: { userId_accountIdentifier: { userId, accountIdentifier: input.accountIdentifier } },
        });
        const saved = existing
          ? existing
          : await tx.accountIdentifier.create({
              data: { userId, accountIdentifier: input.accountIdentifier, color: input.color, label: input.label || null },
            });
        if (existing && saved.accountId)
          await tx.financialAccount.update({
            where: { id: saved.accountId },
            data: { color: input.color, ...(input.label ? { name: input.label } : {}) },
          });
        await audit(tx, userId, request, {
          toolName: existing ? "update_account" : "create_account",
          targetType: "account_identifier",
          targetId: saved.id,
          afterValue: { accountIdentifier: saved.accountIdentifier, color: input.color, label: input.label ?? null },
        });
        return { account: await getAccount(tx, userId, saved.accountId!), created: !existing };
      });
      return response.status(result.created ? 201 : 200).json(result);
    }
    const input = AccountInputSchema.extend(confirmed).strict().parse(request.body);
    const account = await runInTransaction(async (tx) => {
      const saved = await createAccount(tx, userId, input);
      await audit(tx, userId, request, {
        toolName: "create_account",
        targetType: "financial_account",
        targetId: saved.id,
        afterValue: { name: saved.name, type: saved.type, identifiers: input.identifiers ?? [], autoCreated: saved.autoCreated },
      });
      return saved;
    });
    response.status(201).json({ account, created: true });
  }),
);

accountsRouter.get(
  "/:accountId",
  read,
  handle(async (request, response, userId) => {
    response.json({ account: await getAccount(prisma, userId, request.params.accountId) });
  }),
);

accountsRouter.patch(
  "/:accountId",
  write,
  handle(async (request, response, userId) => {
    const input = AccountUpdateSchema.extend(confirmed).strict().parse(request.body);
    const account = await runInTransaction(async (tx) => {
      const before = await getAccount(tx, userId, request.params.accountId);
      const saved = await updateAccount(tx, userId, before.id, input);
      await audit(tx, userId, request, {
        toolName: "update_account",
        targetType: "financial_account",
        targetId: saved.id,
        beforeValue: { name: before.name, institution: before.institution, type: before.type, color: before.color, archived: before.archived },
        afterValue: { name: saved.name, institution: saved.institution, type: saved.type, color: saved.color, archived: saved.archived },
      });
      return saved;
    });
    response.json({ account });
  }),
);

accountsRouter.delete(
  "/:accountId",
  write,
  handle(async (request, response, userId) => {
    z.object(confirmed).parse(request.body ?? {});
    await runInTransaction(async (tx) => {
      const before = await getAccount(tx, userId, request.params.accountId);
      await deleteAccount(tx, userId, before.id);
      await audit(tx, userId, request, {
        toolName: "delete_account",
        targetType: "financial_account",
        targetId: before.id,
        beforeValue: { name: before.name, identifiers: before.identifiers.map((i) => i.identifier) },
      });
    });
    response.json({ deleted: true });
  }),
);

/** Keeps an automatically created account: it leaves the review list. */
accountsRouter.post(
  "/:accountId/confirm",
  write,
  handle(async (request, response, userId) => {
    z.object(confirmed).strict().parse(request.body);
    const account = await runInTransaction(async (tx) => {
      const saved = await confirmAccount(tx, userId, request.params.accountId);
      await audit(tx, userId, request, {
        toolName: "confirm_account",
        targetType: "financial_account",
        targetId: saved.id,
        afterValue: { autoCreated: false, autoCreatedFrom: saved.autoCreatedFrom },
      });
      return saved;
    });
    response.json({ account });
  }),
);

/** Merges this account into another (moving identifiers, cards and transactions) and deletes it. */
accountsRouter.post(
  "/:accountId/merge",
  write,
  handle(async (request, response, userId) => {
    const input = z.object({ intoAccountId: z.string().min(1), ...confirmed }).strict().parse(request.body);
    const account = await runInTransaction(async (tx) => {
      const source = await getAccount(tx, userId, request.params.accountId);
      const saved = await mergeAccount(tx, userId, source.id, input.intoAccountId);
      await audit(tx, userId, request, {
        toolName: "merge_account",
        targetType: "financial_account",
        targetId: saved.id,
        beforeValue: { mergedAccountId: source.id, mergedName: source.name, transactions: source.transactionCount },
        afterValue: { name: saved.name, identifiers: saved.identifiers.map((i) => i.identifier) },
      });
      return saved;
    });
    response.json({ account });
  }),
);

/** Adds a statement identifier to the account, moving it (and its transactions) from another account if needed. */
accountsRouter.post(
  "/:accountId/identifiers",
  write,
  handle(async (request, response, userId) => {
    const input = z.object({ identifier: IdentifierSchema, ...confirmed }).strict().parse(request.body);
    const account = await runInTransaction(async (tx) => {
      const before = await tx.accountIdentifier.findUnique({
        where: { userId_accountIdentifier: { userId, accountIdentifier: input.identifier } },
      });
      const saved = await attachIdentifier(tx, userId, request.params.accountId, input.identifier);
      await audit(tx, userId, request, {
        toolName: before ? "move_account_identifier" : "add_account_identifier",
        targetType: "financial_account",
        targetId: saved.id,
        ...(before ? { beforeValue: { identifier: input.identifier, accountId: before.accountId } } : {}),
        afterValue: { identifier: input.identifier, accountId: saved.id },
      });
      return saved;
    });
    response.json({ account });
  }),
);

accountsRouter.delete(
  "/identifiers/:identifierId",
  write,
  handle(async (request, response, userId) => {
    z.object(confirmed).parse(request.body ?? {});
    await runInTransaction(async (tx) => {
      await detachIdentifier(tx, userId, request.params.identifierId);
      await audit(tx, userId, request, {
        toolName: "remove_account_identifier",
        targetType: "account_identifier",
        targetId: request.params.identifierId,
      });
    });
    response.json({ deleted: true });
  }),
);

accountsRouter.post(
  "/:accountId/cards",
  write,
  handle(async (request, response, userId) => {
    const input = CardInputSchema.extend(confirmed).strict().parse(request.body);
    const card = await runInTransaction(async (tx) => {
      const saved = await addCard(tx, userId, request.params.accountId, input);
      await audit(tx, userId, request, {
        toolName: "add_card",
        targetType: "card",
        targetId: saved.id,
        afterValue: { accountId: saved.accountId, last4: saved.last4, network: saved.network, nickname: saved.nickname },
      });
      return saved;
    });
    response.status(201).json({ card });
  }),
);

accountsRouter.patch(
  "/cards/:cardId",
  write,
  handle(async (request, response, userId) => {
    const input = CardUpdateSchema.extend(confirmed).strict().parse(request.body);
    const card = await runInTransaction(async (tx) => {
      const before = await tx.card.findFirst({ where: { id: request.params.cardId, userId } });
      const saved = await updateCard(tx, userId, request.params.cardId, input);
      await audit(tx, userId, request, {
        toolName: "update_card",
        targetType: "card",
        targetId: saved.id,
        beforeValue: before ? { accountId: before.accountId, last4: before.last4, network: before.network, nickname: before.nickname } : undefined,
        afterValue: { accountId: saved.accountId, last4: saved.last4, network: saved.network, nickname: saved.nickname },
      });
      return saved;
    });
    response.json({ card });
  }),
);

accountsRouter.delete(
  "/cards/:cardId",
  write,
  handle(async (request, response, userId) => {
    z.object(confirmed).parse(request.body ?? {});
    await runInTransaction(async (tx) => {
      await deleteCard(tx, userId, request.params.cardId);
      await audit(tx, userId, request, { toolName: "delete_card", targetType: "card", targetId: request.params.cardId });
    });
    response.json({ deleted: true });
  }),
);

// Images: PUT { base64 } or { url } sets it, DELETE clears it. A card without
// its own image shows its account's.
for (const [path, type] of [
  ["/:id/image", "account"],
  ["/cards/:id/image", "card"],
] as const) {
  accountsRouter.put(
    path,
    write,
    handle(async (request, response, userId) => {
      const input = ImageInputSchema.parse(request.body);
      const result = await runInTransaction(async (tx) => {
        const saved = await setImage(tx, userId, { type, id: request.params.id }, input);
        await audit(tx, userId, request, {
          toolName: `set_${type}_image`,
          targetType: type === "account" ? "financial_account" : "card",
          targetId: request.params.id,
          afterValue: { imageId: saved.imageId, source: input.url ? "url" : "upload" },
        });
        return saved;
      });
      response.json(result);
    }),
  );
  accountsRouter.delete(
    path,
    write,
    handle(async (request, response, userId) => {
      const result = await runInTransaction(async (tx) => {
        const saved = await setImage(tx, userId, { type, id: request.params.id }, null);
        await audit(tx, userId, request, {
          toolName: `clear_${type}_image`,
          targetType: type === "account" ? "financial_account" : "card",
          targetId: request.params.id,
        });
        return saved;
      });
      response.json(result);
    }),
  );
}

/** Puts every transaction of one import batch on an account (by id or statement identifier). */
accountsRouter.post(
  "/import-batches/:batchId/assign",
  requireAccountAuth(["accounts:write", "imports:commit"]),
  handle(async (request, response, userId) => {
    const input = z
      .object({ accountIdentifier: IdentifierSchema.optional(), accountId: z.string().min(1).optional(), ...confirmed })
      .strict()
      .refine((v) => Boolean(v.accountIdentifier) !== Boolean(v.accountId), "Send accountIdentifier or accountId")
      .parse(request.body);
    const batch = await prisma.importBatch.findFirst({
      where: { id: request.params.batchId, userId },
      select: { id: true, filename: true },
    });
    if (!batch) return response.status(404).json({ error: "Import batch not found" });
    const identifier = input.accountIdentifier
      ? await prisma.accountIdentifier.findUnique({
          where: { userId_accountIdentifier: { userId, accountIdentifier: input.accountIdentifier } },
        })
      : null;
    if (input.accountIdentifier && !identifier)
      return response.status(409).json({ error: "Create the account before assigning an import batch to it" });
    const { account, updatedCount } = await runInTransaction(async (tx) => {
      const account = await getAccount(tx, userId, input.accountId ?? identifier!.accountId!);
      // Setting the identifier lets the trigger pick the account; setting the
      // account picks its oldest identifier.
      const updated = await tx.transaction.updateMany({
        where: { userId, importBatchId: batch.id },
        data: identifier ? { accountIdentifier: identifier.accountIdentifier } : { accountId: account.id },
      });
      await audit(tx, userId, request, {
        toolName: "assign_import_batch_account",
        targetType: "import_batch",
        targetId: batch.id,
        afterValue: { accountId: account.id, accountIdentifier: input.accountIdentifier ?? null, updatedCount: updated.count },
        metadata: { filename: batch.filename },
      });
      return { account, updatedCount: updated.count };
    });
    response.json({ batchId: batch.id, account, updatedCount });
  }),
);
