import { z } from "zod";
import prisma from "../../lib/prisma";
import { descriptionTerms } from "../chat/tools/ledger";
import { DuplicateDetector } from "../duplicates/duplicate-detector";
import { identifierDigits } from "./assistant-entries";

/**
 * Read-only context the assistant classifies and reviews with:
 * /api/agent/transactions/context/* (scope transactions:write or transactions:review).
 */

/** Trip-only categories never apply to main-ledger entries. */
const TRIP_CATEGORY_NAMES = ["Flights", "Accommodation", "Attractions", "Fees"];

export const SimilarQuerySchema = z
  .object({
    /** The merchant or description as the bank shows it. */
    description: z.string().trim().min(2).max(200),
    direction: z.enum(["in", "out"]).optional(),
    limit: z.coerce.number().int().min(1).max(20).default(8),
    /** With date and amount, also returns possible duplicates scored like statement imports. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD").optional(),
    /** Similar amounts (within 25%) rank higher. */
    amount: z.coerce.number().finite().positive().optional(),
    account: z.string().trim().max(120).optional(),
    /** The card's last 4 digits or id: the same card ranks higher. */
    card: z.string().trim().max(64).optional(),
  })
  .strict();

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** The transaction's type as precedents show it: what the assistant or a review set, else what its linkage says. */
function precedentType(metadata: Record<string, unknown>, linkage: unknown) {
  if (typeof metadata.transactionType === "string") return metadata.transactionType;
  const type = record(linkage).type;
  return type === "internal" ? "internal" : type === "reimbursement" ? "reimbursement" : null;
}

export const EntryContext = {
  /**
   * Accounts with their cards' last 4 digits (what a card notification shows),
   * statement identifiers, and whether Fortuna created them and from what.
   * Accounts awaiting review come first.
   */
  async accounts(userId: string) {
    const accounts = await prisma.financialAccount.findMany({
      where: { userId, archived: false },
      include: {
        identifiers: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        cards: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        _count: { select: { transactions: true } },
      },
      orderBy: [{ autoCreated: "desc" }, { createdAt: "asc" }],
    });
    return {
      accounts: accounts.map((account) => {
        const primary = account.identifiers[0]?.accountIdentifier ?? null;
        const digits = primary ? identifierDigits(primary) : "";
        return {
          id: account.id,
          /** The identifier entries are booked under; null when the account has none. */
          accountIdentifier: primary,
          identifiers: account.identifiers.map((item) => item.accountIdentifier),
          label: account.name,
          type: account.type,
          last4: account.cards[0]?.last4 ?? (digits.length >= 4 ? digits.slice(-4) : null),
          autoCreated: account.autoCreated,
          autoCreatedFrom: account.autoCreatedFrom,
          transactionCount: account._count.transactions,
          cards: account.cards.map((card) => ({ id: card.id, last4: card.last4, network: card.network, nickname: card.nickname })),
        };
      }),
    };
  },

  async categories(userId: string) {
    const categories = await prisma.category.findMany({
      where: {
        userId,
        NOT: TRIP_CATEGORY_NAMES.map((name) => ({ name: { equals: name, mode: "insensitive" as const } })),
      },
      select: { id: true, name: true, color: true, icon: true },
      orderBy: { name: "asc" },
    });
    return { categories };
  },

  /**
   * The rules Fortuna classifies with: import rules (which decide before the
   * assistant), and learned patterns (used only when the assistant sends no
   * decision).
   */
  async rules(userId: string) {
    const [rules, patterns] = await Promise.all([
      prisma.importRule.findMany({
        where: { userId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          parserId: true,
          accountIdentifier: true,
          matchType: true,
          matchValue: true,
          caseSensitive: true,
          enabled: true,
          setLabel: true,
          setCategoryName: true,
          markInternal: true,
          accountId: true,
          cardId: true,
          amountMin: true,
          amountMax: true,
          origin: true,
          reason: true,
          hitCount: true,
          lastHitAt: true,
        },
      }),
      prisma.classificationPattern.findMany({
        where: { userId, status: "auto_apply" },
        select: {
          id: true,
          patternType: true,
          patternValue: true,
          direction: true,
          label: true,
          markInternal: true,
          category: { select: { name: true } },
        },
        orderBy: { supportCount: "desc" },
        take: 200,
      }),
    ]);
    return {
      rules: rules.map((rule) => ({
        ...rule,
        amountMin: rule.amountMin == null ? null : Number(rule.amountMin),
        amountMax: rule.amountMax == null ? null : Number(rule.amountMax),
      })),
      learnedPatterns: patterns.map(({ category, ...pattern }) => ({ ...pattern, category: category?.name ?? null })),
    };
  },

  /**
   * Precedents for deciding an entry: past transactions with the same
   * merchant (sharing words with the description or label), the same card
   * and a similar amount, recent reviewed ones first, each with its category,
   * type, label, merchant and reimbursable flag (when set). commonLabels
   * tallies the label/category pairs among them. Given a date and amount it
   * also lists the ones a statement import would call duplicates.
   */
  async similar(userId: string, query: z.infer<typeof SimilarQuerySchema>) {
    const terms = descriptionTerms(query.description);
    const out = query.direction !== "in";
    const cards = query.card
      ? await prisma.card.findMany({
          where: { userId, OR: [{ id: query.card }, { last4: query.card }] },
          select: { id: true, last4: true },
        })
      : [];
    const cardIds = cards.map((card) => card.id);
    const amountRange = query.amount ? { gte: query.amount * 0.75, lte: query.amount * 1.25 } : null;
    const directional =
      query.direction === "in" ? { amountIn: { gt: 0 } } : query.direction === "out" ? { amountOut: { gt: 0 } } : {};
    const rows = terms.length || (cardIds.length && amountRange)
      ? await prisma.transaction.findMany({
          where: {
            userId,
            ...directional,
            OR: [
              ...terms.flatMap((term) => [
                { description: { contains: term, mode: "insensitive" as const } },
                { label: { contains: term, mode: "insensitive" as const } },
              ]),
              // The same card and a similar amount, whatever the bank called the merchant.
              ...(cardIds.length && amountRange
                ? [{ cardId: { in: cardIds }, ...(out ? { amountOut: amountRange } : { amountIn: amountRange }) }]
                : []),
            ],
          },
          include: { category: { select: { name: true } }, card: { select: { last4: true } } },
          orderBy: { date: "desc" },
          take: 400,
        })
      : [];
    const wanted = query.description.trim().toLowerCase();
    const scored = rows
      .map((row) => {
        const metadata = record(row.metadata);
        const merchant = typeof metadata.merchant === "string" ? metadata.merchant : null;
        const own = new Set(descriptionTerms(`${row.description} ${row.label || ""} ${merchant || ""}`));
        const merchantScore =
          row.description.trim().toLowerCase() === wanted ? 1 : terms.length ? terms.filter((term) => own.has(term)).length / terms.length : 0;
        const amount = Number(row.amountOut ?? 0) || Number(row.amountIn ?? 0);
        const similarAmount = Boolean(query.amount && amount && Math.abs(amount - query.amount) <= query.amount * 0.25);
        const sameCard = Boolean(row.cardId && cardIds.includes(row.cardId));
        const matchedOn = [
          ...(merchantScore >= 0.5 ? ["merchant"] : []),
          ...(similarAmount ? ["amount"] : []),
          ...(sameCard ? ["card"] : []),
        ];
        return {
          row,
          metadata,
          merchant,
          matchedOn,
          score: Math.round((merchantScore + (similarAmount ? 0.25 : 0) + (sameCard ? 0.25 : 0)) * 100) / 100,
        };
      })
      .filter((item) => item.matchedOn.includes("merchant") || (item.matchedOn.includes("card") && item.matchedOn.includes("amount")))
      // Reviewed first (a person has seen them), then the best match, then the most recent.
      .sort(
        (a, b) =>
          Number(b.row.reviewStatus === "reviewed") - Number(a.row.reviewStatus === "reviewed") ||
          b.score - a.score ||
          b.row.date.getTime() - a.row.date.getTime(),
      );
    const tally = new Map<string, { label: string | null; category: string | null; count: number }>();
    for (const { row } of scored.slice(0, 50)) {
      if (!row.label && !row.categoryId) continue;
      const key = `${row.label || ""}|${row.category?.name || ""}`;
      const entry = tally.get(key) || { label: row.label, category: row.category?.name ?? null, count: 0 };
      entry.count += 1;
      tally.set(key, entry);
    }
    const similar = {
      description: query.description,
      matchCount: scored.length,
      matches: scored.slice(0, query.limit).map(({ row, metadata, merchant, matchedOn, score }) => ({
        id: row.id,
        date: row.date.toISOString().slice(0, 10),
        description: row.description,
        label: row.label,
        merchant,
        category: row.category?.name ?? null,
        categoryId: row.categoryId,
        transactionType: precedentType(metadata, row.linkage),
        reimbursable: metadata.reimbursable ?? null,
        amountIn: row.amountIn == null ? null : Number(row.amountIn),
        amountOut: row.amountOut == null ? null : Number(row.amountOut),
        currency: row.currency,
        account: row.accountIdentifier,
        accountId: row.accountId,
        card: row.card?.last4 ?? null,
        entrySource: row.entrySource,
        reviewStatus: row.reviewStatus,
        decidedBy: (record(metadata.classification).decidedBy as string | undefined) ?? null,
        matchedOn,
        score,
      })),
      commonLabels: [...tally.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    };
    if (!query.date || !query.amount) return { ...similar, possibleDuplicates: [] };
    const matches = await DuplicateDetector.findDuplicates(userId, {
      date: new Date(`${query.date}T00:00:00.000Z`),
      description: query.description,
      amountIn: out ? null : query.amount,
      amountOut: out ? query.amount : null,
      accountIdentifier: query.account ?? null,
    });
    return {
      ...similar,
      possibleDuplicates: matches.map((match) => ({
        id: match.transaction.id,
        date: (match.transaction.date as Date).toISOString().slice(0, 10),
        description: match.transaction.description,
        label: match.transaction.label,
        amountIn: match.transaction.amountIn == null ? null : Number(match.transaction.amountIn),
        amountOut: match.transaction.amountOut == null ? null : Number(match.transaction.amountOut),
        account: match.transaction.accountIdentifier,
        entrySource: match.transaction.entrySource,
        reviewStatus: match.transaction.reviewStatus,
        matchScore: match.matchScore,
        matchReasons: match.matchReasons,
      })),
    };
  },
};
