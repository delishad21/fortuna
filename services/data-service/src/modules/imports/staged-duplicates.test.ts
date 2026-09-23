import assert from "node:assert/strict";
import test from "node:test";
import { findStagedDuplicates } from "./staged-duplicates";

test("finds matching rows across selected staged drafts", () => {
  const findings = findStagedDuplicates([
    { draftId: "a", rowId: "a1", rowIndex: 0, filename: "first.pdf", date: "2026-08-08", description: "PAYMENT TO SHOP", amountOut: 12.5, amountIn: null },
    { draftId: "b", rowId: "b1", rowIndex: 4, filename: "second.pdf", date: "2026-08-08", description: "PAYMENT TO SHOP", amountOut: 12.5, amountIn: null },
    { draftId: "b", rowId: "b2", rowIndex: 5, filename: "second.pdf", date: "2026-08-09", description: "UNRELATED PAYMENT", amountOut: 12.5, amountIn: null },
  ]);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].row.rowId, "b1");
  assert.equal(findings[0].match.rowId, "a1");
  assert.equal(findings[0].match.source, "staged");
});

test("keeps credit and debit transactions distinct", () => {
  assert.deepEqual(findStagedDuplicates([
    { draftId: "a", rowId: "a1", rowIndex: 0, filename: "first.pdf", date: "2026-08-08", description: "TRANSFER", amountOut: 50, amountIn: null },
    { draftId: "b", rowId: "b1", rowIndex: 0, filename: "second.pdf", date: "2026-08-08", description: "TRANSFER", amountOut: null, amountIn: 50 },
  ]), []);
});
