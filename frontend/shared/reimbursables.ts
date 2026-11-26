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
