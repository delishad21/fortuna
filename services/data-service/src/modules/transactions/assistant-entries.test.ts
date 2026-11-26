import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accountsForLast4,
  CreateEntrySchema,
  entryDateParts,
  parseEntryFilters,
} from "./assistant-entries";

describe("assistant entry dates", () => {
  it("keeps a plain date as midnight UTC, like statement rows", () => {
    assert.deepEqual(entryDateParts("2026-11-26"), {
      date: new Date("2026-11-26T00:00:00.000Z"),
      time: null,
      occurredAt: null,
    });
  });

  it("takes the calendar day and clock time as written, whatever the offset", () => {
    const parts = entryDateParts("2026-11-26T07:05:00+08:00");
    assert.equal(parts.date.toISOString(), "2026-11-26T00:00:00.000Z");
    assert.equal(parts.time, "07:05");
    assert.equal(parts.occurredAt, "2026-11-26T07:05:00+08:00");
  });

  it("lets a separate time override and rejects bad values", () => {
    assert.equal(entryDateParts("2026-11-26", "18:30").time, "18:30");
    assert.throws(() => entryDateParts("2026-02-30"));
    assert.throws(() => entryDateParts("yesterday"));
    assert.throws(() => entryDateParts("2026-11-26", "25:00"));
  });
});

describe("assistant entry input", () => {
  const base = { externalId: "mail-1", date: "2026-11-26", description: "KOPITIAM", account: "DBS" };

  it("needs exactly one amount; the account is optional", () => {
    assert.equal(CreateEntrySchema.safeParse({ ...base, amountOut: 5 }).success, true);
    assert.equal(CreateEntrySchema.safeParse({ ...base }).success, false);
    assert.equal(CreateEntrySchema.safeParse({ ...base, amountIn: 5, amountOut: 5 }).success, false);
    assert.equal(CreateEntrySchema.safeParse({ ...base, amountOut: -5 }).success, false);
    const { account: _account, ...noAccount } = base;
    assert.equal(CreateEntrySchema.safeParse({ ...noAccount, amountOut: 5 }).success, true);
    assert.equal(CreateEntrySchema.safeParse({ ...base, amountOut: 5, category: "Food" }).success, false);
    assert.equal(CreateEntrySchema.safeParse({ ...noAccount, amountOut: 5, card: { last4: "4591" } }).success, true);
    assert.equal(CreateEntrySchema.safeParse({ ...base, amountOut: 5, userId: "x" }).success, false);
  });

  it("finds accounts by a card's last 4 digits", () => {
    const accounts = [{ accountIdentifier: "4265-****-****-4591" }, { accountIdentifier: "123-45678-9" }];
    assert.deepEqual(accountsForLast4(accounts, "4591"), [accounts[0]]);
    assert.deepEqual(accountsForLast4(accounts, "6789"), [accounts[1]]);
    assert.deepEqual(accountsForLast4(accounts, "0000"), []);
  });

  it("parses list filters", () => {
    assert.deepEqual(parseEntryFilters({ entrySource: "assistant,bogus,mobile", reconciled: "false" }), {
      entrySources: ["assistant", "mobile"],
      reconciled: false,
    });
    assert.deepEqual(parseEntryFilters({}), { entrySources: undefined, reconciled: undefined });
  });
});
