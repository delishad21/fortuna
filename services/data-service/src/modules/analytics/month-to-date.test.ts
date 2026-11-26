import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMonthToDate,
  monthToDateFrom,
  partialPeriod,
  projectMonthEnd,
  resolveToday,
  sameDayIn,
  todayKey,
  weekStartKey,
} from "./month-to-date";
import { buildAccountBreakdown } from "./analytics.utils";
import { buildSpendingRows } from "./spending";

const food = { id: "cat-food", name: "Food", color: "#f00", icon: "utensils" };
const transport = { id: "cat-transport", name: "Transport", color: "#0f0", icon: "bus" };
const at = (day: string, amountOut: number, category = food, extra: Record<string, unknown> = {}) => ({
  id: `${day}-${amountOut}`,
  date: new Date(`${day}T00:00:00Z`),
  description: "x",
  amountOut,
  categoryId: category.id,
  category,
  ...extra,
});

describe("month to date", () => {
  it("takes today in Singapore, not UTC", () => {
    // 20:00 UTC on the 25th is 04:00 on the 26th in Singapore.
    assert.equal(todayKey(new Date("2026-11-25T20:00:00Z")), "2026-11-26");
    assert.equal(todayKey(new Date("2026-11-25T20:00:00Z"), "UTC"), "2026-11-25");
  });

  it("accepts only real dates for today", () => {
    assert.equal(resolveToday("2026-11-26"), "2026-11-26");
    assert.equal(resolveToday("2026-02-30", new Date("2026-11-25T20:00:00Z")), "2026-11-26");
    assert.equal(resolveToday(undefined, new Date("2026-11-25T20:00:00Z")), "2026-11-26");
  });

  it("finds Mondays and the same day in shorter months", () => {
    assert.equal(weekStartKey("2026-11-26"), "2026-11-23"); // Thursday
    assert.equal(weekStartKey("2026-11-23"), "2026-11-23"); // Monday
    assert.equal(weekStartKey("2026-11-01"), "2026-10-26"); // Sunday
    assert.equal(sameDayIn("2026-02", 31), "2026-02-28");
    assert.equal(sameDayIn("2026-10", 26), "2026-10-26");
    assert.equal(monthToDateFrom("2026-03-02"), "2026-02-01");
  });

  it("projects at the pace so far", () => {
    assert.equal(projectMonthEnd(300, 10, 30), 900);
    assert.equal(projectMonthEnd(0, 10, 30), null);
    assert.deepEqual(partialPeriod("2026-11-01", "2026-11-30", "2026-11-10", { totalIn: 0, totalOut: 100 }), {
      asOf: "2026-11-10",
      elapsedDays: 10,
      totalDays: 30,
      projected: { totalOut: 300, totalIn: null },
    });
    assert.equal(partialPeriod("2026-10-01", "2026-10-31", "2026-11-10", { totalIn: 0, totalOut: 100 }), null);
  });

  it("compares the month so far with last month to the same day", () => {
    const result = buildMonthToDate(
      [
        at("2026-10-05", 40),
        at("2026-10-26", 10, transport),
        at("2026-10-27", 500), // after the same day last month
        at("2026-11-02", 30),
        at("2026-11-23", 20, transport),
        at("2026-11-26", 15),
        at("2026-11-26", 999, food, { linkage: { type: "internal" } }),
        { ...at("2026-11-25", 0), amountIn: 3000, amountOut: 0 },
      ],
      "2026-11-26",
    );
    assert.equal(result.month, "2026-11");
    assert.equal(result.spent, 65);
    assert.equal(result.income, 3000);
    assert.equal(result.todaySpent, 15);
    assert.equal(result.weekStart, "2026-11-23");
    assert.equal(result.weekSpent, 35);
    assert.deepEqual(result.previous, {
      month: "2026-10",
      sameDay: "2026-10-26",
      spentSameDay: 50,
      spentTotal: 550,
      hasData: true,
    });
    assert.equal(result.change, 15);
    assert.equal(result.projected, 75);
    assert.deepEqual(
      result.categories.map((item) => [item.name, item.icon, item.spent, item.previousSameDay, item.previousTotal]),
      [
        ["Food", "utensils", 45, 40, 540],
        ["Transport", "bus", 20, 10, 10],
      ],
    );
  });
});

describe("account grouping", () => {
  const savings = { id: "acc-1", name: "DBS Multiplier", color: "#111" };
  const credit = { id: "acc-2", name: "UOB Credit Card", color: "#222" };
  const rows = [
    at("2026-11-02", 30, food, { accountId: savings.id, account: savings }),
    at("2026-11-03", 50, food, {
      accountId: credit.id,
      account: credit,
      cardId: "card-1",
      card: { id: "card-1", last4: "4591", nickname: null, network: "visa" },
    }),
    at("2026-11-04", 5),
  ];

  it("groups by the Account model and by card", () => {
    assert.deepEqual(
      buildAccountBreakdown(rows).map((item) => [item.key, item.name, item.totalOut]),
      [
        ["acc-2", "UOB Credit Card", 50],
        ["acc-1", "DBS Multiplier", 30],
        ["none", "No account", 5],
      ],
    );
    assert.deepEqual(
      buildAccountBreakdown(rows, "card").map((item) => [item.name, item.color, item.totalOut]),
      [
        ["Visa ·· 4591", "#222", 50],
        ["No card", "#9ca3af", 35],
      ],
    );
  });

  it("gives the agent spending per account", () => {
    assert.deepEqual(buildSpendingRows(rows, { groupBy: "account", from: "2026-11-01", to: "2026-11-30" }), [
      { label: "UOB Credit Card", amount: 50 },
      { label: "DBS Multiplier", amount: 30 },
      { label: "No account", amount: 5 },
    ]);
  });
});
