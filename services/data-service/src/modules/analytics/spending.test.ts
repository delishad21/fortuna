import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSpendingRows, matchesCategory, parseSpendingQuery } from "./spending";

const food = { id: "cat-food", name: "Food", color: "#f00" };
const transport = { id: "cat-transport", name: "Transport", color: "#0f0" };

const transactions = [
  { id: "1", date: new Date("2026-09-03T00:00:00Z"), description: "KOPITIAM 1234", amountOut: 5.5, categoryId: food.id, category: food },
  { id: "2", date: new Date("2026-09-20T00:00:00Z"), description: "Grab ride", amountOut: 12, categoryId: transport.id, category: transport },
  { id: "3", date: new Date("2026-11-02T00:00:00Z"), description: "KOPITIAM 9876", amountOut: 4.5, categoryId: food.id, category: food },
  { id: "4", date: new Date("2026-11-05T00:00:00Z"), description: "Salary", amountIn: 3000 },
  { id: "5", date: new Date("2026-11-06T00:00:00Z"), description: "Dinner", amountOut: 80, linkage: { reimbursedByAllocations: [{ amount: 60 }] } },
  { id: "6", date: new Date("2026-11-07T00:00:00Z"), description: "To savings", amountOut: 500, linkage: { type: "internal" } },
];

describe("spending query", () => {
  it("accepts a valid query", () => {
    assert.deepEqual(
      parseSpendingQuery({ groupBy: "month", from: "2026-01-01", to: "2026-03-31", limit: "5", category: "Food" }),
      { ok: true, value: { groupBy: "month", from: "2026-01-01", to: "2026-03-31", category: "Food", limit: 5 } },
    );
  });

  it("rejects bad groupBy, dates and limits", () => {
    assert.equal(parseSpendingQuery({ groupBy: "day", from: "2026-01-01", to: "2026-01-31" }).ok, false);
    assert.equal(parseSpendingQuery({ groupBy: "month", from: "2026-02-30", to: "2026-03-01" }).ok, false);
    assert.equal(parseSpendingQuery({ groupBy: "month", from: "2026-03-01", to: "2026-01-01" }).ok, false);
    assert.equal(parseSpendingQuery({ groupBy: "month", from: "2026-01-01" }).ok, false);
    assert.equal(parseSpendingQuery({ groupBy: "merchant", from: "2026-01-01", to: "2026-01-31", limit: "0" }).ok, false);
    assert.equal(parseSpendingQuery({ groupBy: "merchant", from: "2026-01-01", to: "2026-01-31", limit: "2.5" }).ok, false);
  });
});

describe("spending rows", () => {
  const range = { from: "2026-09-01", to: "2026-11-30" };

  it("sums effective money out per month, including empty months", () => {
    assert.deepEqual(buildSpendingRows(transactions, { groupBy: "month", ...range }), [
      { label: "2026-09", amount: 17.5 },
      { label: "2026-10", amount: 0 },
      { label: "2026-11", amount: 24.5 },
    ]);
  });

  it("keeps the most recent months under a limit", () => {
    assert.deepEqual(
      buildSpendingRows(transactions, { groupBy: "month", ...range, limit: 1 }).map((row) => row.label),
      ["2026-11"],
    );
  });

  it("groups by category, largest first, with uncategorized spending", () => {
    assert.deepEqual(buildSpendingRows(transactions, { groupBy: "category", ...range }), [
      { label: "Uncategorized", amount: 20 },
      { label: "Transport", amount: 12 },
      { label: "Food", amount: 10 },
    ]);
  });

  it("groups by merchant and applies the limit", () => {
    assert.deepEqual(buildSpendingRows(transactions, { groupBy: "merchant", ...range, limit: 2 }), [
      { label: "Dinner", amount: 20 },
      { label: "Grab ride", amount: 12 },
    ]);
  });

  it("matches a category by id or name", () => {
    assert.equal(matchesCategory(transactions[0], "food"), true);
    assert.equal(matchesCategory(transactions[0], "cat-food"), true);
    assert.equal(matchesCategory(transactions[1], "food"), false);
    assert.equal(matchesCategory(transactions[3], "uncategorized"), true);
  });
});
