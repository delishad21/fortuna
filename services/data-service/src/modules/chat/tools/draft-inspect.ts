import { z } from "zod";
import { idSchema } from "../contracts";
import { draftAmountIssues } from "../../imports/draft-review";
import { paylahRowCounts } from "../../imports/paylah-emails";

/**
 * What inspect_staged_import returns. By default a summary of the draft, small enough to
 * read many times in one run; rows only when asked for, filtered and paged, with the
 * fields the model names. A whole 130-row draft was about 260 KB per call.
 */

export const ROW_FIELDS = [
  "date",
  "description",
  "amounts",
  "balance",
  "account",
  "label",
  "category",
  "linkage",
  "review",
  "status",
  "metadata",
  "links",
  "proposals",
  "parsed",
  "payload",
] as const;
type RowField = (typeof ROW_FIELDS)[number];
const DEFAULT_FIELDS: RowField[] = [
  "date",
  "description",
  "amounts",
  "label",
  "category",
  "linkage",
  "review",
];
export const PAGE_LIMIT = 100;
const SUMMARY_REVIEW_ROWS = 15;
const SUMMARY_AMOUNT_ISSUES = 20;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const inspectSchema = z
  .object({
    draftId: idSchema,
    rowIds: z.array(idSchema).min(1).max(PAGE_LIMIT).optional(),
    needsReview: z.boolean().optional(),
    unlabelled: z.boolean().optional(),
    direction: z.enum(["in", "out"]).optional(),
    dateFrom: day.optional(),
    dateTo: day.optional(),
    search: z.string().trim().min(1).max(120).optional(),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(PAGE_LIMIT).optional(),
    fields: z.array(z.enum(ROW_FIELDS)).min(1).max(ROW_FIELDS.length).optional(),
  })
  .strict();
export type InspectInput = z.infer<typeof inspectSchema>;

/** True when the call asks for rows rather than the summary. */
export const wantsRows = (input: InspectInput) =>
  Object.keys(input).some((key) => key !== "draftId");

export const inspectJsonSchema = {
  type: "object",
  properties: {
    draftId: { type: "string" },
    rowIds: {
      type: "array",
      items: { type: "string" },
      maxItems: PAGE_LIMIT,
      description: "Only these rows",
    },
    needsReview: {
      type: "boolean",
      description: "Only rows that need review (amount problems, missing label or category, pending suggestions)",
    },
    unlabelled: {
      type: "boolean",
      description: "Only rows missing a label, or missing a category without being internal or a reimbursement",
    },
    direction: {
      enum: ["in", "out"],
      description: "in = credits (money in) only; out = debits only",
    },
    dateFrom: { type: "string", description: "YYYY-MM-DD, inclusive" },
    dateTo: { type: "string", description: "YYYY-MM-DD, inclusive" },
    search: {
      type: "string",
      description: "Text the description or label contains, case-insensitive (e.g. 'TOP-UP TO PAYLAH')",
    },
    offset: { type: "integer", minimum: 0 },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: PAGE_LIMIT,
      description: `Rows per page, at most ${PAGE_LIMIT} (default 50)`,
    },
    fields: {
      type: "array",
      items: { enum: [...ROW_FIELDS] },
      description:
        "Row fields to return besides id, rowIndex and version. Default: date, description, amounts, label, category, linkage, review. Others: balance, account, status (reviewStatus, selected), metadata, links (reimbursement links), proposals (pending suggestions), parsed (the parser's original row), payload (the full current row).",
    },
  },
  required: ["draftId"],
  additionalProperties: false,
};

type Payload = Record<string, any>;
type DraftRow = {
  id: string;
  rowIndex: number;
  version: number;
  selected: boolean;
  reviewStatus: string;
  parsedPayload?: unknown;
  currentPayload: unknown;
  links?: unknown;
  proposals?: Array<{
    id: string;
    status: string;
    proposedLabel?: string | null;
    proposedCategoryId?: string | null;
    proposedLinkage?: unknown;
    confidence?: unknown;
    reason?: string | null;
  }>;
  review?: { needsReview: boolean; reasons: string[] };
};
export type InspectableDraft = {
  id: string;
  sourceFilename: string;
  status: string;
  mode: string;
  version: number;
  parserId: string | null;
  parserVersion: string | null;
  targetTripId: string | null;
  expiresAt: Date;
  error: string | null;
  reviewSummary: unknown;
  rows: DraftRow[];
};

const payloadOf = (row: { currentPayload: unknown }) =>
  (row.currentPayload || {}) as Payload;
const cents = (value: unknown) => Math.round(Number(value || 0) * 100);
const money = (value: number) => (value / 100).toFixed(2);
const dateOf = (payload: Payload) => {
  const value = payload.date ?? payload.transactionDate;
  return value ? String(value).slice(0, 10) : null;
};
const clip = (value: unknown, length: number) => {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
};
const amountsOf = (payload: Payload) => ({
  ...(cents(payload.amountIn) ? { amountIn: money(cents(payload.amountIn)) } : {}),
  ...(cents(payload.amountOut) ? { amountOut: money(cents(payload.amountOut)) } : {}),
  currency: payload.currency || payload.metadata?.currency || null,
});
const linkageType = (payload: Payload) =>
  (payload.linkage && typeof payload.linkage === "object" && payload.linkage.type) || null;

/** No label, or no category on a row that isn't internal or a reimbursement. */
export function isUnlabelled(payload: Payload) {
  return !String(payload.label || "").trim() || (!payload.categoryId && !linkageType(payload));
}

function rowView(row: DraftRow, fields: Set<RowField>) {
  const payload = payloadOf(row);
  const view: Record<string, unknown> = {
    id: row.id,
    rowIndex: row.rowIndex,
    version: row.version,
  };
  if (fields.has("date")) view.date = dateOf(payload);
  if (fields.has("description")) view.description = payload.description ?? null;
  if (fields.has("amounts")) Object.assign(view, amountsOf(payload));
  if (fields.has("balance")) view.balance = payload.balance ?? null;
  if (fields.has("account")) view.accountIdentifier = payload.accountIdentifier ?? null;
  if (fields.has("label")) view.label = payload.label ?? null;
  if (fields.has("category")) view.categoryId = payload.categoryId ?? null;
  if (fields.has("linkage")) view.linkage = linkageType(payload);
  if (fields.has("review") && row.review)
    view.review = row.review.needsReview
      ? { needsReview: true, reasons: row.review.reasons.map((r) => clip(r, 200)) }
      : { needsReview: false };
  if (fields.has("status")) {
    view.reviewStatus = row.reviewStatus;
    view.selected = row.selected;
  }
  if (fields.has("metadata")) view.metadata = payload.metadata ?? null;
  if (fields.has("links")) view.links = row.links ?? null;
  if (fields.has("proposals"))
    view.proposals = (row.proposals || [])
      .filter((p) => p.status === "proposed")
      .map((p) => ({
        id: p.id,
        proposedLabel: p.proposedLabel ?? null,
        proposedCategoryId: p.proposedCategoryId ?? null,
        ...(p.proposedLinkage ? { proposedLinkage: p.proposedLinkage } : {}),
        confidence: p.confidence === undefined ? null : Number(p.confidence),
        reason: p.reason ?? null,
      }));
  if (fields.has("parsed")) view.parsed = row.parsedPayload ?? null;
  if (fields.has("payload")) view.payload = payload;
  return view;
}

/** One page of the draft's rows that pass every filter given. */
export function draftRowsPage(draft: InspectableDraft, input: InspectInput) {
  const ids = input.rowIds ? new Set(input.rowIds) : null;
  const needle = input.search?.toLowerCase();
  const matching = draft.rows.filter((row) => {
    const payload = payloadOf(row);
    const date = dateOf(payload);
    if (ids && !ids.has(row.id)) return false;
    if (input.needsReview !== undefined && !!row.review?.needsReview !== input.needsReview)
      return false;
    if (input.unlabelled !== undefined && isUnlabelled(payload) !== input.unlabelled)
      return false;
    if (input.direction === "in" && !cents(payload.amountIn)) return false;
    if (input.direction === "out" && !cents(payload.amountOut)) return false;
    if (input.dateFrom && (!date || date < input.dateFrom)) return false;
    if (input.dateTo && (!date || date > input.dateTo)) return false;
    if (
      needle &&
      !String(payload.description || "").toLowerCase().includes(needle) &&
      !String(payload.label || "").toLowerCase().includes(needle)
    )
      return false;
    return true;
  });
  const offset = input.offset || 0;
  const limit = input.limit || 50;
  const page = matching.slice(offset, offset + limit);
  const fields = new Set(input.fields || DEFAULT_FIELDS);
  const missing = ids
    ? input.rowIds!.filter((id) => !draft.rows.some((row) => row.id === id))
    : [];
  return {
    draftId: draft.id,
    version: draft.version,
    status: draft.status,
    total: matching.length,
    offset,
    limit,
    nextOffset: offset + page.length < matching.length ? offset + page.length : null,
    ...(missing.length ? { notInDraft: missing } : {}),
    rows: page.map((row) => rowView(row, fields)),
  };
}

/** Money in and out per account and currency, with the dates the rows cover. */
export function draftTotals(rows: Array<{ currentPayload: unknown }>) {
  const groups = new Map<
    string,
    {
      accountIdentifier: string | null;
      currency: string | null;
      rows: number;
      credits: number;
      debits: number;
      moneyIn: number;
      moneyOut: number;
      firstDate: string | null;
      lastDate: string | null;
    }
  >();
  for (const row of rows) {
    const payload = payloadOf(row);
    const account = payload.accountIdentifier ? String(payload.accountIdentifier) : null;
    const currency = String(payload.currency || payload.metadata?.currency || "") || null;
    const key = `${account}|${currency}`;
    const group = groups.get(key) || {
      accountIdentifier: account,
      currency,
      rows: 0,
      credits: 0,
      debits: 0,
      moneyIn: 0,
      moneyOut: 0,
      firstDate: null,
      lastDate: null,
    };
    const date = dateOf(payload);
    group.rows += 1;
    if (cents(payload.amountIn)) group.credits += 1;
    if (cents(payload.amountOut)) group.debits += 1;
    group.moneyIn += cents(payload.amountIn);
    group.moneyOut += cents(payload.amountOut);
    if (date && (!group.firstDate || date < group.firstDate)) group.firstDate = date;
    if (date && (!group.lastDate || date > group.lastDate)) group.lastDate = date;
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    moneyIn: money(group.moneyIn),
    moneyOut: money(group.moneyOut),
  }));
}

/** PayLah rows still to name, and what the chat can do about them. */
function paylahSection(
  rows: DraftRow[],
  gmailConnected: boolean,
  period: { from: string | null; to: string | null },
) {
  const { unmatchedTopUps, unhandledMaxOuts } = paylahRowCounts(rows);
  if (!unmatchedTopUps && !unhandledMaxOuts) return {};
  const counts = `This draft has ${unmatchedTopUps} PayLah payment row(s) (TOP-UP TO PAYLAH!) without an email match and ${unhandledMaxOuts} PayLah receipt row(s) (MAXED OUT FROM PAYLAH!) not yet handled.`;
  const hint = gmailConnected
    ? `${counts} Gmail is connected: call get_paylah_email_guide, then search_paylah_emails${period.from && period.to ? ` with from ${period.from} and to ${period.to}` : ""}, and name the rows with update_staged_rows as the guide says. Find them with inspect_staged_import search 'PAYLAH'.`
    : `${counts} Gmail isn't connected, so they can't be named from PayLah alert emails. Tell the user they can connect Gmail in Settings to have them named; don't guess who was paid.`;
  return {
    paylah: { unmatchedTopUps, unhandledMaxOuts, gmailConnected },
    paylahHint: hint,
  };
}

/** The default inspect_staged_import result: counts, issues and pointers, no full rows. */
export function draftSummary(
  draft: InspectableDraft,
  extras: { gmailConnected: boolean; parserVersionNote?: string },
) {
  const payloads = draft.rows.map(payloadOf);
  const issues = draftAmountIssues(payloads, { runningBalance: draft.mode !== "trip" });
  const amountIssues = draft.rows.flatMap((row, index) =>
    issues[index].errors.length || issues[index].warnings.length
      ? [
          {
            rowId: row.id,
            rowIndex: row.rowIndex,
            version: row.version,
            date: dateOf(payloads[index]),
            description: clip(payloads[index].description, 80),
            errors: issues[index].errors.map((e) => clip(e, 240)),
            warnings: issues[index].warnings.map((w) => clip(w, 240)),
          },
        ]
      : [],
  );
  const byReviewStatus: Record<string, number> = {};
  for (const row of draft.rows)
    byReviewStatus[row.reviewStatus] = (byReviewStatus[row.reviewStatus] || 0) + 1;
  const reviewRows = draft.rows.filter((row) => row.review?.needsReview);
  const dates = payloads.map(dateOf).filter((d): d is string => !!d).sort();
  const period = { from: dates[0] || null, to: dates[dates.length - 1] || null };
  const pendingProposals = draft.rows.reduce(
    (n, row) => n + (row.proposals || []).filter((p) => p.status === "proposed").length,
    0,
  );
  return {
    id: draft.id,
    sourceFilename: draft.sourceFilename,
    status: draft.status,
    mode: draft.mode,
    version: draft.version,
    parserId: draft.parserId,
    parserVersion: draft.parserVersion,
    ...(draft.targetTripId ? { targetTripId: draft.targetTripId } : {}),
    expiresAt: draft.expiresAt,
    ...(draft.error ? { error: draft.error } : {}),
    ...(extras.parserVersionNote ? { parserVersionNote: extras.parserVersionNote } : {}),
    reviewSummary: draft.reviewSummary,
    counts: {
      rows: draft.rows.length,
      selected: draft.rows.filter((row) => row.selected).length,
      credits: payloads.filter((p) => cents(p.amountIn) > 0).length,
      debits: payloads.filter((p) => cents(p.amountOut) > 0).length,
      unlabelled: payloads.filter(isUnlabelled).length,
      needsReview: reviewRows.length,
      linked: payloads.filter((p) => linkageType(p)).length,
      pendingSuggestions: pendingProposals,
      byReviewStatus,
    },
    period,
    totals: draftTotals(draft.rows),
    ...(amountIssues.length
      ? {
          amountIssueCount: amountIssues.length,
          amountIssues: amountIssues.slice(0, SUMMARY_AMOUNT_ISSUES),
          amountIssuesNote:
            "These rows' amounts don't match the statement as parsed. Tell the user before suggesting labels; don't commit until they're fixed.",
        }
      : {}),
    ...paylahSection(draft.rows, extras.gmailConnected, period),
    rowsNeedingReview: {
      total: reviewRows.length,
      first: reviewRows.slice(0, SUMMARY_REVIEW_ROWS).map((row) => {
        const payload = payloadOf(row);
        return {
          id: row.id,
          rowIndex: row.rowIndex,
          version: row.version,
          date: dateOf(payload),
          description: clip(payload.description, 80),
          ...amountsOf(payload),
          label: payload.label ?? null,
          categoryId: payload.categoryId ?? null,
          reasons: (row.review?.reasons || []).slice(0, 3).map((r) => clip(r, 160)),
        };
      }),
    },
    readRows: `This is a summary. To read rows, call inspect_staged_import again with filters (rowIds, needsReview, unlabelled, direction, dateFrom/dateTo, search), offset/limit (at most ${PAGE_LIMIT} per page) and fields; each row comes with its id and current version for update_staged_rows and suggest_draft_labels.`,
  };
}
