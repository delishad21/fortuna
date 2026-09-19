import { test } from "node:test";
import assert from "node:assert/strict";
import { detachStagedReimbursementAllocations } from "./transactions.service";

test("turns staged reimbursement targets into unlinked reimbursement value", () => {
  const result = detachStagedReimbursementAllocations(
    [
      { transactionId: "saved-1", amount: 20 },
      {
        stagedDraftId: "draft-1",
        stagedRowId: "row-1",
        amount: 35.5,
      },
    ],
    4.5,
  );

  assert.deepEqual(result, {
    linkedAllocations: [{ transactionId: "saved-1", amount: 20 }],
    leftoverAmount: 40,
  });
});
