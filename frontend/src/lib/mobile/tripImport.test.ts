import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareReviewedTripRows } from "./tripImport";
const row = { date: "2026-09-20", description: "Expense", amountOut: 10 };
test("preserves parser top-ups and remaps selected reimbursement references", () => {
  const rows = [
    row,
    {
      ...row,
      metadata: { transactionType: "topup" },
      amountIn: 100,
      amountOut: 0,
    },
    {
      ...row,
      amountIn: 10,
      amountOut: 0,
      entryType: "reimbursement",
      linkage: {
        type: "reimbursement",
        reimbursesAllocations: [{ pendingBatchIndex: 0, amount: 10 }],
      },
    },
  ];
  const prepared = prepareReviewedTripRows(rows, [1, 0, 2]);
  assert.equal(prepared[0].entryType, "funding_in");
  assert.deepEqual(prepared[2].linkage?.reimbursesAllocations, [
    { transactionId: undefined, pendingBatchIndex: 1, amountBase: 10 },
  ]);
  assert.throws(() => prepareReviewedTripRows(rows, [2]), /unselected/);
});
test("rejects invalid and duplicated selected indices", () => {
  for (const selected of [[], [0, 0], [-1], [1], [0.5]])
    assert.throws(() => prepareReviewedTripRows([row], selected));
});
