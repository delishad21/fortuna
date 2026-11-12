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
  /** Friendly account names by identifier. */
  accountLabels?: Record<string, string>;
};
/** "Label · identifier" for an identifier mentioned in a preview, or the identifier alone. */
export const previewAccountName = (
  identifier: string,
  references: PreviewReferences = {},
) =>
  references.accountLabels?.[identifier]
    ? `${references.accountLabels[identifier]} · ${identifier}`
    : identifier;
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
      // Older proposals may address a row of the same import only by position.
      const staged = !a.transactionId;
      const id = String(
        a.transactionId ||
          a.stagedRowId ||
          (typeof a.pendingBatchIndex === "number"
            ? `row:${a.pendingBatchIndex}`
            : ""),
      );
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

/** What a review's pre-filled suggestions change, e.g. "Category → Internal". */
export function reviewSuggestionSummary(
  rows: Array<{ original: any; value: any }>,
  categories: Array<{ id: string; name: string }> = [],
) {
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const effects = new Map<string, number>();
  let changed = 0;
  for (const row of rows || []) {
    const keys = Object.keys(row.value || {}).filter(
      (k) => !same(row.value[k], row.original?.[k]),
    );
    if (!keys.length) continue;
    changed++;
    for (const key of keys) {
      const value = row.value[key];
      const text =
        key === "categoryId"
          ? `Category → ${names.get(value) || "None"}`
          : key === "linkage"
            ? `Type → ${linkageView(value).label}`
            : key === "label"
              ? `Label → ${value || "None"}`
              : `${FIELD_LABELS[key] || key} edited`;
      effects.set(text, (effects.get(text) || 0) + 1);
    }
  }
  return {
    changed,
    total: rows?.length || 0,
    effects: [...effects.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([text]) => text),
  };
}

/** One end of a reimbursement link in an edit preview: a saved transaction or a staged row. */
export type LinkEnd = LinkedSummary & {
  kind: "transaction" | "staged";
  draft?: {
    id: string;
    filename?: string | null;
    parserId?: string | null;
  } | null;
};
export type LinkChange = {
  change: "added" | "removed" | "changed";
  amount: string | number;
  previousAmount?: string | number;
  reimbursement: LinkEnd;
  expense: LinkEnd;
  leftover?: string | number | null;
};
const endAmount = (end: LinkEnd) =>
  Math.abs(Number(end.amountIn ?? end.amountOut ?? 0) || 0);
/** "SINGLIFE · Sep 27, 2026" plus where it lives, e.g. "staged in uob-oct.pdf". */
export function linkEndView(
  end: LinkEnd,
  money: (n: number, c: string) => string,
) {
  return {
    title: transactionTitle(end),
    detail: [
      shortDate(end.date),
      money(endAmount(end), end.currency || "SGD"),
      end.kind === "staged"
        ? `staged${end.draft?.filename ? ` in ${end.draft.filename}` : ""}, not imported yet`
        : "saved",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}
/** Words for one link change: "SGD 1,486.16 of PAYNOW → pays back SINGLIFE; SGD 13.84 left over". */
export function linkChangeView(
  change: LinkChange,
  money: (n: number, c: string) => string,
) {
  const currency =
    change.reimbursement.currency || change.expense.currency || "SGD";
  const amount = money(Number(change.amount), currency);
  const leftover =
    change.leftover != null && Number(change.leftover) > 0
      ? `${money(Number(change.leftover), currency)} left over`
      : null;
  return {
    heading:
      change.change === "added"
        ? "New reimbursement link"
        : change.change === "removed"
          ? "Reimbursement link removed"
          : "Reimbursement amount changed",
    amount:
      change.change === "changed" && change.previousAmount != null
        ? `${money(Number(change.previousAmount), currency)} → ${amount}`
        : amount,
    verb: change.change === "removed" ? "no longer pays back" : "pays back",
    from: linkEndView(change.reimbursement, money),
    to: linkEndView(change.expense, money),
    leftover,
  };
}
/** Whether an edit preview would apply anything; an empty one must not be confirmable. */
export function previewHasChanges(proposal: { kind: string; preview: any }) {
  const preview = proposal.preview || {};
  if (proposal.kind !== "edit_transactions" && !preview.changes) return true;
  return (
    (preview.changes || []).length > 0 || (preview.linkChanges || []).length > 0
  );
}

/** Shown on a proposal that waits for the user. */
export const NEEDS_APPROVAL = "Needs your approval";
/** Why a proposal is closed, in words; never "rejected" unless the user rejected it. */
export const PROPOSAL_STATES: Record<string, string> = {
  pending: NEEDS_APPROVAL,
  applied: "Applied",
  rejected: "Rejected by you",
  expired: "Expired",
  superseded: "Replaced by a newer proposal",
  stale: "Records changed: ask for a fresh preview",
  cancelled: "Closed when you stopped the reply",
  closed: "Closed without a decision",
};
export const REVIEW_STATES: Record<string, string> = {
  pending: "Needs your review",
  queued: "Queued: sends after the current reply",
  submitted: "Sent to Fortuna",
  superseded: "Replaced by a newer review",
  cancelled: "Closed when you stopped the reply",
  closed: "Closed without a decision",
};
/** Pending proposals past their 24 hours read as expired before the server marks them. */
export function proposalState(
  proposal: { status: string; expiresAt?: string },
  now = new Date(),
) {
  const status =
    proposal.status === "pending" &&
    !!proposal.expiresAt &&
    new Date(proposal.expiresAt) <= now
      ? "expired"
      : proposal.status;
  return {
    status,
    pending: status === "pending",
    label: PROPOSAL_STATES[status] || "Closed",
  };
}
/** "5h left", "40m left": how long a pending proposal can still be confirmed. */
export function timeLeft(expiresAt: string | undefined, now = new Date()) {
  if (!expiresAt) return "";
  const minutes = Math.floor(
    (new Date(expiresAt).getTime() - now.getTime()) / 60000,
  );
  if (minutes <= 0) return "";
  if (minutes < 60) return `${minutes}m left`;
  return `${Math.floor(minutes / 60)}h left`;
}
/** "2 changes and 1 review waiting for you", for the bar above the composer. */
export function waitingText(changes: number, reviews: number) {
  const parts = [
    ...(changes ? [`${changes} ${changes === 1 ? "change" : "changes"}`] : []),
    ...(reviews ? [`${reviews} ${reviews === 1 ? "review" : "reviews"}`] : []),
  ];
  if (!parts.length) return "";
  return `${parts.join(" and ")} waiting for ${changes ? "your approval" : "you"}`;
}
/** One-line description of what a proposal would do, for compact cards. */
export function proposalSummary(proposal: {
  kind: string;
  status: string;
  expiresAt?: string;
  preview: any;
}): { title: string; detail: string; color?: string | null; state: string } {
  const preview = proposal.preview || {};
  const state = proposalState(proposal).label;
  const title = preview.title || "Proposed change";
  if (proposal.kind === "edit_transactions" || preview.changes) {
    const changes = preview.changes || [];
    const [first] = groupTransactionChanges(changes);
    const effect = first?.diffs
      .slice(0, 2)
      .map((d) =>
        d.key === "category"
          ? `Category → ${categoryChip(d.after)?.name || "None"}`
          : d.key === "linkage"
            ? `Type → ${linkageView(d.after).label}`
            : `${FIELD_LABELS[d.key] || d.key} edited`,
      )
      .join(" · ");
    const links = preview.linkChanges || [];
    const counts = [
      ...(changes.length
        ? [
            `${changes.length} ${changes.length === 1 ? "transaction" : "transactions"}`,
          ]
        : []),
      ...(links.length
        ? [
            `${links.length} reimbursement ${links.length === 1 ? "link" : "links"}`,
          ]
        : []),
    ];
    return {
      title,
      detail: counts.length
        ? `${counts.join(" · ")}${effect ? ` · ${effect}` : ""}`
        : "Nothing to change",
      state,
    };
  }
  if (proposal.kind === "create_account")
    return {
      title,
      detail: preview.after?.label
        ? `${preview.after.label} · ${preview.after.accountIdentifier}`
        : `${preview.after?.accountIdentifier || "New account"}`,
      color: preview.after?.color,
      state,
    };
  if (proposal.kind === "create_category")
    return {
      title,
      detail: `${preview.after?.name || "New category"}`,
      color: preview.after?.color,
      state,
    };
  if (proposal.kind === "update_import_rule") {
    const rule = ruleSummary({
      ...(preview.before || {}),
      ...(preview.after || {}),
    });
    return {
      title,
      detail: rule
        ? `${rule.conditions[0]} → ${rule.effects[0]}`
        : "Import rule",
      state,
    };
  }
  if (proposal.kind === "retain_fixture") {
    const files = preview.details?.files || [];
    return {
      title,
      detail:
        files.length === 1 ? files[0].filename : `${files.length} statements`,
      state,
    };
  }
  if (proposal.kind === "commit_drafts") {
    const drafts = preview.drafts || [];
    const rows = drafts.reduce(
      (n: number, d: any) =>
        n + Number(d.summary?.selected ?? d.summary?.rows ?? 0),
      0,
    );
    return {
      title,
      detail: `${rows} ${rows === 1 ? "row" : "rows"} from ${drafts.length} ${drafts.length === 1 ? "import" : "imports"}${preview.valid === false ? " · needs attention" : ""}`,
      state,
    };
  }
  if (proposal.kind === "restage_draft" || proposal.kind === "discard_draft")
    return { title, detail: preview.detail || "Staged import", state };
  const details = preview.details || {};
  return {
    title,
    detail:
      [
        details.name || details.parserId,
        details.version && `v${details.version}`,
      ]
        .filter(Boolean)
        .join(" · ") || "Parser change",
    state,
  };
}
