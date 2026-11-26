import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { DuplicateDetector } from "../duplicates/duplicate-detector";
import { runInTransaction } from "../reimbursements/links.service";
import {
  accountsForLast4,
  entryDateParts,
  type CreateEntryInput,
  type UpdateEntryInput,
} from "./assistant-entries";
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

const RESERVED = { internal: "Internal", reimbursement: "Reimbursement" } as const;

/**
 * The account the entry is booked to, and the card it was paid with.
 *
 * Seam for Accounts and Cards (task fortu-6489): today an account is an
 * AccountIdentifier (matched by identifier, id or label) and a card is only
 * recorded in metadata.card; a card's last 4 digits find the account when no
 * account is given. Once Card rows exist, resolve card.id / card.last4 to a
 * Card here, take its account from it, and store the card's id on the row.
 */
async function resolveAccount(userId: string, account: string | null | undefined, card: Card | null | undefined) {
  const accounts = await prisma.accountIdentifier.findMany({
    where: { userId },
    select: { id: true, accountIdentifier: true, label: true },
  });
  const known = accounts.map((item) => item.accountIdentifier);
  if (account) {
    const wanted = account.trim();
    const lower = wanted.toLowerCase();
    const match =
      accounts.find((item) => item.accountIdentifier === wanted || item.id === wanted) ??
      accounts.find((item) => item.label?.trim().toLowerCase() === lower);
    if (!match) throw new EntryError(400, `Unknown account "${wanted}"`, { accounts: known });
    return { accountIdentifier: match.accountIdentifier, card };
  }
  if (card?.last4) {
    const matches = accountsForLast4(accounts, card.last4);
    if (matches.length === 1) return { accountIdentifier: matches[0].accountIdentifier, card };
    throw new EntryError(
      400,
      matches.length
        ? `Card ${card.last4} matches more than one account; give the account`
        : `No account ends in ${card.last4}; give the account`,
      { accounts: known },
    );
  }
  throw new EntryError(400, "account is required", { accounts: known });
}

/** A category by id or name (case-insensitive); none means Uncategorized. */
async function resolveCategory(userId: string, category: string) {
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

/** Linkage that matches a reserved category, the way imports set it. */
function linkageFor(categoryName: string, amountIn: number | null | undefined) {
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
) {
  const next: Record<string, unknown> = { ...record(previous) };
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

async function audit(
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
    const { accountIdentifier, card } = await resolveAccount(userId, input.account, input.card);
    const settings = await prisma.userSettings.findUnique({ where: { userId }, select: { currency: true } });
    const transaction = await runInTransaction(async () => {
      const { uncategorized } = await TransactionService.ensureReservedCategories(userId);
      const category = input.category ? await resolveCategory(userId, input.category) : uncategorized;
      const linkage = linkageFor(category.name, input.amountIn);
      const created = await prisma.transaction.create({
        data: {
          userId,
          externalId: input.externalId,
          entrySource: "assistant",
          date: parts.date,
          description: input.description,
          label: input.label || null,
          categoryId: category.id,
          amountIn: input.amountIn ?? null,
          amountOut: input.amountOut ?? null,
          currency: (input.currency || settings?.currency || "SGD").toUpperCase(),
          accountIdentifier,
          metadata: entryMetadata({}, parts, card ?? null, input.metadata ?? null),
          linkage: linkage ? (linkage as Prisma.InputJsonValue) : Prisma.DbNull,
        },
        include: { category: true },
      });
      await audit(userId, actor, "create_transaction", created.id, { afterValue: publicEntry(created) });
      return created;
    });
    return { transaction: publicEntry(transaction), possibleDuplicates: await possibleDuplicates(userId, transaction) };
  },

  async update(
    userId: string,
    ref: { id?: string; externalId?: string },
    input: UpdateEntryInput,
    actor: EntryActor,
  ) {
    const transaction = await runInTransaction(async () => {
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
        input.account !== undefined || input.card?.last4
          ? await resolveAccount(userId, input.account, input.card)
          : null;

      // One amount replaces the other: money out becoming money in clears amountOut.
      const amounts =
        input.amountIn != null
          ? { amountIn: input.amountIn, amountOut: null }
          : input.amountOut != null
            ? { amountIn: null, amountOut: input.amountOut }
            : {};
      const nextAmountIn =
        "amountIn" in amounts ? amounts.amountIn : money(existing.amountIn);

      let categoryChange: { categoryId?: string; linkage?: unknown } = {};
      if (input.category !== undefined) {
        const { uncategorized } = await TransactionService.ensureReservedCategories(userId);
        const category = input.category ? await resolveCategory(userId, input.category) : uncategorized;
        const linkage = linkageFor(category.name, nextAmountIn);
        categoryChange = { categoryId: category.id, linkage };
      }

      await TransactionService.updateTransaction(existing.id, userId, {
        ...(dateParts ? { date: dateParts.date } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.label !== undefined ? { label: (input.label || null) as string } : {}),
        ...(amounts as { amountIn?: number | null; amountOut?: number | null }),
        ...(input.currency ? { currency: input.currency.toUpperCase() } : {}),
        ...(resolved ? { accountIdentifier: resolved.accountIdentifier } : {}),
        ...(categoryChange as { categoryId?: string; linkage?: null }),
      });
      await prisma.transaction.update({
        where: { id: existing.id },
        data: {
          metadata: entryMetadata(
            existing.metadata,
            dateParts,
            resolved ? resolved.card : input.card,
            input.metadata,
          ),
        },
      });
      const updated = (await load(userId, existing.id))!;
      await audit(userId, actor, "update_transaction", existing.id, {
        beforeValue: publicEntry(existing),
        afterValue: publicEntry(updated),
      });
      return updated;
    });
    return { transaction: publicEntry(transaction), possibleDuplicates: await possibleDuplicates(userId, transaction) };
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
