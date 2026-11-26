import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { addCard, createAccount, runInTransaction as runAccountTransaction } from "../accounts/accounts.service";
import { DuplicateDetector } from "../duplicates/duplicate-detector";
import { autoCategorizeRows } from "../imports/import-enrichment";
import { runInTransaction } from "../reimbursements/links.service";
import {
  accountsForLast4,
  entryDateParts,
  type CreateEntryInput,
  type UpdateEntryInput,
} from "./assistant-entries";
import {
  reviewReasonsFor,
  type AssistantDecision,
  type ClassificationDecision,
  type EntryQuestion,
  type QuestionInput,
  type ReviewReason,
} from "./entry-review";
import {
  assistantQuestions,
  assistantSentDecision,
  decideEntry,
  mergeQuestions,
  question,
  storedQuestions,
  type PatternResult,
  type RuleAmountMiss,
  type RuleResult,
} from "./entry-decision";
import { detectStructural, markCounterpart, type StructuralMatch } from "./structural-detection";
import { TransactionService } from "./transactions.service";
import { parseExternalId, type ParsedExternalId, type SourceRow } from "../sources/sources";
import {
  findChannelCounterpart,
  resolveEntrySource,
  sourceEntry,
  withoutSourceEntry,
  withSourceEntry,
  type ChannelMatch,
} from "./entry-sources.service";
import { reimbursableOf } from "../reimbursements/reimbursables.core";

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
  /** The card or account the entry names isn't one Fortuna knows; a question asks where it belongs. */
  unknown: UnknownAccount | null;
};

/** What an entry said about a card or account Fortuna doesn't know. */
export type UnknownAccount = { last4?: string; identifier?: string; name?: string };

/**
 * The user's statement identifiers as accounts: each with its account's name
 * and review flag (they live on FinancialAccount now).
 */
async function loadAccounts(userId: string): Promise<AccountRow[]> {
  const rows = await prisma.accountIdentifier.findMany({
    where: { userId, accountId: { not: null } },
    select: {
      id: true,
      accountIdentifier: true,
      accountId: true,
      account: { select: { name: true, autoCreated: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    accountIdentifier: row.accountIdentifier,
    label: row.account?.name ?? null,
    autoCreated: row.account?.autoCreated ?? false,
    accountId: row.accountId,
  }));
}

/**
 * An existing account by identifier, identifier id, account id or name
 * (case-insensitive). An account with no statement identifier (one made in
 * Settings with only cards, say) is found by id or name too; its
 * accountIdentifier is then null.
 */
export async function findAccount(
  userId: string,
  ref: string,
): Promise<(Omit<AccountRow, "accountIdentifier"> & { accountIdentifier: string | null }) | null> {
  const accounts = await loadAccounts(userId);
  const wanted = ref.trim();
  const lower = wanted.toLowerCase();
  const byIdentifier =
    accounts.find((item) => item.accountIdentifier === wanted || item.id === wanted) ??
    accounts.find((item) => item.accountId === wanted) ??
    accounts.find((item) => item.label?.trim().toLowerCase() === lower);
  if (byIdentifier) return byIdentifier;
  const account = await prisma.financialAccount.findFirst({
    where: { userId, OR: [{ id: wanted }, { name: { equals: wanted, mode: "insensitive" } }] },
    select: { id: true, name: true, autoCreated: true },
    orderBy: { createdAt: "asc" },
  });
  return account
    ? { id: account.id, accountIdentifier: null, label: account.name, autoCreated: account.autoCreated, accountId: account.id }
    : null;
}

/**
 * The account the entry is booked to, and the card it was paid with.
 *
 * An account the assistant names (identifier, id or name) wins, then the
 * user's card with those last 4 digits (or that card id), then a statement
 * identifier ending in them, each only when exactly one matches. A card or
 * account the entry names that matches nothing is unknown: the entry is
 * booked to no account and a question asks where it belongs (a card under an
 * existing account, a new account, or linking the identifier to one), unless
 * unknown is "create" (then Fortuna creates it, flagged autoCreated, as it
 * used to). Only when the entry names neither does Fortuna fall back to one
 * shared unassigned account it creates itself.
 */
export async function resolveAccount(
  userId: string,
  input: { account?: string | null; accountName?: string | null; card?: Card | null; externalId?: string | null },
  unknown: "ask" | "create" = "ask",
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
    unknown: null,
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
      return { accountIdentifier: null, accountId: bare.id, card, cardId: null, autoCreated: bare.autoCreated, created: null, unknown: null };
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
            unknown: null,
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

  // Something usable that matches nothing: ask where it belongs.
  if (unknown === "ask" && (card?.last4 || account?.trim()))
    return {
      accountIdentifier: null,
      accountId: null,
      card,
      cardId: null,
      autoCreated: false,
      created: null,
      unknown: {
        ...(card?.last4 ? { last4: card.last4 } : {}),
        ...(account?.trim() ? { identifier: account.trim() } : {}),
        ...(accountName?.trim() ? { name: accountName.trim() } : {}),
      },
    };

  // Nothing matched: Fortuna creates the account from what the entry shows.
  const identifier = account?.trim() || (card?.last4 ? `****${card.last4}` : UNASSIGNED_ACCOUNT);
  const label =
    accountName?.trim() ||
    (account ? null : card?.last4 ? `Card ending ${card.last4}` : "Unassigned assistant entries");
  const evidence = card?.last4 ? `card ${card.last4}` : account ? `account "${account.trim()}"` : "no account given";
  const existing = accounts.find((item) => item.accountIdentifier === identifier);
  if (existing) return found(existing);
  let created;
  try {
    created = await runAccountTransaction(async (db) => {
      const account = await createAccount(db, userId, {
        name: label || identifier,
        type: card?.last4 ? "credit_card" : "other",
        color: "#6366f1",
        identifiers: [identifier],
        autoCreated: true,
        autoCreatedFrom: `assistant entry${input.externalId ? ` ${input.externalId}` : ""} (${evidence})`,
      });
      const newCard = card?.last4 && /^[0-9]{4}$/.test(card.last4) ? await addCard(db, userId, account.id, { last4: card.last4 }) : null;
      return { account, cardId: newCard?.id ?? null };
    });
  } catch (error) {
    // Another request created the same identifier first: use that one.
    const raced = (await loadAccounts(userId)).find((item) => item.accountIdentifier === identifier);
    if (raced) return found(raced);
    throw error;
  }
  const row: AccountRow = {
    id: created.account.identifiers[0].id,
    accountIdentifier: identifier,
    label: created.account.name,
    autoCreated: true,
    accountId: created.account.id,
  };
  return {
    accountIdentifier: identifier,
    accountId: created.account.id,
    card,
    cardId: created.cardId,
    autoCreated: true,
    created: row,
    unknown: null,
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

/** The question for a card or account Fortuna doesn't know: add the card, make a new account, or link it. */
export async function accountQuestion(userId: string, unknown: UnknownAccount, now = new Date()): Promise<EntryQuestion> {
  const accounts = await prisma.financialAccount.findMany({
    where: { userId, archived: false, autoCreated: false },
    select: { id: true, name: true, type: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 6,
  });
  const name = unknown.name ? ` “${unknown.name}”` : "";
  if (unknown.last4)
    return question(
      {
        key: `unknown_card:${unknown.last4}`,
        field: "account",
        prompt: `Card ending ${unknown.last4}${unknown.name ? ` (${unknown.name})` : ""} isn't one Fortuna knows. Where does it belong?`,
        options: [
          ...accounts.map((account) => ({ id: `add_card:${account.id}`, label: `Add it to ${account.name}` })),
          { id: "new_account:credit_card", label: `New credit card account${name}` },
          { id: "new_account:savings", label: `New bank account${name}` },
        ],
        source: "unknown_account",
        context: unknown,
      },
      now,
    );
  const identifier = unknown.identifier ?? "";
  return question(
    {
      key: `unknown_account:${identifier.toLowerCase()}`,
      field: "account",
      prompt: `The account “${identifier}” isn't one Fortuna knows. Which account is it?`,
      options: [
        ...accounts.map((account) => ({ id: `link:${account.id}`, label: `Link it to ${account.name}` })),
        { id: "new_account:other", label: `New account “${unknown.name || identifier}”` },
      ],
      source: "unknown_account",
      context: unknown,
    },
    now,
  );
}

type EntryFacts = {
  /** The entry's id when it is saved already (structural pairs never match it). */
  id?: string | null;
  date: Date;
  description: string;
  label: string | null;
  amountIn: number | null;
  amountOut: number | null;
  accountIdentifier: string;
  accountId: string | null;
  cardId: string | null;
  suggestedCategory: string | null | undefined;
  decision: AssistantDecision | null | undefined;
};

/** What the rules did to the entry: the rule that decided it, and rules whose amount range it missed. */
async function ruleStep(userId: string, entry: EntryFacts) {
  await TransactionService.bootstrapDefaultImportRules(userId);
  const [row] = (await TransactionService.applyImportRules(userId, undefined, [
    {
      date: entry.date,
      description: entry.description,
      amountIn: entry.amountIn,
      amountOut: entry.amountOut,
      accountIdentifier: entry.accountIdentifier || null,
      accountId: entry.accountId,
      cardId: entry.cardId,
      metadata: { accountIdentifier: entry.accountIdentifier },
    },
  ])) as Array<Record<string, any>>;
  const metadata = (row.metadata || {}) as Record<string, any>;
  const misses: RuleAmountMiss[] = Array.isArray(metadata.ruleAmountMisses) ? metadata.ruleAmountMisses : [];
  let rule: RuleResult | null = null;
  if (typeof metadata.fixedRuleId === "string") {
    const category = row.categoryId
      ? await prisma.category.findFirst({ where: { id: row.categoryId, userId }, select: { name: true } })
      : null;
    rule = {
      ruleId: metadata.fixedRuleId,
      ruleName: String(metadata.fixedRuleName ?? "a rule"),
      ...(row.categoryId ? { categoryId: row.categoryId, categoryName: category?.name } : {}),
      ...(row.label ? { label: row.label } : {}),
      internal: row.linkage?.type === "internal",
    };
  }
  return { row, rule, misses };
}

/** A learned pattern or history match (only asked when the assistant sent nothing). */
async function patternStep(userId: string, row: Record<string, any>): Promise<PatternResult | null> {
  const { linkage: _linkage, ...rest } = row;
  const [out] = await autoCategorizeRows(userId, undefined, [{ ...rest, linkage: null }]);
  if (!out?.suggestionApplied) return null;
  const source = out.suggestionSource;
  return {
    source: source === "learned_pattern" || source === "history" ? source : "heuristic",
    ...(out.categoryId ? { categoryId: out.categoryId } : {}),
    ...(out.label && out.label !== row.label ? { label: out.label } : {}),
    internal: out.linkage?.type === "internal",
    ...(typeof out.metadata?.classificationPatternId === "string" ? { patternId: out.metadata.classificationPatternId } : {}),
  };
}

/**
 * Fortuna's classification of an assistant entry, in this order: structural
 * detection, enabled rules, the assistant's decision, and a learned pattern
 * or history match only when the assistant sent nothing (entry-decision.ts).
 */
async function classifyEntry(userId: string, entry: EntryFacts) {
  const reserved = await TransactionService.ensureReservedCategories(userId);
  const warnings: string[] = [];
  const structural = await detectStructural(userId, {
    id: entry.id,
    accountId: entry.accountId,
    date: entry.date,
    description: entry.description,
    amountIn: entry.amountIn,
    amountOut: entry.amountOut,
  });
  const { row, rule, misses } = await ruleStep(userId, entry);

  const decision = entry.decision ?? null;
  const wanted = decision?.category || entry.suggestedCategory || null;
  let category: { id: string; name: string } | null = null;
  if (wanted) {
    const match = await suggestedCategoryMatch(userId, wanted);
    if (!match) warnings.push(`Unknown category "${wanted}"; the entry stays Uncategorized`);
    else if (match.name === RESERVED.reimbursement && !((entry.amountIn ?? 0) > 0))
      warnings.push("Only money in can be a Reimbursement; the entry stays Uncategorized");
    else category = match;
  }
  const assistant = { decision, suggestedCategory: entry.suggestedCategory ?? null, category };
  const pattern =
    !structural?.internal && !(rule && (rule.internal || rule.categoryId)) && !assistantSentDecision(assistant)
      ? await patternStep(userId, row)
      : null;
  const decided = decideEntry(
    { amountIn: entry.amountIn, amountOut: entry.amountOut, label: entry.label },
    { structural, rule, ruleAmountMisses: misses, assistant, pattern },
    reserved,
  );
  return { ...decided, structural, warnings };
}

type Classified = Awaited<ReturnType<typeof classifyEntry>>;

/** The rule that decided (or labelled) the entry counts a hit. */
async function recordRuleHit(userId: string, decision: ClassificationDecision, previousRuleId?: string) {
  if (!decision.ruleId || decision.ruleId === previousRuleId) return;
  await prisma.importRule.updateMany({
    where: { id: decision.ruleId, userId },
    data: { hitCount: { increment: 1 }, lastHitAt: new Date() },
  });
}

/** After saving: the other side of a structural pair, and the rule's hit. */
async function afterClassified(userId: string, entryId: string, classified: Classified, previousRuleId?: string) {
  if (classified.structural?.counterpartId) {
    const reserved = await TransactionService.ensureReservedCategories(userId);
    await markCounterpart(userId, classified.structural as StructuralMatch, entryId, reserved.internal.id);
  }
  await recordRuleHit(userId, classified.decision, previousRuleId);
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
  decided?: { merchant: string | null; transactionType: string | null },
) {
  const next: Record<string, unknown> = { ...record(previous) };
  if (classification) next.classification = classification;
  if (decided) {
    if (decided.merchant) next.merchant = decided.merchant;
    if (decided.transactionType) next.transactionType = decided.transactionType;
    else delete next.transactionType;
  }
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
    category: transaction.category
      ? {
          id: transaction.category.id,
          name: transaction.category.name,
          color: transaction.category.color,
          icon: transaction.category.icon ?? null,
        }
      : null,
    account: transaction.accountIdentifier,
    accountId: transaction.accountId,
    cardId: transaction.cardId,
    imageId: transaction.imageId,
    card: metadata.card ?? null,
    entrySource: transaction.entrySource,
    reconciled: transaction.reconciled,
    reconciledAt: transaction.reconciledAt,
    reviewStatus: transaction.reviewStatus,
    reviewReasons: transaction.reviewReasons,
    reviewedAt: transaction.reviewedAt,
    /** Which step decided (decidedBy) and with what; the assistant's own decision is in classification.assistant. */
    classification: metadata.classification ?? null,
    /** The assistant's decision as it sent it: category, type, label, merchant, reason, confidence, precedentIds. */
    decision: record(metadata.classification).assistant ?? null,
    merchant: typeof metadata.merchant === "string" ? metadata.merchant : null,
    transactionType: typeof metadata.transactionType === "string" ? metadata.transactionType : null,
    /** Open questions for the review; answer them with /review/questions/answer. */
    questions: storedQuestions(transaction.questions),
    /** The messages behind it (metadata.sources): the primary one, and backups merged into it. */
    sources: Array.isArray(metadata.sources) ? metadata.sources : [],
    metadata: metadata.assistant ?? null,
    /** Paid for someone who pays it back: who, and what they owe (null when it isn't). */
    reimbursable: reimbursableOf(
      transaction,
      (transaction as { reimbursablePerson?: { id: string; name: string } | null }).reimbursablePerson,
    ),
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

/**
 * An assistant entry by Fortuna id or by external id: its own, or one of a
 * backup channel's messages merged into it. Others can't be changed here.
 */
export async function findEntry(userId: string, ref: { id?: string; externalId?: string }) {
  const found = ref.id
    ? await load(userId, ref.id)
    : await prisma.transaction.findFirst({
        where: {
          userId,
          OR: [{ externalId: ref.externalId }, { sourceReports: { some: { userId, externalId: ref.externalId } } }],
        },
        include: { category: true },
      });
  if (!found) throw new EntryError(404, "Transaction not found");
  return found;
}

/**
 * Sets the entry's review reasons from its classification, its account, its
 * open questions and the possible duplicates found for it, and builds the
 * write response.
 */
async function withReview(
  userId: string,
  transaction: Stored,
  facts: {
    decision: (Pick<ClassificationDecision, "decidedBy"> & { assistant?: AssistantDecision | null }) | undefined;
    accountAutoCreated: boolean;
    accountCreated: { id: string; accountIdentifier: string; label: string | null } | null;
    warnings: string[];
    keepReasons?: ReviewReason[];
  },
) {
  const duplicates = await possibleDuplicates(userId, transaction);
  const questions = storedQuestions(transaction.questions);
  const reasons: ReviewReason[] = reviewReasonsFor({
    decision: facts.decision ?? { decidedBy: "correction" },
    accountAutoCreated: facts.accountAutoCreated,
    accountUnknown: questions.some((item) => item.source === "unknown_account"),
    possibleDuplicates: duplicates.length,
    questions: questions.length,
  });
  for (const reason of facts.keepReasons ?? []) if (!reasons.includes(reason)) reasons.push(reason);
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

/** What a message said, kept on its report (a merged backup's message changes nothing else). */
function reportFacts(input: CreateEntryInput) {
  return {
    date: input.date,
    ...(input.time ? { time: input.time } : {}),
    description: input.description,
    amountIn: input.amountIn ?? null,
    amountOut: input.amountOut ?? null,
    ...(input.currency ? { currency: input.currency } : {}),
    ...(input.card ? { card: input.card } : {}),
    ...(input.sender ? { sender: input.sender } : {}),
    ...(input.metadata ? { evidence: input.metadata } : {}),
  } as Prisma.InputJsonValue;
}

type WriteResult = Awaited<ReturnType<typeof withReview>>;
export type UpsertResult =
  | ({ created: boolean; merged?: { into: string; as: string; matchScore?: number; matchReasons?: string[] } } & WriteResult)
  | {
      created: false;
      merged: { into: string; as: string };
      transaction: ReturnType<typeof publicEntry>;
      possibleDuplicates: never[];
    }
  | { created: false; skipped: "deleted"; message: string; transaction: null; possibleDuplicates: never[] };

/**
 * Two channels of one card reported the same purchase. A backup's message is
 * recorded on the main channel's entry and changes nothing else. A main
 * channel's message takes over the entry its backup created: the entry gets
 * the main message's externalId and facts, and the backup's message stays
 * linked to it.
 */
async function mergeChannels(
  userId: string,
  input: CreateEntryInput,
  parsed: ParsedExternalId,
  source: SourceRow,
  match: ChannelMatch,
  actor: EntryActor,
  warnings: string[],
): Promise<UpsertResult> {
  const target = match.transaction;
  const merged = { into: target.id, as: source.channel, matchScore: match.matchScore, matchReasons: match.matchReasons };
  const report = {
    userId,
    transactionId: target.id,
    sourceId: source.id,
    externalId: input.externalId,
    kind: parsed.kind,
    channel: source.channel,
    facts: reportFacts(input),
  };
  if (match.existing === "main") {
    const updated = await runInTransaction(async () => {
      await prisma.transactionSourceReport.create({ data: { ...report, primary: false } });
      const saved = await prisma.transaction.update({
        where: { id: target.id },
        data: { metadata: withSourceEntry(target.metadata, sourceEntry(input.externalId, parsed.kind, source, false)) },
        include: { category: true },
      });
      await audit(userId, actor, "merge_transaction_report", target.id, {
        afterValue: { externalId: input.externalId, sourceId: source.id, channel: source.channel, matchScore: match.matchScore },
      });
      return saved;
    });
    return {
      created: false,
      merged,
      transaction: publicEntry(updated),
      possibleDuplicates: [],
      ...(warnings.length ? { warnings } : {}),
    } as UpsertResult;
  }
  await runInTransaction(async () => {
    await prisma.transactionSourceReport.updateMany({ where: { userId, transactionId: target.id }, data: { primary: false } });
    await prisma.transactionSourceReport.create({ data: { ...report, primary: true } });
    await prisma.transaction.update({
      where: { id: target.id },
      data: {
        externalId: input.externalId,
        metadata: withSourceEntry(target.metadata, sourceEntry(input.externalId, parsed.kind, source, true)),
      },
    });
    await audit(userId, actor, "merge_transaction_report", target.id, {
      beforeValue: { externalId: target.externalId },
      afterValue: { externalId: input.externalId, sourceId: source.id, channel: source.channel, matchScore: match.matchScore },
    });
  });
  const { externalId: _externalId, sourceId: _sourceId, sender: _sender, ...changes } = input;
  const result = await AssistantEntries.update(userId, { id: target.id }, changes, actor);
  return {
    created: false,
    merged,
    ...result,
    ...(warnings.length || result.warnings ? { warnings: [...warnings, ...(result.warnings ?? [])] } : {}),
  };
}

export const AssistantEntries = {
  /**
   * Creates the entry, or updates it when one with this externalId exists, so a
   * retried request or a re-read message never adds a second row. A message
   * from a card's backup channel about a purchase its main channel already
   * reported is merged into that entry instead (and a main channel's message
   * takes over an entry only its backup had reported). An entry that was
   * deleted stays deleted when its message comes again.
   */
  async upsert(userId: string, input: CreateEntryInput, actor: EntryActor, retried = false): Promise<UpsertResult> {
    const { externalId } = input;
    const report = await prisma.transactionSourceReport.findUnique({
      where: { userId_externalId: { userId, externalId } },
      include: { transaction: { select: { id: true, externalId: true } } },
    });
    if (report && !report.transaction)
      return {
        created: false,
        skipped: "deleted",
        message: "The transaction from this message was deleted; it isn't added again",
        transaction: null,
        possibleDuplicates: [],
      };
    if (report?.transaction && report.transaction.externalId !== externalId) {
      // A backup's message merged into another entry: keep what it said, leave the entry alone.
      await prisma.transactionSourceReport.update({ where: { id: report.id }, data: { facts: reportFacts(input) } });
      const transaction = (await load(userId, report.transaction.id))!;
      return {
        created: false,
        merged: { into: transaction.id, as: report.channel ?? "backup" },
        transaction: publicEntry(transaction),
        possibleDuplicates: [],
      };
    }
    const existing =
      report?.transaction ??
      (await prisma.transaction.findFirst({ where: { userId, externalId }, select: { id: true, externalId: true } }));
    if (existing) {
      const { externalId: _externalId, sourceId: _sourceId, sender: _sender, ...changes } = input;
      const result = await AssistantEntries.update(userId, { id: existing.id }, changes, actor);
      if (report) await prisma.transactionSourceReport.update({ where: { id: report.id }, data: { facts: reportFacts(input) } });
      else
        await prisma.transactionSourceReport.create({
          data: { userId, transactionId: existing.id, externalId, kind: parseExternalId(externalId).kind, primary: true, facts: reportFacts(input) },
        });
      return { created: false, ...result };
    }
    try {
      return await AssistantEntries.create(userId, input, actor);
    } catch (error) {
      // Two requests with the same externalId raced: the other one saved it.
      if (!retried && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return AssistantEntries.upsert(userId, input, actor, true);
      throw error;
    }
  },

  /**
   * A new message. Finds its source, books the account (the source's card or
   * account when the message names none), then merges it with the other
   * channel's report of the same purchase, or adds the entry.
   */
  async create(userId: string, input: CreateEntryInput, actor: EntryActor): Promise<UpsertResult> {
    const parts = entryDateParts(input.date, input.time);
    const parsed = parseExternalId(input.externalId);
    const sourced = await resolveEntrySource(userId, input, parsed);
    if (sourced.error) throw new EntryError(sourced.error.status, sourced.error.message);
    const source = sourced.source;
    const namesAccount = Boolean(input.account || input.accountName || input.card);
    const account = await resolveAccount(
      userId,
      !namesAccount && source
        ? { ...input, ...(source.cardId ? { card: { id: source.cardId } } : { account: source.accountId }) }
        : input,
    );
    if (source) {
      const counterpart = await findChannelCounterpart(userId, source, {
        accountId: account.accountId,
        cardId: account.cardId,
        date: parts.date,
        time: parts.time,
        description: input.description,
        amountIn: input.amountIn ?? null,
        amountOut: input.amountOut ?? null,
      });
      if (counterpart) return mergeChannels(userId, input, parsed, source, counterpart, actor, sourced.warnings);
    }
    const settings = await prisma.userSettings.findUnique({ where: { userId }, select: { currency: true } });
    const classified = await classifyEntry(userId, {
      date: parts.date,
      description: input.description,
      label: input.label || null,
      amountIn: input.amountIn ?? null,
      amountOut: input.amountOut ?? null,
      accountIdentifier: account.accountIdentifier ?? "",
      accountId: account.accountId,
      cardId: account.cardId,
      suggestedCategory: input.suggestedCategory,
      decision: input.decision,
    });
    const now = new Date();
    const questions = mergeQuestions([], {
      system: classified.questions,
      assistant: assistantQuestions((input.questions ?? []) as QuestionInput[], now),
      account: account.unknown ? await accountQuestion(userId, account.unknown, now) : null,
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
          questions: questions as unknown as Prisma.InputJsonValue,
          metadata: withSourceEntry(
            entryMetadata({}, parts, account.card ?? null, input.metadata ?? null, classified.decision, classified),
            sourceEntry(input.externalId, parsed.kind, source, true),
          ),
          linkage: classified.linkage ? (classified.linkage as Prisma.InputJsonValue) : Prisma.DbNull,
        },
        include: { category: true },
      });
      await prisma.transactionSourceReport.create({
        data: {
          userId,
          transactionId: created.id,
          sourceId: source?.id ?? null,
          externalId: input.externalId,
          kind: parsed.kind,
          channel: source?.channel ?? null,
          primary: true,
          facts: reportFacts(input),
        },
      });
      await audit(userId, actor, "create_transaction", created.id, { afterValue: publicEntry(created) });
      return created;
    });
    await afterClassified(userId, transaction.id, classified);
    return {
      created: true,
      ...(await withReview(userId, transaction, {
        decision: classified.decision,
        accountAutoCreated: account.autoCreated,
        accountCreated: account.created,
        warnings: [...sourced.warnings, ...classified.warnings],
      })),
    };
  },

  async update(
    userId: string,
    ref: { id?: string; externalId?: string },
    input: UpdateEntryInput,
    actor: EntryActor,
    options: { reclassify?: boolean; keepReasons?: ReviewReason[]; auditAs?: string } = {},
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
      const accountIdentifier = resolved ? (resolved.accountIdentifier ?? "") : (existing.accountIdentifier ?? "");

      // Fortuna classifies again when what it classifies on changed, unless a
      // review has corrected the entry: a person's correction stands.
      const previous = record(record(existing.metadata).classification) as Partial<ClassificationDecision>;
      const relevant =
        options.reclassify ||
        input.description !== undefined ||
        "amountIn" in amounts ||
        resolved !== null ||
        input.suggestedCategory !== undefined ||
        input.decision !== undefined;
      let decision = (previous.decidedBy ? previous : undefined) as ClassificationDecision | undefined;
      let warnings: string[] = [];
      let categoryChange: { categoryId?: string; linkage?: unknown } = {};
      let labelChange: { label?: string | null } =
        input.label !== undefined ? { label: input.label || null } : {};
      let classified: Classified | null = null;
      const now = new Date();
      const previousQuestions = storedQuestions(existing.questions);
      let systemQuestions = previousQuestions.filter((item) => item.source === "rule_conflict" || item.source === "amount_range");
      if (relevant && previous.decidedBy !== "correction") {
        const currentLabel =
          input.label !== undefined ? input.label || null : previous.labelFromRule ? null : existing.label;
        classified = await classifyEntry(userId, {
          id: existing.id,
          date: dateParts?.date ?? existing.date,
          description: input.description ?? existing.description,
          label: currentLabel,
          amountIn: nextAmountIn,
          amountOut: nextAmountOut,
          accountIdentifier,
          accountId: resolved ? resolved.accountId : existing.accountId,
          cardId: resolved ? resolved.cardId : existing.cardId,
          suggestedCategory:
            input.suggestedCategory !== undefined ? input.suggestedCategory : (previous.suggestedCategory ?? null),
          decision: input.decision !== undefined ? input.decision : (previous.assistant ?? null),
        });
        decision = classified.decision;
        warnings = classified.warnings;
        systemQuestions = classified.questions;
        const existingType = record(existing.linkage).type;
        const reservedBefore = existingType === "internal" || existingType === "reimbursement";
        if (classified.categoryId !== existing.categoryId || (classified.linkage?.type ?? null) !== (reservedBefore ? existingType : null))
          categoryChange = {
            categoryId: classified.categoryId,
            ...(classified.linkage ? { linkage: classified.linkage } : reservedBefore ? { linkage: null } : {}),
          };
        if (classified.label !== existing.label) labelChange = { label: classified.label };
      }
      const questions = mergeQuestions(previousQuestions, {
        system: systemQuestions,
        ...(input.questions !== undefined ? { assistant: assistantQuestions((input.questions ?? []) as QuestionInput[], now) } : {}),
        ...(resolved ? { account: resolved.unknown ? await accountQuestion(userId, resolved.unknown, now) : null } : {}),
      });

      await TransactionService.updateTransaction(existing.id, userId, {
        ...(dateParts ? { date: dateParts.date } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(labelChange as { label?: string }),
        ...(amounts as { amountIn?: number | null; amountOut?: number | null }),
        ...(input.currency ? { currency: input.currency.toUpperCase() } : {}),
        ...(resolved
          ? resolved.accountIdentifier
            ? { accountIdentifier: resolved.accountIdentifier, accountId: resolved.accountId, cardId: resolved.cardId }
            : { accountIdentifier: null, accountId: resolved.accountId, cardId: resolved.cardId }
          : {}),
        ...(categoryChange as { categoryId?: string; linkage?: null }),
      } as never);
      await prisma.transaction.update({
        where: { id: existing.id },
        data: {
          // A change from the assistant goes back into the queue.
          reviewStatus: "to_review",
          reviewedAt: null,
          questions: questions as unknown as Prisma.InputJsonValue,
          metadata: entryMetadata(
            existing.metadata,
            dateParts,
            resolved ? resolved.card : input.card,
            input.metadata,
            decision,
            classified ?? undefined,
          ),
        },
      });
      const updated = (await load(userId, existing.id))!;
      await audit(userId, actor, options.auditAs ?? "update_transaction", existing.id, {
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
      return {
        updated,
        decision,
        warnings,
        accountAutoCreated,
        accountCreated: resolved?.created ?? null,
        classified,
        previousRuleId: previous.ruleId,
      };
    });
    if (changed.classified) await afterClassified(userId, changed.updated.id, changed.classified, changed.previousRuleId);
    return withReview(userId, changed.updated, {
      decision: changed.decision,
      accountAutoCreated: changed.accountAutoCreated,
      accountCreated: changed.accountCreated,
      warnings: changed.warnings,
      keepReasons: options.keepReasons,
    });
  },

  /**
   * Classifies an assistant entry again from what it already holds (its
   * facts and the assistant's stored decision), e.g. after the rule that
   * decided it was undone or its account was settled. A corrected entry keeps
   * its correction. The entry goes back into the queue.
   */
  async reclassify(userId: string, id: string, actor: EntryActor, keepReasons: ReviewReason[] = []) {
    return AssistantEntries.update(userId, { id }, {}, actor, { reclassify: true, keepReasons, auditAs: "reclassify_transaction" });
  },

  /**
   * Deletes the entry. By the externalId of a backup's message merged into it,
   * only that message is unlinked: the entry is the main channel's.
   */
  async remove(userId: string, ref: { id?: string; externalId?: string }, actor: EntryActor) {
    const existing = await findEntry(userId, ref);
    assertAssistantEntry(existing);
    if (ref.externalId && existing.externalId !== ref.externalId) {
      await runInTransaction(async () => {
        await prisma.transactionSourceReport.delete({ where: { userId_externalId: { userId, externalId: ref.externalId! } } });
        await prisma.transaction.update({
          where: { id: existing.id },
          data: { metadata: withoutSourceEntry(existing.metadata, ref.externalId!) },
        });
        await audit(userId, actor, "unlink_transaction_report", existing.id, { beforeValue: { externalId: ref.externalId } });
      });
      return { deleted: false, unlinked: true, id: existing.id, externalId: ref.externalId };
    }
    await runInTransaction(async () => {
      await TransactionService.deleteTransaction(existing.id, userId);
      await audit(userId, actor, "delete_transaction", existing.id, { beforeValue: publicEntry(existing) });
    });
    return { deleted: true, id: existing.id, externalId: existing.externalId };
  },
};
