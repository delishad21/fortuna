/** Display logic for approval previews, shared by web and mobile. No server or UI dependencies. */

export type CategoryChip = { name: string; color: string | null };
export type LinkedSummary = {
  id: string;
  date?: string | null;
  description?: string | null;
  label?: string | null;
  amountIn?: string | number | null;
  amountOut?: string | number | null;
  currency?: string | null;
  accountIdentifier?: string | null;
};
export type PreviewReferences = {
  transactions?: Record<string, LinkedSummary>;
  stagedRows?: Record<string, LinkedSummary>;
  categories?: Record<string, CategoryChip>;
  accounts?: Record<string, string | null>;
};
/** One side (before or after) of a transaction edit. */
export type TransactionSide = LinkedSummary & {
  balance?: string | number | null;
  category?:
    | { id?: string; name: string; color?: string | null }
    | string
    | null;
  linkage?: any;
};
export type FieldDiff = { key: string; before: unknown; after: unknown };
export type ChangeGroup = {
  diffs: FieldDiff[];
  transactions: TransactionSide[];
};

export const FIELD_LABELS: Record<string, string> = {
  category: "Category",
  linkage: "Type",
  label: "Label",
  description: "Description",
  date: "Date",
  amountOut: "Money out",
  amountIn: "Money in",
  balance: "Balance",
  currency: "Currency",
  accountIdentifier: "Account",
};
const FIELD_ORDER = Object.keys(FIELD_LABELS);
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Fields that differ, in a stable reading order. */
export function transactionDiffs(
  before: TransactionSide,
  after: TransactionSide,
): FieldDiff[] {
  return FIELD_ORDER.filter(
    (key) => !same((before as any)[key], (after as any)[key]),
  ).map((key) => ({
    key,
    before: (before as any)[key],
    after: (after as any)[key],
  }));
}

/** Bulk edits usually repeat one change; show it once above the affected transactions. */
export function groupTransactionChanges(
  changes: Array<{
    id: string;
    before: TransactionSide;
    after: TransactionSide;
  }>,
): ChangeGroup[] {
  const groups = new Map<string, ChangeGroup>();
  for (const change of changes || []) {
    const diffs = transactionDiffs(change.before, change.after);
    const key = JSON.stringify(diffs);
    const group = groups.get(key) || { diffs, transactions: [] };
    group.transactions.push({ ...change.before, id: change.id });
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function categoryChip(value: unknown): CategoryChip | null {
  if (!value) return null;
  if (typeof value === "string") return { name: value, color: null };
  const v = value as { name?: string; color?: string | null };
  return v.name ? { name: v.name, color: v.color ?? null } : null;
}

export type LinkageView = {
  kind: "none" | "internal" | "reimbursement" | "reimbursed";
  label: string;
  links: Array<{
    id: string;
    amount: number | null;
    summary: LinkedSummary | null;
    staged: boolean;
  }>;
  leftover: CategoryChip | null;
};
/** Turn a linkage object into words and resolved linked transactions. */
export function linkageView(
  linkage: any,
  references: PreviewReferences = {},
): LinkageView {
  const type = linkage?.type;
  const allocations =
    type === "reimbursement"
      ? linkage?.reimbursesAllocations || []
      : type === "reimbursed"
        ? linkage?.reimbursedByAllocations || []
        : [];
  return {
    kind: type || "none",
    label:
      type === "internal"
        ? "Internal transfer"
        : type === "reimbursement"
          ? "Reimbursement"
          : type === "reimbursed"
            ? "Reimbursed"
            : "Regular transaction",
    links: allocations.map((a: any) => {
      const staged = !a.transactionId && !!a.stagedRowId;
      const id = String(a.transactionId || a.stagedRowId || "");
      return {
        id,
        amount: a.amount == null ? null : Number(a.amount),
        summary:
          (staged
            ? references.stagedRows?.[id]
            : references.transactions?.[id]) || null,
        staged,
      };
    }),
    leftover: linkage?.leftoverCategoryId
      ? references.categories?.[linkage.leftoverCategoryId] || {
          name: "Another category",
          color: null,
        }
      : null,
  };
}

export const transactionTitle = (t: LinkedSummary) =>
  (t.label && String(t.label).trim()) || t.description || "Transaction";
export const signedAmount = (t: LinkedSummary) => {
  const income = t.amountIn != null && Number(t.amountIn) !== 0;
  return {
    income,
    value: Math.abs(Number(income ? t.amountIn : t.amountOut) || 0),
  };
};
export const shortDate = (value: unknown) => {
  const d = new Date(String(value));
  return Number.isNaN(d.getTime())
    ? String(value ?? "")
    : d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
};

/** Plain-text rendering for simple fields; category and linkage have their own views. */
export function fieldText(
  key: string,
  value: unknown,
  currency: string,
  money: (amount: number, currency: string) => string,
) {
  if (value === null || value === undefined || value === "") return "None";
  if (key === "date") return shortDate(value);
  if (["amountIn", "amountOut", "balance"].includes(key))
    return money(Number(value), currency);
  return String(value);
}

/** A rule as readable conditions and effects. */
export function ruleSummary(rule: any) {
  if (!rule) return null;
  const conditions = [
    rule.matchType === "always"
      ? "Every transaction"
      : `Description contains “${rule.matchValue || ""}”${rule.caseSensitive ? " (case-sensitive)" : ""}`,
    rule.accountIdentifier
      ? `Account ${rule.accountIdentifier}`
      : "Any account",
    rule.parserId ? `Parser ${rule.parserId}` : "Any parser",
  ];
  const effects = [
    ...(rule.markInternal ? ["Mark as internal transfer"] : []),
    ...(rule.setLabel ? [`Set label “${rule.setLabel}”`] : []),
    ...(rule.setCategoryName ? [`Set category “${rule.setCategoryName}”`] : []),
  ];
  return {
    name: rule.name as string,
    enabled: rule.enabled !== false,
    conditions,
    effects: effects.length ? effects : ["No changes"],
  };
}

/** Friendly labels for summary keys from staged-import and parser previews. */
export const SUMMARY_LABELS: Record<string, string> = {
  rows: "Rows",
  selected: "Selected",
  autoApplied: "Auto-labelled",
  needsReview: "Need review",
  accountIdentifiers: "Accounts",
  missingAccountAssignments: "Missing account",
  unknownAccountIdentifiers: "Unknown accounts",
  parserId: "Parser",
  parserType: "Parser type",
  status: "Status",
  name: "Name",
  fileType: "File type",
  version: "Version",
  versionStatus: "Version status",
  currentlyActive: "Currently active",
};
export const summaryLabel = (key: string) =>
  SUMMARY_LABELS[key] ||
  key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
export const summaryValue = (value: unknown): string =>
  value === null || value === undefined
    ? "None"
    : typeof value === "boolean"
      ? value
        ? "Yes"
        : "No"
      : Array.isArray(value)
        ? value.length
          ? value.join(", ")
          : "None"
        : typeof value === "object"
          ? Object.entries(value as object)
              .map(([k, v]) => `${summaryLabel(k)}: ${summaryValue(v)}`)
              .join(" · ")
          : String(value);
