import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTransactionCardPrimaryClickAction } from "./TransactionCard";

describe("getTransactionCardPrimaryClickAction", () => {
  it("toggles selection instead of expanding when a selection toggle is available", () => {
    assert.equal(
      getTransactionCardPrimaryClickAction({ hasSelectionToggle: true }),
      "toggle-selection",
    );
  });

  it("expands the card when no selection toggle is available", () => {
    assert.equal(
      getTransactionCardPrimaryClickAction({ hasSelectionToggle: false }),
      "toggle-expansion",
    );
  });
});
