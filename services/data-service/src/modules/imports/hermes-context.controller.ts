import { Router, type Response } from "express";
import { z } from "zod";
import prisma from "../../lib/prisma";
import { authenticatedUserId, requireAccountAuth } from "../auth/auth.middleware";
import { TransactionService } from "../transactions/transactions.service";

export const hermesContextRouter = Router();

function failure(response: Response, error: unknown) {
  return response.status((error as { status?: number }).status || 400).json({
    error: error instanceof Error ? error.message : "Context request failed",
  });
}

function maskAccount(value: string | null) {
  if (!value) return null;
  const suffix = value.replace(/\s/g, "").slice(-4);
  return suffix ? `••••${suffix}` : "••••";
}

hermesContextRouter.get("/metrics", requireAccountAuth(["drafts:read"]), async (request, response) => {
  try {
    const userId = authenticatedUserId(request);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [draftStatuses, proposalStatuses, jobStatuses, parserStatuses] = await Promise.all([
      prisma.importDraft.groupBy({ by: ["status"], where: { userId, createdAt: { gte: since } }, _count: true }),
      prisma.classificationProposal.groupBy({ by: ["status"], where: { draft: { userId }, createdAt: { gte: since } }, _count: true }),
      prisma.classificationJob.groupBy({ by: ["status"], where: { userId, createdAt: { gte: since } }, _count: true }),
      prisma.parserCandidate.groupBy({ by: ["status"], where: { workspace: { userId }, createdAt: { gte: since } }, _count: true }),
    ]);
    return response.json({ windowDays: 30, drafts: draftStatuses, proposals: proposalStatuses, jobs: jobStatuses, parserCandidates: parserStatuses });
  } catch (error) {
    return failure(response, error);
  }
});

hermesContextRouter.get("/categories", requireAccountAuth(["classification:write"]), async (request, response) => {
  try {
    const userId = authenticatedUserId(request);
    const scope = z.enum(["main", "trip", "all"]).default("all").parse(request.query.scope);
    const categories = await prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" } });
    const tripNames = new Set(["Trip Expense", "Trip Funding", "Trip Reimbursement"]);
    return response.json({
      categories: categories.filter((category) => scope === "all" || (scope === "trip" ? tripNames.has(category.name) : !tripNames.has(category.name))),
    });
  } catch (error) {
    return failure(response, error);
  }
});

hermesContextRouter.get("/similar-transactions", requireAccountAuth(["classification:write"]), async (request, response) => {
  try {
    const input = z.object({ description: z.string().min(2), direction: z.enum(["in", "out"]).optional(), limit: z.coerce.number().int().min(1).max(20).default(8) }).parse(request.query);
    const terms = input.description.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 3).slice(0, 4);
    const transactions = await prisma.transaction.findMany({
      where: {
        userId: authenticatedUserId(request),
        ...(terms.length ? { OR: terms.map((term) => ({ description: { contains: term, mode: "insensitive" as const } })) } : {}),
        ...(input.direction === "in" ? { amountIn: { gt: 0 } } : input.direction === "out" ? { amountOut: { gt: 0 } } : {}),
      },
      select: { id: true, date: true, description: true, label: true, categoryId: true, amountIn: true, amountOut: true, currency: true, accountIdentifier: true, linkage: true },
      orderBy: { date: "desc" },
      take: input.limit,
    });
    return response.json({ transactions: transactions.map((transaction) => ({ ...transaction, accountIdentifier: maskAccount(transaction.accountIdentifier) })) });
  } catch (error) {
    return failure(response, error);
  }
});

hermesContextRouter.get("/trips", requireAccountAuth(["trips:read"]), async (request, response) => {
  try {
    const query = z.object({ dateFrom: z.coerce.date().optional(), dateTo: z.coerce.date().optional() }).parse(request.query);
    const trips = await prisma.trip.findMany({
      where: {
        userId: authenticatedUserId(request),
        ...(query.dateFrom || query.dateTo
          ? {
              AND: [
                ...(query.dateTo ? [{ startDate: { lte: query.dateTo } }] : []),
                ...(query.dateFrom ? [{ OR: [{ endDate: null }, { endDate: { gte: query.dateFrom } }] }] : []),
              ],
            }
          : {}),
      },
      select: { id: true, name: true, baseCurrency: true, startDate: true, endDate: true, status: true },
      orderBy: { startDate: "desc" },
    });
    return response.json({ trips });
  } catch (error) {
    return failure(response, error);
  }
});

hermesContextRouter.get("/trips/:tripId", requireAccountAuth(["trips:read"]), async (request, response) => {
  try {
    const trip = await prisma.trip.findFirst({
      where: { id: request.params.tripId, userId: authenticatedUserId(request) },
      include: {
        wallets: { select: { id: true, name: true, currency: true } },
        fundings: { select: { id: true, walletId: true, sourceCurrency: true, sourceAmount: true, destinationCurrency: true, destinationAmount: true, feeAmount: true, createdAt: true } },
        entries: { select: { id: true, type: true, transactionDate: true, description: true, label: true, localCurrency: true, localAmount: true, baseAmount: true, walletId: true, categoryId: true }, orderBy: { transactionDate: "desc" }, take: 100 },
      },
    });
    if (!trip) return response.status(404).json({ error: "Trip not found" });
    return response.json({ trip });
  } catch (error) {
    return failure(response, error);
  }
});

hermesContextRouter.get("/trips/:tripId/funding-candidates", requireAccountAuth(["trips:read"]), async (request, response) => {
  try {
    const userId = authenticatedUserId(request);
    const { draftRowId } = z.object({ draftRowId: z.string().min(1) }).parse(request.query);
    const [trip, row] = await Promise.all([
      prisma.trip.findFirst({ where: { id: request.params.tripId, userId }, include: { wallets: true } }),
      prisma.importDraftRow.findFirst({ where: { id: draftRowId, draft: { userId } } }),
    ]);
    if (!trip || !row) return response.status(404).json({ error: "Trip or draft row not found" });
    const payload = row.currentPayload as Record<string, any>;
    const date = new Date(String(payload.date || payload.transactionDate));
    if (Number.isNaN(date.getTime())) return response.status(400).json({ error: "Draft row date is invalid" });
    const amount = Number(payload.amountOut || payload.amountIn || payload.localAmount || 0);
    const from = new Date(date.getTime() - 3 * 24 * 60 * 60 * 1000);
    const to = new Date(date.getTime() + 3 * 24 * 60 * 60 * 1000);
    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        date: { gte: from, lte: to },
        OR: [
          { amountOut: { gte: Math.max(0, amount - 0.02), lte: amount + 0.02 } },
          { amountIn: { gte: Math.max(0, amount - 0.02), lte: amount + 0.02 } },
        ],
      },
      select: { id: true, date: true, description: true, amountIn: true, amountOut: true, currency: true, accountIdentifier: true },
      orderBy: { date: "desc" },
      take: 20,
    });
    return response.json({
      trip: { id: trip.id, name: trip.name, baseCurrency: trip.baseCurrency },
      wallets: trip.wallets.map(({ id, name, currency }) => ({ id, name, currency })),
      candidates: transactions.map((item) => ({ ...item, accountIdentifier: maskAccount(item.accountIdentifier), amountDifference: Math.min(Math.abs(Number(item.amountOut || 0) - amount), Math.abs(Number(item.amountIn || 0) - amount)) })),
    });
  } catch (error) {
    return failure(response, error);
  }
});

hermesContextRouter.get("/trips/:tripId/reimbursement-candidates", requireAccountAuth(["trips:read"]), async (request, response) => {
  try {
    const userId = authenticatedUserId(request);
    const input = z.object({ draftRowId: z.string().min(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
    const [trip, row] = await Promise.all([
      prisma.trip.findFirst({ where: { id: request.params.tripId, userId }, select: { id: true, name: true } }),
      prisma.importDraftRow.findFirst({ where: { id: input.draftRowId, draft: { userId } } }),
    ]);
    if (!trip || !row) return response.status(404).json({ error: "Trip or draft row not found" });
    const payload = row.currentPayload as Record<string, any>;
    const date = new Date(String(payload.date || payload.transactionDate));
    const reimbursementAmount = Number(payload.amountIn || payload.localAmount || 0);
    const candidates = await prisma.tripEntry.findMany({
      where: {
        tripId: trip.id,
        type: "spending",
        ...(Number.isNaN(date.getTime()) ? {} : { transactionDate: { lte: new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000) } }),
        ...(reimbursementAmount > 0 ? { baseAmount: { lte: reimbursementAmount } } : {}),
      },
      select: { id: true, transactionDate: true, description: true, label: true, localCurrency: true, localAmount: true, baseAmount: true, walletId: true, categoryId: true, reimbursementAllocationsAsTarget: { select: { amountBase: true } } },
      orderBy: { transactionDate: "desc" },
      take: input.limit,
    });
    return response.json({
      trip,
      candidates: candidates.map((candidate) => ({
        ...candidate,
        alreadyReimbursedBase: candidate.reimbursementAllocationsAsTarget.reduce((sum, allocation) => sum + Number(allocation.amountBase), 0),
      })),
    });
  } catch (error) {
    return failure(response, error);
  }
});

hermesContextRouter.get("/rules", requireAccountAuth(["rules:read"]), async (request, response) => {
  try {
    const parserId = request.query.parserId ? String(request.query.parserId) : undefined;
    const rules = await prisma.importRule.findMany({
      where: { userId: authenticatedUserId(request), ...(parserId ? { OR: [{ parserId }, { parserId: null }] } : {}) },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return response.json({ rules });
  } catch (error) {
    return failure(response, error);
  }
});

const RulePayloadSchema = z.object({
  name: z.string().min(1).max(100),
  parserId: z.string().nullable().optional(),
  matchType: z.enum(["always", "description_contains"]).default("description_contains"),
  matchValue: z.string().nullable().optional(),
  caseSensitive: z.boolean().default(false),
  setLabel: z.string().nullable().optional(),
  setCategoryName: z.string().nullable().optional(),
  markInternal: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
}).strict();

hermesContextRouter.post("/rules", requireAccountAuth(["rules:write"]), async (request, response) => {
  try {
    const userId = authenticatedUserId(request);
    const payload = RulePayloadSchema.parse(request.body);
    if (payload.setCategoryName) {
      const category = await prisma.category.findFirst({ where: { userId, name: { equals: payload.setCategoryName, mode: "insensitive" } } });
      if (!category) return response.status(400).json({ error: "Rule category does not exist" });
    }
    const rule = await TransactionService.createImportRule(userId, { ...payload, enabled: false });
    await prisma.agentAuditEvent.create({ data: { userId, actorType: request.apiAuth!.actorType, actorId: request.apiAuth!.tokenId, toolName: "create_import_rule_disabled", targetType: "import_rule", targetId: rule.id, afterValue: rule as any } });
    return response.status(201).json({ rule, confirmationRequiredToEnable: true });
  } catch (error) {
    return failure(response, error);
  }
});

hermesContextRouter.patch("/rules/:ruleId", requireAccountAuth(["rules:write"]), async (request, response) => {
  try {
    const input = RulePayloadSchema.partial().extend({ enabled: z.boolean().optional(), confirmed: z.boolean().optional() }).strict().parse(request.body);
    if (input.enabled === true && input.confirmed !== true) return response.status(400).json({ error: "Explicit confirmation is required to enable a deterministic rule" });
    const { confirmed: _confirmed, ...payload } = input;
    const userId = authenticatedUserId(request);
    const rule = await TransactionService.updateImportRule(userId, request.params.ruleId, payload);
    await prisma.agentAuditEvent.create({ data: { userId, actorType: request.apiAuth!.actorType, actorId: request.apiAuth!.tokenId, toolName: "update_import_rule", targetType: "import_rule", targetId: rule.id, afterValue: rule as any } });
    return response.json({ rule });
  } catch (error) {
    return failure(response, error);
  }
});

hermesContextRouter.get("/patterns", requireAccountAuth(["rules:read"]), async (request, response) => {
  try {
    return response.json({ patterns: await TransactionService.getClassificationPatterns(authenticatedUserId(request), {}) });
  } catch (error) {
    return failure(response, error);
  }
});

hermesContextRouter.post("/patterns/rebuild", requireAccountAuth(["rules:write"]), async (request, response) => {
  try {
    return response.json(await TransactionService.rebuildClassificationPatterns(authenticatedUserId(request)));
  } catch (error) {
    return failure(response, error);
  }
});

hermesContextRouter.post("/patterns", requireAccountAuth(["rules:write"]), async (request, response) => {
  try {
    const input = z.object({
      patternType: z.enum(["description_exact", "merchant_stem", "label_alias"]),
      patternValue: z.string().min(2).max(500),
      parserId: z.string().nullable().optional(),
      direction: z.enum(["in", "out"]).nullable().optional(),
      label: z.string().nullable().optional(),
      categoryId: z.string().nullable().optional(),
      markInternal: z.boolean().default(false),
      confidence: z.number().min(0).max(1),
      supportCount: z.number().int().min(0),
      matchCount: z.number().int().min(0),
      conflictCount: z.number().int().min(0),
      evidence: z.record(z.unknown()).optional(),
    }).strict().parse(request.body);
    const userId = authenticatedUserId(request);
    if (input.categoryId && !(await prisma.category.findFirst({ where: { id: input.categoryId, userId } }))) {
      return response.status(400).json({ error: "Pattern category does not exist" });
    }
    const pattern = await prisma.classificationPattern.create({
      data: {
        userId,
        patternType: input.patternType,
        patternValue: input.patternValue.trim().toLowerCase(),
        parserId: input.parserId,
        direction: input.direction,
        label: input.label,
        categoryId: input.categoryId,
        markInternal: input.markInternal,
        confidence: input.confidence,
        supportCount: input.supportCount,
        matchCount: input.matchCount,
        conflictCount: input.conflictCount,
        status: "disabled",
        metadata: { source: "hermes", evidence: input.evidence || {} } as any,
      },
    });
    return response.status(201).json({ pattern, confirmationRequiredToEnable: true });
  } catch (error) {
    return failure(response, error);
  }
});

hermesContextRouter.patch("/patterns/:patternId", requireAccountAuth(["rules:write"]), async (request, response) => {
  try {
    const input = z.object({ status: z.enum(["auto_apply", "disabled", "unresolved"]), confirmed: z.boolean().optional() }).strict().parse(request.body);
    const userId = authenticatedUserId(request);
    const existing = await prisma.classificationPattern.findFirst({ where: { id: request.params.patternId, userId } });
    if (!existing) return response.status(404).json({ error: "Classification pattern not found" });
    if (input.status === "auto_apply") {
      if (input.confirmed !== true) return response.status(400).json({ error: "Explicit confirmation is required to enable a learned rule" });
      const contradictionRate = existing.supportCount > 0 ? existing.conflictCount / existing.supportCount : 1;
      if (existing.supportCount < 3 || Number(existing.confidence) < 0.9 || contradictionRate > 0.1 || existing.markInternal) {
        return response.status(400).json({ error: "Pattern does not meet auto-apply evidence policy" });
      }
    }
    return response.json({ pattern: await TransactionService.updateClassificationPattern(userId, existing.id, { status: input.status }) });
  } catch (error) {
    return failure(response, error);
  }
});

hermesContextRouter.get("/patterns/:patternId/evidence", requireAccountAuth(["rules:read"]), async (request, response) => {
  try {
    const userId = authenticatedUserId(request);
    const pattern = await prisma.classificationPattern.findFirst({ where: { id: request.params.patternId, userId }, include: { category: true } });
    if (!pattern) return response.status(404).json({ error: "Classification pattern not found" });
    const examples = await prisma.transaction.findMany({
      where: { userId, description: { contains: pattern.patternValue, mode: "insensitive" } },
      select: { id: true, date: true, description: true, label: true, categoryId: true, amountIn: true, amountOut: true },
      orderBy: { date: "desc" },
      take: 20,
    });
    return response.json({ pattern, examples });
  } catch (error) {
    return failure(response, error);
  }
});
