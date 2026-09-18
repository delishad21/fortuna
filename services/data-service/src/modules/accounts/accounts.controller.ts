import { Prisma } from "@prisma/client";
import { Router, type Request } from "express";
import { z } from "zod";
import prisma from "../../lib/prisma";
import { authenticatedUserId, requireAccountAuth } from "../auth/auth.middleware";

export const accountsRouter = Router();

const AccountIdentifierSchema = z.string().trim().min(1).max(120);
const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "color must be a six-digit hex value");

function publicAccount(account: {
  id: string;
  accountIdentifier: string;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: account.id,
    accountIdentifier: account.accountIdentifier,
    color: account.color,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

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

accountsRouter.get("/", requireAccountAuth(["accounts:read"]), async (request, response, next) => {
  try {
    const accounts = await prisma.accountIdentifier.findMany({
      where: { userId: authenticatedUserId(request) },
      select: { id: true, accountIdentifier: true, color: true, createdAt: true, updatedAt: true },
      orderBy: { accountIdentifier: "asc" },
    });
    return response.json({ accounts });
  } catch (error) {
    next(error);
  }
});

accountsRouter.post("/", requireAccountAuth(["accounts:write"]), async (request, response, next) => {
  try {
    const input = z.object({
      accountIdentifier: AccountIdentifierSchema,
      color: ColorSchema.default("#6366f1"),
      confirmed: z.literal(true),
    }).strict().parse(request.body);
    const userId = authenticatedUserId(request);
    const existing = await prisma.accountIdentifier.findUnique({
      where: { userId_accountIdentifier: { userId, accountIdentifier: input.accountIdentifier } },
    });
    const account = await prisma.$transaction(async (tx) => {
      const saved = await tx.accountIdentifier.upsert({
        where: { userId_accountIdentifier: { userId, accountIdentifier: input.accountIdentifier } },
        update: { color: input.color },
        create: { userId, accountIdentifier: input.accountIdentifier, color: input.color },
      });
      await audit(tx, userId, request, {
        toolName: existing ? "update_account" : "create_account",
        targetType: "account_identifier",
        targetId: saved.id,
        ...(existing ? { beforeValue: { accountIdentifier: existing.accountIdentifier, color: existing.color } } : {}),
        afterValue: { accountIdentifier: saved.accountIdentifier, color: saved.color },
      });
      return saved;
    });
    return response.status(existing ? 200 : 201).json({ account: publicAccount(account), created: !existing });
  } catch (error) {
    next(error);
  }
});

accountsRouter.patch("/:accountId", requireAccountAuth(["accounts:write"]), async (request, response, next) => {
  try {
    const input = z.object({ color: ColorSchema, confirmed: z.literal(true) }).strict().parse(request.body);
    const userId = authenticatedUserId(request);
    const existing = await prisma.accountIdentifier.findFirst({ where: { id: request.params.accountId, userId } });
    if (!existing) return response.status(404).json({ error: "Account not found" });
    const account = await prisma.$transaction(async (tx) => {
      const saved = await tx.accountIdentifier.update({ where: { id: existing.id }, data: { color: input.color } });
      await audit(tx, userId, request, {
        toolName: "update_account_color",
        targetType: "account_identifier",
        targetId: saved.id,
        beforeValue: { color: existing.color },
        afterValue: { color: saved.color },
      });
      return saved;
    });
    return response.json({ account: publicAccount(account) });
  } catch (error) {
    next(error);
  }
});

accountsRouter.post("/import-batches/:batchId/assign", requireAccountAuth(["accounts:write", "imports:commit"]), async (request, response, next) => {
  try {
    const input = z.object({ accountIdentifier: AccountIdentifierSchema, confirmed: z.literal(true) }).strict().parse(request.body);
    const userId = authenticatedUserId(request);
    const [batch, account] = await Promise.all([
      prisma.importBatch.findFirst({ where: { id: request.params.batchId, userId }, select: { id: true, filename: true } }),
      prisma.accountIdentifier.findUnique({ where: { userId_accountIdentifier: { userId, accountIdentifier: input.accountIdentifier } } }),
    ]);
    if (!batch) return response.status(404).json({ error: "Import batch not found" });
    if (!account) return response.status(409).json({ error: "Create the account before assigning an import batch to it" });
    const updatedCount = await prisma.$transaction(async (tx) => {
      const updated = await tx.transaction.updateMany({
        where: { userId, importBatchId: batch.id },
        data: { accountIdentifier: account.accountIdentifier },
      });
      await audit(tx, userId, request, {
        toolName: "assign_import_batch_account",
        targetType: "import_batch",
        targetId: batch.id,
        afterValue: { accountIdentifier: account.accountIdentifier, updatedCount: updated.count },
        metadata: { filename: batch.filename },
      });
      return updated.count;
    });
    return response.json({ batchId: batch.id, account: publicAccount(account), updatedCount });
  } catch (error) {
    next(error);
  }
});
