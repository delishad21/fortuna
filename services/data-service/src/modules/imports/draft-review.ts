type Proposal = {
  status: string;
  proposedLinkage?: unknown;
  proposedTripEntryType?: string | null;
  reason?: string;
  proposedLabel?: string | null;
  proposedCategoryId?: string | null;
};
type Row = {
  reviewStatus: string;
  selected: boolean;
  currentPayload: unknown;
  proposals: Proposal[];
};
export function reviewDraftRow(row: Row) {
  const payload = (row.currentPayload || {}) as Record<string, any>;
  const pending = row.proposals.filter((p) => p.status === "proposed");
  const reconciliation = pending.some(
    (p) =>
      Boolean(p.proposedLinkage) ||
      ["reimbursement", "funding_in", "funding_out"].includes(
        p.proposedTripEntryType || "",
      ),
  );
  const missingClassification =
    !String(payload.label || "").trim() ||
    (!payload.categoryId && !payload.linkage);
  const labelling =
    missingClassification ||
    pending.some((p) => Boolean(p.proposedLabel || p.proposedCategoryId));
  const flagged = ["unresolved", "proposed", "rejected"].includes(
    row.reviewStatus,
  );
  const reasons = [
    ...(missingClassification ? ["Label or category is missing"] : []),
    ...(reconciliation
      ? ["Transfer, funding or reimbursement needs reconciliation"]
      : []),
    ...pending.map((p) => p.reason || "Agent suggestion needs a decision"),
    ...(row.reviewStatus === "rejected"
      ? ["Suggestion rejected; review the current classification"]
      : []),
    ...(row.reviewStatus === "unresolved"
      ? ["Agent left this row unresolved"]
      : []),
  ];
  return {
    labelling,
    reconciliation,
    needsReview: labelling || reconciliation || flagged || pending.length > 0,
    pendingProposals: pending.length,
    reasons: [...new Set(reasons)],
  };
}
export function summarizeDraftReview(rows: Row[]) {
  const reviews = rows.map(reviewDraftRow);
  return {
    total: rows.length,
    selected: rows.filter((r) => r.selected).length,
    needsReview: reviews.filter((r) => r.needsReview).length,
    labelling: reviews.filter((r) => r.labelling).length,
    reconciliation: reviews.filter((r) => r.reconciliation).length,
    ready: reviews.filter((r) => !r.needsReview).length,
  };
}
