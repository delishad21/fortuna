import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCategoryBreakdown,
  getEffectiveIn,
  getEffectiveOut,
  getReimbursementLeftover,
  REIMBURSEMENT_LEFTOVER_CATEGORY,
  summarizeTransactions,
} from "./analytics.utils";

describe("reimbursement analytics", () => {
  it("excludes internal transfers from effective income and spending", () => {
    const transaction = {
      amountIn: 500,
      amountOut: 500,
      linkage: { type: "internal" },
    };

    assert.equal(getEffectiveIn(transaction), 0);
    assert.equal(getEffectiveOut(transaction), 0);
  });

  it("treats the reserved Internal category as non-spending", () => {
    const transaction = {
      amountOut: 75,
      category: { id: "internal", name: "Internal", color: "#9ca3af" },
    };

    assert.equal(getEffectiveOut(transaction), 0);
  });

  it("excludes linked reimbursement leftover from ordinary income", () => {
    const transaction = {
      amountIn: 100,
      linkage: {
        type: "reimbursement",
        reimbursesAllocations: [{ transactionId: "purchase-1", amount: 70 }],
      },
    };

    assert.equal(getEffectiveIn(transaction), 0);
    assert.equal(getReimbursementLeftover(transaction), 30);
  });

  it("treats a targetless reimbursement as reimbursement leftover", () => {
    const transaction = {
      amountIn: 100,
      linkage: {
        type: "reimbursement",
        reimbursesAllocations: [],
      },
    };

    assert.equal(getEffectiveIn(transaction), 0);
    assert.equal(getReimbursementLeftover(transaction), 100);
  });

  it("summarizes linked reimbursement as expense offset without ordinary income", () => {
    const summary = summarizeTransactions([
      {
        id: "purchase-1",
        date: new Date("2026-04-01"),
        description: "Original purchase",
        amountOut: 70,
        linkage: {
          type: "reimbursed",
          reimbursedByAllocations: [{ transactionId: "refund-1", amount: 70 }],
        },
      },
      {
        id: "refund-1",
        date: new Date("2026-04-02"),
        description: "Refund",
        amountIn: 100,
        linkage: {
          type: "reimbursement",
          reimbursesAllocations: [{ transactionId: "purchase-1", amount: 70 }],
        },
      },
    ]);

    assert.equal(summary.totalIn, 0);
    assert.equal(summary.totalOut, 0);
    assert.equal(summary.net, 0);
  });

  it("puts reimbursement leftover in a synthetic analytics category", () => {
    const breakdown = buildCategoryBreakdown([
      {
        id: "refund-1",
        date: new Date("2026-04-02"),
        description: "Refund",
        amountIn: 100,
        categoryId: "reimbursement",
        category: { id: "reimbursement", name: "Reimbursement", color: "#10b981" },
        linkage: {
          type: "reimbursement",
          reimbursesAllocations: [{ transactionId: "purchase-1", amount: 70 }],
        },
      },
    ]);

    const synthetic = breakdown.find(
      (item) => item.key === REIMBURSEMENT_LEFTOVER_CATEGORY.id,
    );
    const realCategory = breakdown.find((item) => item.key === "reimbursement");

    assert.equal(synthetic?.name, REIMBURSEMENT_LEFTOVER_CATEGORY.name);
    assert.equal(synthetic?.totalIn, 30);
    assert.equal(realCategory?.totalIn, 0);
  });
});
