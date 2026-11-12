import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchWhere, parseSearchAmount } from "./transaction-search";
import { TransactionRepository } from "./transactions.repository";

const text = (value: string) => [
  { description: { contains: value, mode: "insensitive" } },
  { label: { contains: value, mode: "insensitive" } },
];

test("'4.49' matches the text or exactly 4.49 in or out", () => {
  assert.deepEqual(buildSearchWhere("4.49"), {
    OR: [
      ...text("4.49"),
      { amountIn: { equals: 4.49 } },
      { amountOut: { equals: 4.49 } },
    ],
  });
});

test("'$4.49' keeps the text match and matches the amount without the $", () => {
  assert.deepEqual(buildSearchWhere("$4.49"), {
    OR: [
      ...text("$4.49"),
      ...text("4.49"),
      { amountIn: { equals: 4.49 } },
      { amountOut: { equals: 4.49 } },
    ],
  });
});

test("'$4' matches the whole dollar range 4.00 to 4.99", () => {
  assert.deepEqual(buildSearchWhere("$4"), {
    OR: [
      ...text("$4"),
      ...text("4"),
      { amountIn: { gte: 4, lt: 5 } },
      { amountOut: { gte: 4, lt: 5 } },
    ],
  });
});

test("a plain word only matches description and label, as before", () => {
  assert.deepEqual(buildSearchWhere("grab"), { OR: text("grab") });
  assert.equal(parseSearchAmount("grab"), null);
});

test("a number still finds descriptions that contain it", () => {
  const where = buildSearchWhere("7");
  assert.deepEqual(where.OR?.slice(0, 2), text("7"));
  assert.deepEqual(where.OR?.slice(2), [
    { amountIn: { gte: 7, lt: 8 } },
    { amountOut: { gte: 7, lt: 8 } },
  ]);
});

test("parses currency prefixes, thousands commas and whitespace", () => {
  assert.deepEqual(parseSearchAmount(" S$1,200 "), { text: "1,200", min: 1200, max: 1201 });
  assert.deepEqual(parseSearchAmount("$ 12.5"), { text: "12.5", min: 12.5 });
  assert.equal(parseSearchAmount("1,20"), null);
  assert.equal(parseSearchAmount("4.499"), null);
  assert.equal(parseSearchAmount("$"), null);
  assert.equal(parseSearchAmount("bus 4"), null);
});

test("list, count, totals and bulk filters share the search and keep amount bounds separate", () => {
  const where = TransactionRepository.buildWhere("user-1", { search: "$4", minAmount: 10 });
  assert.deepEqual(where.AND, [buildSearchWhere("$4")]);
  assert.deepEqual(where.OR, [
    { amountIn: { gte: 10 } },
    { amountOut: { gte: 10 } },
  ]);
});
