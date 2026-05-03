import assert from "node:assert/strict";
import test from "node:test";
import { validateImportSelection } from "./importValidation";

const baseTx = (overrides = {}) => ({
  date: "2026-04-01",
  description: "Transaction",
  amountOut: 10,
  metadata: {},
  ...overrides,
});

test("blocks import when selected reimbursement points to an unselected current-import transaction", () => {
  const result = validateImportSelection([
    baseTx({
      description: "Refund",
      amountIn: 10,
      amountOut: undefined,
      linkage: {
        type: "reimbursement",
        reimbursesAllocations: [{ pendingBatchIndex: 1, amount: 10 }],
      },
    }),
    baseTx({ description: "Original purchase", amountOut: 10 }),
  ], new Set([0]));

  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 1);
  assert.deepEqual(result.errorIndices.sort((a, b) => a - b), [0, 1]);
  assert.match(result.errors[0].message, /must also be selected/i);
});

test("allows selected reimbursement without a target", () => {
  const result = validateImportSelection([
    baseTx({
      description: "Refund without target",
      amountIn: 10,
      amountOut: undefined,
      linkage: {
        type: "reimbursement",
        reimbursesAllocations: [],
        leftoverAmount: 10,
        leftoverCategoryId: null,
      },
    }),
  ], new Set([0]));

  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.errorIndices.length, 0);
});

test("allows reimbursement allocation mismatch because leftover counts as income", () => {
  const result = validateImportSelection([
    baseTx({
      description: "Partial refund",
      amountIn: 15,
      amountOut: undefined,
      linkage: {
        type: "reimbursement",
        reimbursesAllocations: [{ pendingBatchIndex: 1, amount: 10 }],
        leftoverAmount: 5,
        leftoverCategoryId: null,
      },
    }),
    baseTx({ description: "Original purchase", amountOut: 20 }),
  ], new Set([0, 1]));

  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.errorIndices.length, 0);
});

test("allows selected reimbursement and selected current-import target with categorized leftover", () => {
  const result = validateImportSelection([
    baseTx({
      description: "Partial refund",
      amountIn: 15,
      amountOut: undefined,
      linkage: {
        type: "reimbursement",
        reimbursesAllocations: [{ pendingBatchIndex: 1, amount: 10 }],
        leftoverAmount: 5,
        leftoverCategoryId: "cat-food",
      },
    }),
    baseTx({ description: "Original purchase", amountOut: 20 }),
  ], new Set([0, 1]));

  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.errorIndices.length, 0);
});

test("blocks aggregate over-allocation to the same current-import target", () => {
  const result = validateImportSelection([
    baseTx({
      description: "Refund A",
      amountIn: 8,
      amountOut: undefined,
      linkage: {
        type: "reimbursement",
        reimbursesAllocations: [{ pendingBatchIndex: 2, amount: 8 }],
      },
    }),
    baseTx({
      description: "Refund B",
      amountIn: 8,
      amountOut: undefined,
      linkage: {
        type: "reimbursement",
        reimbursesAllocations: [{ pendingBatchIndex: 2, amount: 8 }],
      },
    }),
    baseTx({ description: "Original purchase", amountOut: 10 }),
  ], new Set([0, 1, 2]));

  assert.equal(result.valid, false);
  assert.deepEqual(result.errorIndices.sort((a, b) => a - b), [0, 1, 2]);
  assert.match(result.errors[0].message, /over-allocate/i);
});

test("blocks aggregate over-allocation to the same existing transaction with row context", () => {
  const result = validateImportSelection([
    baseTx({
      description: "Refund A",
      amountIn: 8,
      amountOut: undefined,
      linkage: {
        type: "reimbursement",
        reimbursesAllocations: [
          {
            transactionId: "existing-1",
            amount: 8,
            targetDescription: "Original purchase",
            targetRemainingReimbursable: 10,
          },
        ],
      },
    }),
    baseTx({
      description: "Refund B",
      amountIn: 8,
      amountOut: undefined,
      linkage: {
        type: "reimbursement",
        reimbursesAllocations: [
          {
            transactionId: "existing-1",
            amount: 8,
            targetDescription: "Original purchase",
            targetRemainingReimbursable: 10,
          },
        ],
      },
    }),
  ], new Set([0, 1]));

  assert.equal(result.valid, false);
  assert.deepEqual(result.errorIndices.sort((a, b) => a - b), [0, 1]);
  assert.match(result.errors[0].message, /Rows 1, 2/);
  assert.match(result.errors[0].message, /Original purchase/);
  assert.doesNotMatch(result.errors[0].message, /existing-1/);
});

test("allows valid aggregate allocation to the same existing transaction when row snapshots differ", () => {
  const result = validateImportSelection([
    baseTx({
      description: "Refund A",
      amountIn: 4,
      amountOut: undefined,
      linkage: {
        type: "reimbursement",
        reimbursesAllocations: [
          {
            transactionId: "existing-1",
            amount: 4,
            targetDescription: "Original purchase",
            targetRemainingReimbursable: 10,
          },
        ],
      },
    }),
    baseTx({
      description: "Refund B",
      amountIn: 6,
      amountOut: undefined,
      linkage: {
        type: "reimbursement",
        reimbursesAllocations: [
          {
            transactionId: "existing-1",
            amount: 6,
            targetDescription: "Original purchase",
            targetRemainingReimbursable: 6,
          },
        ],
      },
    }),
  ], new Set([0, 1]));

  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});
