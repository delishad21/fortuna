import {
  AnalyticsTransaction,
  formatMonthKey,
  getAccountInfo,
  getCategoryInfo,
  getEffectiveOut,
  normalizeMerchant,
  shiftMonthKey,
} from "./analytics.utils";

export const SPENDING_GROUPS = ["category", "month", "merchant", "account"] as const;
export type SpendingGroup = (typeof SPENDING_GROUPS)[number];

export const MAX_SPENDING_ROWS = 500;

export interface SpendingQuery {
  groupBy: SpendingGroup;
  from: string;
  to: string;
  category?: string;
  limit?: number;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isValidDate = (value: string) =>
  DATE_PATTERN.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** Validates the query string of GET /api/agent/analytics/spending. */
export const parseSpendingQuery = (
  query: Record<string, unknown>,
): { ok: true; value: SpendingQuery } | { ok: false; error: string } => {
  const text = (key: string) => (typeof query[key] === "string" ? (query[key] as string).trim() : "");
  const groupBy = text("groupBy");
  if (!SPENDING_GROUPS.includes(groupBy as SpendingGroup)) {
    return { ok: false, error: "groupBy must be category, month, merchant or account" };
  }
  const from = text("from");
  const to = text("to");
  if (!isValidDate(from) || !isValidDate(to)) {
    return { ok: false, error: "from and to must be dates as YYYY-MM-DD" };
  }
  if (from > to) return { ok: false, error: "from must not be after to" };

  let limit: number | undefined;
  const rawLimit = text("limit");
  if (rawLimit) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SPENDING_ROWS) {
      return { ok: false, error: `limit must be a whole number from 1 to ${MAX_SPENDING_ROWS}` };
    }
  }

  const category = text("category") || undefined;
  return { ok: true, value: { groupBy: groupBy as SpendingGroup, from, to, category, limit } };
};

/** Matches a category by id, by name (any case), or "uncategorized". */
export const matchesCategory = (tx: AnalyticsTransaction, category: string) => {
  const info = getCategoryInfo(tx);
  const wanted = category.trim().toLowerCase();
  return info.id === category || info.name.trim().toLowerCase() === wanted;
};

const round = (value: number) => Number(value.toFixed(2));

/**
 * Money out per category, month, merchant or account, using the same effective
 * spending as the app (reimbursed parts and internal transfers left out).
 * Months cover every month from `from` to `to`, oldest first, including empty
 * ones; categories, merchants and accounts are largest first and leave out zeros.
 * `limit` keeps the largest rows, or the most recent months.
 */
export const buildSpendingRows = (
  transactions: AnalyticsTransaction[],
  query: Pick<SpendingQuery, "groupBy" | "from" | "to" | "limit">,
) => {
  const totals = new Map<string, { label: string; amount: number }>();
  const add = (key: string, label: string, amount: number) => {
    const current = totals.get(key) || { label, amount: 0 };
    current.amount += amount;
    totals.set(key, current);
  };

  if (query.groupBy === "month") {
    const last = query.to.slice(0, 7);
    for (let month = query.from.slice(0, 7); month <= last; month = shiftMonthKey(month, 1)) {
      add(month, month, 0);
    }
  }

  for (const tx of transactions) {
    const amount = getEffectiveOut(tx);
    if (amount <= 0) continue;
    if (query.groupBy === "month") {
      const month = formatMonthKey(tx.date);
      add(month, month, amount);
    } else if (query.groupBy === "category") {
      const category = getCategoryInfo(tx);
      add(category.id, category.name, amount);
    } else if (query.groupBy === "account") {
      const account = getAccountInfo(tx);
      add(account.key, account.name, amount);
    } else {
      const merchant = normalizeMerchant(tx);
      add(merchant.key, merchant.name, amount);
    }
  }

  const rows = Array.from(totals.values()).map((row) => ({ label: row.label, amount: round(row.amount) }));
  if (query.groupBy === "month") {
    rows.sort((a, b) => a.label.localeCompare(b.label));
    return rows.slice(-(query.limit ?? MAX_SPENDING_ROWS));
  }
  return rows
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label))
    .slice(0, query.limit ?? MAX_SPENDING_ROWS);
};
