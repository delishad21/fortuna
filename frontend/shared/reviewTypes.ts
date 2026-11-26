/** The review queue as the apps get it (data-service publicEntry and TransactionReview.queue). */
import type { EntrySource, ReviewStatus } from "./entrySource";
import type { ReimbursableFlag, RepaymentProposal } from "./reimbursables";

export const REVIEW_REASONS = [
  "no_rule_matched",
  "assistant_category",
  "new_account",
  "possible_duplicate",
  "question",
  "low_confidence",
  "unknown_account",
  "rule_undone",
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

export const TRANSACTION_TYPES = [
  "purchase",
  "bill",
  "subscription",
  "transfer_to_person",
  "refund",
  "reimbursement",
  "internal",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  purchase: "Purchase",
  bill: "Bill",
  subscription: "Subscription",
  transfer_to_person: "Transfer to a person",
  refund: "Refund",
  reimbursement: "Reimbursement",
  internal: "Internal transfer",
};

export const transactionTypeLabel = (type: string | null | undefined) =>
  type ? (TRANSACTION_TYPE_LABELS[type as TransactionType] ?? type) : null;

/** What the assistant decided, as it sent it (metadata.classification.assistant). */
export interface AssistantDecision {
  category?: string | null;
  transactionType?: TransactionType | null;
  label?: string | null;
  merchant?: string | null;
  reason?: string | null;
  /** 0..1 */
  confidence?: number | null;
  /** The past transactions the decision was based on. */
  precedentIds?: string[] | null;
}

export type DecidedBy =
  | "structural"
  | "rule"
  | "assistant"
  | "learned_pattern"
  | "history"
  | "heuristic"
  | "correction"
  | "none";

/** Which step classified an entry (metadata.classification). */
export interface EntryClassification {
  decidedBy?: DecidedBy | string;
  ruleId?: string;
  ruleName?: string;
  suggestedCategory?: string;
  /** A transfer between two of the user's own accounts, found in code. */
  structural?: { kind: "paylah_transfer" | "card_bill_payment"; counterpartId: string | null; reason: string };
  /** A rule and the assistant disagreed on the category; the rule won. */
  conflict?: { ruleId: string; rule: string; assistant: string };
  assistant?: AssistantDecision;
}

/** An open question on an entry; answer it with answerReviewQuestion. */
export interface EntryQuestion {
  id: string;
  /** Entries sharing a key are answered together (e.g. one unknown card). */
  key?: string;
  field: string;
  prompt: string;
  options: { id: string; label: string }[];
  /** A free answer is accepted besides the options. */
  allowOther?: boolean;
  source: "rule_conflict" | "amount_range" | "unknown_account" | "assistant";
  ruleId?: string;
  context?: Record<string, unknown>;
  createdAt: string;
}

/** A past entry an assistant decision was based on. */
export interface ReviewPrecedent {
  id: string;
  date: string;
  description: string;
  label: string | null;
  amountIn: number | null;
  amountOut: number | null;
  category: string | null;
}

export type RuleOrigin = "user" | "assistant_on_request" | "assistant_detected";

export const RULE_ORIGIN_LABELS: Record<RuleOrigin, string> = {
  user: "User",
  assistant_on_request: "Asked for",
  assistant_detected: "Detected by assistant",
};

export const ruleOriginLabel = (origin: string | null | undefined) =>
  RULE_ORIGIN_LABELS[origin as RuleOrigin] ?? RULE_ORIGIN_LABELS.user;

/** A classification rule as data-service shows it (Rules.publicRule). */
export interface PublicRule {
  id: string;
  name: string;
  enabled: boolean;
  origin: RuleOrigin;
  reason: string | null;
  matchType: "always" | "description_contains";
  matchValue: string | null;
  caseSensitive: boolean;
  parserId: string | null;
  accountIdentifier: string | null;
  accountId: string | null;
  account: { id: string; name: string } | null;
  cardId: string | null;
  card: { id: string; last4: string | null } | null;
  setCategoryName: string | null;
  setLabel: string | null;
  markInternal: boolean;
  amountMin: number | null;
  amountMax: number | null;
  recurringBill: unknown;
  exampleTransactionIds: string[];
  examples: (ReviewPrecedent & { reviewStatus: string })[];
  hitCount: number;
  lastHitAt: string | null;
  acknowledgedAt: string | null;
  undoneAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewEntry {
  id: string;
  externalId: string | null;
  /** YYYY-MM-DD */
  date: string;
  time: string | null;
  description: string;
  label: string | null;
  amountIn: number | null;
  amountOut: number | null;
  currency: string;
  category: { id: string; name: string; color: string; icon: string | null } | null;
  /** The statement identifier. */
  account: string | null;
  accountId: string | null;
  cardId: string | null;
  imageId: string | null;
  card: { id?: string; last4?: string } | null;
  entrySource: EntrySource;
  reconciled: boolean;
  reviewStatus: ReviewStatus;
  reviewReasons: ReviewReason[];
  reviewedAt: string | null;
  classification: EntryClassification | null;
  /** The assistant's decision as it sent it. */
  decision: AssistantDecision | null;
  merchant: string | null;
  transactionType: TransactionType | null;
  questions: EntryQuestion[];
  /** The past entries the decision was based on (the queue only). */
  precedents?: ReviewPrecedent[];
  /** Paid for someone who pays it back: who, and what they owe. */
  reimbursable?: ReimbursableFlag | null;
  /** Money in that looks like a repayment: the items it would pay back, to confirm. */
  reimbursementProposal?: RepaymentProposal | null;
  createdAt: string;
}

export interface ReviewQueue {
  total: number;
  limit: number;
  offset: number;
  /** Entries per reason with the other filters applied. */
  reasons: Record<ReviewReason, number>;
  /** Rules the assistant created by itself since the last review; each can be undone. */
  newRules: PublicRule[];
  transactions: ReviewEntry[];
}

export interface ReviewQueueFilters {
  status?: ReviewStatus | "all";
  reasons?: ReviewReason[];
  entrySource?: EntrySource[];
  /** An Account id (or statement identifier). */
  account?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

/**
 * A rule suggestion from a description: its first two words that aren't
 * numbers or card noise, e.g. "GRAB*RIDE 1234 SINGAPORE" → "GRAB*RIDE".
 * The rule matches descriptions that contain it.
 */
export const suggestRuleMatch = (descriptions: string[]) => {
  const words = (text: string) =>
    text
      .split(/\s+/)
      .filter((word) => word.length > 1 && !/^\d+$/.test(word) && !/^(sg|sgp|singapore|pte|ltd|card|pos)$/i.test(word));
  const first = descriptions[0] ? words(descriptions[0]) : [];
  for (let size = Math.min(2, first.length); size > 0; size -= 1) {
    const candidate = first.slice(0, size).join(" ");
    if (candidate.length >= 2 && descriptions.every((text) => text.toLowerCase().includes(candidate.toLowerCase())))
      return candidate;
  }
  return "";
};

/** What a rule sets, e.g. "Category Food · label Grab · internal". */
export const ruleEffectText = (rule: Pick<PublicRule, "setCategoryName" | "setLabel" | "markInternal">) =>
  [
    rule.setCategoryName ? `Category ${rule.setCategoryName}` : null,
    rule.setLabel ? `label ${rule.setLabel}` : null,
    rule.markInternal ? "internal" : null,
  ]
    .filter(Boolean)
    .join(" · ") || "Nothing";

/** Where a rule applies besides its match: account, card and amount range. */
export const ruleScopeText = (
  rule: Pick<PublicRule, "account" | "accountIdentifier" | "card" | "amountMin" | "amountMax">,
) => {
  const amount =
    rule.amountMin != null && rule.amountMax != null
      ? `${rule.amountMin} to ${rule.amountMax}`
      : rule.amountMin != null
        ? `${rule.amountMin} or more`
        : rule.amountMax != null
          ? `up to ${rule.amountMax}`
          : null;
  return [
    rule.account?.name ?? rule.accountIdentifier,
    rule.card?.last4 ? `card ·· ${rule.card.last4}` : null,
    amount ? `amount ${amount}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
};
