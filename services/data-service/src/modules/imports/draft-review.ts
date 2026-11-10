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
const cents = (value: unknown) => Math.round(Number(value || 0) * 100);
const money = (value: number) =>
  (value / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const balanceOf = (payload: Record<string, any>) => {
  const value = payload.balance;
  return value === null || value === undefined || value === "" || !Number.isFinite(Number(value))
    ? null
    : cents(value);
};

export type DraftAmountIssues = {
  errors: string[];
  warnings: string[];
  /** Set when the row's amounts don't take the previous balance to its own. */
  runningBalance?: string;
};

/**
 * Amount problems on staged rows, whichever parser produced them: a row with
 * both money in and money out, and, where rows carry the statement's running
 * balance, a row whose amounts don't take the previous balance to its own.
 * Rows must be in statement order. Statements listed newest first are checked
 * in that direction. Trip statements (several pockets per currency) skip the
 * running balance. Parser warnings (metadata.parseWarning) come back as
 * warnings, since an edit can't clear them.
 */
export function draftAmountIssues(
  payloads: unknown[],
  { runningBalance = true }: { runningBalance?: boolean } = {},
): DraftAmountIssues[] {
  const rows = payloads.map((payload) => (payload || {}) as Record<string, any>);
  const issues = rows.map((payload): DraftAmountIssues => ({
    errors:
      cents(payload.amountIn) > 0 && cents(payload.amountOut) > 0
        ? ["Has both money in and money out, but a statement row is one or the other. Check the amounts against the statement."]
        : [],
    warnings:
      typeof payload.metadata?.parseWarning === "string" && payload.metadata.parseWarning.trim()
        ? [payload.metadata.parseWarning.trim()]
        : [],
  }));
  const groups = new Map<string, number[]>();
  rows.forEach((payload, index) => {
    if (!runningBalance || balanceOf(payload) === null) return;
    const key = `${String(payload.accountIdentifier || "").trim()}|${String(payload.currency || payload.metadata?.currency || "").trim()}`;
    groups.set(key, [...(groups.get(key) || []), index]);
  });
  const mismatch = (earlier: Record<string, any>, later: Record<string, any>) => {
    const expected = balanceOf(earlier)! - cents(later.amountOut) + cents(later.amountIn);
    return expected === balanceOf(later) ? null : expected;
  };
  for (const indexes of groups.values()) {
    const pairs = indexes.slice(1).map((index, i) => [indexes[i], index]);
    if (!pairs.length) continue;
    const forward = pairs.filter(([a, b]) => mismatch(rows[a], rows[b]) === null).length;
    const backward = pairs.filter(([a, b]) => mismatch(rows[b], rows[a]) === null).length;
    for (const [a, b] of pairs) {
      const [earlier, later] = backward > forward ? [a, b].reverse() : [a, b];
      const expected = mismatch(rows[earlier], rows[later]);
      if (expected === null) continue;
      const payload = rows[later];
      const moves = [
        cents(payload.amountOut) ? ` - ${money(cents(payload.amountOut))}` : "",
        cents(payload.amountIn) ? ` + ${money(cents(payload.amountIn))}` : "",
      ].join("");
      const message = `Running balance doesn't match: ${money(balanceOf(rows[earlier])!)}${moves} = ${money(expected)}, but the statement shows ${money(balanceOf(payload)!)}. Check the amounts against the statement.`;
      issues[later].runningBalance = message;
      issues[later].errors.push(message);
    }
  }
  return issues;
}

export function reviewDraftRow(
  row: Row,
  amountIssues: DraftAmountIssues = draftAmountIssues([row.currentPayload])[0],
) {
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
  const amountErrors = amountIssues.errors;
  const reasons = [
    ...amountErrors,
    ...amountIssues.warnings,
    ...(missingClassification ? ["Label or category is missing"] : []),
    ...(reconciliation
      ? ["Transfer, funding or reimbursement needs reconciliation"]
      : []),
    ...pending.map((p) => p.reason || "Agent suggestion needs a decision"),
    ...(row.reviewStatus === "rejected"
      ? ["Suggestion rejected; review the current classification"]
      : []),
    ...(row.reviewStatus === "unresolved"
      ? [payload.metadata?.assistantNote || "Agent left this row unresolved"]
      : []),
  ];
  return {
    labelling,
    reconciliation,
    amountErrors,
    needsReview:
      labelling ||
      reconciliation ||
      flagged ||
      pending.length > 0 ||
      amountErrors.length > 0 ||
      amountIssues.warnings.length > 0,
    pendingProposals: pending.length,
    reasons: [...new Set(reasons)],
  };
}
/** Review every row of a draft; rows must be in statement (rowIndex) order. */
export function reviewDraftRows(rows: Row[], options: { runningBalance?: boolean } = {}) {
  const issues = draftAmountIssues(rows.map((row) => row.currentPayload), options);
  return rows.map((row, index) => reviewDraftRow(row, issues[index]));
}
export function summarizeDraftReview(rows: Row[], options: { runningBalance?: boolean } = {}) {
  const reviews = reviewDraftRows(rows, options);
  return {
    total: rows.length,
    selected: rows.filter((r) => r.selected).length,
    needsReview: reviews.filter((r) => r.needsReview).length,
    labelling: reviews.filter((r) => r.labelling).length,
    reconciliation: reviews.filter((r) => r.reconciliation).length,
    ready: reviews.filter((r) => !r.needsReview).length,
    amountErrors: reviews.filter((r) => r.amountErrors.length > 0).length,
  };
}
