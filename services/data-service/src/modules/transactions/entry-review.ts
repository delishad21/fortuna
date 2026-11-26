import { z } from "zod";

/**
 * The review queue. Assistant entries are classified in this order:
 * structural detection in code (PayLah and bank transfers, card bill
 * payments), then enabled rules, then the assistant's own decision (made from
 * similar past entries and the user's instructions), and only when the
 * assistant sent nothing, a learned pattern or history match. The entry is
 * booked to an account (an unknown card or account becomes a question) and
 * queued for review; the review can be done in Fortuna or by the assistant
 * through /api/agent/transactions/review (scope transactions:review). Every
 * other row (statement imports, manual and phone entries) is saved as reviewed.
 */

export const REVIEW_STATUSES = ["to_review", "reviewed"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_REASONS = [
  "no_rule_matched",
  "assistant_category",
  "new_account",
  "possible_duplicate",
  /** The entry has open questions (entry.questions). */
  "question",
  /** The assistant was unsure (confidence below LOW_CONFIDENCE). */
  "low_confidence",
  /** The card or account isn't one Fortuna knows; a question asks where it belongs. */
  "unknown_account",
  /** A rule that had classified it was undone. */
  "rule_undone",
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

/** Below this the assistant's decision is flagged low_confidence. */
export const LOW_CONFIDENCE = 0.6;

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

export const QUESTION_FIELDS = [
  "category",
  "label",
  "merchant",
  "transactionType",
  "account",
  "rule",
  "reimbursable",
  "other",
] as const;
export type QuestionField = (typeof QUESTION_FIELDS)[number];

/** An open question on an entry, kept in transactions.questions until answered. */
export type EntryQuestion = {
  id: string;
  /** Entries sharing a key are answered together (e.g. one unknown card). */
  key?: string;
  field: QuestionField;
  prompt: string;
  options: { id: string; label: string }[];
  /** A free answer (any category name, label…) is accepted besides the options. */
  allowOther?: boolean;
  /** rule_conflict | amount_range | unknown_account | assistant */
  source: "rule_conflict" | "amount_range" | "unknown_account" | "assistant";
  ruleId?: string;
  context?: Record<string, unknown>;
  createdAt: string;
};

/** What the assistant decided, as it sent it; kept on the entry and shown in its details. */
export const AssistantDecisionSchema = z
  .object({
    category: z.string().trim().min(1).max(120).nullish(),
    transactionType: z.enum(TRANSACTION_TYPES).nullish(),
    label: z.string().trim().max(200).nullish(),
    /** The merchant's name, cleaned up (the description stays as the bank wrote it). */
    merchant: z.string().trim().max(200).nullish(),
    reason: z.string().trim().max(2000).nullish(),
    confidence: z.number().min(0).max(1).nullish(),
    /** Ids of the past transactions the decision was based on. */
    precedentIds: z.array(z.string().trim().min(1).max(64)).max(20).nullish(),
  })
  .strict();
export type AssistantDecision = z.infer<typeof AssistantDecisionSchema>;

/** A question the assistant asks with an entry. */
export const QuestionInputSchema = z
  .object({
    field: z.enum(QUESTION_FIELDS),
    prompt: z.string().trim().min(1).max(500),
    options: z
      .array(
        z.union([
          z.string().trim().min(1).max(120),
          z.object({ id: z.string().trim().min(1).max(120).optional(), label: z.string().trim().min(1).max(200) }).strict(),
        ]),
      )
      .max(8)
      .default([]),
    allowOther: z.boolean().optional(),
  })
  .strict();
export type QuestionInput = z.infer<typeof QuestionInputSchema>;

/** Which step chose the category, with what it used. */
export type ClassificationDecision = {
  decidedBy:
    | "structural"
    | "rule"
    | "assistant"
    | "learned_pattern"
    | "history"
    | "heuristic"
    | "correction"
    | "none";
  ruleId?: string;
  ruleName?: string;
  patternId?: string;
  /** Structural detection: what kind of pair, and the other side. */
  structural?: { kind: "paylah_transfer" | "card_bill_payment"; counterpartId: string | null; reason: string };
  /** The assistant's decision as sent, kept even when a rule decided. */
  assistant?: AssistantDecision;
  /** The category the assistant suggested (the older suggestedCategory field). */
  suggestedCategory?: string;
  /** The assistant's decision disagreed with the rule; the rule's result was kept and a question asked. */
  conflict?: { ruleId: string; rule: string; assistant: string };
  /** Fortuna set the label too (a rule or pattern), so a later run may replace it. */
  labelFromRule?: boolean;
  correctedFrom?: string | null;
  at: string;
};

/** Why an assistant entry waits for review. The entry is queued even when the list is empty. */
export function reviewReasonsFor(input: {
  decision: Pick<ClassificationDecision, "decidedBy"> & { assistant?: AssistantDecision | null };
  accountAutoCreated: boolean;
  accountUnknown?: boolean;
  possibleDuplicates: number;
  questions?: number;
}): ReviewReason[] {
  const reasons: ReviewReason[] = [];
  const { decidedBy } = input.decision;
  if (decidedBy === "none" || decidedBy === "assistant") reasons.push("no_rule_matched");
  if (decidedBy === "assistant") reasons.push("assistant_category");
  const confidence = input.decision.assistant?.confidence;
  if (decidedBy === "assistant" && confidence != null && confidence < LOW_CONFIDENCE) reasons.push("low_confidence");
  if (input.accountAutoCreated) reasons.push("new_account");
  if (input.accountUnknown) reasons.push("unknown_account");
  if (input.possibleDuplicates > 0) reasons.push("possible_duplicate");
  if (input.questions) reasons.push("question");
  return reasons;
}

/** Parses `reviewStatus` for GET /api/transactions and the bulk filters. */
export function parseReviewFilter(query: { reviewStatus?: unknown }) {
  const value = typeof query.reviewStatus === "string" ? query.reviewStatus.trim() : "";
  return (REVIEW_STATUSES as readonly string[]).includes(value)
    ? { reviewStatus: value as ReviewStatus }
    : {};
}

const csv = <T extends string>(values: readonly T[]) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : undefined,
    )
    .pipe(z.array(z.enum(values as unknown as [T, ...T[]])).optional());

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dates must be YYYY-MM-DD");

export const ReviewQueueQuerySchema = z
  .object({
    status: z.enum([...REVIEW_STATUSES, "all"]).default("to_review"),
    reasons: csv(REVIEW_REASONS),
    entrySource: csv(["assistant", "manual", "statement", "mobile"] as const),
    account: z.string().trim().min(1).max(120).optional(),
    dateFrom: Day.optional(),
    dateTo: Day.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

const Ids = z.array(z.string().trim().min(1).max(64)).min(1).max(200);

export const CorrectionSchema = z
  .object({
    ids: Ids,
    category: z.string().trim().min(1).max(120).optional(),
    account: z.string().trim().min(1).max(120).optional(),
    label: z.string().trim().max(200).nullable().optional(),
    /** Corrected entries are reviewed unless this is false. */
    markReviewed: z.boolean().default(true),
    /** Also save a classification rule so future entries come out this way. */
    createRule: z
      .object({
        matchValue: z.string().trim().min(2).max(200),
        name: z.string().trim().min(1).max(100).optional(),
        accountOnly: z.boolean().default(false),
        /** Who asked for it: the user in this conversation (default), or the assistant from a pattern. */
        origin: z.enum(["assistant_on_request", "assistant_detected"]).default("assistant_on_request"),
        /** The user's words, or the pattern the assistant saw. */
        reason: z.string().trim().min(1).max(1000).optional(),
        /** Reviewed transactions it is based on (assistant_detected needs 3 besides the corrected ones). */
        exampleIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
        amountMin: z.number().finite().nonnegative().optional(),
        amountMax: z.number().finite().nonnegative().optional(),
        /** Accepted for older callers; no longer needed. */
        confirmed: z.literal(true).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (value) => value.category !== undefined || value.account !== undefined || value.label !== undefined,
    "Give category, account or label",
  )
  .refine(
    (value) => !value.createRule || value.category !== undefined || (value.label ?? null) !== null,
    "A rule needs a category or label to set",
  );

export const ReviewStatusSchema = z
  .object({ ids: Ids, status: z.enum(REVIEW_STATUSES).default("reviewed") })
  .strict();

export const ConfirmAccountSchema = z
  .object({ label: z.string().trim().min(1).max(120).optional() })
  .strict();

export const MergeAccountSchema = z
  .object({ into: z.string().trim().min(1).max(120), confirmed: z.literal(true) })
  .strict();

export type CorrectionInput = z.infer<typeof CorrectionSchema>;
export type ReviewQueueQuery = z.infer<typeof ReviewQueueQuerySchema>;

export const AnswerSchema = z
  .object({
    transactionId: z.string().trim().min(1).max(64),
    questionId: z.string().trim().min(1).max(64),
    /** The id of one of the question's options. */
    option: z.string().trim().min(1).max(200).optional(),
    /** A free answer, where the question allows one (a category name, a label…). */
    value: z.string().trim().min(1).max(200).optional(),
    /** Also mark the entry reviewed when this was its last question. */
    markReviewed: z.boolean().default(false),
  })
  .strict()
  .refine((value) => Boolean(value.option) !== Boolean(value.value), "Give option or value");
export type AnswerInput = z.infer<typeof AnswerSchema>;
