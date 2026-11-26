/**
 * Reimbursable spending as the apps get it from data-service
 * /api/agent/reimbursables: money out paid for someone who pays it back. It
 * keeps its real category; the flag names the person and what they owe.
 */

/** What someone owes of an item: all of it, a fraction of it, or a fixed amount. */
export type ReimbursableShare =
  | { kind: "full" }
  | { kind: "fraction"; fraction: number }
  | { kind: "amount"; amount: number };

/** The share as the API takes it. */
export type ReimbursableShareInput = "full" | "half" | { amount: number } | { fraction: number };

export interface ReimbursableFlag {
  personId: string;
  person: string | null;
  owed: number;
  share: ReimbursableShare;
  note: string | null;
}

export interface ReimbursementPerson {
  id: string;
  name: string;
  aliases: string[];
  archived: boolean;
}

export interface ReimbursableRepayment {
  transactionId: string;
  amount: number;
  date: string;
  description: string;
  label: string | null;
}

export interface ReimbursableItem {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  description: string;
  label: string | null;
  category: { id: string; name: string; color: string } | null;
  amountOut: number;
  currency: string;
  personId: string | null;
  owed: number;
  share: ReimbursableShare;
  note: string | null;
  repaid: number;
  outstanding: number;
  repayments: ReimbursableRepayment[];
}

export interface PersonBalanceMonth {
  /** YYYY-MM */
  month: string;
  owed: number;
  repaid: number;
  outstanding: number;
  itemCount: number;
  openItems: number;
}

export interface PersonBalance {
  person: ReimbursementPerson;
  owed: number;
  repaid: number;
  outstanding: number;
  itemCount: number;
  openItems: number;
  months: PersonBalanceMonth[];
  items?: ReimbursableItem[];
}

export interface OutstandingReimbursements {
  from?: string;
  to?: string;
  outstanding: number;
  people: PersonBalance[];
}

export type AllocationMatch = "exact" | "exact_set" | "oldest_first";

export interface RepaymentProposal {
  transactionId: string;
  person: { id: string; name: string };
  available: number;
  match: AllocationMatch;
  links: Array<{
    transactionId: string;
    date: string;
    description: string;
    label: string | null;
    owed: number;
    outstanding: number;
    amount: number;
  }>;
  unallocated: number;
  remainingOnItems: number;
  /** Confirming marks the repayment a Reimbursement. */
  marksReimbursement: boolean;
}

export interface RepaymentProposalWithRepayment extends RepaymentProposal {
  repayment: { id: string; date: string; description: string; label: string | null; amountIn: number; reviewStatus: string };
}

export interface BackfillItem {
  transactionId: string;
  date: string;
  description: string;
  label: string | null;
  category: { id: string; name: string; color: string } | null;
  amountOut: number;
  /** labelled: the label names the person; linked: one of their repayments is linked to it. */
  source: "labelled" | "linked";
  share: ReimbursableShare;
  owed: number;
  repaid: number;
  outstanding: number;
  selected: boolean;
  confidence: "high" | "low";
  reason: string;
}

export interface BackfillLinkGroup {
  repayment: { id: string; date: string; description: string; label: string | null; amountIn: number };
  available: number;
  match: AllocationMatch;
  links: Array<{ transactionId: string; date: string; description: string; label: string | null; amount: number }>;
  marksReimbursement: boolean;
  selected: boolean;
}

export interface BackfillProposal {
  person: ReimbursementPerson | { id: null; name: string; aliases: string[]; archived: false; createsPerson: true };
  items: BackfillItem[];
  links: BackfillLinkGroup[];
  alreadyMarked: number;
  summary: { items: number; selected: number; owed: number; repaid: number; outstanding: number; linksToAdd: number };
}

/** Reimbursable spending in an analytics period, per person. */
export interface ReimbursableSummary {
  /** Inside the totals (the user counts it as their own) or shown apart. */
  countsAsOwn: boolean;
  spentFor: number;
  repaid: number;
  outstanding: number;
  people: Array<{ personId: string; name: string; spentFor: number; repaid: number; outstanding: number; items: number }>;
}

/** The share an item owes, for the apps: "in full", "half", "1/3" or "$12.00". */
export const describeShare = (share: ReimbursableShare, currency = "$") => {
  if (share.kind === "full") return "in full";
  if (share.kind === "amount") return `${currency}${share.amount.toFixed(2)}`;
  if (Math.abs(share.fraction - 0.5) < 1e-6) return "half";
  for (const denominator of [3, 4, 5]) {
    const numerator = share.fraction * denominator;
    if (Math.abs(numerator - Math.round(numerator)) < 1e-4) return `${Math.round(numerator)}/${denominator}`;
  }
  return `${Number((share.fraction * 100).toFixed(1))}%`;
};

/** A share as the API takes it, from what the editor shows. */
export const shareInput = (share: ReimbursableShare): ReimbursableShareInput =>
  share.kind === "full" ? "full" : share.kind === "amount" ? { amount: share.amount } : { fraction: share.fraction };

/** What a share comes to on an item. */
export const owedFor = (amountOut: number, share: ReimbursableShare) =>
  share.kind === "full"
    ? amountOut
    : share.kind === "amount"
      ? Math.min(share.amount, amountOut)
      : Math.round(amountOut * share.fraction * 100) / 100;

export const MATCH_LABELS: Record<AllocationMatch, string> = {
  exact: "Exact amount",
  exact_set: "Adds up exactly",
  oldest_first: "Oldest first",
};

/** The flag from a transaction's raw columns (getTransactions / getTransaction rows), or null. */
export const flagFromRow = (row: {
  reimbursablePersonId?: string | null;
  reimbursableAmount?: string | number | null;
  reimbursableShare?: string | number | null;
  reimbursableNote?: string | null;
  reimbursablePerson?: { id: string; name: string } | null;
}): ReimbursableFlag | null => {
  if (!row.reimbursablePersonId) return null;
  const owed = Number(row.reimbursableAmount ?? 0);
  const fraction = row.reimbursableShare === null || row.reimbursableShare === undefined ? null : Number(row.reimbursableShare);
  return {
    personId: row.reimbursablePersonId,
    person: row.reimbursablePerson?.name ?? null,
    owed,
    share: fraction === null ? { kind: "amount", amount: owed } : Math.abs(fraction - 1) < 1e-9 ? { kind: "full" } : { kind: "fraction", fraction },
    note: row.reimbursableNote ?? null,
  };
};

/** The share editor's choice: in full, half, a fixed amount or a percentage. */
export type ShareMode = "full" | "half" | "amount" | "percent";

/** The editor's fields for a stored share. */
export const shareFields = (share: ReimbursableShare | undefined): { mode: ShareMode; value: string } => {
  if (!share || share.kind === "full") return { mode: "full", value: "" };
  if (share.kind === "amount") return { mode: "amount", value: share.amount.toFixed(2) };
  if (Math.abs(share.fraction - 0.5) < 1e-6) return { mode: "half", value: "" };
  return { mode: "percent", value: String(Number((share.fraction * 100).toFixed(2))) };
};

/** The share as the API takes it, or an error to show. */
export const shareFromFields = (mode: ShareMode, value: string): ReimbursableShareInput | { error: string } => {
  if (mode === "full" || mode === "half") return mode;
  const number = Number(value);
  if (mode === "amount")
    return number > 0 ? { amount: Math.round(number * 100) / 100 } : { error: "Enter the amount they owe" };
  return number > 0 && number <= 100 ? { fraction: number / 100 } : { error: "Enter a share from 1 to 100%" };
};

export const isShareError = (value: ReimbursableShareInput | { error: string }): value is { error: string } =>
  typeof value === "object" && "error" in value;

export const shareOf = (input: ReimbursableShareInput): ReimbursableShare =>
  input === "full"
    ? { kind: "full" }
    : input === "half"
      ? { kind: "fraction", fraction: 0.5 }
      : "amount" in input
        ? { kind: "amount", amount: input.amount }
        : { kind: "fraction", fraction: input.fraction };
