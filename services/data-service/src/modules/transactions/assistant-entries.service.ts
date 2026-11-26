import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { DuplicateDetector } from "../duplicates/duplicate-detector";
import { classifyRows } from "../imports/import-enrichment";
import { runInTransaction } from "../reimbursements/links.service";
import {
  accountsForLast4,
  entryDateParts,
  type CreateEntryInput,
  type UpdateEntryInput,
} from "./assistant-entries";
import {
  classificationDecision,
  reviewReasonsFor,
  type ClassificationDecision,
  type ReviewReason,
} from "./entry-review";
import { TransactionService } from "./transactions.service";

export class EntryError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export type EntryActor = {
  actorType: string;
  actorId?: string;
  requestId?: string;
};

type Card = { id?: string; last4?: string };

type Stored = Prisma.TransactionGetPayload<{ include: { category: true } }>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export const RESERVED = { internal: "Internal", reimbursement: "Reimbursement" } as const;

type AccountRow = {
  /** The statement identifier's id. */
  id: string;
  accountIdentifier: string;
  /** The account's name. */
  label: string | null;
  /** The account still awaits review (FinancialAccount.autoCreated). */
  autoCreated: boolean;
  accountId: string | null;
};

export type ResolvedAccount = {
  /** The statement identifier to book to; null for an account that has none (the card decides). */
  accountIdentifier: string | null;
  /** The FinancialAccount to book to. */
  accountId: string | null;
  card: Card | null | undefined;
  /** The Card row the entry was paid with, when one matched or was created. */
  cardId: string | null;
  /** The account was created by Fortuna and nobody has confirmed it yet. */
  autoCreated: boolean;
  /** This request created it. */
  created: AccountRow | null;
};

/**
 * The user's statement identifiers as accounts: each with its account's name
 * and review flag (they live on FinancialAccount now).
 */
async function loadAccounts(userId: string): Promise<AccountRow[]> {
  const rows = await prisma.accountIdentifier.findMany({
    where: { userId },
    select: {
      id: true,
      accountIdentifier: true,
      label: true,
      autoCreated: true,
      accountId: true,
      account: { select: { name: true, autoCreated: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    accountIdentifier: row.accountIdentifier,
    label: row.account?.name ?? row.label,
    autoCreated: row.account ? row.account.autoCreated : row.autoCreated,
    accountId: row.accountId,
  }));
}

/** An existing account by identifier, identifier id, account id or name (case-insensitive). */
export async function findAccount(userId: string, ref: string) {
  const accounts = await loadAccounts(userId);
  const wanted = ref.trim();
  const lower = wanted.toLowerCase();
  return (
    accounts.find((item) => item.accountIdentifier === wanted || item.id === wanted) ??
    accounts.find((item) => item.accountId === wanted) ??
    accounts.find((item) => item.label?.trim().toLowerCase() === lower) ??
    null
  );
}

/**
 * The account the entry is booked to, and the card it was paid with.
 *
 * An account the assistant names (identifier, id or name) wins, then the
 * user's card with those last 4 digits (or that card id), then a statement
 * identifier ending in them, each only when exactly one matches. When nothing
 * matches, Fortuna creates the account itself (an identifier whose trigger
 * makes a FinancialAccount flagged autoCreated, with what created it) and a
 * Card under it for the last 4 digits; the entry is queued with reason
 * new_account until the user confirms or merges it. The assistant never has
 * to invent one.
 */
export async function resolveAccount(
  userId: string,
  input: { account?: string | null; accountName?: string | null; card?: Card | null; externalId?: string | null },
): Promise<ResolvedAccount> {
  const { account, accountName, card } = input;
  const accounts = await loadAccounts(userId);
  const found = (row: AccountRow, cardId: string | null = null): ResolvedAccount => ({
    accountIdentifier: row.accountIdentifier,
    accountId: row.accountId,
    card,
    cardId,
    autoCreated: row.autoCreated,
    created: null,
  });
  const byName = (name: string | null | undefined, among: AccountRow[]) => {
    const lower = name?.trim().toLowerCase();
    return lower ? among.find((item) => item.label?.trim().toLowerCase() === lower) : undefined;
  };

  if (account) {
    const wanted = account.trim();
    const match =
      accounts.find((item) => item.accountIdentifier === wanted || item.id === wanted || item.accountId === wanted) ??
      byName(wanted, accounts);
    if (match) return found(match);
    // An account with no statement identifier yet, by id or name.
    const bare = await prisma.financialAccount.findFirst({
      where: { userId, OR: [{ id: wanted }, { name: { equals: wanted, mode: "insensitive" } }] },
      select: { id: true, autoCreated: true },
    });
    if (bare)
      return { accountIdentifier: null, accountId: bare.id, card, cardId: null, autoCreated: bare.autoCreated, created: null };
  }
  if (card?.id || card?.last4) {
    const cards = await prisma.card.findMany({
      where: { userId, ...(card.id ? { id: card.id } : { last4: card.last4 }) },
      select: { id: true, accountId: true, account: { select: { name: true, autoCreated: true } } },
    });
    const pick = (match: (typeof cards)[number]): ResolvedAccount => {
      const row = accounts.find((item) => item.accountId === match.accountId);
      return row
        ? found(row, match.id)
        : {
            accountIdentifier: null,
            accountId: match.accountId,
            card,
            cardId: match.id,
            autoCreated: match.account.autoCreated,
            created: null,
          };
    };
    if (cards.length === 1) return pick(cards[0]);
    if (cards.length > 1) {
      const lower = (accountName ?? account)?.trim().toLowerCase();
      const named = lower ? cards.find((item) => item.account.name.trim().toLowerCase() === lower) : undefined;
      if (named) return pick(named);
      throw new EntryError(400, `Card ${card.last4 ?? card.id} matches more than one account; give the account`, {
        accounts: cards.map((item) => ({ accountId: item.accountId, label: item.account.name })),
      });
    }
  }
  if (card?.last4) {
    const matches = accountsForLast4(accounts, card.last4);
    if (matches.length === 1) return found(matches[0]);
    if (matches.length > 1) {
      const named = byName(accountName, matches) ?? byName(account, matches);
      if (named) return found(named);
      throw new EntryError(400, `Card ${card.last4} matches more than one account; give the account`, {
        accounts: matches.map((item) => ({ accountIdentifier: item.accountIdentifier, label: item.label })),
      });
    }
  }
  if (!account && accountName) {
    const named = byName(accountName, accounts);
    if (named) return found(named);
  }

  // Nothing matched: Fortuna creates the account from what the entry shows.
  const identifier = account?.trim() || (card?.last4 ? `****${card.last4}` : UNASSIGNED_ACCOUNT);
  const label =
    accountName?.trim() ||
    (account ? null : card?.last4 ? `Card ending ${card.last4}` : "Unassigned assistant entries");
  const evidence = card?.last4 ? `card ${card.last4}` : account ? `account "${account.trim()}"` : "no account given";
  const existing = accounts.find((item) => item.accountIdentifier === identifier);
  if (existing) return found(existing);
  // The trigger on account_numbers creates the account and copies the flag.
  const saved = await prisma.accountIdentifier.upsert({
    where: { userId_accountIdentifier: { userId, accountIdentifier: identifier } },
    update: {},
    create: {
      userId,
      accountIdentifier: identifier,
      label,
      autoCreated: true,
      autoCreatedFrom: `assistant entry${input.externalId ? ` ${input.externalId}` : ""} (${evidence})`,
    },
    select: { id: true, accountIdentifier: true, label: true, autoCreated: true, accountId: true },
  });
  let cardId: string | null = null;
  if (card?.last4 && /^[0-9]{4}$/.test(card.last4) && saved.accountId) {
    await prisma.financialAccount.update({ where: { id: saved.accountId }, data: { type: "credit_card" } });
    cardId = (
      await prisma.card.upsert({
        where: { accountId_last4: { accountId: saved.accountId, last4: card.last4 } },
        update: {},
        create: { userId, accountId: saved.accountId, last4: card.last4 },
        select: { id: true },
      })
    ).id;
  }
  return {
    accountIdentifier: saved.accountIdentifier,
    accountId: saved.accountId,
    card,
    cardId,
    autoCreated: saved.autoCreated,
    created: saved,
  };
}

/** Where entries go when the assistant gives neither an account nor a card. */
export const UNASSIGNED_ACCOUNT = "Assistant: no account";

/** A category by id or name (case-insensitive); none means Uncategorized. */
export async function resolveCategory(userId: string, category: string) {
  const wanted = category.trim();
  const categories = await prisma.category.findMany({
    where: { userId },
    select: { id: true, name: true },
  });
  const match =
    categories.find((item) => item.id === wanted) ??
    categories.find((item) => item.name.toLowerCase() === wanted.toLowerCase());
  if (!match)
    throw new EntryError(400, `Unknown category "${wanted}"`, {
      categories: categories.map((item) => item.name).sort(),
    });
  return match;
}

/** The assistant's suggested category, when it names one of the user's categories. */
async function suggestedCategoryMatch(userId: string, suggestion: string | null | undefined) {
  if (!suggestion) return null;
  try {
    return await resolveCategory(userId, suggestion);
  } catch (error) {
    if (error instanceof EntryError) return null;
    throw error;
  }
}

type EntryFacts = {
  date: Date;
  description: string;
  label: string | null;
  amountIn: number | null;
  amountOut: number | null;
  accountIdentifier: string;
  suggestedCategory: string | null | undefined;
};

/**
 * Fortuna's classification of an entry: its import rules and auto-categorization
 * first (as for statement rows), the assistant's suggestion only when none of
 * them chose a category, Uncategorized otherwise.
 */
async function classifyEntry(userId: string, entry: EntryFacts) {
  const [row] = await classifyRows(userId, undefined, [
    {
      date: entry.date.toISOString().slice(0, 10),
      description: entry.description,
      label: entry.label || undefined,
      amountIn: entry.amountIn ?? undefined,
      amountOut: entry.amountOut ?? undefined,
      accountIdentifier: entry.accountIdentifier,
      metadata: { accountIdentifier: entry.accountIdentifier },
    },
  ]);
  const reserved = await TransactionService.ensureReservedCategories(userId);
  const warnings: string[] = [];
  let categoryId: string | undefined = row.categoryId || undefined;
  let linkage: Record<string, unknown> | null = null;
  const ruleLinkage = row.linkage?.type as string | undefined;
  const reason = typeof row.linkage?.detectionReason === "string" ? row.linkage.detectionReason : "Matched a rule";
  if (ruleLinkage === "internal") {
    categoryId = reserved.internal.id;
    linkage = { type: "internal", autoDetected: true, detectionReason: reason };
  } else if (ruleLinkage === "reimbursement" && (entry.amountIn ?? 0) > 0) {
    categoryId = reserved.reimbursement.id;
    linkage = { type: "reimbursement", leftoverCategoryId: null, autoDetected: true, detectionReason: reason };
  } else if (categoryId === reserved.reimbursement.id) {
    categoryId = undefined;
  }

  let usedSuggestion = false;
  if (!categoryId && entry.suggestedCategory) {
    const match = await suggestedCategoryMatch(userId, entry.suggestedCategory);
    if (!match) warnings.push(`Unknown category "${entry.suggestedCategory}"; the entry stays Uncategorized`);
    else if (match.name === RESERVED.reimbursement && !((entry.amountIn ?? 0) > 0))
      warnings.push("Only money in can be a Reimbursement; the entry stays Uncategorized");
    else {
      categoryId = match.id;
      linkage = linkageFor(match.name, entry.amountIn);
      usedSuggestion = true;
    }
  }
  const decision = classificationDecision(
    { label: entry.label },
    { ...row, categoryId: categoryId && !usedSuggestion ? categoryId : undefined, linkage: usedSuggestion ? null : row.linkage },
    { suggestedCategory: entry.suggestedCategory, usedSuggestion },
  );
  return {
    categoryId: categoryId || reserved.uncategorized.id,
    linkage,
    label: (row.label as string | undefined) || entry.label || null,
    decision,
    warnings,
  };
}

/** Linkage that matches a reserved category, the way imports set it. */
export function linkageFor(categoryName: string, amountIn: number | null | undefined) {
  if (categoryName === RESERVED.internal)
    return { type: "internal" as const, autoDetected: false, detectionReason: "Set by the assistant" };
  if (categoryName === RESERVED.reimbursement) {
    if (!amountIn || amountIn <= 0)
      throw new EntryError(400, "Only money in can be a Reimbursement");
    return { type: "reimbursement" as const, leftoverCategoryId: null, autoDetected: false };
  }
  return null;
}

function entryMetadata(
  previous: unknown,
  parts: { time?: string | null; occurredAt?: string | null } | null,
  card: Card | null | undefined,
  assistant: Record<string, unknown> | null | undefined,
  classification?: ClassificationDecision,
) {
  const next: Record<string, unknown> = { ...record(previous) };
  if (classification) next.classification = classification;
  if (parts) {
    if (parts.time) next.time = parts.time;
    else delete next.time;
    if (parts.occurredAt) next.occurredAt = parts.occurredAt;
    else delete next.occurredAt;
  }
  if (card !== undefined) {
    if (card) next.card = { ...(card.id ? { id: card.id } : {}), ...(card.last4 ? { last4: card.last4 } : {}) };
    else delete next.card;
  }
  if (assistant !== undefined) {
    if (assistant) next.assistant = assistant;
    else delete next.assistant;
  }
  return next as Prisma.InputJsonValue;
}

const money = (value: Prisma.Decimal | null) => (value == null ? null : Number(value));

export function publicEntry(transaction: Stored) {
  const metadata = record(transaction.metadata);
  return {
    id: transaction.id,
    externalId: transaction.externalId,
    date: transaction.date.toISOString().slice(0, 10),
    time: typeof metadata.time === "string" ? metadata.time : null,
    description: transaction.description,
    label: transaction.label,
    amountIn: money(transaction.amountIn),
    amountOut: money(transaction.amountOut),
    currency: transaction.currency,
    category: transaction.category ? { id: transaction.category.id, name: transaction.category.name } : null,
    account: transaction.accountIdentifier,
    card: metadata.card ?? null,
    entrySource: transaction.entrySource,
    reconciled: transaction.reconciled,
    reconciledAt: transaction.reconciledAt,
    reviewStatus: transaction.reviewStatus,
    reviewReasons: transaction.reviewReasons,
    reviewedAt: transaction.reviewedAt,
    classification: metadata.classification ?? null,
    metadata: metadata.assistant ?? null,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
  };
}

async function possibleDuplicates(userId: string, transaction: Stored) {
  const matches = await DuplicateDetector.findDuplicates(userId, {
    date: transaction.date,
    description: transaction.description,
    amountIn: money(transaction.amountIn),
    amountOut: money(transaction.amountOut),
    accountIdentifier: transaction.accountIdentifier,
    source: transaction.source,
    metadata: transaction.metadata,
  });
  return matches
    .filter((match) => match.transaction.id !== transaction.id)
    .map((match) => ({
      id: match.transaction.id,
      date: (match.transaction.date as Date).toISOString().slice(0, 10),
      description: match.transaction.description,
      label: match.transaction.label,
      amountIn: money(match.transaction.amountIn),
      amountOut: money(match.transaction.amountOut),
      account: match.transaction.accountIdentifier,
      entrySource: match.transaction.entrySource,
      reconciled: match.transaction.reconciled,
      matchScore: match.matchScore,
      matchReasons: match.matchReasons,
    }));
}

export async function audit(
  userId: string,
  actor: EntryActor,
  toolName: string,
  targetId: string,
  values: { beforeValue?: unknown; afterValue?: unknown },
) {
  await prisma.agentAuditEvent.create({
    data: {
      userId,
      ...actor,
      toolName,
      targetType: "transaction",
      targetId,
      ...(values.beforeValue !== undefined ? { beforeValue: values.beforeValue as Prisma.InputJsonValue } : {}),
      ...(values.afterValue !== undefined ? { afterValue: values.afterValue as Prisma.InputJsonValue } : {}),
    },
  });
}

async function load(userId: string, id: string) {
  return prisma.transaction.findFirst({ where: { id, userId }, include: { category: true } });
}

/** An assistant entry by Fortuna id or by external id. Others can't be changed here. */
export async function findEntry(userId: string, ref: { id?: string; externalId?: string }) {
  const found = ref.id
    ? await load(userId, ref.id)
    : await prisma.transaction.findFirst({
        where: { userId, externalId: ref.externalId },
        include: { category: true },
      });
  if (!found) throw new EntryError(404, "Transaction not found");
  return found;
}

/**
 * Sets the entry's review reasons from its classification, its account and the
 * possible duplicates found for it, and builds the write response.
 */
async function withReview(
  userId: string,
  transaction: Stored,
  facts: {
    decision: Pick<ClassificationDecision, "decidedBy"> | undefined;
    accountAutoCreated: boolean;
    accountCreated: { id: string; accountIdentifier: string; label: string | null } | null;
    warnings: string[];
  },
) {
  const duplicates = await possibleDuplicates(userId, transaction);
  const reasons: ReviewReason[] = reviewReasonsFor({
    decision: facts.decision ?? { decidedBy: "correction" },
    accountAutoCreated: facts.accountAutoCreated,
    possibleDuplicates: duplicates.length,
  });
  const saved = await prisma.transaction.update({
    where: { id: transaction.id },
    data: { reviewReasons: reasons },
    include: { category: true },
  });
  return {
    transaction: publicEntry(saved),
    possibleDuplicates: duplicates,
    ...(facts.accountCreated
      ? {
          accountCreated: {
            id: facts.accountCreated.id,
            accountIdentifier: facts.accountCreated.accountIdentifier,
            label: facts.accountCreated.label,
            autoCreated: true,
          },
        }
      : {}),
    ...(facts.warnings.length ? { warnings: facts.warnings } : {}),
  };
}

function assertAssistantEntry(transaction: Stored) {
  if (transaction.entrySource !== "assistant")
    throw new EntryError(409, "Only transactions the assistant created can be changed through this API");
}

export const AssistantEntries = {
  /**
   * Creates the entry, or updates it when one with this externalId exists, so a
   * retried request never adds a second row.
   */
  async upsert(userId: string, input: CreateEntryInput, actor: EntryActor) {
    const existing = await prisma.transaction.findFirst({
      where: { userId, externalId: input.externalId },
      select: { id: true },
    });
    if (existing) {
      const { externalId: _externalId, ...changes } = input;
      return { created: false, ...(await AssistantEntries.update(userId, { id: existing.id }, changes, actor)) };
    }
    try {
      return { created: true, ...(await AssistantEntries.create(userId, input, actor)) };
    } catch (error) {
      // Two requests with the same externalId raced: the other one created it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const { externalId, ...changes } = input;
        return { created: false, ...(await AssistantEntries.update(userId, { externalId }, changes, actor)) };
      }
      throw error;
    }
  },

  async create(userId: string, input: CreateEntryInput, actor: EntryActor) {
    const parts = entryDateParts(input.date, input.time);
    const account = await resolveAccount(userId, input);
    const settings = await prisma.userSettings.findUnique({ where: { userId }, select: { currency: true } });
    const classified = await classifyEntry(userId, {
      date: parts.date,
      description: input.description,
      label: input.label || null,
      amountIn: input.amountIn ?? null,
      amountOut: input.amountOut ?? null,
      accountIdentifier: account.accountIdentifier ?? "",
      suggestedCategory: input.suggestedCategory,
    });
    const transaction = await runInTransaction(async () => {
      const created = await prisma.transaction.create({
        data: {
          userId,
          externalId: input.externalId,
          entrySource: "assistant",
          reviewStatus: "to_review",
          date: parts.date,
          description: input.description,
          label: classified.label,
          categoryId: classified.categoryId,
          amountIn: input.amountIn ?? null,
          amountOut: input.amountOut ?? null,
          currency: (input.currency || settings?.currency || "SGD").toUpperCase(),
          accountIdentifier: account.accountIdentifier,
          accountId: account.accountId,
          cardId: account.cardId,
          metadata: entryMetadata({}, parts, account.card ?? null, input.metadata ?? null, classified.decision),
          linkage: classified.linkage ? (classified.linkage as Prisma.InputJsonValue) : Prisma.DbNull,
        },
        include: { category: true },
      });
      await audit(userId, actor, "create_transaction", created.id, { afterValue: publicEntry(created) });
      return created;
    });
    return withReview(userId, transaction, {
      decision: classified.decision,
      accountAutoCreated: account.autoCreated,
      accountCreated: account.created,
      warnings: classified.warnings,
    });
  },

  async update(
    userId: string,
    ref: { id?: string; externalId?: string },
    input: UpdateEntryInput,
    actor: EntryActor,
  ) {
    const changed = await runInTransaction(async () => {
      const existing = await findEntry(userId, ref);
      assertAssistantEntry(existing);
      let dateParts: ReturnType<typeof entryDateParts> | null = null;
      if (input.date !== undefined || input.time !== undefined) {
        const parsed = entryDateParts(input.date ?? existing.date.toISOString().slice(0, 10), input.time);
        const previousTime = record(existing.metadata).time;
        // A new date alone keeps the time already recorded; time: null clears it.
        const time =
          input.time === null
            ? null
            : (parsed.time ?? (typeof previousTime === "string" ? previousTime : null));
        dateParts = { ...parsed, time };
      }
      const resolved =
        input.account !== undefined || input.accountName != null || input.card?.last4
          ? await resolveAccount(userId, { ...input, externalId: existing.externalId })
          : null;

      // One amount replaces the other: money out becoming money in clears amountOut.
      const amounts =
        input.amountIn != null
          ? { amountIn: input.amountIn, amountOut: null }
          : input.amountOut != null
            ? { amountIn: null, amountOut: input.amountOut }
            : {};
      const nextAmountIn = "amountIn" in amounts ? (amounts.amountIn ?? null) : money(existing.amountIn);
      const nextAmountOut = "amountOut" in amounts ? (amounts.amountOut ?? null) : money(existing.amountOut);
      const accountIdentifier = resolved?.accountIdentifier ?? existing.accountIdentifier ?? "";

      // Fortuna classifies again when what it classifies on changed, unless a
      // review has corrected the entry: a person's correction stands.
      const previous = record(record(existing.metadata).classification) as Partial<ClassificationDecision>;
      const relevant =
        input.description !== undefined ||
        "amountIn" in amounts ||
        resolved !== null ||
        input.suggestedCategory !== undefined;
      let decision = (previous.decidedBy ? previous : undefined) as ClassificationDecision | undefined;
      let warnings: string[] = [];
      let categoryChange: { categoryId?: string; linkage?: unknown } = {};
      let labelChange: { label?: string | null } =
        input.label !== undefined ? { label: input.label || null } : {};
      if (relevant && previous.decidedBy !== "correction") {
        const currentLabel =
          input.label !== undefined ? input.label || null : previous.labelFromRule ? null : existing.label;
        const classified = await classifyEntry(userId, {
          date: dateParts?.date ?? existing.date,
          description: input.description ?? existing.description,
          label: currentLabel,
          amountIn: nextAmountIn,
          amountOut: nextAmountOut,
          accountIdentifier,
          suggestedCategory:
            input.suggestedCategory !== undefined ? input.suggestedCategory : (previous.suggestedCategory ?? null),
        });
        decision = classified.decision;
        warnings = classified.warnings;
        const existingType = record(existing.linkage).type;
        const reservedBefore = existingType === "internal" || existingType === "reimbursement";
        if (classified.categoryId !== existing.categoryId || (classified.linkage?.type ?? null) !== (reservedBefore ? existingType : null))
          categoryChange = {
            categoryId: classified.categoryId,
            ...(classified.linkage ? { linkage: classified.linkage } : reservedBefore ? { linkage: null } : {}),
          };
        if (classified.label !== existing.label) labelChange = { label: classified.label };
      }

      await TransactionService.updateTransaction(existing.id, userId, {
        ...(dateParts ? { date: dateParts.date } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(labelChange as { label?: string }),
        ...(amounts as { amountIn?: number | null; amountOut?: number | null }),
        ...(input.currency ? { currency: input.currency.toUpperCase() } : {}),
        ...(resolved
          ? { accountIdentifier: resolved.accountIdentifier, accountId: resolved.accountId, cardId: resolved.cardId }
          : {}),
        ...(categoryChange as { categoryId?: string; linkage?: null }),
      });
      await prisma.transaction.update({
        where: { id: existing.id },
        data: {
          // A change from the assistant goes back into the queue.
          reviewStatus: "to_review",
          reviewedAt: null,
          metadata: entryMetadata(
            existing.metadata,
            dateParts,
            resolved ? resolved.card : input.card,
            input.metadata,
            decision,
          ),
        },
      });
      const updated = (await load(userId, existing.id))!;
      await audit(userId, actor, "update_transaction", existing.id, {
        beforeValue: publicEntry(existing),
        afterValue: publicEntry(updated),
      });
      const accountAutoCreated =
        resolved?.autoCreated ??
        Boolean(
          updated.accountId &&
            (await prisma.financialAccount.findFirst({
              where: { id: updated.accountId, autoCreated: true },
              select: { id: true },
            })),
        );
      return { updated, decision, warnings, accountAutoCreated, accountCreated: resolved?.created ?? null };
    });
    return withReview(userId, changed.updated, {
      decision: changed.decision,
      accountAutoCreated: changed.accountAutoCreated,
      accountCreated: changed.accountCreated,
      warnings: changed.warnings,
    });
  },

  async remove(userId: string, ref: { id?: string; externalId?: string }, actor: EntryActor) {
    const existing = await findEntry(userId, ref);
    assertAssistantEntry(existing);
    await runInTransaction(async () => {
      await TransactionService.deleteTransaction(existing.id, userId);
      await audit(userId, actor, "delete_transaction", existing.id, { beforeValue: publicEntry(existing) });
    });
    return { deleted: true, id: existing.id, externalId: existing.externalId };
  },
};
