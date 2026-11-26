/**
 * A staged statement's reconcile plan as the apps get it (data-service
 * reconcile-plan.ts), with the words both apps show for it. A draft has a plan
 * only when its account and period already have logged entries; otherwise it
 * is a plain import and `reconcile` is null.
 */
export type ReconcileEntry = {
  id: string;
  accountId: string | null;
  accountName: string | null;
  date: string;
  description: string;
  label: string | null;
  amountIn: number | null;
  amountOut: number | null;
  currency: string | null;
  entrySource: string;
  categoryId: string | null;
  reviewStatus: string | null;
  imageId: string | null;
};

export type ReconcileMatch = {
  rowId: string;
  rowIndex: number;
  transactionId: string;
  entry: ReconcileEntry;
  mode: "auto" | "manual";
  score: number | null;
  reasons: string[];
  days: number;
  amountDifference: number;
  warnings: string[];
  errors: string[];
};

export type ReconcileGap = {
  rowId: string;
  rowIndex: number;
  unmatched: boolean;
  candidates: Array<{ transactionId: string; score: number; reasons: string[] }>;
};

export type LeftoverAction = "keep" | "delete" | "move";
export type LeftoverReasonCode = "pending" | "possible_duplicate" | "wrong_amount" | "wrong_account" | "not_found";

export type ReconcileLeftover = {
  entry: ReconcileEntry;
  reasons: Array<{ code: LeftoverReasonCode; message: string; rowId?: string; accountId?: string; transactionId?: string }>;
  action: LeftoverAction;
  accountId: string | null;
  suggestedAction: LeftoverAction | "link";
  suggestedRowId: string | null;
  errors: string[];
};

export type ReconcilePlan = {
  accounts: Array<{ accountId: string; from: string; to: string; logged: number }>;
  matched: ReconcileMatch[];
  gaps: ReconcileGap[];
  leftovers: ReconcileLeftover[];
  summary: {
    matched: number;
    gaps: number;
    leftovers: number;
    amountWarnings: number;
    toDelete: number;
    toMove: number;
    errors: number;
  };
};

/** What the user sends to change the plan (PATCH /drafts/:id/reconcile). */
export type ReconcileChange = {
  rows?: Array<{ rowId: string; transactionId: string | null | "auto" }>;
  entries?: Array<{ transactionId: string; action: LeftoverAction; accountId?: string | null }>;
};

export const LEFTOVER_REASON_LABELS: Record<LeftoverReasonCode, string> = {
  pending: "Pending",
  possible_duplicate: "Possible duplicate",
  wrong_amount: "Wrong amount",
  wrong_account: "Wrong account",
  not_found: "Not on the statement",
};

export const LEFTOVER_ACTION_LABELS: Record<LeftoverAction, string> = {
  keep: "Keep as is",
  delete: "Delete",
  move: "Move to another account",
};

export const SUGGESTED_ACTION_LABELS: Record<ReconcileLeftover["suggestedAction"], string> = {
  keep: "Keep it",
  delete: "Delete it",
  move: "Move it",
  link: "Link it to the statement row",
};

/** "-12.30" for money out, "+12.30" for money in. */
export function reconcileAmount(side: { amountIn: number | null; amountOut: number | null }) {
  const amountIn = Number(side.amountIn || 0);
  return amountIn > 0 ? `+${amountIn.toFixed(2)}` : `-${Number(side.amountOut || 0).toFixed(2)}`;
}

export const entryTitle = (entry: Pick<ReconcileEntry, "label" | "description">) =>
  entry.label || entry.description;

/** One line for the review's header, e.g. "3 matched · 2 new · 1 logged but not on the statement". */
export function reconcileHeadline(plan: Pick<ReconcilePlan, "summary">) {
  const { matched, gaps, leftovers } = plan.summary;
  return [
    `${matched} matched`,
    `${gaps} new`,
    `${leftovers} logged but not on the statement`,
  ].join(" · ");
}

/** The drafts' plans together, for a review of several statements. */
export function combinedPlans<D extends { id: string; sourceFilename?: string; reconcile?: ReconcilePlan | null }>(
  drafts: D[],
) {
  return drafts.flatMap((draft) => (draft.reconcile ? [{ draft, plan: draft.reconcile }] : []));
}
