import assert from "node:assert/strict";
import test from "node:test";
import { merchantSimilarity, scoreReconcilePair } from "../duplicates/reconcile-scoring";
import { buildReconcilePlan, type ReconcileEntry, type ReconcileRow } from "./reconcile-plan";

const DBS = "acc-dbs";
const UOB = "acc-uob";

let rowIndex = 0;
const row = (date: string, description: string, amountOut: number | null, extra: Partial<ReconcileRow> = {}): ReconcileRow => {
  const index = rowIndex++;
  return {
    rowId: `row-${index}`,
    rowIndex: index,
    selected: true,
    accountId: DBS,
    date,
    description,
    amountIn: null,
    amountOut,
    ...extra,
  };
};
const entry = (id: string, date: string, description: string, amountOut: number | null, extra: Partial<ReconcileEntry> = {}): ReconcileEntry => ({
  id,
  accountId: DBS,
  date,
  description,
  amountIn: null,
  amountOut,
  entrySource: "assistant",
  ...extra,
});

test("an exact amount on the same day matches", () => {
  const score = scoreReconcilePair(
    { date: "2026-11-03", description: "STARBUCKS COFFEE SG 1234 SINGAPORE", amountIn: null, amountOut: 7.4 },
    { date: "2026-11-03", description: "Starbucks", amountIn: null, amountOut: 7.4 },
  );
  assert.ok(score);
  assert.equal(score.exactAmount, true);
  assert.ok(score.reasons.includes("Same merchant"));
});

test("the bank posting a few days later still matches; too late or the other way does not", () => {
  const statement = { date: "2026-11-07", description: "GRAB* A-8XYZ SINGAPORE", amountIn: null, amountOut: 15.2 };
  const posted = scoreReconcilePair(statement, { date: "2026-11-03", description: "Grab ride", amountIn: null, amountOut: 15.2 });
  assert.ok(posted);
  assert.equal(posted.days, 4);
  assert.equal(scoreReconcilePair(statement, { date: "2026-10-30", description: "Grab ride", amountIn: null, amountOut: 15.2 }), null);
  assert.equal(scoreReconcilePair(statement, { date: "2026-11-05", description: "Grab", amountIn: 15.2, amountOut: null }), null);
});

test("a close amount matches only when the date and merchant agree", () => {
  const statement = { date: "2026-11-10", description: "JOE'S BISTRO NEW YORK USD 48.30", amountIn: null, amountOut: 66.1 };
  const tipped = scoreReconcilePair(statement, { date: "2026-11-09", description: "Joe's Bistro dinner", amountIn: null, amountOut: 57.5 });
  assert.ok(tipped);
  assert.equal(tipped.exactAmount, false);
  assert.equal(tipped.amountDifference, 8.6);
  // Same date and amount band, but nothing in the description: not the same purchase.
  assert.equal(scoreReconcilePair(statement, { date: "2026-11-10", description: "Groceries", amountIn: null, amountOut: 60 }), null);
  // Far outside the tolerance.
  assert.equal(scoreReconcilePair(statement, { date: "2026-11-10", description: "Joe's Bistro", amountIn: null, amountOut: 30 }), null);
});

test("different cards and different journey times are different transactions", () => {
  assert.equal(
    scoreReconcilePair(
      { date: "2026-11-03", description: "NTUC FAIRPRICE", amountIn: null, amountOut: 20, cardLast4: "4591" },
      { date: "2026-11-03", description: "NTUC FairPrice", amountIn: null, amountOut: 20, cardLast4: "1234" },
    ),
    null,
  );
  assert.equal(
    scoreReconcilePair(
      { date: "2026-11-03", description: "BUS/MRT", amountIn: null, amountOut: 1.82, metadata: { legs: ["07:55 PM Train"] } },
      { date: "2026-11-03", description: "BUS/MRT", amountIn: null, amountOut: 1.82, metadata: { legs: ["08:40 AM Train"] } },
    ),
    null,
  );
});

test("merchant similarity looks past the bank's extra words", () => {
  assert.ok(merchantSimilarity("GRABFOOD SINGAPORE SG", "Grab") >= 0.9);
  assert.ok(merchantSimilarity("NETFLIX.COM 866-579-7172", "Netflix subscription") >= 0.9);
  assert.ok(merchantSimilarity("SHENG SIONG SUPERMARKET", "Dinner at Jumbo") < 0.35);
});

test("a statement with nothing logged for its accounts has no plan", () => {
  const rows = [row("2026-11-03", "LUNCH", 12)];
  assert.equal(buildReconcilePlan({ rows, entries: [] }), null);
  // Entries on another account, or outside the period, don't count either.
  assert.equal(
    buildReconcilePlan({
      rows,
      entries: [entry("e-other", "2026-11-03", "Lunch", 12, { accountId: UOB }), entry("e-old", "2026-09-01", "Lunch", 12)],
    }),
    null,
  );
});

test("matched, gaps and leftovers", () => {
  const coffee = row("2026-11-04", "STARBUCKS COFFEE SINGAPORE", 7.4);
  const grab = row("2026-11-08", "GRAB* RIDE SINGAPORE", 15.2);
  const dinner = row("2026-11-12", "JUMBO SEAFOOD RIVERSIDE", 128.6);
  const rent = row("2026-11-20", "GIRO RENT NOV", 1800);
  const salary = row("2026-11-25", "SALARY ACME PTE LTD", null, { amountIn: 5000, amountOut: null });
  const plan = buildReconcilePlan({
    rows: [coffee, grab, dinner, rent, salary],
    entries: [
      entry("e-coffee", "2026-11-03", "Starbucks", 7.4),
      entry("e-grab", "2026-11-05", "Grab", 15.2),
      entry("e-dinner", "2026-11-12", "Jumbo Seafood dinner", 115),
      entry("e-cash", "2026-11-14", "Hawker lunch", 6.5),
      entry("e-pending", "2026-11-24", "Uniqlo", 49.9),
      entry("e-coffee-again", "2026-11-05", "Starbucks", 7.4),
    ],
    elsewhere: [],
  });
  assert.ok(plan);
  assert.deepEqual(
    plan.matched.map((match) => [match.rowId, match.transactionId, match.mode]),
    [
      [coffee.rowId, "e-coffee", "auto"],
      [grab.rowId, "e-grab", "auto"],
      [dinner.rowId, "e-dinner", "auto"],
    ],
  );
  const dinnerMatch = plan.matched[2];
  assert.equal(dinnerMatch.amountDifference, 13.6);
  assert.match(dinnerMatch.warnings[0], /statement amount is saved/);
  assert.deepEqual(plan.gaps.map((gap) => gap.rowId), [rent.rowId, salary.rowId]);
  const reasons = Object.fromEntries(plan.leftovers.map((item) => [item.entry.id, item.reasons.map((r) => r.code)]));
  assert.deepEqual(reasons, {
    "e-cash": ["not_found"],
    "e-pending": ["pending"],
    "e-coffee-again": ["possible_duplicate"],
  });
  assert.equal(plan.leftovers.find((item) => item.entry.id === "e-coffee-again")?.suggestedAction, "delete");
  assert.ok(plan.leftovers.every((item) => item.action === "keep"));
  assert.deepEqual(plan.summary, { matched: 3, gaps: 2, leftovers: 3, amountWarnings: 1, toDelete: 0, toMove: 0, errors: 0 });
});

test("an entry with the wrong amount is flagged against its statement row", () => {
  const taxi = row("2026-11-06", "COMFORTDELGRO TAXI", 42.5);
  const plan = buildReconcilePlan({ rows: [taxi], entries: [entry("e-taxi", "2026-11-06", "ComfortDelGro taxi", 24.5)] });
  assert.ok(plan);
  assert.equal(plan.matched.length, 0);
  const [leftover] = plan.leftovers;
  assert.equal(leftover.reasons[0].code, "wrong_amount");
  assert.equal(leftover.suggestedAction, "link");
  assert.equal(leftover.suggestedRowId, taxi.rowId);
});

test("an entry another account's statement shows is flagged as on the wrong account", () => {
  const plan = buildReconcilePlan({
    rows: [row("2026-11-02", "LUNCH", 12), row("2026-11-28", "DINNER", 30)],
    entries: [entry("e-shoes", "2026-11-10", "Nike", 120)],
    elsewhere: [{ entryId: "e-shoes", accountId: UOB, accountName: "UOB One", transactionId: "t-uob", date: "2026-11-11", description: "NIKE ORCHARD" }],
  });
  assert.ok(plan);
  assert.equal(plan.leftovers[0].reasons[0].code, "wrong_account");
  assert.equal(plan.leftovers[0].reasons[0].accountId, UOB);
  assert.equal(plan.leftovers[0].suggestedAction, "move");
});

test("overrides: unmatch, match another entry by hand, and leftover actions", () => {
  const coffee = row("2026-11-03", "STARBUCKS COFFEE SINGAPORE", 7.4);
  const taxi = row("2026-11-06", "COMFORTDELGRO TAXI", 42.5);
  const entries = [
    entry("e-coffee", "2026-11-03", "Starbucks", 7.4),
    entry("e-taxi", "2026-11-06", "ComfortDelGro taxi", 24.5),
    entry("e-other-card", "2026-11-04", "Coffee", 7.4, { accountId: UOB, accountName: "UOB One" }),
    entry("e-gone", "2026-11-05", "Snacks", 3),
  ];
  const plan = buildReconcilePlan({
    rows: [coffee, taxi],
    entries,
    overrides: {
      rows: { [coffee.rowId]: null, [taxi.rowId]: "e-taxi" },
      entries: { "e-coffee": { action: "move", accountId: UOB }, "e-gone": { action: "delete" } },
    },
    accountNames: { [UOB]: "UOB One" },
  });
  assert.ok(plan);
  // The taxi row is matched by hand despite the amount, with a warning; the coffee row is a gap.
  assert.deepEqual(plan.matched.map((match) => [match.rowId, match.transactionId, match.mode]), [[taxi.rowId, "e-taxi", "manual"]]);
  assert.match(plan.matched[0].warnings[0], /42\.50.*24\.50/);
  assert.deepEqual(plan.gaps.map((gap) => [gap.rowId, gap.unmatched]), [[coffee.rowId, true]]);
  const actions = Object.fromEntries(plan.leftovers.map((item) => [item.entry.id, [item.action, item.accountId]]));
  assert.deepEqual(actions, { "e-coffee": ["move", UOB], "e-gone": ["delete", null] });
  assert.equal(plan.summary.toDelete, 1);
  assert.equal(plan.summary.toMove, 1);

  // An entry on another account can be matched by hand; it moves on commit.
  const across = buildReconcilePlan({ rows: [coffee], entries, overrides: { rows: { [coffee.rowId]: "e-other-card" } }, accountNames: { [UOB]: "UOB One" } });
  assert.ok(across);
  assert.equal(across.matched[0].transactionId, "e-other-card");
  assert.match(across.matched[0].warnings.join(" "), /Logged on UOB One/);
  // The coffee entry it would have matched is now left over.
  assert.ok(across.leftovers.some((item) => item.entry.id === "e-coffee"));
});

test("manual matches that can't hold are errors", () => {
  const coffee = row("2026-11-04", "STARBUCKS COFFEE SINGAPORE", 7.4);
  const refund = row("2026-11-05", "REFUND STARBUCKS", null, { amountIn: 7.4, amountOut: null });
  const plan = buildReconcilePlan({
    rows: [coffee, refund],
    entries: [entry("e-coffee", "2026-11-03", "Starbucks", 7.4), entry("e-confirmed", "2026-11-03", "Starbucks", 7.4, { available: false })],
    overrides: { rows: { [refund.rowId]: "e-coffee", [coffee.rowId]: "e-confirmed" } },
  });
  assert.ok(plan);
  const errors = Object.fromEntries(plan.matched.map((match) => [match.rowId, match.errors.join(" ")]));
  assert.match(errors[coffee.rowId], /confirmed by another statement/);
  assert.match(errors[refund.rowId], /opposite directions/);
  assert.equal(plan.summary.errors, 2);
});

test("each entry matches one row: the best pair wins", () => {
  const first = row("2026-11-03", "KOPITIAM", 4.5);
  const second = row("2026-11-04", "KOPITIAM", 4.5);
  const plan = buildReconcilePlan({
    rows: [first, second],
    entries: [entry("e-kopi", "2026-11-04", "Kopitiam", 4.5)],
  });
  assert.ok(plan);
  assert.deepEqual(plan.matched.map((match) => [match.rowId, match.transactionId]), [[second.rowId, "e-kopi"]]);
  assert.deepEqual(plan.gaps.map((gap) => gap.rowId), [first.rowId]);
  assert.equal(plan.leftovers.length, 0);
});

test("unselected rows aren't reconciled", () => {
  const coffee = row("2026-11-04", "STARBUCKS", 7.4, { selected: false });
  const lunch = row("2026-11-02", "LUNCH", 12);
  const dinner = row("2026-11-06", "DINNER", 20);
  const plan = buildReconcilePlan({ rows: [coffee, lunch, dinner], entries: [entry("e-coffee", "2026-11-04", "Starbucks", 7.4)] });
  assert.ok(plan);
  assert.equal(plan.matched.length, 0);
  assert.deepEqual(plan.leftovers.map((item) => item.entry.id), ["e-coffee"]);
});
