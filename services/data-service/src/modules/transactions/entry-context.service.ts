import { z } from "zod";
import prisma from "../../lib/prisma";
import { LedgerTools } from "../chat/tools/ledger";
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
    description: z.string().trim().min(2).max(200),
    direction: z.enum(["in", "out"]).optional(),
    limit: z.coerce.number().int().min(1).max(10).default(5),
    /** With date and amount, also returns possible duplicates scored like statement imports. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD").optional(),
    amount: z.coerce.number().finite().positive().optional(),
    account: z.string().trim().max(120).optional(),
  })
  .strict();

export const EntryContext = {
  /**
   * Accounts with the last 4 digits a card notification would show. Seam for
   * Accounts and Cards (task fortu-6489): cards are empty until Card rows exist.
   */
  async accounts(userId: string) {
    const [accounts, counts] = await Promise.all([
      prisma.accountIdentifier.findMany({ where: { userId }, orderBy: [{ autoCreated: "desc" }, { createdAt: "asc" }] }),
      prisma.transaction.groupBy({ by: ["accountIdentifier"], where: { userId }, _count: true }),
    ]);
    const used = new Map(counts.map((row) => [row.accountIdentifier, row._count]));
    return {
      accounts: accounts.map((account) => {
        const digits = identifierDigits(account.accountIdentifier);
        return {
          id: account.id,
          accountIdentifier: account.accountIdentifier,
          label: account.label,
          last4: digits.length >= 4 ? digits.slice(-4) : null,
          autoCreated: account.autoCreated,
          autoCreatedFrom: account.autoCreatedFrom,
          transactionCount: used.get(account.accountIdentifier) ?? 0,
          cards: [] as Array<{ id: string; last4: string }>,
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

  /** The rules Fortuna classifies with: import rules, and learned patterns that apply by themselves. */
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
      rules,
      learnedPatterns: patterns.map(({ category, ...pattern }) => ({ ...pattern, category: category?.name ?? null })),
    };
  },

  /**
   * Past transactions like this one (the same search as the chat's
   * find_similar_transactions, with their labels and categories), and, given a
   * date and amount, the ones a statement import would call duplicates.
   */
  async similar(userId: string, query: z.infer<typeof SimilarQuerySchema>) {
    const { results } = await new LedgerTools(prisma).similar(userId, {
      descriptions: [query.description],
      ...(query.direction ? { direction: query.direction } : {}),
      limit: query.limit,
    });
    const [similar] = results;
    if (!query.date || !query.amount) return { ...similar, possibleDuplicates: [] };
    const out = query.direction !== "in";
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
