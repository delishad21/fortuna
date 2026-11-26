import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { withChatDb } from "../chat/test-harness";
import { withDatabase } from "../../lib/database-context";
import {
  guessFromLabel,
  nameMatcher,
  parseShare,
  proposeAllocation,
  resolveShare,
  shareFromAnswer,
  summarizeBalance,
} from "./reimbursables.core";
import {
  applyBackfill,
  backfillProposal,
  clearReimbursable,
  confirmRepayment,
  outstanding,
  setReimbursable,
} from "./reimbursables.service";
import { auditLinks } from "./links.queries";
import { replaceLinks, runInTransaction } from "./links.service";
import { TransactionReview } from "../transactions/transaction-review.service";
import { TransactionService } from "../transactions/transactions.service";
import { asOwnSpending, buildReimbursableSummary, getEffectiveOut } from "../analytics/analytics.utils";

const actor = { actorType: "trusted_service", actorId: "test" };

test("shares read as full, fractions, percentages or amounts", () => {
  assert.deepEqual(parseShare(undefined), { kind: "full" });
  assert.deepEqual(parseShare("half"), { kind: "fraction", fraction: 0.5 });
  assert.deepEqual(parseShare("1/3"), { kind: "fraction", fraction: 1 / 3 });
  assert.deepEqual(parseShare("25%"), { kind: "fraction", fraction: 0.25 });
  assert.deepEqual(parseShare({ fraction: 1 }), { kind: "full" });
  assert.deepEqual(parseShare({ amount: 12.5 }), { kind: "amount", amount: 12.5 });
  assert.throws(() => parseShare("2/1"));
  assert.throws(() => parseShare({ amount: 0 }));

  // Answers to a reimbursable question.
  assert.deepEqual(shareFromAnswer("Full"), { kind: "full" });
  assert.deepEqual(shareFromAnswer("Half (S$48)"), { kind: "fraction", fraction: 0.5 });
  assert.deepEqual(shareFromAnswer("S$20"), { kind: "amount", amount: 20 });
  assert.deepEqual(shareFromAnswer("12.5"), { kind: "amount", amount: 12.5 });
  assert.equal(shareFromAnswer("Not shared"), "not_shared");
  assert.equal(shareFromAnswer("No."), "not_shared");
  assert.equal(shareFromAnswer("maybe"), null);
  assert.equal(shareFromAnswer("0"), null);

  assert.deepEqual(resolveShare(30, { kind: "full" }), { amount: 30, fraction: 1 });
  assert.deepEqual(resolveShare(10, { kind: "fraction", fraction: 1 / 3 }), { amount: 3.33, fraction: 0.333333 });
  assert.deepEqual(resolveShare(30, { kind: "amount", amount: 12 }), { amount: 12, fraction: null });
  assert.throws(() => resolveShare(30, { kind: "amount", amount: 31 }), /more than the item/);
  assert.throws(() => resolveShare(0, { kind: "full" }), /Only money out/);
});

test("names match as whole words in description or label, any case", () => {
  const matches = nameMatcher({ name: "Madeline", aliases: ["Lee Yoon Li"] });
  assert.ok(matches("FAST Payment INCOMING PAYNOW FROM: LEE YOON LI MADELINE OTHER"));
  assert.ok(matches("RECEIVE MONEY FROM 96450439", "Reimbursement from Madeline"));
  assert.ok(matches("PAYNOW FROM LEE  YOON LI"));
  assert.ok(!matches("MADELINES BAKERY"));
  assert.ok(!matches(null, undefined));
});

test("repayments match an exact item first, then an exact run, then oldest first", () => {
  const items = [
    { id: "a", date: "2026-09-02", owed: 10, repaid: 0, outstanding: 10 },
    { id: "b", date: "2026-09-05", owed: 5.5, repaid: 0, outstanding: 5.5 },
    { id: "c", date: "2026-10-01", owed: 20, repaid: 0, outstanding: 20 },
    { id: "d", date: "2026-10-03", owed: 5.5, repaid: 0, outstanding: 5.5 },
  ];
  // One item owing exactly that: the oldest such.
  assert.deepEqual(proposeAllocation(5.5, items).links, [{ transactionId: "b", amount: 5.5 }]);
  // The oldest items adding up exactly.
  const run = proposeAllocation(15.5, items);
  assert.equal(run.match, "exact_set");
  assert.deepEqual(run.links.map((link) => link.transactionId), ["a", "b"]);
  // One month's items adding up exactly ("October spending").
  const month = proposeAllocation(25.5, items);
  assert.equal(month.match, "exact_set");
  assert.deepEqual(month.links.map((link) => link.transactionId), ["c", "d"]);
  // Otherwise oldest first, the last one partly: the rest stays outstanding.
  const partial = proposeAllocation(12, items);
  assert.equal(partial.match, "oldest_first");
  assert.deepEqual(partial.links, [
    { transactionId: "a", amount: 10 },
    { transactionId: "b", amount: 2 },
  ]);
  assert.equal(partial.remainingOnItems, 3.5);
  assert.equal(partial.unallocated, 0);
  // More than everything owed: the rest is left unallocated.
  const over = proposeAllocation(50, items);
  assert.equal(over.unallocated, 9);
  // Items after the repayment's date are left out.
  assert.deepEqual(proposeAllocation(20, items, "2026-09-30").links.map((link) => link.transactionId), ["a", "b"]);
  assert.equal(proposeAllocation(5, []).match, "none");
});

test("balances add up per month with full and partial shares and partial repayments", () => {
  const balance = summarizeBalance([
    { id: "a", date: "2026-09-02", owed: 10, repaid: 10 },
    { id: "b", date: "2026-09-20", owed: 7.5, repaid: 2.5 },
    { id: "c", date: "2026-10-01", owed: 4, repaid: 0 },
    { id: "d", date: "2026-10-02", owed: 3, repaid: 5 },
  ]);
  assert.deepEqual(
    { owed: balance.owed, repaid: balance.repaid, outstanding: balance.outstanding, openItems: balance.openItems },
    { owed: 24.5, repaid: 15.5, outstanding: 9, openItems: 2 },
  );
  assert.deepEqual(
    balance.months.map((month) => [month.month, month.owed, month.repaid, month.outstanding]),
    [
      ["2026-09", 17.5, 12.5, 5],
      ["2026-10", 7, 3, 4],
    ],
  );
});

test("backfill guesses from the label", () => {
  const madeline = { name: "Madeline" };
  assert.equal(guessFromLabel("Lunch", madeline), null);
  assert.deepEqual(guessFromLabel("MRT/Bus (Madeline)", madeline)?.share, { kind: "full" });
  assert.equal(guessFromLabel("Keyboard for Madeline", madeline)?.selected, true);
  assert.deepEqual(guessFromLabel("Hiking Shoes (For Madeline and me)", madeline)?.share, { kind: "fraction", fraction: 0.5 });
  const outing = guessFromLabel("Sushiro With Madeline", madeline);
  assert.equal(outing?.selected, false);
  assert.equal(outing?.confidence, "low");
  assert.equal(guessFromLabel("Rent for staying at Madeline's Place", madeline)?.selected, false);
  assert.equal(guessFromLabel("Funds For Madeline (Reimbursed)", madeline)?.selected, false);
});

test("analytics leave what someone owes out of own spending unless it counts", () => {
  const rows = [
    { amountOut: 100, reimbursablePersonId: "m", reimbursableAmount: 50, linkage: null },
    { amountOut: 30, reimbursablePersonId: "m", reimbursableAmount: 30, linkage: { type: "reimbursed", reimbursedByAllocations: [{ transactionId: "r", amount: 10 }] } },
    { amountOut: 20, linkage: null },
  ];
  assert.deepEqual(rows.map(getEffectiveOut), [50, 0, 20]);
  assert.deepEqual(asOwnSpending(rows, true).map(getEffectiveOut), [100, 20, 20]);
  assert.deepEqual(asOwnSpending(rows, false).map(getEffectiveOut), [50, 0, 20]);
  const summary = buildReimbursableSummary(rows, new Map([["m", "Madeline"]]), false);
  assert.deepEqual(
    { spentFor: summary.spentFor, repaid: summary.repaid, outstanding: summary.outstanding, countsAsOwn: summary.countsAsOwn },
    { spentFor: 80, repaid: 10, outstanding: 70, countsAsOwn: false },
  );
  assert.equal(summary.people[0].name, "Madeline");
});

async function seed(db: PrismaClient) {
  process.env.COMMIT_TOKEN_SECRET = "reimbursables-test-commit-token-secret-at-least-32";
  const user = await db.user.create({ data: { username: `reimb-${Date.now()}-${Math.random()}` } });
  await db.accountIdentifier.create({ data: { userId: user.id, accountIdentifier: "DBS" } });
  const tx = (data: Record<string, unknown>) =>
    db.transaction.create({
      data: { userId: user.id, date: new Date("2026-09-01"), description: "tx", accountIdentifier: "DBS", ...data } as never,
    });
  return { user, tx };
}

test("marking items, balances with shares, and the trigger keeping the amount in step", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, tx } = await seed(db);
      const dinner = await tx({ description: "SUSHIRO", label: "Sushiro", amountOut: 40, date: new Date("2026-09-03") });
      const bus = await tx({ description: "SimplyGo: Simei - Bedok", label: "MRT/Bus (Madeline)", amountOut: 2.11, date: new Date("2026-09-04") });
      const bus2 = await tx({ description: "SimplyGo: Bedok - Simei", label: "MRT/Bus (Madeline)", amountOut: 1.49, date: new Date("2026-10-04") });
      const salary = await tx({ description: "SALARY", amountIn: 3000 });

      await assert.rejects(setReimbursable(user.id, { ids: [dinner.id], person: "Madeline" }, actor), /add them first/);
      // Half the dinner, by fraction.
      await setReimbursable(user.id, { ids: [dinner.id], person: "Madeline", createPerson: true, share: "half", note: "split" }, actor);
      // Retroactively by search, in full; preview first changes nothing.
      const preview = await setReimbursable(user.id, { search: { query: "(Madeline)" }, person: "Madeline", preview: true }, actor);
      assert.equal((preview as { matched: unknown[] }).matched.length, 2);
      assert.equal(await db.transaction.count({ where: { userId: user.id, reimbursablePersonId: { not: null } } }), 1);
      await setReimbursable(user.id, { search: { query: "(Madeline)" }, person: "madeline" }, actor);
      // Money in can't be reimbursable.
      const skipped = await setReimbursable(user.id, { ids: [salary.id, bus.id], person: "Madeline" }, actor);
      assert.equal(skipped.skipped.length, 1);

      let balance = await outstanding(user.id, { person: "Madeline", items: "all" });
      assert.equal(balance.people[0].owed, 23.6);
      assert.equal(balance.people[0].outstanding, 23.6);
      assert.deepEqual(balance.people[0].months.map((month) => [month.month, month.owed]), [["2026-09", 22.11], ["2026-10", 1.49]]);

      // A fraction share follows the amount when it changes; a fixed share never exceeds it.
      await TransactionService.updateTransaction(dinner.id, user.id, { amountOut: 50 });
      assert.equal(Number((await db.transaction.findUniqueOrThrow({ where: { id: dinner.id } })).reimbursableAmount), 25);
      await setReimbursable(user.id, { ids: [bus2.id], person: "Madeline", share: { amount: 1 } }, actor);
      await TransactionService.updateTransaction(bus2.id, user.id, { amountOut: 0.8 });
      assert.equal(Number((await db.transaction.findUniqueOrThrow({ where: { id: bus2.id } })).reimbursableAmount), 0.8);
      // Becoming an internal transfer drops the flag.
      await db.transaction.update({ where: { id: bus2.id }, data: { linkage: { type: "internal" } } });
      assert.equal((await db.transaction.findUniqueOrThrow({ where: { id: bus2.id } })).reimbursablePersonId, null);

      balance = await outstanding(user.id, { person: "Madeline" });
      assert.equal(balance.people[0].outstanding, 27.11);
      await clearReimbursable(user.id, [bus.id], actor);
      balance = await outstanding(user.id, {});
      assert.equal(balance.outstanding, 25);
      assert.equal(
        await db.agentAuditEvent.count({ where: { userId: user.id, toolName: { in: ["set_reimbursable", "clear_reimbursable"] } } }),
        6,
      );
    }),
  ));

test("repayments are proposed in the review queue and confirmed through the links service", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, tx } = await seed(db);
      const a = await tx({ description: "GRAB", label: "Grab (Madeline)", amountOut: 12, date: new Date("2026-09-02") });
      const b = await tx({ description: "SHOPEE", label: "Shopee (Madeline)", amountOut: 8, date: new Date("2026-09-05") });
      await setReimbursable(user.id, { ids: [a.id, b.id], person: "Madeline", createPerson: true }, actor);
      await db.reimbursementPerson.updateMany({ where: { userId: user.id }, data: { aliases: ["LEE YOON LI MADELINE"] } });

      const repayment = await tx({
        description: "INCOMING PAYNOW FROM: LEE YOON LI MADELINE GRAB OTHER",
        amountIn: 15,
        date: new Date("2026-09-10"),
        entrySource: "assistant",
        reviewStatus: "to_review",
      });
      const unrelated = await tx({ description: "PAYNOW FROM SAM", amountIn: 12, date: new Date("2026-09-10"), reviewStatus: "to_review" });

      const queue = await TransactionReview.queue(user.id, { status: "to_review", limit: 50, offset: 0 } as never);
      const entry = queue.transactions.find((item) => item.id === repayment.id);
      assert.equal(queue.transactions.find((item) => item.id === unrelated.id)?.reimbursementProposal, null);
      const proposal = entry?.reimbursementProposal;
      assert.ok(proposal);
      assert.equal(proposal.person.name, "Madeline");
      assert.equal(proposal.match, "oldest_first");
      assert.deepEqual(proposal.links.map((link) => [link.transactionId, link.amount]), [[a.id, 12], [b.id, 3]]);
      assert.equal(proposal.remainingOnItems, 5);
      assert.equal(proposal.marksReimbursement, true);

      // A partial payment leaves the rest outstanding.
      await confirmRepayment(
        user.id,
        { transactionId: repayment.id, links: proposal.links.map((link) => ({ transactionId: link.transactionId, amount: link.amount })) },
        actor,
      );
      const saved = await db.transaction.findUniqueOrThrow({ where: { id: repayment.id }, include: { category: true } });
      assert.equal((saved.linkage as { type: string }).type, "reimbursement");
      assert.equal(saved.category?.name, "Reimbursement");
      assert.equal(saved.reviewStatus, "reviewed");
      // The links service rebuilt both caches, and nothing drifted.
      assert.equal((saved.linkage as { leftoverAmount: number }).leftoverAmount, 0);
      const bAfter = await db.transaction.findUniqueOrThrow({ where: { id: b.id } });
      assert.deepEqual((bAfter.linkage as { reimbursedByAllocations: unknown[] }).reimbursedByAllocations, [{ transactionId: repayment.id, amount: 3 }]);
      assert.equal(await db.reimbursementLink.count({ where: { userId: user.id } }), 2);
      assert.deepEqual((await auditLinks({ userId: user.id })).findings, []);

      const balance = await outstanding(user.id, { person: "Madeline" });
      assert.equal(balance.people[0].outstanding, 5);
      assert.deepEqual(balance.people[0].items?.map((item) => [item.id, item.outstanding]), [[b.id, 5]]);

      // The rest comes later and matches exactly; linking it again keeps the earlier links.
      const rest = await tx({ description: "PAYLAH RECEIVE", label: "Reimbursement from Madeline", amountIn: 5, date: new Date("2026-09-20"), reviewStatus: "to_review" });
      const second = (await TransactionReview.queue(user.id, { status: "to_review", limit: 50, offset: 0 } as never)).transactions.find(
        (item) => item.id === rest.id,
      )?.reimbursementProposal;
      assert.equal(second?.match, "exact");
      await confirmRepayment(user.id, { transactionId: rest.id, links: [{ transactionId: b.id, amount: 5 }] }, actor);
      assert.equal((await outstanding(user.id, { person: "Madeline" })).people[0].outstanding, 0);
      // An over-link is refused by the links service and changes nothing.
      await assert.rejects(
        confirmRepayment(user.id, { transactionId: unrelated.id, links: [{ transactionId: a.id, amount: 12 }] }, actor),
        /would be reimbursed/,
      );
      assert.equal((await db.transaction.findUniqueOrThrow({ where: { id: unrelated.id } })).linkage, null);
    }),
  ));

test("the backfill proposes without writing, and Apply writes only what was kept", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, tx } = await seed(db);
      const now = new Date("2026-11-26T00:00:00Z");
      const bus = await tx({ description: "SimplyGo", label: "MRT/Bus (Madeline)", amountOut: 2.11, date: new Date("2026-10-30") });
      const shoes = await tx({ description: "DECATHLON", label: "Hiking Shoes (For Madeline and me)", amountOut: 80, date: new Date("2026-11-01") });
      const outing = await tx({ description: "SUSHIRO", label: "Sushiro With Madeline", amountOut: 40, date: new Date("2026-11-02") });
      const old = await tx({ description: "SUBWAY", label: "Subway (Madeline)", amountOut: 9, date: new Date("2025-01-10") });
      // An old expense only linked to one of her repayments.
      const ramen = await tx({ description: "FIRE RAMEN", label: "Fire Ramen", amountOut: 30, date: new Date("2025-02-01") });
      const oldRepayment = await tx({
        description: "PAYNOW FROM: LEE YOON LI MADELINE RAMEN",
        label: "Reimbursement for Fire Ramen",
        amountIn: 15,
        linkage: { type: "reimbursement", leftoverCategoryId: null },
        date: new Date("2025-02-03"),
      });
      await runInTransaction((dbx) =>
        replaceLinks(dbx, user.id, { subject: { transactionId: oldRepayment.id }, role: "reimbursement", links: [{ other: { transactionId: ramen.id }, amount: 15 }] }),
      );
      // A recent unlinked repayment matching the bus fare exactly.
      const busRepayment = await tx({ description: "RECEIVE MONEY", label: "Reimbursement from Madeline", amountIn: 2.11, date: new Date("2026-11-03") });

      const snapshot = async () =>
        JSON.stringify(
          await db.transaction.findMany({ where: { userId: user.id }, orderBy: { id: "asc" }, select: { id: true, reimbursablePersonId: true, linkage: true, categoryId: true } }),
        ) + (await db.reimbursementLink.count()) + (await db.reimbursementPerson.count());
      const before = await snapshot();
      const proposal = await backfillProposal(user.id, "Madeline", now);
      assert.equal(await snapshot(), before, "the proposal writes nothing");
      assert.equal(proposal.person.id, null);

      const byId = new Map(proposal.items.map((item) => [item.transactionId, item]));
      assert.equal(byId.get(bus.id)?.selected, true);
      assert.deepEqual(byId.get(shoes.id)?.share, { kind: "fraction", fraction: 0.5 });
      assert.equal(byId.get(shoes.id)?.owed, 40);
      assert.equal(byId.get(outing.id)?.selected, false);
      assert.equal(byId.get(old.id)?.selected, false, "old and never linked: probably settled");
      assert.equal(byId.get(ramen.id)?.source, "linked");
      assert.deepEqual(byId.get(ramen.id)?.share, { kind: "amount", amount: 15 });
      assert.equal(byId.get(ramen.id)?.outstanding, 0);
      assert.equal(proposal.links.length, 1);
      assert.equal(proposal.links[0].repayment.id, busRepayment.id);
      assert.deepEqual(proposal.links[0].links.map((link) => [link.transactionId, link.amount]), [[bus.id, 2.11]]);

      const kept = proposal.items.filter((item) => item.selected);
      const result = await applyBackfill(
        user.id,
        {
          person: "Madeline",
          items: kept.map((item) => ({ transactionId: item.transactionId, share: item.share })),
          links: proposal.links.map((group) => ({ repaymentId: group.repayment.id, links: group.links.map((link) => ({ transactionId: link.transactionId, amount: link.amount })) })),
        },
        actor,
      );
      assert.equal(result.marked, 3);
      assert.equal(result.linked, 1);
      assert.equal((await db.transaction.findUniqueOrThrow({ where: { id: outing.id } })).reimbursablePersonId, null);
      const balance = await outstanding(user.id, { person: "Madeline" });
      assert.equal(balance.people[0].owed, 2.11 + 40 + 15);
      assert.equal(balance.people[0].outstanding, 40);
      assert.deepEqual((await auditLinks({ userId: user.id })).findings, []);
      // Proposing again finds nothing new to mark.
      const again = await backfillProposal(user.id, "Madeline", now);
      assert.deepEqual(again.items.map((item) => item.transactionId).sort(), [old.id, outing.id].sort());
      assert.equal(again.alreadyMarked, 3);
      assert.equal(again.links.length, 0);
    }),
  ));
