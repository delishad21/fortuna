/** Where a transaction came from, and whether a statement has confirmed it. Shared by web and mobile. */
export const ENTRY_SOURCES = ["assistant", "manual", "statement", "mobile"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export const ENTRY_SOURCE_LABELS: Record<EntrySource, string> = {
  assistant: "Assistant",
  manual: "Manual",
  statement: "Statement",
  mobile: "Mobile",
};

export const entrySourceLabel = (source: string | null | undefined) =>
  ENTRY_SOURCE_LABELS[source as EntrySource] ?? ENTRY_SOURCE_LABELS.manual;

/** Filter values for the reconciled state; "all" sends no filter. */
export type ReconciledFilter = "all" | "reconciled" | "unreconciled";

export const reconciledParam = (filter: ReconciledFilter | undefined) =>
  filter === "reconciled" ? true : filter === "unreconciled" ? false : undefined;

export const reconciledLabel = (reconciled: boolean | null | undefined) =>
  reconciled ? "Reconciled" : "Not reconciled";

/** Assistant entries wait for review; everything else is saved as reviewed. */
export const REVIEW_STATUSES = ["to_review", "reviewed"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Filter values for the review state; "all" sends no filter. */
export type ReviewFilter = "all" | ReviewStatus;

export const reviewStatusParam = (filter: string | undefined): ReviewStatus | undefined =>
  filter === "to_review" || filter === "reviewed" ? filter : undefined;

export const REVIEW_REASON_LABELS: Record<string, string> = {
  no_rule_matched: "No rule matched",
  assistant_category: "Assistant's category",
  new_account: "New account",
  possible_duplicate: "Possible duplicate",
};

export const reviewReasonLabel = (reason: string) => REVIEW_REASON_LABELS[reason] ?? reason;

export const reviewReasonsText = (reasons: string[] | null | undefined) =>
  (reasons ?? []).map(reviewReasonLabel).join(" · ");

/** Who chose an assistant entry's category, from metadata.classification. */
export function classificationLabel(classification: unknown): string | null {
  const value = classification as { decidedBy?: string; ruleName?: string } | null | undefined;
  switch (value?.decidedBy) {
    case "rule":
      return value.ruleName ? `Rule “${value.ruleName}”` : "A rule";
    case "learned_pattern":
      return "A learned pattern";
    case "history":
      return "Past transactions";
    case "heuristic":
      return "Fortuna's guess";
    case "assistant":
      return "The assistant's suggestion";
    case "correction":
      return "A review correction";
    case "none":
      return "Nothing matched";
    default:
      return null;
  }
}
