import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { withChatDb } from "../chat/test-harness";
import { withDatabase } from "../../lib/database-context";
import {
  EndInfo,
  LinkRow,
  canonicalLinkage,
  classifyEndLinks,
  normalizeDesired,
  stripLinkFields,
} from "./links.core";
import { replaceLinks, runInTransaction } from "./links.service";
import { listCandidates } from "./links.queries";
import { TransactionService } from "../transactions/transactions.service";
import { HermesWorkflowService } from "../imports/hermes-workflow.service";

const end = (overrides: Partial<EndInfo>): EndInfo => ({
  key: "t:x",
  kind: "transaction",
  id: "x",
  amountIn: 0,
  amountOut: 0,
  linkageType: null,
  linkage: null,
  description: "x",
  label: null,
  date: null,
  ...overrides,
});

test("canonical linkage rebuilds the cache from saved links only", () => {
  assert.deepEqual(
    canonicalLinkage(
      {
        type: "reimbursement",
        reimbursesAllocations: [{ transactionId: "stale", amount: 99 }],
        leftoverAmount: 0,
        leftoverCategoryId: "food",
        tripSync: { tripId: "t" },
      },
      50,
      [
        { transactionId: "b", amount: 20 },
        { transactionId: "a", amount: 10.004 },
      ],
      [],
    ),
    {
      type: "reimbursement",
      reimbursesAllocations: [
        { transactionId: "a", amount: 10 },
        { transactionId: "b", amount: 20 },
      ],
      leftoverAmount: 20,
      leftoverCategoryId: "food",
      tripSync: { tripId: "t" },
    },
  );
  assert.deepEqual(
    canonicalLinkage(null, 0, [], [{ transactionId: "r", amount: 5 }]),
    { type: "reimbursed", reimbursedByAllocations: [{ transactionId: "r", amount: 5 }] },
  );
  assert.equal(
    canonicalLinkage({ type: "reimbursed", reimbursedByAllocations: [] }, 0, [], []),
    null,
  );
  assert.deepEqual(canonicalLinkage({ type: "internal", reimbursedByAllocations: [] }, 0, [], []), {
    type: "internal",
  });
});

test("staged rows hold all their links; saved ends only count related drafts", () => {
  const saved = end({ key: "t:e", id: "e", amountOut: 50 });
  const related = end({ key: "r:a", kind: "draftRow", id: "a", draftId: "d1", draftStatus: "review", amountIn: 30, linkageType: "reimbursement" });
  const unrelated = end({ key: "r:b", kind: "draftRow", id: "b", draftId: "d2", draftStatus: "review", draftFilename: "old.csv", amountIn: 30, linkageType: "reimbursement" });
  const closed = end({ key: "r:c", kind: "draftRow", id: "c", draftId: "d3", draftStatus: "discarded", amountIn: 30, linkageType: "reimbursement" });
  const link = (id: string, from: string, amount: number): LinkRow => ({
    id,
    amount,
    reimbursementTransactionId: null,
    reimbursementDraftRowId: from,
    expenseTransactionId: "e",
    expenseDraftRowId: null,
  });
  const links = [link("1", "a", 20), link("2", "b", 25), link("3", "c", 10)];
  const ends = new Map([saved, related, unrelated, closed].map((item) => [item.key, item]));
  const result = classifyEndLinks(saved, "expense", links, ends, new Set(["d1"]));
  assert.equal(result.hard, 20);
  assert.deepEqual(
    result.pending.map((item) => [item.filename, item.amount]),
    [["old.csv", 25]],
  );
  assert.equal(classifyEndLinks(related, "reimbursement", links, ends, new Set()).hard, 20);
});

test("link input merges duplicates and strips legacy link fields", () => {
  assert.deepEqual(
    normalizeDesired([
      { other: { transactionId: "a" }, amount: 5 },
      { other: { transactionId: "a" }, amount: 2.5 },
      { other: { draftRowId: "r" }, amount: 0 },
    ]),
    [{ key: "t:a", amount: 7.5 }],
  );
  assert.throws(() => normalizeDesired([{ other: { transactionId: "a" }, amount: -1 }]));
  assert.deepEqual(
    stripLinkFields({ type: "reimbursement", reimbursesAllocations: [], leftoverAmount: 3, leftoverCategoryId: null }),
    { type: "reimbursement", leftoverCategoryId: null },
  );
  assert.equal(stripLinkFields({ type: "reimbursed", reimbursedByAllocations: [] }), null);
});

async function seed(db: PrismaClient) {
  process.env.COMMIT_TOKEN_SECRET = "links-test-commit-token-secret-at-least-32-characters";
  const user = await db.user.create({ data: { username: `links-${Date.now()}-${Math.random()}` } });
  await db.accountIdentifier.create({ data: { userId: user.id, accountIdentifier: "DBS" } });
  const tx = (data: Record<string, unknown>) =>
    db.transaction.create({
      data: {
        userId: user.id,
        date: new Date("2026-09-01"),
        description: "tx",
        accountIdentifier: "DBS",
        ...data,
      } as never,
    });
  return { user, tx };
}

const reimbursementLinkage = { type: "reimbursement", leftoverCategoryId: null };

test("saved links work in both directions, keep caches in sync and respect limits", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, tx } = await seed(db);
      const r1 = await tx({ description: "PayNow from Alex", amountIn: 50, linkage: reimbursementLinkage });
      const r2 = await tx({ description: "PayNow from Sam", amountIn: 100, linkage: reimbursementLinkage });
      const e1 = await tx({ description: "Dinner", amountOut: 30 });
      const e2 = await tx({ description: "Tickets", amountOut: 40 });

      await runInTransaction((dbx) =>
        replaceLinks(dbx, user.id, {
          subject: { transactionId: r1.id },
          role: "reimbursement",
          links: [
            { other: { transactionId: e1.id }, amount: 30 },
            { other: { transactionId: e2.id }, amount: 20 },
          ],
        }),
      );
      await assert.rejects(
        runInTransaction((dbx) =>
          replaceLinks(dbx, user.id, {
            subject: { transactionId: r1.id },
            role: "reimbursement",
            links: [
              { other: { transactionId: e1.id }, amount: 30 },
              { other: { transactionId: e2.id }, amount: 25 },
            ],
          }),
        ),
        /would pay back \$55\.00/,
      );

      // Reverse direction: the expense picks its reimbursements.
      await assert.rejects(
        runInTransaction((dbx) =>
          replaceLinks(dbx, user.id, {
            subject: { transactionId: e2.id },
            role: "expense",
            links: [
              { other: { transactionId: r1.id }, amount: 20 },
              { other: { transactionId: r2.id }, amount: 25 },
            ],
          }),
        ),
        /would be reimbursed \$45\.00/,
      );
      await runInTransaction((dbx) =>
        replaceLinks(dbx, user.id, {
          subject: { transactionId: e2.id },
          role: "expense",
          links: [
            { other: { transactionId: r1.id }, amount: 20 },
            { other: { transactionId: r2.id }, amount: 20 },
          ],
        }),
      );
      const [r1After, r2After, e2After] = await Promise.all(
        [r1.id, r2.id, e2.id].map((id) => db.transaction.findUniqueOrThrow({ where: { id } })),
      );
      assert.equal((r1After.linkage as any).leftoverAmount, 0);
      assert.equal((r2After.linkage as any).leftoverAmount, 80);
      assert.deepEqual(
        (e2After.linkage as any).reimbursedByAllocations.map((a: any) => a.amount).sort(),
        [20, 20],
      );

      // Candidates show what is left on each reimbursement.
      const candidates = await listCandidates({
        userId: user.id,
        subject: { transactionId: e1.id },
        lookingFor: "reimbursement",
      });
      const byId = new Map(candidates.saved.items.map((item) => [item.transactionId, item]));
      // r1 gives 20 elsewhere, so up to 30 can go to e1 (which already holds 30).
      assert.equal(byId.get(r1.id)?.available, 30);
      assert.equal(byId.get(r1.id)?.otherLinked, 20);
      assert.equal(byId.get(r1.id)?.linkedToSubject, 30);
      assert.equal(byId.get(r1.id)?.fullyAllocated, false);
      assert.equal(byId.get(r2.id)?.available, 80);

      // Amount edits below what is linked are rejected and change nothing.
      await assert.rejects(
        TransactionService.updateTransaction(e2.id, user.id, { amountOut: 10 }),
        /Reduce or remove those links first/,
      );
      assert.equal(
        Number((await db.transaction.findUniqueOrThrow({ where: { id: e2.id } })).amountOut),
        40,
      );

      // Editing a reimbursement's label keeps its links (old bug: mirrors were stripped).
      await TransactionService.updateTransaction(r1.id, user.id, { label: "Alex" });
      assert.equal(
        (await db.transaction.findUniqueOrThrow({ where: { id: e1.id } })).linkage &&
          ((await db.transaction.findUniqueOrThrow({ where: { id: e1.id } })).linkage as any)
            .reimbursedByAllocations.length,
        1,
      );

      // Deleting an expense removes its links and frees the reimbursement.
      await TransactionService.deleteTransaction(e1.id, user.id);
      assert.equal(
        ((await db.transaction.findUniqueOrThrow({ where: { id: r1.id } })).linkage as any).leftoverAmount,
        30,
      );
      assert.equal(await db.reimbursementLink.count({ where: { userId: user.id } }), 2);
    }),
  ));

async function stageDraft(
  db: PrismaClient,
  userId: string,
  filename: string,
  rows: Array<Record<string, unknown>>,
) {
  return db.importDraft.create({
    data: {
      userId,
      mode: "main",
      sourceFilename: filename,
      sourceSha256: filename,
      status: "review",
      expiresAt: new Date("2099-01-01"),
      rows: {
        create: rows.map((payload, rowIndex) => ({
          rowIndex,
          parsedPayload: payload as never,
          currentPayload: payload as never,
          reviewStatus: "accepted",
        })),
      },
    },
    include: { rows: { orderBy: { rowIndex: "asc" } } },
  });
}

const actor = { actorType: "user" as const };
const row = (data: Record<string, unknown>) => ({
  date: "2026-09-02",
  accountIdentifier: "DBS",
  currency: "SGD",
  ...data,
});

test("links between staged files are kept when the files are committed together", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user } = await seed(db);
      const dbs = await stageDraft(db, user.id, "dbs.csv", [row({ description: "Dinner", amountOut: 80 })]);
      const revolut = await stageDraft(db, user.id, "revolut.csv", [
        row({ description: "PayNow", amountIn: 40, linkage: reimbursementLinkage }),
      ]);

      // Legacy payload input (mobile, chat review) becomes a staged link.
      const reimbursementRow = revolut.rows[0];
      await HermesWorkflowService.updateRow(
        user.id,
        revolut.id,
        reimbursementRow.id,
        {
          expectedVersion: reimbursementRow.version,
          currentPayload: {
            ...(reimbursementRow.currentPayload as object),
            linkage: {
              ...reimbursementLinkage,
              reimbursesAllocations: [
                { stagedDraftId: dbs.id, stagedRowId: dbs.rows[0].id, amount: 40 },
              ],
            },
          },
        },
        actor,
      );
      const stored = await db.importDraftRow.findUniqueOrThrow({ where: { id: reimbursementRow.id } });
      assert.equal((stored.currentPayload as any).linkage.reimbursesAllocations, undefined);
      const decorated = await HermesWorkflowService.getDraft(user.id, dbs.id);
      assert.equal((decorated.rows[0].currentPayload as any).linkage.type, "reimbursed");
      assert.equal(decorated.rows[0].links.remaining, 40);

      // Committing one file alone is blocked with a message naming the other.
      const alone = await HermesWorkflowService.prepareSelection(user.id, [dbs.id], actor);
      assert.equal(alone.valid, false);
      assert.match(
        JSON.stringify(alone.validations[0].validation),
        /revolut\.csv\. Commit them together/,
      );

      const together = await HermesWorkflowService.prepareSelection(user.id, [dbs.id, revolut.id], actor);
      assert.equal(together.valid, true);
      await HermesWorkflowService.commitDrafts(
        user.id,
        together.validations.map(({ draftId, validation }) => ({
          draftId,
          confirmationToken: (validation as any).confirmationToken,
        })),
        true,
        actor,
      );
      const links = await db.reimbursementLink.findMany({ where: { userId: user.id } });
      assert.equal(links.length, 1);
      assert.ok(links[0].reimbursementTransactionId && links[0].expenseTransactionId);
      assert.equal(links[0].reimbursementDraftRowId, null);
      const dinner = await db.transaction.findUniqueOrThrow({ where: { id: links[0].expenseTransactionId as string } });
      assert.deepEqual((dinner.linkage as any).reimbursedByAllocations, [
        { transactionId: links[0].reimbursementTransactionId, amount: 40 },
      ]);
    }),
  ));

test("first save wins: a staged claim fails at commit if a saved edit used the amount", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, tx } = await seed(db);
      const expense = await tx({ description: "Concert", amountOut: 50 });
      const saved = await tx({ description: "Bank transfer", amountIn: 40, linkage: reimbursementLinkage });
      const draft = await stageDraft(db, user.id, "later.csv", [
        row({ description: "PayNow", amountIn: 40, linkage: reimbursementLinkage }),
      ]);
      await runInTransaction((dbx) =>
        replaceLinks(dbx, user.id, {
          subject: { draftRowId: draft.rows[0].id },
          role: "reimbursement",
          links: [{ other: { transactionId: expense.id }, amount: 40 }],
        }),
      );
      // The saved edit is allowed, with a warning naming the staged claim.
      const result = await runInTransaction((dbx) =>
        replaceLinks(dbx, user.id, {
          subject: { transactionId: expense.id },
          role: "expense",
          links: [{ other: { transactionId: saved.id }, amount: 30 }],
        }),
      );
      assert.match(result.warnings.join(" "), /also claimed by later\.csv/);
      const selection = await HermesWorkflowService.prepareSelection(user.id, [draft.id], actor);
      assert.equal(selection.valid, false);
      assert.equal(await db.transaction.count({ where: { userId: user.id } }), 2);
    }),
  ));

test("direct imports save rows and links together or not at all", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user } = await seed(db);
      const rows = [
        { date: new Date("2026-09-03"), description: "Taxi", amountOut: 10, accountIdentifier: "DBS" },
        {
          date: new Date("2026-09-04"),
          description: "PayNow",
          amountIn: 20,
          accountIdentifier: "DBS",
          linkage: {
            type: "reimbursement",
            reimbursesAllocations: [{ pendingBatchIndex: 0, amount: 15 }],
          },
        },
      ];
      const failed = await TransactionService.commitImport(user.id, rows as never, [0, 1]);
      assert.equal(failed.success, false);
      assert.equal(await db.transaction.count({ where: { userId: user.id } }), 0);

      (rows[1].linkage as any).reimbursesAllocations[0].amount = 10;
      const ok = await TransactionService.commitImport(user.id, rows as never, [0, 1], {
        filename: "direct.csv",
        fileType: "csv",
        parserId: "test",
      });
      assert.equal(ok.success, true);
      const link = await db.reimbursementLink.findFirstOrThrow({ where: { userId: user.id } });
      assert.equal(link.expenseTransactionId, ok.transactionIds?.[0]);
      assert.equal(link.reimbursementTransactionId, ok.transactionIds?.[1]);
      assert.equal(Number(link.amount), 10);
    }),
  ));

test("discarding a draft removes its links to other drafts", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user } = await seed(db);
      const a = await stageDraft(db, user.id, "a.csv", [row({ description: "Lunch", amountOut: 12 })]);
      const b = await stageDraft(db, user.id, "b.csv", [
        row({ description: "Payback", amountIn: 12, linkage: reimbursementLinkage }),
      ]);
      await runInTransaction((dbx) =>
        replaceLinks(dbx, user.id, {
          subject: { draftRowId: b.rows[0].id },
          role: "reimbursement",
          links: [{ other: { draftRowId: a.rows[0].id }, amount: 12 }],
        }),
      );
      const before = await db.importDraftRow.findUniqueOrThrow({ where: { id: a.rows[0].id } });
      await HermesWorkflowService.discardDraft(user.id, b.id, actor);
      assert.equal(await db.reimbursementLink.count({ where: { userId: user.id } }), 0);
      const after = await db.importDraftRow.findUniqueOrThrow({ where: { id: a.rows[0].id } });
      assert.ok(after.version > before.version, "the other draft's row is re-versioned");
    }),
  ));
