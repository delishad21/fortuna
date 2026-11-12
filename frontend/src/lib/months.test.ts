import { test } from "node:test";
import assert from "node:assert/strict";
import { monthLabel, monthOfRange, monthOptions, monthRange } from "./months";

test("lists months newest first from the current month", () => {
  const options = monthOptions([2026, 2025], new Date(2026, 10, 12));
  assert.deepEqual(options.slice(0, 3), [
    { value: "2026-11", label: "November 2026" },
    { value: "2026-10", label: "October 2026" },
    { value: "2026-09", label: "September 2026" },
  ]);
  assert.equal(options.length, 11 + 12);
  assert.deepEqual(options.at(-1), { value: "2025-01", label: "January 2025" });
});

test("always offers the current month, even before its first transaction", () => {
  const options = monthOptions([2025], new Date(2026, 0, 3));
  assert.deepEqual(options[0], { value: "2026-01", label: "January 2026" });
  assert.equal(options[1].value, "2025-12");
});

test("a month selects its first to last day", () => {
  assert.deepEqual(monthRange("2026-11"), { dateFrom: "2026-11-01", dateTo: "2026-11-30" });
  assert.deepEqual(monthRange("2024-02"), { dateFrom: "2024-02-01", dateTo: "2024-02-29" });
  assert.deepEqual(monthRange("2025-12"), { dateFrom: "2025-12-01", dateTo: "2025-12-31" });
  assert.equal(monthLabel("2025-12"), "December 2025");
});

test("a whole-month range maps back to its month, anything else to all time", () => {
  assert.equal(monthOfRange("2026-02-01", "2026-02-28"), "2026-02");
  assert.equal(monthOfRange("2026-02-01", "2026-02-27"), "");
  assert.equal(monthOfRange("2026-02-02", "2026-02-28"), "");
  assert.equal(monthOfRange("", ""), "");
});
