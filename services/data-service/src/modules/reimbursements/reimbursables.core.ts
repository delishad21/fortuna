/**
 * Pure rules for reimbursable spending: money out paid for someone who pays it
 * back. Kept free of database access so they can be unit tested; the service
 * (reimbursables.service.ts) loads rows and writes through the links service.
 */

import { EPSILON, money } from "./links.core";

/** What someone owes of an item: all of it, a fraction of it, or a fixed amount. */
export type Share =
  | { kind: "full" }
  | { kind: "fraction"; fraction: number }
  | { kind: "amount"; amount: number };

export class ShareError extends Error {}

/**
 * Reads a share as the apps and agents send it: "full", "half", "1/3",
 * "50%", a fraction like 0.5, or { amount } / { fraction }.
 */
export function parseShare(input: unknown): Share {
  if (input === undefined || input === null || input === "full") return { kind: "full" };
  if (typeof input === "object") {
    const value = input as Record<string, unknown>;
    if (value.kind === "full") return { kind: "full" };
    if (typeof value.amount === "number") return checkShare({ kind: "amount", amount: value.amount });
    if (typeof value.fraction === "number") return checkShare({ kind: "fraction", fraction: value.fraction });
    throw new ShareError("A share is full, { amount } or { fraction }");
  }
  if (typeof input === "number") return checkShare({ kind: "fraction", fraction: input });
  const text = String(input).trim().toLowerCase();
  if (text === "half") return { kind: "fraction", fraction: 0.5 };
  const percent = /^(\d+(?:\.\d+)?)\s*%$/.exec(text);
  if (percent) return checkShare({ kind: "fraction", fraction: Number(percent[1]) / 100 });
  const ratio = /^(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (ratio) return checkShare({ kind: "fraction", fraction: Number(ratio[1]) / Number(ratio[2]) });
  throw new ShareError(`Unknown share "${input}"; use full, half, 1/3, 50%, { amount } or { fraction }`);
}

function checkShare(share: Share): Share {
  if (share.kind === "fraction") {
    if (!Number.isFinite(share.fraction) || share.fraction <= 0 || share.fraction > 1)
      throw new ShareError("A fraction share is more than 0 and at most 1");
    if (Math.abs(share.fraction - 1) < 1e-9) return { kind: "full" };
  }
  if (share.kind === "amount" && (!Number.isFinite(share.amount) || share.amount <= 0))
    throw new ShareError("A share amount must be more than 0");
  return share;
}

/**
 * The columns a share writes: the amount owed and the fraction (1 for full,
 * null for a fixed amount). A fixed amount can't be more than the item.
 */
export function resolveShare(amountOut: number, share: Share) {
  if (!(amountOut > 0)) throw new ShareError("Only money out can be reimbursable");
  if (share.kind === "full") return { amount: money(amountOut), fraction: 1 };
  if (share.kind === "fraction")
    return { amount: money(amountOut * share.fraction), fraction: Number(share.fraction.toFixed(6)) };
  if (share.amount - amountOut > EPSILON)
    throw new ShareError(`The share (${share.amount.toFixed(2)}) is more than the item (${amountOut.toFixed(2)})`);
  return { amount: money(share.amount), fraction: null };
}

/** The share stored on a row, as the API shows it. */
export function describeShare(amount: number, fraction: number | null): Share {
  if (fraction === null) return { kind: "amount", amount: money(amount) };
  if (Math.abs(fraction - 1) < 1e-9) return { kind: "full" };
  return { kind: "fraction", fraction };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The names a person goes by, normalised: their name and aliases, without blanks or repeats. */
export function personNames(person: { name: string; aliases?: string[] | null }) {
  return [...new Set([person.name, ...(person.aliases || [])].map((name) => name.trim()).filter(Boolean))];
}

/** Matches text naming the person: any of their names as whole words, any case. */
export function nameMatcher(person: { name: string; aliases?: string[] | null }) {
  const patterns = personNames(person).map(
    (name) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name).replace(/\s+/g, "\\s+")}(?=$|[^\\p{L}\\p{N}])`, "iu"),
  );
  return (...texts: Array<string | null | undefined>) =>
    patterns.some((pattern) => texts.some((text) => !!text && pattern.test(text)));
}

export type OpenItem = {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  owed: number;
  repaid: number;
  outstanding: number;
};

export type AllocationMatch = "exact" | "exact_set" | "oldest_first" | "none";

export type Allocation = {
  match: AllocationMatch;
  links: Array<{ transactionId: string; amount: number }>;
  /** What the repayment covers beyond the proposed items (stays unallocated). */
  unallocated: number;
  /** What the proposed items still owe after this repayment (a partial payment). */
  remainingOnItems: number;
};

const cents = (value: number) => Math.round(value * 100);
const byAge = (a: OpenItem, b: OpenItem) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

/**
 * How a repayment of `available` pays off a person's open items: one item
 * owing exactly that much (the oldest such), else a run of items that adds up
 * exactly (the oldest items, or one month's), else the oldest items first,
 * the last one partly. Items dated after the repayment are left out.
 */
export function proposeAllocation(available: number, items: OpenItem[], repaymentDate?: string): Allocation {
  const total = cents(available);
  const open = items
    .filter((item) => cents(item.outstanding) > 0 && (!repaymentDate || item.date <= repaymentDate))
    .sort(byAge);
  if (total <= 0 || !open.length) return { match: "none", links: [], unallocated: money(Math.max(available, 0)), remainingOnItems: 0 };

  const whole = (chosen: OpenItem[], match: AllocationMatch): Allocation => ({
    match,
    links: chosen.map((item) => ({ transactionId: item.id, amount: money(item.outstanding) })),
    unallocated: 0,
    remainingOnItems: 0,
  });

  const single = open.find((item) => cents(item.outstanding) === total);
  if (single) return whole([single], "exact");

  // The oldest items, in order, adding up exactly.
  let sum = 0;
  for (let index = 0; index < open.length; index += 1) {
    sum += cents(open[index].outstanding);
    if (sum === total) return whole(open.slice(0, index + 1), "exact_set");
    if (sum > total) break;
  }
  // One month's items adding up exactly (e.g. "September spending").
  const months = new Map<string, OpenItem[]>();
  for (const item of open) months.set(item.date.slice(0, 7), [...(months.get(item.date.slice(0, 7)) || []), item]);
  for (const monthItems of months.values()) {
    if (monthItems.reduce((acc, item) => acc + cents(item.outstanding), 0) === total)
      return whole(monthItems, "exact_set");
  }

  const links: Allocation["links"] = [];
  let left = total;
  let remainingOnItems = 0;
  for (const item of open) {
    if (left <= 0) break;
    const owing = cents(item.outstanding);
    const take = Math.min(owing, left);
    links.push({ transactionId: item.id, amount: take / 100 });
    remainingOnItems += owing - take;
    left -= take;
  }
  return { match: "oldest_first", links, unallocated: left / 100, remainingOnItems: remainingOnItems / 100 };
}

export type BalanceItem = {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  owed: number;
  repaid: number;
};

/** Owed, repaid and outstanding in total and per month of the item, oldest month first. */
export function summarizeBalance(items: BalanceItem[]) {
  const months = new Map<string, { month: string; owed: number; repaid: number; outstanding: number; itemCount: number; openItems: number }>();
  let owed = 0;
  let repaid = 0;
  let outstanding = 0;
  let openItems = 0;
  for (const item of items) {
    const left = Math.max(item.owed - item.repaid, 0);
    const counted = Math.min(item.repaid, item.owed);
    const key = item.date.slice(0, 7);
    const month = months.get(key) || { month: key, owed: 0, repaid: 0, outstanding: 0, itemCount: 0, openItems: 0 };
    month.owed += item.owed;
    month.repaid += counted;
    month.outstanding += left;
    month.itemCount += 1;
    if (left > EPSILON) month.openItems += 1;
    months.set(key, month);
    owed += item.owed;
    repaid += counted;
    outstanding += left;
    if (left > EPSILON) openItems += 1;
  }
  return {
    owed: money(owed),
    repaid: money(repaid),
    outstanding: money(outstanding),
    itemCount: items.length,
    openItems,
    months: [...months.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((month) => ({
        ...month,
        owed: money(month.owed),
        repaid: money(month.repaid),
        outstanding: money(month.outstanding),
      })),
  };
}

export type BackfillGuess = {
  share: Share;
  /** Ticked in the review by default. */
  selected: boolean;
  confidence: "high" | "low";
  reason: string;
};

/**
 * What a label naming the person suggests about an existing item, before
 * looking at repayments: "MRT/Bus (Madeline)" and "Keyboard for Madeline" are
 * hers in full; "for Madeline and me" is half; "Sushiro with Madeline" was
 * probably a shared outing (left unticked, half suggested); "Madeline's place"
 * or "(reimbursed)" need a look.
 */
export function guessFromLabel(label: string, person: { name: string; aliases?: string[] | null }): BackfillGuess | null {
  if (!nameMatcher(person)(label)) return null;
  const names = personNames(person).map((name) => escape(name).replace(/\s+/g, "\\s+")).join("|");
  const text = label.toLowerCase();
  if (/\b(and me|me and|split|shared|half)\b/.test(text))
    return { share: { kind: "fraction", fraction: 0.5 }, selected: true, confidence: "high", reason: "Shared (the label says so): half each" };
  if (new RegExp(`\\bwith\\s+(${names})\\b`, "iu").test(label))
    return {
      share: { kind: "fraction", fraction: 0.5 },
      selected: false,
      confidence: "low",
      reason: `“with ${person.name}”: maybe a shared outing you paid for both; tick it and set the share if ${person.name} owes part`,
    };
  if (/\breimbursed\b/.test(text))
    return {
      share: { kind: "full" },
      selected: false,
      confidence: "low",
      reason: "The label says reimbursed, but no repayment is linked; ticking it counts it as owed",
    };
  if (new RegExp(`\\b(${names})['’]s\\b`, "iu").test(label))
    return {
      share: { kind: "full" },
      selected: false,
      confidence: "low",
      reason: `Names ${person.name}'s place or things; tick it if ${person.name} owes it`,
    };
  return { share: { kind: "full" }, selected: true, confidence: "high", reason: `Labelled for ${person.name}: owed in full` };
}

/** The reimbursable part of a transaction as the APIs show it. */
export function reimbursableOf(
  row: { reimbursablePersonId: string | null; reimbursableAmount: unknown; reimbursableShare: unknown; reimbursableNote: string | null },
  person: { id: string; name: string } | null | undefined,
) {
  if (!row.reimbursablePersonId) return null;
  const owed = money(Number(row.reimbursableAmount ?? 0));
  return {
    personId: row.reimbursablePersonId,
    person: person?.name ?? null,
    owed,
    share: describeShare(owed, row.reimbursableShare === null || row.reimbursableShare === undefined ? null : Number(row.reimbursableShare)),
    note: row.reimbursableNote,
  };
}
