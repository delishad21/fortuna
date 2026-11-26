import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { withChatDb } from "../chat/test-harness";
import { withDatabase } from "../../lib/database-context";
import { HermesWorkflowService } from "./hermes-workflow.service";
import { replaceLinks, runInTransaction } from "../reimbursements/links.service";
import { TripRepository } from "../trips/trips.repository";

const actor = { actorType: "user" as const };

async function seed(db: PrismaClient) {
  process.env.COMMIT_TOKEN_SECRET = "reconcile-commit-test-secret-at-least-32-characters";
  const user = await db.user.create({ data: { username: `reconcile-${Date.now()}-${Math.random()}` } });
  const dbs = await db.accountIdentifier.create({ data: { userId: user.id, accountIdentifier: "DBS-123" } });
  const uob = await db.accountIdentifier.create({ data: { userId: user.id, accountIdentifier: "UOB-4591" } });
  const food = await db.category.create({ data: { userId: user.id, name: "Food", color: "#f00" } });
  const transport = await db.category.create({ data: { userId: user.id, name: "Transport", color: "#0f0" } });
  return { user, dbsAccountId: dbs.accountId as string, uobAccountId: uob.accountId as string, food, transport };
}

type Payload = Record<string, unknown>;
const statementRow = (date: string, description: string, amount: number, extra: Payload = {}): Payload => ({
  date,
  description,
  accountIdentifier: "DBS-123",
  currency: "SGD",
  ...(amount < 0 ? { amountIn: -amount } : { amountOut: amount }),
  label: description,
  ...extra,
});

function stage(db: PrismaClient, userId: string, payloads: Payload[]) {
  return db.importDraft.create({
    data: {
      userId,
      mode: "main",
      parserId: "dbs_statement",
      sourceFilename: `dbs-${Math.random()}.pdf`,
      sourceSha256: `sha-${Math.random()}`,
      status: "review",
      expiresAt: new Date("2099-01-01"),
      rows: {
        create: payloads.map((payload, rowIndex) => ({
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

function logged(db: PrismaClient, userId: string, data: Payload) {
  return db.transaction.create({
    data: {
      userId,
      entrySource: "assistant",
      reviewStatus: "to_review",
      reviewReasons: ["no_rule_matched"],
      accountIdentifier: "DBS-123",
      currency: "SGD",
      ...data,
    } as never,
  });
}

async function validate(userId: string, draftIds: string[]) {
  const selection = await HermesWorkflowService.prepareSelection(userId, draftIds, actor);
  assert.equal(selection.valid, true, JSON.stringify(selection.validations.map((v) => v.validation.errors)));
  return selection;
}

async function commit(userId: string, draftIds: string[]) {
  const selection = await validate(userId, draftIds);
  return HermesWorkflowService.commitDrafts(
    userId,
    selection.validations.map(({ draftId, validation }) => ({
      draftId,
      confirmationToken: (validation as any).confirmationToken,
    })),
    true,
    actor,
  );
}

test("an upload into a month with nothing logged is the plain import", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user } = await seed(db);
      // Logged entries elsewhere don't count: another account, another month, or already confirmed.
      await logged(db, user.id, { date: new Date("2026-11-03"), description: "Coffee", amountOut: 5, accountIdentifier: "UOB-4591" });
      await logged(db, user.id, { date: new Date("2026-09-03"), description: "Coffee", amountOut: 5 });
      await logged(db, user.id, { date: new Date("2026-11-03"), description: "Lunch", amountOut: 12, reconciled: true });
      const draft = await stage(db, user.id, [
        statementRow("2026-11-02", "COFFEE BEAN", 5),
        statementRow("2026-11-10", "GIRO RENT", 1800),
      ]);
      const read = await HermesWorkflowService.getDraft(user.id, draft.id);
      assert.equal(read.reconcile, null);
      assert.ok(read.rows.every((row: any) => !("reconcile" in row)));
      const selection = await validate(user.id, [draft.id]);
      assert.equal("reconcile" in selection.validations[0].validation, false);
      const [result] = await commit(user.id, [draft.id]);
      assert.equal(result.importedCount, 2);
      assert.equal("reconciled" in result, false);
      const saved = await db.transaction.findMany({ where: { userId: user.id, importBatchId: result.batchId as string } });
      assert.equal(saved.length, 2);
      assert.ok(saved.every((row) => row.entrySource === "statement" && row.reconciled));
    }),
  ));

test("matched entries are confirmed with the bank's data, gaps are added, leftovers handled as chosen", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, food, transport, uobAccountId, dbsAccountId } = await seed(db);
      const image = await db.storedImage.create({
        data: { userId: user.id, contentType: "image/png", sizeBytes: 1, sha256: `img-${Math.random()}`, storagePath: "/tmp/x.png" },
      });
      const coffee = await logged(db, user.id, {
        date: new Date("2026-11-03"), description: "Starbucks", label: "Morning coffee", amountOut: 7.4,
        categoryId: food.id, imageId: image.id, externalId: "notif:1", metadata: { note: "oat latte" },
      });
      const dinner = await logged(db, user.id, {
        date: new Date("2026-11-12"), description: "Jumbo Seafood dinner", amountOut: 115, categoryId: food.id,
        reviewStatus: "reviewed", reviewReasons: [],
      });
      const twin = await logged(db, user.id, { date: new Date("2026-11-05"), description: "Starbucks", amountOut: 7.4 });
      const wrongAccount = await logged(db, user.id, { date: new Date("2026-11-15"), description: "Taxi", amountOut: 18, categoryId: transport.id });
      const cash = await logged(db, user.id, { date: new Date("2026-11-14"), description: "Hawker lunch", amountOut: 6.5 });

      const draft = await stage(db, user.id, [
        statementRow("2026-11-04", "STARBUCKS COFFEE SINGAPORE", 7.4, { balance: 992.6 }),
        statementRow("2026-11-13", "JUMBO SEAFOOD RIVERSIDE", 128.6, { balance: 864 }),
        statementRow("2026-11-20", "GIRO RENT NOV", 64, { balance: 800 }),
      ]);
      const read = await HermesWorkflowService.getDraft(user.id, draft.id);
      assert.ok(read.reconcile);
      assert.deepEqual(
        read.reconcile.matched.map((match) => [match.rowIndex, match.transactionId]),
        [[0, coffee.id], [1, dinner.id]],
      );
      assert.deepEqual(read.reconcile.gaps.map((gap) => gap.rowIndex), [2]);
      assert.deepEqual(
        read.reconcile.leftovers.map((item) => item.entry.id).sort(),
        [twin.id, wrongAccount.id, cash.id].sort(),
      );
      assert.equal((read.rows[0] as any).reconcile.status, "matched");
      assert.equal((read.rows[2] as any).reconcile.status, "gap");

      const { version } = await HermesWorkflowService.reconcileDraft(
        user.id,
        draft.id,
        {
          expectedVersion: read.version,
          entries: [
            { transactionId: twin.id, action: "delete" },
            { transactionId: wrongAccount.id, action: "move", accountId: uobAccountId },
          ],
        },
        actor,
      );
      assert.equal(version, read.version + 1);

      const before = await db.transaction.count({ where: { userId: user.id } });
      const [result] = await commit(user.id, [draft.id]);
      assert.equal(result.importedCount, 1);
      assert.deepEqual(
        { ...(result.reconciled as any), matchedTransactionIds: undefined },
        { matched: 2, amountsCorrected: 1, deleted: 1, moved: 1, kept: 1, matchedTransactionIds: undefined },
      );
      // One new row (rent), one deleted (the twin).
      assert.equal(await db.transaction.count({ where: { userId: user.id } }), before);

      const confirmed = await db.transaction.findUniqueOrThrow({ where: { id: coffee.id } });
      assert.equal(confirmed.reconciled, true);
      assert.ok(confirmed.reconciledAt);
      assert.equal(confirmed.importBatchId, result.batchId);
      assert.equal(Number(confirmed.balance), 992.6);
      assert.equal(confirmed.label, "Morning coffee");
      assert.equal(confirmed.categoryId, food.id);
      assert.equal(confirmed.imageId, image.id);
      assert.equal(confirmed.reviewStatus, "to_review");
      assert.equal(confirmed.entrySource, "assistant");
      assert.equal(confirmed.description, "Starbucks");
      assert.equal(confirmed.date.toISOString().slice(0, 10), "2026-11-03");
      const meta = confirmed.metadata as any;
      assert.equal(meta.note, "oat latte");
      assert.equal(meta.postedDate, "2026-11-04");
      assert.equal(meta.statementDescription, "STARBUCKS COFFEE SINGAPORE");
      assert.equal(meta.loggedAmount, undefined);

      const corrected = await db.transaction.findUniqueOrThrow({ where: { id: dinner.id } });
      assert.equal(Number(corrected.amountOut), 128.6);
      assert.deepEqual((corrected.metadata as any).loggedAmount, { amountIn: null, amountOut: 115, currency: "SGD" });
      assert.equal(corrected.reviewStatus, "reviewed");

      assert.equal(await db.transaction.findUnique({ where: { id: twin.id } }), null);
      const moved = await db.transaction.findUniqueOrThrow({ where: { id: wrongAccount.id } });
      assert.equal(moved.accountId, uobAccountId);
      assert.equal(moved.accountIdentifier, "UOB-4591");
      assert.equal(moved.reconciled, false);
      const kept = await db.transaction.findUniqueOrThrow({ where: { id: cash.id } });
      assert.equal(kept.reconciled, false);
      assert.equal(kept.accountId, dbsAccountId);

      const rent = await db.transaction.findFirstOrThrow({ where: { userId: user.id, description: "GIRO RENT NOV" } });
      assert.equal(rent.entrySource, "statement");
      assert.equal(rent.importBatchId, result.batchId);
    }),
  ));

test("overrides: unmatch a row, match another by hand, link a leftover to a row", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user } = await seed(db);
      const kopi = await logged(db, user.id, { date: new Date("2026-11-03"), description: "Kopitiam", amountOut: 4.5 });
      const taxi = await logged(db, user.id, { date: new Date("2026-11-06"), description: "ComfortDelGro taxi", amountOut: 24.5 });
      const draft = await stage(db, user.id, [
        statementRow("2026-11-03", "KOPITIAM", 4.5),
        statementRow("2026-11-06", "COMFORTDELGRO TAXI", 42.5),
        statementRow("2026-11-09", "LUNCH", 10),
      ]);
      let read = await HermesWorkflowService.getDraft(user.id, draft.id);
      assert.deepEqual(read.reconcile!.matched.map((m) => m.transactionId), [kopi.id]);
      const taxiLeftover = read.reconcile!.leftovers.find((item) => item.entry.id === taxi.id)!;
      assert.equal(taxiLeftover.reasons[0].code, "wrong_amount");
      assert.equal(taxiLeftover.suggestedRowId, draft.rows[1].id);

      await HermesWorkflowService.reconcileDraft(
        user.id,
        draft.id,
        {
          expectedVersion: read.version,
          rows: [
            { rowId: draft.rows[0].id, transactionId: null },
            { rowId: draft.rows[1].id, transactionId: taxi.id },
          ],
        },
        actor,
      );
      read = await HermesWorkflowService.getDraft(user.id, draft.id);
      assert.deepEqual(read.reconcile!.matched.map((m) => [m.rowIndex, m.transactionId, m.mode]), [[1, taxi.id, "manual"]]);
      assert.deepEqual(read.reconcile!.gaps.map((g) => [g.rowIndex, g.unmatched]), [[0, true], [2, false]]);
      // A stale version is refused.
      await assert.rejects(
        HermesWorkflowService.reconcileDraft(user.id, draft.id, { expectedVersion: read.version - 1, rows: [{ rowId: draft.rows[0].id, transactionId: "auto" }] }, actor),
        { status: 409 },
      );
      // Unmatching kopi: its row is a gap, so a possible duplicate of the entry, which is left over.
      const selection = await validate(user.id, [draft.id]);
      assert.equal(selection.duplicates.length, 1);
      assert.equal(selection.duplicates[0].match.rowId, kopi.id);

      const [result] = await commit(user.id, [draft.id]);
      assert.equal(result.importedCount, 2);
      assert.equal((result.reconciled as any).matched, 1);
      const fixed = await db.transaction.findUniqueOrThrow({ where: { id: taxi.id } });
      assert.equal(Number(fixed.amountOut), 42.5);
      assert.equal(fixed.reconciled, true);
      assert.equal((fixed.metadata as any).reconciledFrom.mode, "manual");
      assert.equal((await db.transaction.findUniqueOrThrow({ where: { id: kopi.id } })).reconciled, false);
    }),
  ));

test("reimbursement links and trip records stay with the confirmed entry", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, food } = await seed(db);
      const dinner = await logged(db, user.id, { date: new Date("2026-11-12"), description: "Jumbo Seafood dinner", amountOut: 115, categoryId: food.id });
      const payback = await db.transaction.create({
        data: {
          userId: user.id, date: new Date("2026-11-13"), description: "PayNow from Alex", amountIn: 50,
          accountIdentifier: "UOB-4591", linkage: { type: "reimbursement", leftoverCategoryId: null },
          entrySource: "statement", reconciled: true,
        },
      });
      await runInTransaction((dbx) =>
        replaceLinks(dbx, user.id, {
          subject: { transactionId: payback.id },
          role: "reimbursement",
          links: [{ other: { transactionId: dinner.id }, amount: 50 }],
        }),
      );
      const trip = await TripRepository.createTrip(user.id, { name: "Staycation", baseCurrency: "SGD", startDate: new Date("2026-11-10") });
      await TripRepository.addEntriesFromSourceTransactions(user.id, trip.id, {
        transactionIds: [dinner.id],
        entryType: "spending",
        categoryId: food.id,
      });

      const draft = await stage(db, user.id, [
        statementRow("2026-11-13", "JUMBO SEAFOOD RIVERSIDE", 128.6),
        statementRow("2026-11-14", "PAYNOW FROM SAM", -40, { linkage: { type: "reimbursement", leftoverCategoryId: null } }),
      ]);
      // The staged credit pays back the staged dinner row, which confirms the logged dinner.
      await runInTransaction((dbx) =>
        replaceLinks(dbx, user.id, {
          subject: { draftRowId: draft.rows[1].id },
          role: "reimbursement",
          links: [{ other: { draftRowId: draft.rows[0].id }, amount: 40 }],
        }),
      );
      const read = await HermesWorkflowService.getDraft(user.id, draft.id);
      assert.deepEqual(read.reconcile!.matched.map((m) => m.transactionId), [dinner.id]);

      const [result] = await commit(user.id, [draft.id]);
      assert.equal(result.importedCount, 1);
      const sam = await db.transaction.findFirstOrThrow({ where: { userId: user.id, description: "PAYNOW FROM SAM" } });
      const links = await db.reimbursementLink.findMany({ where: { userId: user.id }, orderBy: { amount: "asc" } });
      assert.deepEqual(
        links.map((link) => [link.reimbursementTransactionId, link.expenseTransactionId, Number(link.amount), link.expenseDraftRowId]),
        [
          [sam.id, dinner.id, 40, null],
          [payback.id, dinner.id, 50, null],
        ],
      );
      const saved = await db.transaction.findUniqueOrThrow({ where: { id: dinner.id } });
      const linkage = saved.linkage as any;
      assert.equal(linkage.reimbursedByAllocations.length, 2);
      assert.equal(Number(saved.amountOut), 128.6);
      // The trip entry still points at the entry and follows the statement amount.
      const entry = await db.tripEntry.findFirstOrThrow({ where: { sourceTransactionId: dinner.id } });
      assert.equal(entry.tripId, trip.id);
      assert.equal(Number(entry.localAmount), 128.6);
    }),
  ));

test("an entry logged after validation stops the commit until it is checked again", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user } = await seed(db);
      const draft = await stage(db, user.id, [statementRow("2026-11-03", "KOPITIAM", 4.5)]);
      const selection = await validate(user.id, [draft.id]);
      await logged(db, user.id, { date: new Date("2026-11-03"), description: "Kopitiam", amountOut: 4.5 });
      await assert.rejects(
        HermesWorkflowService.commitDrafts(
          user.id,
          selection.validations.map(({ draftId, validation }) => ({ draftId, confirmationToken: (validation as any).confirmationToken })),
          true,
          actor,
        ),
        /logged entries changed/,
      );
      const [result] = await commit(user.id, [draft.id]);
      assert.equal(result.importedCount, 0);
      assert.equal((result.reconciled as any).matched, 1);
      assert.ok(result.batchId);
    }),
  ));
