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
  category?: { id: string; name: string; color: string; icon?: string | null } | null;
  accountIdentifier?: string | null;
  imageId?: string | null;
  source?: string | null;
  importBatchId?: string | null;
  accountId?: string | null;
  cardId?: string | null;
  account?: { id: string; name: string; color: string; imageId?: string | null } | null;
  card?: { id: string; last4: string; nickname?: string | null; network?: string | null; imageId?: string | null } | null;
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

const isInternalLinkage = (linkage: unknown) =>
  !!linkage && typeof linkage === "object" && (linkage as any).type === "internal";

const isInternalCategory = (category: AnalyticsTransaction["category"] | undefined) =>
  category?.name?.trim().toLowerCase() === "internal";

const isInternalTransaction = (tx: { linkage?: unknown; category?: AnalyticsTransaction["category"] }) =>
  isInternalLinkage(tx.linkage) || isInternalCategory(tx.category);

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
  if (isInternalTransaction(tx)) return 0;
  const rawIn = Math.max(toNumber(tx.amountIn), 0);
  if (isReimbursementLinkage(tx.linkage)) return 0;
  return Number(rawIn.toFixed(2));
};

export const getEffectiveOut = (tx: { amountOut?: AmountLike; linkage?: unknown }) => {
  if (isInternalTransaction(tx)) return 0;
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
    ? { id: tx.category.id, name: tx.category.name, color: tx.category.color, icon: tx.category.icon ?? null }
    : null,
  imageId: tx.imageId ?? null,
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

export const NO_ACCOUNT = { key: "none", name: "No account", color: "#9ca3af" };
export const NO_CARD = { key: "none", name: "No card", color: "#9ca3af" };

const NETWORK_LABELS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  unionpay: "UnionPay",
  jcb: "JCB",
  discover: "Discover",
  nets: "NETS",
};

/** "Nickname ·· 1234" or "Visa ·· 1234", like the apps' cardDisplay. */
export const cardName = (card: { last4: string; nickname?: string | null; network?: string | null }) =>
  `${card.nickname?.trim() || (card.network && NETWORK_LABELS[card.network]) || "Card"} ·· ${card.last4}`;

/** Where a transaction is grouped by account: its Account, else "No account". */
export const getAccountInfo = (tx: AnalyticsTransaction) =>
  tx.account
    ? { key: tx.account.id, name: tx.account.name, color: tx.account.color }
    : tx.accountId
      ? { key: tx.accountId, name: "Account", color: NO_ACCOUNT.color }
      : NO_ACCOUNT;

/** Where a transaction is grouped by card: its card (in its account's colour), else "No card". */
export const getCardInfo = (tx: AnalyticsTransaction) =>
  tx.card
    ? { key: tx.card.id, name: cardName(tx.card), color: tx.account?.color || NO_CARD.color }
    : NO_CARD;

/** Money in and out per Account (or per card), largest spending first. */
export const buildAccountBreakdown = (transactions: AnalyticsTransaction[], by: "account" | "card" = "account") => {
  const map = new Map<
    string,
    { key: string; name: string; color: string; totalIn: number; totalOut: number; transactionCount: number }
  >();
  for (const tx of transactions) {
    const info = by === "card" ? getCardInfo(tx) : getAccountInfo(tx);
    const current = map.get(info.key) || { ...info, totalIn: 0, totalOut: 0, transactionCount: 0 };
    current.totalIn += getEffectiveIn(tx);
    current.totalOut += getEffectiveOut(tx);
    current.transactionCount += 1;
    map.set(info.key, current);
  }
  return Array.from(map.values()).sort((a, b) => b.totalOut - a.totalOut || a.name.localeCompare(b.name));
};

export const shiftMonthKey = (monthKey: string, offset: number) => {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
};

/**
 * Months with transactions per account over the last `span` months, so the
 * review tab can show which statements are missing.
 */
export const buildStatementCoverage = (
  transactions: Array<{ date: Date; accountIdentifier?: string | null }>,
  accounts: Array<{ accountIdentifier: string; label: string | null; color: string }>,
  span = 12,
) => {
  if (transactions.length === 0) return { months: [] as string[], accounts: [] };
  const latestMonth = transactions
    .map((tx) => formatMonthKey(tx.date))
    .reduce((max, key) => (key > max ? key : max));
  const months = Array.from({ length: span }, (_, index) =>
    shiftMonthKey(latestMonth, index - (span - 1)),
  );
  const byAccount = new Map<string, { counts: Map<string, number>; firstMonth: string }>();
  for (const tx of transactions) {
    const key = tx.accountIdentifier || "";
    const month = formatMonthKey(tx.date);
    const entry = byAccount.get(key) || { counts: new Map<string, number>(), firstMonth: month };
    entry.counts.set(month, (entry.counts.get(month) || 0) + 1);
    if (month < entry.firstMonth) entry.firstMonth = month;
    byAccount.set(key, entry);
  }
  const accountInfo = new Map(accounts.map((item) => [item.accountIdentifier, item]));
  return {
    months,
    accounts: Array.from(byAccount.entries())
      .map(([identifier, entry]) => {
        const info = accountInfo.get(identifier);
        const cells = months.map((month) => ({
          month,
          transactionCount: entry.counts.get(month) || 0,
          tracked: month >= entry.firstMonth,
        }));
        return {
          accountIdentifier: identifier || null,
          label: info?.label || identifier || "No account",
          color: info?.color || "#9ca3af",
          months: cells,
          missingMonths: cells
            .filter((cell) => cell.tracked && cell.transactionCount === 0)
            .map((cell) => cell.month),
        };
      })
      .filter((account) => account.months.some((cell) => cell.transactionCount > 0))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
};

/**
 * [start, end) indexes of a window of up to `radius * 2 + 1` items centred on
 * `index`, shifted to stay inside `[0, length)`.
 */
export const centeredWindow = (length: number, index: number, radius: number) => {
  const size = Math.min(length, radius * 2 + 1);
  const start = Math.min(Math.max(index - radius, 0), Math.max(length - size, 0));
  return [start, start + size] as const;
};
