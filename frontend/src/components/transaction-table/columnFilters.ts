import type { Category, Transaction } from "./types";

/**
 * Pure filter / sort logic for the import review table's Excel-like column
 * menus. Kept free of React so it can be unit tested with `node:test`.
 */

export type FilterableColumn =
  | "date"
  | "label"
  | "description"
  | "category"
  | "amountIn"
  | "amountOut";

export type SortDirection = "asc" | "desc";

export interface ColumnSort {
  column: FilterableColumn;
  direction: SortDirection;
}

export interface AmountFilter {
  /** Raw input text; empty or non-numeric means "no bound". */
  min: string;
  max: string;
  /** Only rows with a non-zero amount in this column. */
  onlyWithValue: boolean;
}

export interface ColumnFilters {
  /** Inclusive `YYYY-MM-DD` bounds; empty means unbounded. */
  dateFrom: string;
  dateTo: string;
  /**
   * Category keys the user unchecked. Stored as "hidden" so categories that
   * appear later (edits, new rows) are shown by default.
   */
  hiddenCategoryKeys: ReadonlySet<string>;
  amountIn: AmountFilter;
  amountOut: AmountFilter;
}

/** Everything the table-level filters/sorts depend on. */
export interface TableViewState {
  search: string;
  needsReviewOnly: boolean;
  columns: ColumnFilters;
  /** Ordered: index 0 is the primary sort, later entries are tie-breakers. */
  sorts: ColumnSort[];
}

export interface CategoryContext {
  internalCategoryId: string;
  reimbursementCategoryId: string;
  isTripParser: boolean;
  /** Category id → display name, including synthetic reserved ids. */
  categoryNames: ReadonlyMap<string, string>;
}

export interface TableRow {
  transaction: Transaction;
  /** Index into the original `transactions` array. */
  index: number;
}

const textCollator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

export const UNCATEGORIZED_KEY = "__uncategorized__";
export const FUNDING_IN_CATEGORY_ID = "__funding_in__";

export const EMPTY_AMOUNT_FILTER: AmountFilter = {
  min: "",
  max: "",
  onlyWithValue: false,
};

export const EMPTY_COLUMN_FILTERS: ColumnFilters = {
  dateFrom: "",
  dateTo: "",
  hiddenCategoryKeys: new Set<string>(),
  amountIn: EMPTY_AMOUNT_FILTER,
  amountOut: EMPTY_AMOUNT_FILTER,
};

export const EMPTY_TABLE_VIEW: TableViewState = {
  search: "",
  needsReviewOnly: false,
  columns: EMPTY_COLUMN_FILTERS,
  sorts: [],
};

export const SORT_LABELS: Record<
  FilterableColumn,
  { asc: string; desc: string }
> = {
  date: { asc: "Oldest first", desc: "Newest first" },
  label: { asc: "A → Z", desc: "Z → A" },
  description: { asc: "A → Z", desc: "Z → A" },
  category: { asc: "A → Z", desc: "Z → A" },
  amountIn: { asc: "Smallest first", desc: "Largest first" },
  amountOut: { asc: "Smallest first", desc: "Largest first" },
};

// ---------------------------------------------------------------------------
// Category resolution (mirrors how the table displays a row's category)
// ---------------------------------------------------------------------------

export function isFundingInTopup(
  transaction: Transaction,
  isTripParser: boolean,
): boolean {
  if (!isTripParser) return false;
  const metadata =
    transaction.metadata && typeof transaction.metadata === "object"
      ? (transaction.metadata as Record<string, unknown>)
      : {};
  const transactionType = String(metadata.transactionType || "").toLowerCase();
  const fundingInDisabled = metadata.fundingInDisabled === true;
  return (
    transaction.entryTypeOverride === "funding_in" ||
    (transactionType === "topup" && !fundingInDisabled)
  );
}

/** The category id the table shows for a row (may be undefined/empty). */
export function resolveDisplayCategoryId(
  transaction: Transaction,
  context: Pick<
    CategoryContext,
    "internalCategoryId" | "reimbursementCategoryId" | "isTripParser"
  >,
): string | undefined {
  const linkageType = transaction.linkage?.type;
  if (linkageType === "internal") return context.internalCategoryId;
  if (linkageType === "reimbursement") return context.reimbursementCategoryId;
  if (isFundingInTopup(transaction, context.isTripParser)) {
    return FUNDING_IN_CATEGORY_ID;
  }
  return transaction.categoryId;
}

/** Filter key for a row's category: its display id, or the uncategorized key. */
export function categoryFilterKey(
  transaction: Transaction,
  context: CategoryContext,
): string {
  return resolveDisplayCategoryId(transaction, context) || UNCATEGORIZED_KEY;
}

export interface CategoryFilterOption {
  key: string;
  name: string;
  color?: string;
  count: number;
  /** Internal and Uncategorized are always listed at the top. */
  pinned: boolean;
}

/**
 * Checklist options for the category menu: Internal pinned first, then
 * Uncategorized, then every other category present in `rows` (plus any
 * currently hidden key, so it can be re-checked) sorted alphabetically.
 */
export function buildCategoryFilterOptions(
  rows: readonly TableRow[],
  context: CategoryContext,
  categories: readonly Category[] = [],
  hiddenKeys: ReadonlySet<string> = new Set(),
): CategoryFilterOption[] {
  const counts = new Map<string, number>();
  for (const { transaction } of rows) {
    const key = categoryFilterKey(transaction, context);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const colors = new Map(categories.map((c) => [c.id, c.color]));
  const nameOf = (key: string) =>
    context.categoryNames.get(key) ?? "Unknown category";

  const internalKey = context.internalCategoryId;
  const options: CategoryFilterOption[] = [
    {
      key: internalKey,
      name: context.categoryNames.get(internalKey) ?? "Internal",
      color: colors.get(internalKey),
      count: counts.get(internalKey) ?? 0,
      pinned: true,
    },
    {
      key: UNCATEGORIZED_KEY,
      name: "Uncategorized",
      count: counts.get(UNCATEGORIZED_KEY) ?? 0,
      pinned: true,
    },
  ];

  const otherKeys = new Set<string>([...counts.keys(), ...hiddenKeys]);
  otherKeys.delete(internalKey);
  otherKeys.delete(UNCATEGORIZED_KEY);

  const rest = [...otherKeys].map((key) => ({
    key,
    name: nameOf(key),
    color: colors.get(key),
    count: counts.get(key) ?? 0,
    pinned: false,
  }));
  rest.sort((a, b) => textCollator.compare(a.name, b.name));
  return [...options, ...rest];
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export function parseAmountBound(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A positive, finite amount, or null when the cell is effectively empty. */
export function amountValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
}

export function isAmountFilterActive(filter: AmountFilter): boolean {
  return (
    filter.onlyWithValue ||
    parseAmountBound(filter.min) !== null ||
    parseAmountBound(filter.max) !== null
  );
}

function matchesAmountFilter(value: unknown, filter: AmountFilter): boolean {
  const amount = amountValue(value);
  const min = parseAmountBound(filter.min);
  const max = parseAmountBound(filter.max);
  if (filter.onlyWithValue && amount === null) return false;
  // Like spreadsheet number filters, blank cells never satisfy a bound.
  if ((min !== null || max !== null) && amount === null) return false;
  if (min !== null && amount !== null && amount < min) return false;
  if (max !== null && amount !== null && amount > max) return false;
  return true;
}

export function matchesSearch(transaction: Transaction, search: string) {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return (
    String(transaction.description || "")
      .toLowerCase()
      .includes(needle) ||
    String(transaction.label || "")
      .toLowerCase()
      .includes(needle)
  );
}

/** Not auto-applied and still missing a category, label and linkage. */
export function needsReview(transaction: Transaction): boolean {
  return (
    transaction.suggestionApplied !== true &&
    !transaction.categoryId &&
    !transaction.label &&
    !transaction.linkage
  );
}

export function isColumnFiltered(
  column: FilterableColumn,
  filters: ColumnFilters,
): boolean {
  switch (column) {
    case "date":
      return !!filters.dateFrom || !!filters.dateTo;
    case "category":
      return filters.hiddenCategoryKeys.size > 0;
    case "amountIn":
      return isAmountFilterActive(filters.amountIn);
    case "amountOut":
      return isAmountFilterActive(filters.amountOut);
    default:
      return false;
  }
}

export function matchesColumnFilters(
  transaction: Transaction,
  filters: ColumnFilters,
  context: CategoryContext,
): boolean {
  if (filters.dateFrom || filters.dateTo) {
    const date = String(transaction.date || "").slice(0, 10);
    if (!date) return false;
    if (filters.dateFrom && date < filters.dateFrom) return false;
    if (filters.dateTo && date > filters.dateTo) return false;
  }
  if (
    filters.hiddenCategoryKeys.size > 0 &&
    filters.hiddenCategoryKeys.has(categoryFilterKey(transaction, context))
  ) {
    return false;
  }
  if (!matchesAmountFilter(transaction.amountIn, filters.amountIn)) {
    return false;
  }
  if (!matchesAmountFilter(transaction.amountOut, filters.amountOut)) {
    return false;
  }
  return true;
}

export function matchesTableView(
  transaction: Transaction,
  view: TableViewState,
  context: CategoryContext,
): boolean {
  return (
    matchesSearch(transaction, view.search) &&
    (!view.needsReviewOnly || needsReview(transaction)) &&
    matchesColumnFilters(transaction, view.columns, context)
  );
}

export function isTableViewActive(view: TableViewState): boolean {
  return (
    view.search.trim().length > 0 ||
    view.needsReviewOnly ||
    view.sorts.length > 0 ||
    (Object.keys(SORT_LABELS) as FilterableColumn[]).some((column) =>
      isColumnFiltered(column, view.columns),
    )
  );
}

/** Clears one column's filter (sorting is handled by `updateSorts`). */
export function resetColumnFilter(
  filters: ColumnFilters,
  column: FilterableColumn,
): ColumnFilters {
  switch (column) {
    case "date":
      return { ...filters, dateFrom: "", dateTo: "" };
    case "category":
      return { ...filters, hiddenCategoryKeys: new Set<string>() };
    case "amountIn":
      return { ...filters, amountIn: EMPTY_AMOUNT_FILTER };
    case "amountOut":
      return { ...filters, amountOut: EMPTY_AMOUNT_FILTER };
    default:
      return filters;
  }
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/**
 * Sets (or clears, with `null`) a column's sort. A set column becomes the
 * primary sort; the remaining sorts keep their relative order as tie-breakers.
 */
export function updateSorts(
  sorts: readonly ColumnSort[],
  column: FilterableColumn,
  direction: SortDirection | null,
): ColumnSort[] {
  const rest = sorts.filter((sort) => sort.column !== column);
  return direction ? [{ column, direction }, ...rest] : rest;
}

export function getSortState(
  sorts: readonly ColumnSort[],
  column: FilterableColumn,
): { direction: SortDirection; priority: number } | null {
  const position = sorts.findIndex((sort) => sort.column === column);
  if (position === -1) return null;
  return { direction: sorts[position].direction, priority: position + 1 };
}

type SortValue = string | number | null;

function sortValue(
  transaction: Transaction,
  column: FilterableColumn,
  context: CategoryContext,
): SortValue {
  switch (column) {
    case "date":
      return String(transaction.date || "").slice(0, 10) || null;
    case "label":
      return String(transaction.label || "").trim() || null;
    case "description":
      return String(transaction.description || "").trim() || null;
    case "category": {
      const id = resolveDisplayCategoryId(transaction, context);
      if (!id) return null;
      return (context.categoryNames.get(id) || "").trim() || null;
    }
    case "amountIn":
      return amountValue(transaction.amountIn);
    case "amountOut":
      return amountValue(transaction.amountOut);
  }
}

function compareValues(
  a: SortValue,
  b: SortValue,
  direction: SortDirection,
): number {
  // Empty values always sort last, whatever the direction.
  if (a === null || b === null) {
    if (a === b) return 0;
    return a === null ? 1 : -1;
  }
  const result =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : textCollator.compare(String(a), String(b));
  return direction === "asc" ? result : -result;
}

function compareSortKeys(
  a: readonly SortValue[],
  b: readonly SortValue[],
  sorts: readonly ColumnSort[],
): number {
  for (let i = 0; i < sorts.length; i += 1) {
    const result = compareValues(a[i], b[i], sorts[i].direction);
    if (result !== 0) return result;
  }
  return 0;
}

function sortKeys(
  transaction: Transaction,
  sorts: readonly ColumnSort[],
  context: CategoryContext,
): SortValue[] {
  return sorts.map(({ column }) => sortValue(transaction, column, context));
}

/**
 * Comparator applying `sorts` in priority order, falling back to the original
 * row order so the result is deterministic.
 */
export function buildRowComparator(
  sorts: readonly ColumnSort[],
  context: CategoryContext,
): (a: TableRow, b: TableRow) => number {
  return (a, b) =>
    compareSortKeys(
      sortKeys(a.transaction, sorts, context),
      sortKeys(b.transaction, sorts, context),
      sorts,
    ) || a.index - b.index;
}

/** Filters then sorts `rows`; returns a new array (input order untouched). */
export function applyTableView(
  rows: readonly TableRow[],
  view: TableViewState,
  context: CategoryContext,
): TableRow[] {
  const filtered = rows.filter(({ transaction }) =>
    matchesTableView(transaction, view, context),
  );
  if (view.sorts.length === 0) return filtered;
  // Compute sort keys once per row rather than once per comparison.
  const keyed = filtered.map((row) => ({
    row,
    keys: sortKeys(row.transaction, view.sorts, context),
  }));
  keyed.sort(
    (a, b) =>
      compareSortKeys(a.keys, b.keys, view.sorts) || a.row.index - b.row.index,
  );
  return keyed.map(({ row }) => row);
}
