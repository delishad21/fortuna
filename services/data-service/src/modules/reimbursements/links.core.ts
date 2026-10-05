/**
 * Pure helpers for reimbursement links. Kept free of database access so the
 * rules can be unit tested.
 */

export type Role = "reimbursement" | "expense";

export type EndRef =
  | { transactionId: string; draftRowId?: undefined }
  | { draftRowId: string; transactionId?: undefined };

export type LinkRow = {
  id: string;
  amount: number;
  reimbursementTransactionId: string | null;
  reimbursementDraftRowId: string | null;
  expenseTransactionId: string | null;
  expenseDraftRowId: string | null;
};

export type EndInfo = {
  key: string;
  kind: "transaction" | "draftRow";
  id: string;
  amountIn: number;
  amountOut: number;
  linkageType: string | null;
  linkage: Record<string, unknown> | null;
  description: string;
  label: string | null;
  date: string | null;
  draftId?: string;
  draftStatus?: string;
  draftMode?: string;
  draftFilename?: string;
  draftCreatedAt?: Date;
  selected?: boolean;
  rowIndex?: number;
};

export const CLOSED_DRAFT_STATUSES = ["committed", "discarded", "expired"];
export const EPSILON = 0.005;

export class LinkError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export const money = (value: number) => Number(Number(value || 0).toFixed(2));

export const toNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const formatMoney = (value: number) => `$${money(value).toFixed(2)}`;

export const transactionKey = (id: string) => `t:${id}`;
export const draftRowKey = (id: string) => `r:${id}`;

export const keyOf = (ref: EndRef) =>
  ref.transactionId
    ? transactionKey(ref.transactionId)
    : draftRowKey(ref.draftRowId as string);

export const refOf = (key: string): EndRef =>
  key.startsWith("t:")
    ? { transactionId: key.slice(2) }
    : { draftRowId: key.slice(2) };

export const reimbursementKeyOf = (link: LinkRow) =>
  link.reimbursementTransactionId
    ? transactionKey(link.reimbursementTransactionId)
    : draftRowKey(link.reimbursementDraftRowId as string);

export const expenseKeyOf = (link: LinkRow) =>
  link.expenseTransactionId
    ? transactionKey(link.expenseTransactionId)
    : draftRowKey(link.expenseDraftRowId as string);

export const otherRole = (role: Role): Role =>
  role === "reimbursement" ? "expense" : "reimbursement";

/** The key of the end playing `role` in this link. */
export const endKeyFor = (link: LinkRow, role: Role) =>
  role === "reimbursement" ? reimbursementKeyOf(link) : expenseKeyOf(link);

export const isSavedLink = (link: LinkRow) =>
  !!link.reimbursementTransactionId && !!link.expenseTransactionId;

export const capacityOf = (end: EndInfo, role: Role) =>
  role === "reimbursement" ? end.amountIn : end.amountOut;

export const describeEnd = (end: EndInfo) => {
  const name = (end.label || end.description || "Transaction").trim();
  const date = end.date ? ` on ${end.date.slice(0, 10)}` : "";
  const where =
    end.kind === "draftRow" && end.draftFilename
      ? ` (row ${(end.rowIndex ?? 0) + 1} of ${end.draftFilename})`
      : "";
  return `"${name}"${date}${where}`;
};

/** Why `end` cannot play `role` in a link, or null when it can. */
export function roleProblem(end: EndInfo, role: Role): string | null {
  if (end.kind === "draftRow") {
    if (end.draftStatus && CLOSED_DRAFT_STATUSES.includes(end.draftStatus))
      return `${describeEnd(end)} is in an import that is already ${end.draftStatus}`;
    if (end.draftMode && end.draftMode !== "main")
      return `${describeEnd(end)} is in a trip import; trip reimbursements are linked in the trip`;
  }
  if (role === "reimbursement") {
    if (!(end.amountIn > 0)) return `${describeEnd(end)} is not money in`;
    if (end.linkageType !== "reimbursement")
      return `${describeEnd(end)} is not marked as a reimbursement`;
    return null;
  }
  if (!(end.amountOut > 0)) return `${describeEnd(end)} is not money out`;
  if (end.linkageType === "internal")
    return `${describeEnd(end)} is an internal transfer`;
  if (end.linkageType === "reimbursement")
    return `${describeEnd(end)} is marked as a reimbursement`;
  return null;
}

/**
 * Splits the links held by one end into amounts that count against its limit
 * (`hard`) and claims from unrelated staged imports (`pending`).
 *
 * A staged row's links all count: they must be committed together with it.
 * For a saved transaction, saved links count, and so do staged links from the
 * drafts in `relatedDraftIds` (the files being linked or committed together).
 * Claims from any other open draft are pending: first save wins.
 */
export function classifyEndLinks(
  end: EndInfo,
  role: Role,
  links: LinkRow[],
  ends: Map<string, EndInfo>,
  relatedDraftIds: Set<string>,
) {
  let hard = 0;
  const pending: Array<{
    amount: number;
    draftId: string;
    filename: string;
    createdAt?: Date;
    linkId: string;
  }> = [];
  for (const link of links) {
    if (endKeyFor(link, role) !== end.key) continue;
    const other = ends.get(endKeyFor(link, otherRole(role)));
    if (end.kind === "draftRow") {
      hard += link.amount;
      continue;
    }
    if (!other || other.kind === "transaction") {
      hard += link.amount;
      continue;
    }
    if (other.draftStatus && CLOSED_DRAFT_STATUSES.includes(other.draftStatus))
      continue;
    if (other.draftId && relatedDraftIds.has(other.draftId)) {
      hard += link.amount;
      continue;
    }
    pending.push({
      amount: link.amount,
      draftId: other.draftId || "",
      filename: other.draftFilename || "a staged import",
      createdAt: other.draftCreatedAt,
      linkId: link.id,
    });
  }
  return { hard: money(hard), pending };
}

const relativeAge = (date?: Date) => {
  if (!date) return "";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return " (staged today)";
  if (days === 1) return " (staged yesterday)";
  if (days < 14) return ` (staged ${days} days ago)`;
  return ` (staged ${Math.round(days / 7)} weeks ago)`;
};

export function pendingWarning(
  end: EndInfo,
  pending: ReturnType<typeof classifyEndLinks>["pending"],
) {
  const byDraft = new Map<string, (typeof pending)[number]>();
  for (const item of pending) {
    const current = byDraft.get(item.draftId);
    byDraft.set(
      item.draftId,
      current ? { ...current, amount: current.amount + item.amount } : item,
    );
  }
  return [...byDraft.values()].map(
    (item) =>
      `${formatMoney(item.amount)} of ${describeEnd(end)} is also claimed by ${item.filename}${relativeAge(item.createdAt)}. Whichever import is saved first keeps it.`,
  );
}

export function overLimitMessage(end: EndInfo, role: Role, hard: number) {
  const capacity = capacityOf(end, role);
  return role === "reimbursement"
    ? `${describeEnd(end)} is ${formatMoney(capacity)} but would pay back ${formatMoney(hard)}`
    : `${describeEnd(end)} is ${formatMoney(capacity)} but would be reimbursed ${formatMoney(hard)}`;
}

/** Merge duplicate targets and drop non-positive amounts. */
export function normalizeDesired(
  links: Array<{ other: EndRef; amount: number }>,
) {
  const merged = new Map<string, number>();
  for (const link of links) {
    const amount = toNumber(link.amount);
    if (!Number.isFinite(amount) || amount < 0)
      throw new LinkError("Link amounts must be positive");
    const key = keyOf(link.other);
    merged.set(key, (merged.get(key) || 0) + amount);
  }
  return [...merged.entries()]
    .map(([key, amount]) => ({ key, amount: money(amount) }))
    .filter((item) => item.amount > 0);
}

const LINK_FIELDS = [
  "reimbursesAllocations",
  "reimbursedByAllocations",
  "leftoverAmount",
] as const;

/** Linkage JSON without the link data that now lives in the links table. */
export function stripLinkFields(linkage: unknown): Record<string, unknown> | null {
  if (!linkage || typeof linkage !== "object" || Array.isArray(linkage))
    return null;
  const rest: Record<string, unknown> = { ...(linkage as Record<string, unknown>) };
  for (const field of LINK_FIELDS) delete rest[field];
  if (rest.type === "reimbursed" || typeof rest.type !== "string") return null;
  return rest;
}

const byTransactionId = (
  a: { transactionId: string },
  b: { transactionId: string },
) => a.transactionId.localeCompare(b.transactionId);

/**
 * The cached `linkage` JSON a saved transaction should hold, given its saved
 * links. Staged links are not part of the cache: they are pending until commit.
 */
export function canonicalLinkage(
  current: unknown,
  amountIn: number,
  asReimbursement: Array<{ transactionId: string; amount: number }>,
  asExpense: Array<{ transactionId: string; amount: number }>,
): Record<string, unknown> | null {
  const base =
    current && typeof current === "object" && !Array.isArray(current)
      ? ({ ...(current as Record<string, unknown>) } as Record<string, unknown>)
      : null;
  const type = typeof base?.type === "string" ? (base.type as string) : null;
  const rest: Record<string, unknown> = { ...(base || {}) };
  for (const field of LINK_FIELDS) delete rest[field];

  if (type === "internal") return { ...rest, type: "internal" };
  if (type === "reimbursement") {
    const allocations = asReimbursement
      .map((item) => ({ transactionId: item.transactionId, amount: money(item.amount) }))
      .sort(byTransactionId);
    const total = allocations.reduce((sum, item) => sum + item.amount, 0);
    return {
      ...rest,
      type: "reimbursement",
      reimbursesAllocations: allocations,
      leftoverAmount: money(Math.max(amountIn - total, 0)),
      leftoverCategoryId: (rest.leftoverCategoryId as string | null | undefined) ?? null,
    };
  }
  if (asExpense.length > 0) {
    return {
      ...rest,
      type: "reimbursed",
      reimbursedByAllocations: asExpense
        .map((item) => ({ transactionId: item.transactionId, amount: money(item.amount) }))
        .sort(byTransactionId),
    };
  }
  if (type === null || type === "reimbursed") return null;
  return base;
}

function canonicalJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalJson);
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => [key, canonicalJson((value as Record<string, unknown>)[key])]),
  );
}

export const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(canonicalJson(a ?? null)) === JSON.stringify(canonicalJson(b ?? null));
