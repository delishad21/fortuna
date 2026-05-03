export type AmountLike = number | string | null | undefined | { toNumber: () => number };

export interface AnalyticsTransaction {
  id: string;
  date: Date;
  description: string;
  label?: string | null;
  amountIn?: AmountLike;
  amountOut?: AmountLike;
  linkage?: unknown;
  categoryId?: string | null;
  category?: { id: string; name: string; color: string } | null;
  accountIdentifier?: string | null;
  source?: string | null;
  importBatchId?: string | null;
}

export const REIMBURSEMENT_LEFTOVER_CATEGORY = {
  id: "__reimbursement_leftover__",
  name: "Reimbursement Leftover",
  color: "#22AD5C",
};

export const toNumber = (value: AmountLike) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (typeof value === "object" && "toNumber" in value) {
    return value.toNumber();
  }
  return Number(value);
};

const getReimbursedAmount = (linkage: unknown) => {
  if (!linkage || typeof linkage !== "object") return 0;
  const allocations = Array.isArray((linkage as any).reimbursedByAllocations)
    ? (linkage as any).reimbursedByAllocations
    : [];
  return allocations.reduce(
    (sum: number, item: any) => sum + Math.max(toNumber(item?.amount), 0),
    0,
  );
};

const isReimbursementLinkage = (linkage: unknown) =>
  !!linkage && typeof linkage === "object" && (linkage as any).type === "reimbursement";

export const getReimbursementAllocatedAmount = (linkage: unknown) => {
  if (!linkage || typeof linkage !== "object") return 0;
  if ((linkage as any).type !== "reimbursement") return 0;
  const allocations = Array.isArray((linkage as any).reimbursesAllocations)
    ? (linkage as any).reimbursesAllocations
    : [];
  return allocations.reduce(
    (sum: number, item: any) => sum + Math.max(toNumber(item?.amount), 0),
    0,
  );
};

export const getReimbursementLeftover = (tx: { amountIn?: AmountLike; linkage?: unknown }) => {
  if (!isReimbursementLinkage(tx.linkage)) return 0;
  const rawIn = Math.max(toNumber(tx.amountIn), 0);
  const allocated = getReimbursementAllocatedAmount(tx.linkage);
  return Number(Math.max(rawIn - allocated, 0).toFixed(2));
};

export const getEffectiveIn = (tx: { amountIn?: AmountLike; linkage?: unknown }) => {
  const rawIn = Math.max(toNumber(tx.amountIn), 0);
  if (isReimbursementLinkage(tx.linkage)) return 0;
  return Number(rawIn.toFixed(2));
};

export const getEffectiveOut = (tx: { amountOut?: AmountLike; linkage?: unknown }) => {
  const rawOut = Math.max(toNumber(tx.amountOut), 0);
  const reimbursed = getReimbursedAmount(tx.linkage);
  return Number(Math.max(rawOut - reimbursed, 0).toFixed(2));
};

export const formatDayKey = (date: Date) => date.toISOString().slice(0, 10);

export const formatMonthKey = (date: Date) => date.toISOString().slice(0, 7);

export const parseMonthKey = (monthKey: string) => {
  const [year, month] = monthKey.split("-").map((part) => Number(part));
  return { year, month };
};

export const getMonthRange = (monthKey: string) => {
  const { year, month } = parseMonthKey(monthKey);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

export const buildDailySeries = (start: Date, end: Date) => {
  const days: string[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const endDate = new Date(end);
  endDate.setHours(0, 0, 0, 0);
  while (cursor <= endDate) {
    days.push(formatDayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
};

export const buildMonthSeries = (start: Date, end: Date) => {
  const months: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= endMonth) {
    months.push(formatMonthKey(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
};

export const isImportedMonth = (transactions: Array<{ date: Date }>) =>
  transactions.some((tx) => tx.date.getDate() > 15);

export const normalizeMerchant = (tx: Pick<AnalyticsTransaction, "label" | "description">) => {
  const raw = (tx.label || tx.description || "Unlabeled merchant").trim();
  const normalized = raw
    .toLowerCase()
    .replace(/\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/\b(card|visa|mastercard|ref|reference|auth|pos|sg|singapore)\b/g, " ")
    .replace(/[^a-z0-9&' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const displayName = raw.length > 80 ? `${raw.slice(0, 77)}...` : raw;
  return {
    key: normalized || raw.toLowerCase() || "unlabeled merchant",
    name: displayName || "Unlabeled merchant",
  };
};

export const summarizeTransactions = (transactions: AnalyticsTransaction[]) => {
  const totalIn = transactions.reduce((sum, tx) => sum + getEffectiveIn(tx), 0);
  const totalOut = transactions.reduce((sum, tx) => sum + getEffectiveOut(tx), 0);
  return {
    totalIn,
    totalOut,
    net: totalIn - totalOut,
    transactionCount: transactions.length,
  };
};

export const serializeTransaction = (tx: AnalyticsTransaction) => ({
  id: tx.id,
  date: tx.date,
  description: tx.description,
  label: tx.label,
  amountIn: getEffectiveIn(tx),
  amountOut: getEffectiveOut(tx),
  category: tx.category
    ? { id: tx.category.id, name: tx.category.name, color: tx.category.color }
    : null,
  merchant: normalizeMerchant(tx).name,
  merchantKey: normalizeMerchant(tx).key,
});

export const getCategoryKey = (tx: AnalyticsTransaction) =>
  tx.categoryId || "uncategorized";

export const getCategoryInfo = (tx: AnalyticsTransaction) =>
  tx.category || { id: "uncategorized", name: "Uncategorized", color: "#9ca3af" };

export const buildCategoryBreakdown = (transactions: AnalyticsTransaction[]) => {
  const map = new Map<
    string,
    { key: string; name: string; color: string; totalIn: number; totalOut: number; transactionCount: number }
  >();

  const addToCategory = (
    key: string,
    name: string,
    color: string,
    totalIn: number,
    totalOut: number,
  ) => {
    const current = map.get(key) || {
      key,
      name,
      color,
      totalIn: 0,
      totalOut: 0,
      transactionCount: 0,
    };
    current.totalIn += totalIn;
    current.totalOut += totalOut;
    current.transactionCount += 1;
    map.set(key, current);
  };

  for (const tx of transactions) {
    const category = getCategoryInfo(tx);
    addToCategory(
      getCategoryKey(tx),
      category.name,
      category.color,
      getEffectiveIn(tx),
      getEffectiveOut(tx),
    );

    const reimbursementLeftover = getReimbursementLeftover(tx);
    if (reimbursementLeftover > 0) {
      addToCategory(
        REIMBURSEMENT_LEFTOVER_CATEGORY.id,
        REIMBURSEMENT_LEFTOVER_CATEGORY.name,
        REIMBURSEMENT_LEFTOVER_CATEGORY.color,
        reimbursementLeftover,
        0,
      );
    }
  }

  return Array.from(map.values()).sort((a, b) => b.totalOut - a.totalOut);
};
