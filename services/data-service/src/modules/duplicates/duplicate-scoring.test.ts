import assert from "node:assert/strict";
import test from "node:test";
import { scoreDuplicatePair, type DuplicateCandidate } from "./duplicate-scoring";
import { findStagedDuplicates, type StagedRowSummary } from "../imports/staged-duplicates";

const simplyGo = (date: string, route: string, fare: number, legs: string[], extra: Record<string, unknown> = {}): DuplicateCandidate => ({
  date,
  description: `SimplyGo: ${route}`,
  amountIn: null,
  amountOut: fare,
  accountIdentifier: "SimplyGo",
  metadata: { parserId: "simplygo_transit_statement", route, legs, ...extra },
});

const uob = (date: string, description: string, amount: number): DuplicateCandidate => ({
  date,
  description,
  amountIn: null,
  amountOut: amount,
  accountIdentifier: "4265-****-****-4591",
  metadata: { parserId: "uob_one_credit_card_pdf" },
});

const staged = (draftId: string, rowIndex: number, row: DuplicateCandidate, label?: string): StagedRowSummary => {
  const payload = { ...row, label };
  return {
    draftId,
    rowId: `${draftId}${rowIndex}`,
    rowIndex,
    filename: `${draftId}.pdf`,
    date: String(row.date),
    description: row.description,
    amountIn: row.amountIn,
    amountOut: row.amountOut,
    accountIdentifier: row.accountIdentifier,
    metadata: row.metadata,
    content: JSON.stringify(payload),
    distinctWithinDraft: (row.metadata as any)?.distinctWithinDraft === true,
  };
};

const commute = (date: string, times = ["05:08 PM - 05:18 PM", "05:19 PM - 05:40 PM"]) =>
  simplyGo(date, "Aft Ang Mo Kio Ave 10 - Simei", 2.11, [
    `${times[0]} Bus 45 Aft Ang Mo Kio Ave 10 - S'goon Stn Exit F; $1.28`,
    `${times[1]} Train Serangoon CCL - Simei; $0.83`,
  ]);

test("two riders on one trip are not duplicates", () => {
  const trip = simplyGo("2026-10-31", "Paya Lebar CCL - Simei", 1.82, ["07:55 PM - 08:13 PM Train Paya Lebar CCL - Simei; $1.82"], { distinctWithinDraft: true });
  assert.deepEqual(findStagedDuplicates([staged("oct", 0, trip), staged("oct", 1, trip)]), []);
  // Told apart by their labels even without the parser's flag.
  const unflagged = simplyGo("2026-10-31", "Paya Lebar CCL - Simei", 1.82, ["07:55 PM - 08:13 PM Train Paya Lebar CCL - Simei; $1.82"]);
  assert.deepEqual(
    findStagedDuplicates([staged("oct", 0, unflagged, "MRT/Bus (Madeline)"), staged("oct", 1, unflagged, "MRT/Bus (Johan)")]),
    [],
  );
});

test("a line a statement repeats word for word is still flagged", () => {
  const row = uob("2026-10-13", "LUCKINCOFFEE SINGAPORE", 4.49);
  assert.equal(findStagedDuplicates([staged("uob", 0, row), staged("uob", 1, row)]).length, 1);
});

test("a daily commute is not a duplicate within the statement or of last month's trips", () => {
  const rows = ["2026-10-26", "2026-10-27", "2026-10-28"].map((date, index) => staged("oct", index, commute(date)));
  assert.deepEqual(findStagedDuplicates(rows), []);
  assert.equal(scoreDuplicatePair(commute("2026-10-01"), commute("2026-09-30")), null);
  assert.equal(scoreDuplicatePair(commute("2026-10-01"), commute("2026-09-29")), null);
  // Same day, other times: the trip home on another run.
  assert.equal(scoreDuplicatePair(commute("2026-10-01"), commute("2026-10-01", ["06:08 PM - 06:18 PM", "06:19 PM - 06:40 PM"])), null);
});

test("card charges that differ only by reference number are different charges", () => {
  const first = uob("2026-10-31", "BUS/MRT 959333768 SINGAPORE", 6.06);
  const second = uob("2026-10-31", "BUS/MRT 959719091 SINGAPORE", 6.06);
  assert.deepEqual(findStagedDuplicates([staged("uob", 0, first), staged("uob", 1, second)]), []);
  assert.equal(scoreDuplicatePair(first, second), null);
});

test("the same coffee on consecutive days is not a duplicate", () => {
  const days = ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
  const rows = days.map((date, index) => staged("uob", index, uob(date, "LUCKINCOFFEE SINGAPORE", 4.49)));
  assert.deepEqual(findStagedDuplicates(rows), []);
  // Against last month's saved card rows from the same card.
  assert.equal(scoreDuplicatePair(uob("2026-10-01", "LUCKINCOFFEE SINGAPORE", 4.49), uob("2026-09-30", "LUCKINCOFFEE SINGAPORE", 4.49)), null);
});

test("re-staging a committed statement flags every row", () => {
  const statement = [
    commute("2026-09-28"),
    simplyGo("2026-09-28", "Paya Lebar CCL - Simei", 1.82, ["07:55 PM - 08:13 PM Train Paya Lebar CCL - Simei; $1.82"], { distinctWithinDraft: true }),
    simplyGo("2026-09-28", "Paya Lebar CCL - Simei", 1.82, ["07:55 PM - 08:13 PM Train Paya Lebar CCL - Simei; $1.82"], { distinctWithinDraft: true }),
    uob("2026-10-31", "BUS/MRT 959333768 SINGAPORE", 6.06),
    uob("2026-10-14", "LUCKINCOFFEE SINGAPORE", 4.49),
  ];
  for (const row of statement) {
    const result = scoreDuplicatePair(row, { ...row });
    assert.ok(result && result.score >= 0.8, row.description);
  }
  // Statements parsed before leg end times were read still match their re-import.
  const saved = simplyGo("2026-09-28", "Aft Ang Mo Kio Ave 10 - Simei", 2.11, [
    "05:08 PM Bus 45 Aft Ang Mo Kio Ave 10 - S'goon Stn Exit F; $1.28",
    "05:19 PM Train Serangoon CCL - Simei; $0.83",
  ]);
  assert.ok(scoreDuplicatePair(commute("2026-09-28"), saved));
  // Two staged copies of one statement flag each other.
  const copies = [staged("first", 0, statement[3]), staged("second", 0, statement[3])];
  assert.equal(findStagedDuplicates(copies).length, 1);
});

test("one transaction saved from two sources still matches across a posting delay", () => {
  const card = uob("2026-10-14", "GRAB*TRANSPORT SINGAPORE", 12.4);
  const receipt: DuplicateCandidate = {
    date: "2026-10-13",
    description: "GRAB*TRANSPORT SINGAPORE",
    amountIn: null,
    amountOut: 12.4,
    metadata: { parserId: "assistant_rows" },
  };
  const result = scoreDuplicatePair(card, receipt);
  assert.ok(result);
  assert.ok(result.reasons.includes("Date within 1 days"));
});
