/** The review queue as the apps get it (data-service publicEntry and TransactionReview.queue). */
import type { EntrySource, ReviewStatus } from "./entrySource";
import type { ReimbursableFlag, RepaymentProposal } from "./reimbursables";

export const REVIEW_REASONS = ["no_rule_matched", "assistant_category", "new_account", "possible_duplicate"] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

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
  classification: { decidedBy?: string; ruleName?: string; suggestedCategory?: string } | null;
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
