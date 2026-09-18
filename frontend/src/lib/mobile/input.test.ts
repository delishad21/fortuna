import { test } from "node:test";
import assert from "node:assert/strict";
import { reviveMobileInput } from "./input";
test("blocks account impersonation at every nesting level", () => {
  for (const input of [
    { userId: "other" },
    [{ metadata: { userId: "other" } }],
    JSON.parse('{"__proto__":{"admin":true}}'),
  ])
    assert.throws(() => reviveMobileInput(input), /Reserved/);
});
test("revives only date filters and can preserve string-based contracts", () => {
  const value = {
    dateFrom: "2026-09-01",
    date: "2026-09-01",
    metadata: { importedAt: "2026-09-01" },
  };
  assert.ok(reviveMobileInput(value).dateFrom instanceof Date);
  assert.equal(reviveMobileInput(value).date, value.date);
  assert.equal(reviveMobileInput(value, "", 0, false).dateFrom, value.dateFrom);
  assert.throws(() => reviveMobileInput({ dateTo: "invalid" }), /Invalid date/);
});
test("bounds nested input", () => {
  let input: unknown = "value";
  for (let i = 0; i < 30; i++) input = { child: input };
  assert.throws(() => reviveMobileInput(input), /deeply nested/);
});
