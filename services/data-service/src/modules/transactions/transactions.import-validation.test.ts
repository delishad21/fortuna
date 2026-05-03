import assert from "node:assert/strict";
import test from "node:test";
import { validatePendingReimbursementLinks } from "./transactions.import-validation";

const tx = (overrides = {}) => ({
  date: new Date("2026-04-01"),
  description: "Transaction",
  amountOut: 10,
  metadata: {},
  ...overrides,
});

test("rejects selected reimbursement when pending target is not selected", () => {
  assert.throws(
    () =>
      validatePendingReimbursementLinks(
        [
          tx({
            description: "Refund",
            amountIn: 10,
            amountOut: null,
            linkage: {
              type: "reimbursement",
              reimbursesAllocations: [{ pendingBatchIndex: 1, amount: 10 }],
            },
          }),
          tx({ description: "Purchase", amountOut: 10 }),
        ],
        [0],
      ),
    /must also be selected/i,
  );
});

test("accepts selected reimbursement without a target", () => {
  assert.doesNotThrow(() =>
    validatePendingReimbursementLinks(
      [
        tx({
          description: "Refund without target",
          amountIn: 10,
          amountOut: null,
          linkage: {
            type: "reimbursement",
            reimbursesAllocations: [],
            leftoverAmount: 10,
            leftoverCategoryId: null,
          },
        }),
      ],
      [0],
    ),
  );
});

test("accepts reimbursement leftover as income without category", () => {
  assert.doesNotThrow(() =>
    validatePendingReimbursementLinks(
      [
        tx({
          description: "Refund",
          amountIn: 15,
          amountOut: null,
          linkage: {
            type: "reimbursement",
            reimbursesAllocations: [{ pendingBatchIndex: 1, amount: 10 }],
            leftoverAmount: 5,
            leftoverCategoryId: null,
          },
        }),
        tx({ description: "Purchase", amountOut: 10 }),
      ],
      [0, 1],
    ),
  );
});

test("accepts selected pending target and categorized leftover", () => {
  assert.doesNotThrow(() =>
    validatePendingReimbursementLinks(
      [
        tx({
          description: "Refund",
          amountIn: 15,
          amountOut: null,
          linkage: {
            type: "reimbursement",
            reimbursesAllocations: [{ pendingBatchIndex: 1, amount: 10 }],
            leftoverAmount: 5,
            leftoverCategoryId: "cat-food",
          },
        }),
        tx({ description: "Purchase", amountOut: 10 }),
      ],
      [0, 1],
    ),
  );
});

test("rejects aggregate over-allocation to the same pending target", () => {
  assert.throws(
    () =>
      validatePendingReimbursementLinks(
        [
          tx({
            description: "Refund A",
            amountIn: 8,
            amountOut: null,
            linkage: {
              type: "reimbursement",
              reimbursesAllocations: [{ pendingBatchIndex: 2, amount: 8 }],
            },
          }),
          tx({
            description: "Refund B",
            amountIn: 8,
            amountOut: null,
            linkage: {
              type: "reimbursement",
              reimbursesAllocations: [{ pendingBatchIndex: 2, amount: 8 }],
            },
          }),
          tx({ description: "Purchase", amountOut: 10 }),
        ],
        [0, 1, 2],
      ),
    /over-allocate/i,
  );
});
