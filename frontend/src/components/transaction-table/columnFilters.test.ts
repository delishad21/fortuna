import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_COLUMN_FILTERS,
  EMPTY_TABLE_VIEW,
  UNCATEGORIZED_KEY,
  applyTableView,
  buildCategoryFilterOptions,
  buildRowComparator,
  categoryFilterKey,
  getSortState,
  isColumnFiltered,
  isTableViewActive,
  matchesColumnFilters,
  needsReview,
  resetColumnFilter,
  updateSorts,
} from "./columnFilters";
import type { CategoryContext, TableRow, TableViewState } from "./columnFilters";
import type { Transaction } from "./types";

const context: CategoryContext = {
  internalCategoryId: "cat-internal",
  reimbursementCategoryId: "cat-reimb",
  isTripParser: false,
  categoryNames: new Map([
    ["cat-internal", "Internal"],
    ["cat-reimb", "Reimbursement"],
    ["food", "food"],
    ["travel", "Travel"],
    ["bills", "Bills"],
    ["__funding_in__", "Funding In"],
  ]),
};

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return { date: "2026-01-01", description: "", metadata: {}, ...overrides };
}

function rows(...transactions: Transaction[]): TableRow[] {
  return transactions.map((transaction, index) => ({ transaction, index }));
}

function view(overrides: Partial<TableViewState> = {}): TableViewState {
  return { ...EMPTY_TABLE_VIEW, ...overrides };
}

const order = (result: TableRow[]) => result.map((row) => row.index);

test("updateSorts makes the changed column primary and keeps tie-breakers", () => {
  let sorts = updateSorts([], "date", "asc");
  sorts = updateSorts(sorts, "category", "desc");
  assert.deepEqual(sorts, [
    { column: "category", direction: "desc" },
    { column: "date", direction: "asc" },
  ]);

  // Changing the direction of an existing tie-breaker promotes it.
  sorts = updateSorts(sorts, "date", "desc");
  assert.deepEqual(sorts, [
    { column: "date", direction: "desc" },
    { column: "category", direction: "desc" },
  ]);

  // Clearing removes it and leaves the rest in order.
  sorts = updateSorts(sorts, "date", null);
  assert.deepEqual(sorts, [{ column: "category", direction: "desc" }]);
  assert.deepEqual(getSortState(sorts, "category"), {
    direction: "desc",
    priority: 1,
  });
  assert.equal(getSortState(sorts, "date"), null);
});

test("no sorts keeps the incoming row order", () => {
  const input = rows(
    tx({ date: "2026-03-01" }),
    tx({ date: "2026-01-01" }),
    tx({ date: "2026-02-01" }),
  );
  assert.deepEqual(order(applyTableView(input, view(), context)), [0, 1, 2]);
});

test("date sort orders oldest/newest first", () => {
  const input = rows(
    tx({ date: "2026-03-01T00:00:00Z" }),
    tx({ date: "2026-01-01" }),
    tx({ date: "2026-02-01" }),
  );
  const asc = applyTableView(
    input,
    view({ sorts: [{ column: "date", direction: "asc" }] }),
    context,
  );
  assert.deepEqual(order(asc), [1, 2, 0]);
  const desc = applyTableView(
    input,
    view({ sorts: [{ column: "date", direction: "desc" }] }),
    context,
  );
  assert.deepEqual(order(desc), [0, 2, 1]);
});

test("text sorts are case-insensitive and put empty values last", () => {
  const input = rows(
    tx({ label: "banana" }),
    tx({ label: "" }),
    tx({ label: "Apple" }),
    tx({ label: "cherry" }),
  );
  const asc = applyTableView(
    input,
    view({ sorts: [{ column: "label", direction: "asc" }] }),
    context,
  );
  assert.deepEqual(order(asc), [2, 0, 3, 1]);
  const desc = applyTableView(
    input,
    view({ sorts: [{ column: "label", direction: "desc" }] }),
    context,
  );
  assert.deepEqual(order(desc), [3, 0, 2, 1]);
});

test("category sorts by displayed name with uncategorized last", () => {
  const input = rows(
    tx({ categoryId: "travel" }),
    tx({}),
    tx({ categoryId: "food" }),
    tx({ categoryId: "food", linkage: { type: "internal" } }),
    tx({ categoryId: "bills" }),
  );
  const asc = applyTableView(
    input,
    view({ sorts: [{ column: "category", direction: "asc" }] }),
    context,
  );
  // Bills, food, Internal (via linkage), Travel, then uncategorized.
  assert.deepEqual(order(asc), [4, 2, 3, 0, 1]);
  const desc = applyTableView(
    input,
    view({ sorts: [{ column: "category", direction: "desc" }] }),
    context,
  );
  assert.deepEqual(order(desc), [0, 3, 2, 4, 1]);
});

test("amount sorts put rows without an amount last in both directions", () => {
  const input = rows(
    tx({ amountOut: 20 }),
    tx({ amountIn: 5 }),
    tx({ amountOut: 3.5 }),
    tx({ amountOut: 0 }),
    tx({ amountOut: 100 }),
  );
  const asc = applyTableView(
    input,
    view({ sorts: [{ column: "amountOut", direction: "asc" }] }),
    context,
  );
  assert.deepEqual(order(asc), [2, 0, 4, 1, 3]);
  const desc = applyTableView(
    input,
    view({ sorts: [{ column: "amountOut", direction: "desc" }] }),
    context,
  );
  assert.deepEqual(order(desc), [4, 0, 2, 1, 3]);
});

test("multi-level sort uses later sorts as tie-breakers", () => {
  const input = rows(
    tx({ date: "2026-01-02", amountOut: 5 }),
    tx({ date: "2026-01-01", amountOut: 50 }),
    tx({ date: "2026-01-02", amountOut: 30 }),
    tx({ date: "2026-01-01", amountOut: 10 }),
  );
  const sorts = updateSorts(
    updateSorts([], "amountOut", "desc"),
    "date",
    "asc",
  );
  assert.deepEqual(order(applyTableView(input, view({ sorts }), context)), [
    1, 3, 2, 0,
  ]);
  // The standalone comparator agrees with applyTableView.
  const sorted = [...input].sort(buildRowComparator(sorts, context));
  assert.deepEqual(order(sorted), [1, 3, 2, 0]);
});

test("date range filter is inclusive and compares the date prefix", () => {
  const filters = {
    ...EMPTY_COLUMN_FILTERS,
    dateFrom: "2026-01-05",
    dateTo: "2026-01-10",
  };
  assert.equal(
    matchesColumnFilters(tx({ date: "2026-01-05" }), filters, context),
    true,
  );
  assert.equal(
    matchesColumnFilters(tx({ date: "2026-01-10T23:59:00Z" }), filters, context),
    true,
  );
  assert.equal(
    matchesColumnFilters(tx({ date: "2026-01-11" }), filters, context),
    false,
  );
  assert.equal(
    matchesColumnFilters(tx({ date: "2026-01-04" }), filters, context),
    false,
  );
  assert.equal(isColumnFiltered("date", filters), true);
});

test("category filter hides unchecked keys and resolves linkage categories", () => {
  const filters = {
    ...EMPTY_COLUMN_FILTERS,
    hiddenCategoryKeys: new Set(["cat-internal", UNCATEGORIZED_KEY]),
  };
  const input = rows(
    tx({ categoryId: "food" }),
    tx({ categoryId: "food", linkage: { type: "internal" } }),
    tx({}),
    tx({ linkage: { type: "reimbursement" } }),
    tx({ categoryId: "brand-new" }),
  );
  const result = applyTableView(input, view({ columns: filters }), context);
  assert.deepEqual(order(result), [0, 3, 4]);
  assert.equal(categoryFilterKey(input[3].transaction, context), "cat-reimb");
});

test("trip top-ups resolve to the funding-in category", () => {
  const tripContext = { ...context, isTripParser: true };
  assert.equal(
    categoryFilterKey(
      tx({ metadata: { transactionType: "TOPUP" } }),
      tripContext,
    ),
    "__funding_in__",
  );
  assert.equal(
    categoryFilterKey(
      tx({ metadata: { transactionType: "topup", fundingInDisabled: true } }),
      tripContext,
    ),
    UNCATEGORIZED_KEY,
  );
});

test("amount filters apply min/max bounds and the only-with-value toggle", () => {
  const input = rows(
    tx({ amountOut: 5 }),
    tx({ amountOut: 15 }),
    tx({ amountOut: 25 }),
    tx({ amountIn: 40 }),
  );
  const bounded = applyTableView(
    input,
    view({
      columns: {
        ...EMPTY_COLUMN_FILTERS,
        amountOut: { min: "10", max: "20", onlyWithValue: false },
      },
    }),
    context,
  );
  assert.deepEqual(order(bounded), [1]);

  const onlyIn = applyTableView(
    input,
    view({
      columns: {
        ...EMPTY_COLUMN_FILTERS,
        amountIn: { min: "", max: "", onlyWithValue: true },
      },
    }),
    context,
  );
  assert.deepEqual(order(onlyIn), [3]);

  // Non-numeric bounds are ignored.
  const junk = {
    ...EMPTY_COLUMN_FILTERS,
    amountOut: { min: "abc", max: " ", onlyWithValue: false },
  };
  assert.equal(isColumnFiltered("amountOut", junk), false);
  assert.equal(applyTableView(input, view({ columns: junk }), context).length, 4);
});

test("search matches label or description and needs-review uses the unresolved predicate", () => {
  const input = rows(
    tx({ description: "GRAB *Ride", label: "" }),
    tx({ description: "NTUC", label: "Groceries" }),
    tx({ description: "Unknown" }),
    tx({ description: "Auto", suggestionApplied: true }),
    tx({ description: "Linked", linkage: { type: "internal" } }),
  );
  assert.deepEqual(
    order(applyTableView(input, view({ search: "grab" }), context)),
    [0],
  );
  assert.deepEqual(
    order(applyTableView(input, view({ search: "  GROCER " }), context)),
    [1],
  );
  assert.deepEqual(
    order(applyTableView(input, view({ needsReviewOnly: true }), context)),
    [0, 2],
  );
  assert.equal(needsReview(tx({ categoryId: "food" })), false);
});

test("category options pin Internal then Uncategorized, then present categories alphabetically", () => {
  const input = rows(
    tx({ categoryId: "travel" }),
    tx({ categoryId: "food" }),
    tx({ categoryId: "food" }),
    tx({}),
    tx({ categoryId: "bills" }),
  );
  const options = buildCategoryFilterOptions(
    input,
    context,
    [{ id: "food", name: "food", color: "#f00" }],
    new Set(["gone"]),
  );
  assert.deepEqual(
    options.map((o) => [o.key, o.name, o.count, o.pinned]),
    [
      ["cat-internal", "Internal", 0, true],
      [UNCATEGORIZED_KEY, "Uncategorized", 1, true],
      ["bills", "Bills", 1, false],
      ["food", "food", 2, false],
      ["travel", "Travel", 1, false],
      ["gone", "Unknown category", 0, false],
    ],
  );
  assert.equal(options[3].color, "#f00");
});

test("resetColumnFilter clears only the given column and activity tracking follows", () => {
  const columns = {
    ...EMPTY_COLUMN_FILTERS,
    dateFrom: "2026-01-01",
    hiddenCategoryKeys: new Set(["food"]),
  };
  const reset = resetColumnFilter(columns, "category");
  assert.equal(reset.hiddenCategoryKeys.size, 0);
  assert.equal(reset.dateFrom, "2026-01-01");
  assert.equal(isTableViewActive(view({ columns: reset })), true);
  assert.equal(
    isTableViewActive(view({ columns: resetColumnFilter(reset, "date") })),
    false,
  );
  assert.equal(isTableViewActive(view({ search: "  " })), false);
  assert.equal(
    isTableViewActive(view({ sorts: [{ column: "label", direction: "asc" }] })),
    true,
  );
});
