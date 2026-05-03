import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDefaultInitialSelectedDbTransactions } from "./ReimbursementSelectorModal";

describe("ReimbursementSelectorModal defaults", () => {
  it("uses a stable empty initial DB selection so selection is not reset after every click", () => {
    assert.equal(
      getDefaultInitialSelectedDbTransactions(),
      getDefaultInitialSelectedDbTransactions(),
    );
  });
});
