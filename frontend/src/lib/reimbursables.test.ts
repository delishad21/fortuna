import { test } from "node:test";
import assert from "node:assert/strict";
import { describeShare, flagFromRow, owedFor, shareFields, shareFromFields, shareInput } from "./reimbursables";

test("shares read and show as the editors use them", () => {
  assert.equal(describeShare({ kind: "full" }), "in full");
  assert.equal(describeShare({ kind: "fraction", fraction: 0.5 }), "half");
  assert.equal(describeShare({ kind: "fraction", fraction: 1 / 3 }), "1/3");
  assert.equal(describeShare({ kind: "fraction", fraction: 0.35 }), "35%");
  assert.equal(describeShare({ kind: "amount", amount: 12 }), "$12.00");
  assert.deepEqual(shareFromFields("percent", "25"), { fraction: 0.25 });
  assert.deepEqual(shareFromFields("amount", "4.505"), { amount: 4.51 });
  assert.ok("error" in (shareFromFields("amount", "") as object));
  assert.deepEqual(shareFields({ kind: "fraction", fraction: 0.25 }), { mode: "percent", value: "25" });
  assert.deepEqual(shareInput({ kind: "fraction", fraction: 0.5 }), { fraction: 0.5 });
  assert.equal(owedFor(10, { kind: "fraction", fraction: 1 / 3 }), 3.33);
  assert.equal(owedFor(10, { kind: "amount", amount: 12 }), 10);
});

test("a transaction's columns become its flag", () => {
  assert.equal(flagFromRow({ reimbursablePersonId: null }), null);
  assert.deepEqual(
    flagFromRow({ reimbursablePersonId: "p", reimbursableAmount: "5.5", reimbursableShare: "0.5", reimbursablePerson: { id: "p", name: "Madeline" } }),
    { personId: "p", person: "Madeline", owed: 5.5, share: { kind: "fraction", fraction: 0.5 }, note: null },
  );
  assert.deepEqual(flagFromRow({ reimbursablePersonId: "p", reimbursableAmount: "3", reimbursableShare: null })?.share, { kind: "amount", amount: 3 });
  assert.deepEqual(flagFromRow({ reimbursablePersonId: "p", reimbursableAmount: "3", reimbursableShare: "1" })?.share, { kind: "full" });
});
