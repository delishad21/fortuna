import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toTransactionDate } from "./transaction-date";

describe("toTransactionDate", () => {
  it("stores a plain day as midnight UTC", () => {
    assert.equal(toTransactionDate("2026-09-29").toISOString(), "2026-09-29T00:00:00.000Z");
  });

  it("keeps ISO timestamps and Dates", () => {
    assert.equal(toTransactionDate("2026-09-28T16:00:00.000Z").toISOString(), "2026-09-28T16:00:00.000Z");
    const date = new Date("2026-09-29T00:00:00.000Z");
    assert.equal(toTransactionDate(date), date);
  });

  it("rejects empty and invalid values", () => {
    assert.throws(() => toTransactionDate(""), /Invalid transaction date/);
    assert.throws(() => toTransactionDate("29/09/2026"), /Invalid transaction date/);
  });
});
