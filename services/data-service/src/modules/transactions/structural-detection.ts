import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { identifierDigits } from "./assistant-entries";
import type { StructuralResult } from "./entry-decision";

/**
 * Structural detection for entries without a parser (assistant entries):
 * money moving between two of the user's own accounts is Internal, decided in
 * code before any rule or AI.
 *
 * - PayLah ↔ bank: a top-up, max-out or send-back moves money between the
 *   PayLah wallet and a bank account (DBS Multiplier). The bank side's alert
 *   names PayLah; the wallet side is either its own leg ("top up wallet from
 *   my account", "send money to my account") or the real transaction the
 *   transfer paid for (a payment funded by an auto top-up, money received
 *   that maxed the wallet out). Pairs match by amount within PAYLAH_WINDOW
 *   days across the two accounts. Legs are Internal; the PayLah payment or
 *   receipt itself stays the real transaction.
 * - Card bill payment: money out of a bank account to a credit card account
 *   Fortuna knows (the alert names the card), and that card account's
 *   payment received, match by amount within BILL_WINDOW days. Both sides are
 *   Internal.
 *
 * Detection is symmetric: whichever side arrives second finds the first, and
 * the first side (an assistant entry no review has corrected) is updated too.
 */

export const PAYLAH_WINDOW = 2;
export const BILL_WINDOW = 7;

/** A bank alert about moving money to or from the PayLah wallet. */
const BANK_PAYLAH_LEG =
  /(top[\s-]?up|topped[\s-]?up|transfer(?:red)?)\s.{0,30}paylah|max(?:ed)?[\s-]?out\s.{0,30}paylah|send[\s-]?back\s.{0,30}paylah|paylah\S*\s.{0,40}(top[\s-]?up|max(?:ed)?[\s-]?out|send[\s-]?back)/i;
/** The wallet's own side of a transfer to or from the bank. */
const WALLET_LEG = /top[\s-]?up wallet|wallet top[\s-]?up|from my account|to my account|send(?:ing)?[\s-]?back|max(?:ed)?[\s-]?out/i;
/** Words a bank alert uses for paying a card's bill. */
const BILL_WORDS = /\bbill\b|card payment|credit card|payment to/i;
/** Words a card account uses for a payment it received. */
const PAYMENT_RECEIVED = /payment|thank you|received|giro|credit/i;
/** Words in account names that say nothing about which account it is. */
const GENERIC = new Set(["card", "credit", "debit", "account", "bank", "savings", "current", "the", "and", "visa", "mastercard"]);

type AccountInfo = {
  id: string;
  name: string;
  type: string;
  institution: string | null;
  wallet: boolean;
  last4s: string[];
  nameWords: string[];
};

export type StructuralEntry = {
  /** The entry's own id once saved, so it doesn't pair with itself. */
  id?: string | null;
  accountId: string | null;
  date: Date;
  description: string;
  amountIn: number | null;
  amountOut: number | null;
};

export type StructuralMatch = StructuralResult & {
  /** The other side to mark Internal too (an assistant entry no review corrected). */
  counterpartToMark: { id: string; reason: string } | null;
};

const isWallet = (account: { name: string; institution: string | null }) =>
  /paylah/i.test(`${account.name} ${account.institution ?? ""}`);

async function loadAccounts(userId: string): Promise<AccountInfo[]> {
  const accounts = await prisma.financialAccount.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      type: true,
      institution: true,
      cards: { select: { last4: true } },
      identifiers: { select: { accountIdentifier: true } },
    },
  });
  return accounts.map((account) => {
    const digits = account.identifiers.map((item) => identifierDigits(item.accountIdentifier)).filter((value) => value.length >= 4);
    return {
      id: account.id,
      name: account.name,
      type: account.type,
      institution: account.institution,
      wallet: isWallet(account),
      last4s: [...new Set([...account.cards.map((card) => card.last4), ...digits.map((value) => value.slice(-4))])],
      nameWords: `${account.name} ${account.institution ?? ""}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 3 && !GENERIC.has(word) && !/^\d+$/.test(word)),
    };
  });
}

const amountOf = (entry: { amountIn: number | null; amountOut: number | null }) => entry.amountOut ?? entry.amountIn ?? 0;

function window(date: Date, days: number) {
  const from = new Date(date);
  from.setUTCDate(from.getUTCDate() - days);
  const to = new Date(date);
  to.setUTCDate(to.getUTCDate() + days);
  return { gte: from, lte: to };
}

type Candidate = {
  id: string;
  date: Date;
  description: string;
  accountId: string | null;
  amountIn: Prisma.Decimal | null;
  amountOut: Prisma.Decimal | null;
  entrySource: string;
  metadata: Prisma.JsonValue;
  linkage: Prisma.JsonValue;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Already one side of a detected pair (with another transaction than this one). */
function paired(candidate: Candidate, selfId: string | null | undefined) {
  const metadata = record(candidate.metadata);
  const ids = [
    record(record(candidate.linkage).pair).counterpartId,
    record(metadata.structuralPair).counterpartId,
    record(record(metadata.classification).structural).counterpartId,
  ];
  return ids.some((id) => typeof id === "string" && id !== selfId);
}

/** A counterpart may be changed by detection: an assistant entry no review has corrected. */
function markable(candidate: Candidate) {
  const classification = record(record(candidate.metadata).classification);
  return candidate.entrySource === "assistant" && classification.decidedBy !== "correction";
}

async function candidates(
  userId: string,
  entry: StructuralEntry,
  accountIds: string[],
  days: number,
  direction: "in" | "out" | "any",
) {
  if (!accountIds.length) return [];
  const amount = amountOf(entry);
  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      accountId: { in: accountIds },
      date: window(entry.date, days),
      ...(entry.id ? { id: { not: entry.id } } : {}),
      ...(direction === "in"
        ? { amountIn: amount }
        : direction === "out"
          ? { amountOut: amount }
          : { OR: [{ amountIn: amount }, { amountOut: amount }] }),
    },
    select: {
      id: true,
      date: true,
      description: true,
      accountId: true,
      amountIn: true,
      amountOut: true,
      entrySource: true,
      metadata: true,
      linkage: true,
    },
  });
  // The nearest date first.
  return rows
    .filter((row) => !paired(row, entry.id))
    .sort((a, b) => Math.abs(a.date.getTime() - entry.date.getTime()) - Math.abs(b.date.getTime() - entry.date.getTime()));
}

async function detectPaylah(userId: string, entry: StructuralEntry, account: AccountInfo, accounts: AccountInfo[]) {
  const wallets = accounts.filter((item) => item.wallet).map((item) => item.id);
  const banks = accounts.filter((item) => !item.wallet && item.type !== "credit_card").map((item) => item.id);
  if (!wallets.length) return null;
  if (account.wallet) {
    const ownLeg = WALLET_LEG.test(entry.description);
    const bankSide = (await candidates(userId, entry, banks, PAYLAH_WINDOW, "any")).find((row) =>
      BANK_PAYLAH_LEG.test(row.description),
    );
    if (!bankSide && !ownLeg) return null;
    const reason = ownLeg
      ? "PayLah transfer to or from your bank account"
      : "Paid for by a PayLah transfer from your bank account";
    return {
      kind: "paylah_transfer" as const,
      internal: ownLeg,
      reason,
      counterpartId: bankSide?.id ?? null,
      counterpartToMark:
        bankSide && markable(bankSide)
          ? { id: bankSide.id, reason: "PayLah transfer: the PayLah entry is the real transaction" }
          : null,
    };
  }
  if (account.type === "credit_card" || !BANK_PAYLAH_LEG.test(entry.description)) return null;
  const walletSide = (await candidates(userId, entry, wallets, PAYLAH_WINDOW, "any"))[0];
  return {
    kind: "paylah_transfer" as const,
    internal: true,
    reason: walletSide
      ? WALLET_LEG.test(walletSide.description)
        ? "PayLah transfer to or from your bank account"
        : "PayLah transfer: the PayLah entry is the real transaction"
      : "PayLah transfer to or from your bank account",
    counterpartId: walletSide?.id ?? null,
    counterpartToMark:
      walletSide && WALLET_LEG.test(walletSide.description) && markable(walletSide)
        ? { id: walletSide.id, reason: "PayLah transfer to or from your bank account" }
        : null,
  };
}

/** The card accounts a bank alert's text names, by card digits or a distinctive name word. */
function namedCardAccounts(description: string, cards: AccountInfo[]) {
  const text = description.toLowerCase();
  const digits = description.replace(/\D/g, " ");
  return cards.filter(
    (card) =>
      card.last4s.some((last4) => new RegExp(`(^|\\D)${last4}(\\D|$)`).test(digits)) ||
      card.nameWords.some((word) => new RegExp(`\\b${word}\\b`).test(text)),
  );
}

async function detectBillPayment(userId: string, entry: StructuralEntry, account: AccountInfo, accounts: AccountInfo[]) {
  const cards = accounts.filter((item) => item.type === "credit_card");
  if (!cards.length) return null;
  if (account.type === "credit_card") {
    if (!entry.amountIn || !PAYMENT_RECEIVED.test(entry.description)) return null;
    const banks = accounts.filter((item) => item.type !== "credit_card" && !item.wallet).map((item) => item.id);
    const bankSide = (await candidates(userId, entry, banks, BILL_WINDOW, "out")).find(
      (row) => namedCardAccounts(row.description, cards).some((card) => card.id === account.id) || BILL_WORDS.test(row.description),
    );
    if (!bankSide) return null;
    return {
      kind: "card_bill_payment" as const,
      internal: true,
      reason: "Credit card bill payment from your bank account",
      counterpartId: bankSide.id,
      counterpartToMark: markable(bankSide) ? { id: bankSide.id, reason: `Credit card bill payment to ${account.name}` } : null,
    };
  }
  if (!entry.amountOut || account.wallet) return null;
  const named = namedCardAccounts(entry.description, cards);
  const billWords = BILL_WORDS.test(entry.description);
  if (!named.length && !billWords) return null;
  const pool = named.length ? named : cards;
  const cardSide = (await candidates(userId, entry, pool.map((item) => item.id), BILL_WINDOW, "in")).find((row) =>
    PAYMENT_RECEIVED.test(row.description),
  );
  // The alert names one card account: the payee is known even before its side arrives.
  const target = cardSide ? cards.find((card) => card.id === cardSide.accountId) : named.length === 1 ? named[0] : null;
  if (!target) return null;
  return {
    kind: "card_bill_payment" as const,
    internal: true,
    reason: `Credit card bill payment to ${target.name}`,
    counterpartId: cardSide?.id ?? null,
    counterpartToMark:
      cardSide && markable(cardSide) ? { id: cardSide.id, reason: "Credit card bill payment from your bank account" } : null,
  };
}

/** Structural detection for one entry; null when it isn't one side of a known pair. */
export async function detectStructural(userId: string, entry: StructuralEntry): Promise<StructuralMatch | null> {
  if (!entry.accountId || !(amountOf(entry) > 0)) return null;
  const accounts = await loadAccounts(userId);
  const account = accounts.find((item) => item.id === entry.accountId);
  if (!account) return null;
  return (await detectPaylah(userId, entry, account, accounts)) ?? (await detectBillPayment(userId, entry, account, accounts));
}

/**
 * Marks the other side of a detected pair Internal, pointing back at this
 * entry. Only an assistant entry no review corrected is changed, and it stays
 * in the review queue.
 */
export async function markCounterpart(
  userId: string,
  match: StructuralMatch,
  entryId: string,
  internalCategoryId: string,
  now = new Date(),
) {
  if (match.counterpartId) {
    const other = await prisma.transaction.findFirst({ where: { id: match.counterpartId, userId } });
    if (!other) return;
    const pair = { kind: match.kind, counterpartId: entryId };
    if (!match.counterpartToMark) {
      // The real transaction (or one a person decided or a statement brought): only remember the pair.
      await prisma.transaction.update({
        where: { id: other.id },
        data: { metadata: { ...record(other.metadata), structuralPair: pair } as Prisma.InputJsonValue },
      });
      return;
    }
    const metadata = record(other.metadata);
    const classification = record(metadata.classification);
    await prisma.transaction.update({
      where: { id: other.id },
      data: {
        categoryId: internalCategoryId,
        linkage: { type: "internal", autoDetected: true, detectionReason: match.counterpartToMark.reason, pair } as Prisma.InputJsonValue,
        metadata: {
          ...metadata,
          classification: {
            ...classification,
            decidedBy: "structural",
            structural: { kind: match.kind, counterpartId: entryId, reason: match.counterpartToMark.reason },
            at: now.toISOString(),
          },
        } as Prisma.InputJsonValue,
        reviewReasons: other.reviewReasons.filter((reason) => reason !== "no_rule_matched" && reason !== "assistant_category" && reason !== "low_confidence"),
      },
    });
  }
}
