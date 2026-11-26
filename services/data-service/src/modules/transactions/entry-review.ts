import { z } from "zod";

/**
 * The review queue. Fortuna classifies what the assistant writes, books it to
 * an account (creating one when none matches) and queues it for review; the
 * review can be done in Fortuna or by the assistant through
 * /api/agent/transactions/review (scope transactions:review). Every other row
 * (statement imports, manual and phone entries) is saved as reviewed.
 */

export const REVIEW_STATUSES = ["to_review", "reviewed"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_REASONS = [
  "no_rule_matched",
  "assistant_category",
  "new_account",
  "possible_duplicate",
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

/** Who chose the category: one of Fortuna's rules, the assistant's suggestion, a review correction, or nobody. */
export type ClassificationDecision = {
  decidedBy: "rule" | "learned_pattern" | "history" | "heuristic" | "assistant" | "correction" | "none";
  ruleId?: string;
  ruleName?: string;
  patternId?: string;
  /** The category the assistant suggested, kept even when a rule decided. */
  suggestedCategory?: string;
  /** Fortuna set the label too (a rule or pattern), so a later run may replace it. */
  labelFromRule?: boolean;
  at: string;
};

type ClassifiedRow = {
  categoryId?: string;
  label?: string;
  linkage?: { type?: string } | null;
  metadata?: Record<string, unknown>;
  suggestionApplied?: boolean;
  suggestionSource?: string;
};

/**
 * Reads what classifyRows did to one row. An import rule leaves fixedRuleId in
 * metadata when it changed something; auto-categorization leaves
 * suggestionApplied and its source.
 */
export function classificationDecision(
  before: { label?: string | null },
  after: ClassifiedRow,
  assistant: { suggestedCategory?: string | null; usedSuggestion: boolean },
  now = new Date(),
): ClassificationDecision {
  const metadata = after.metadata || {};
  const decided = Boolean(after.categoryId || after.linkage?.type === "internal");
  const labelFromRule = Boolean(after.label && after.label !== (before.label || undefined));
  const base = {
    ...(assistant.suggestedCategory ? { suggestedCategory: assistant.suggestedCategory } : {}),
    ...(labelFromRule ? { labelFromRule } : {}),
    at: now.toISOString(),
  };
  if (decided && typeof metadata.fixedRuleId === "string")
    return {
      decidedBy: "rule",
      ruleId: metadata.fixedRuleId,
      ...(typeof metadata.fixedRuleName === "string" ? { ruleName: metadata.fixedRuleName } : {}),
      ...base,
    };
  if (decided && after.suggestionApplied) {
    const source = after.suggestionSource;
    const decidedBy =
      source === "learned_pattern" || source === "history" || source === "heuristic" ? source : "heuristic";
    return {
      decidedBy,
      ...(typeof metadata.classificationPatternId === "string" ? { patternId: metadata.classificationPatternId } : {}),
      ...base,
    };
  }
  if (assistant.usedSuggestion) return { decidedBy: "assistant", ...base };
  return { decidedBy: "none", ...base };
}

/** Why an assistant entry waits for review. The entry is queued even when the list is empty. */
export function reviewReasonsFor(input: {
  decision: Pick<ClassificationDecision, "decidedBy">;
  accountAutoCreated: boolean;
  possibleDuplicates: number;
}): ReviewReason[] {
  const reasons: ReviewReason[] = [];
  if (input.decision.decidedBy === "none" || input.decision.decidedBy === "assistant") reasons.push("no_rule_matched");
  if (input.decision.decidedBy === "assistant") reasons.push("assistant_category");
  if (input.accountAutoCreated) reasons.push("new_account");
  if (input.possibleDuplicates > 0) reasons.push("possible_duplicate");
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
        confirmed: z.literal(true),
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
