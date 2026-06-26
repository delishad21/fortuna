import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCurrentImportReimbursementItems,
  getDefaultInitialSelectedDbTransactions,
} from "./ReimbursementSelectorModal";

describe("ReimbursementSelectorModal defaults", () => {
  it("uses a stable empty initial DB selection so selection is not reset after every click", () => {
    assert.equal(
      getDefaultInitialSelectedDbTransactions(),
      getDefaultInitialSelectedDbTransactions(),
    );
  });

  it("keeps current-import reimbursement options in transaction order with date labels", () => {
    const items = buildCurrentImportReimbursementItems(
      [
        {
          date: "2026-01-01",
          description: "Before",
          amountOut: 10,
          metadata: {},
        },
        {
          date: "2026-01-02",
          description: "Refund",
          amountIn: 20,
          metadata: {},
        },
        {
          date: "2026-01-03",
          description: "After",
          amountOut: 15,
          metadata: {},
        },
      ],
      1,
    );

    assert.deepEqual(
      items.map((item) => ({ index: item.index, dateLabel: item.dateLabel })),
      [
        { index: 0, dateLabel: "Jan 1, 2026" },
        { index: 2, dateLabel: "Jan 3, 2026" },
      ],
    );
  });
});
