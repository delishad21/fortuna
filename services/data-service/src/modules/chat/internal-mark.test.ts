import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { withChatDb } from "./test-harness";
import { ReviewService } from "./reviews.service";
import { ChatService } from "./chat.service";
import { ApprovalService } from "./approvals.service";
import { TransactionActions } from "./tools/transactions";
import { ImportTools } from "./tools/imports";
import { ReadTools } from "./tools/read";
import { withDatabase } from "../../lib/database-context";
import {
  alignReviewRows,
  withChosenLinkage,
  withSuggestedLinkage,
} from "./internal-mark";

const auto = {
  type: "internal",
  autoDetected: true,
  detectionReason: "Matched import rule: Wallet top-up",
};
const chosen = { type: "internal", autoDetected: false };
const mark = { type: "internal" };

async function seed(db: PrismaClient) {
  const user = await db.user.create({ data: { username: "marks" } });
  const conv = await db.chatConversation.create({ data: { userId: user.id } });
  await db.chatConnection.create({
    data: { userId: user.id, provider: "codex", selected: true, status: "connected" },
  });
  const run = await db.chatRun.create({
    data: {
      userId: user.id,
      conversationId: conv.id,
      idempotencyKey: "first",
      provider: "codex",
      model: "test",
      status: "running",
    },
  });
  const [internal, food, books] = await Promise.all(
    [
      ["Internal", "#9ca3af"],
      ["Snacks", "#ff9800"],
      ["Books", "#4caf50"],
    ].map(([name, color]) =>
      db.category.create({ data: { userId: user.id, name, color } }),
    ),
  );
  await db.accountIdentifier.create({
    data: { userId: user.id, accountIdentifier: "111-sample", color: "#123456" },
  });
  const spend = (description: string, extra: object = {}) =>
    db.transaction.create({
      data: {
        userId: user.id,
        date: new Date("2026-05-04"),
        description,
        amountOut: 10,
        currency: "SGD",
        categoryId: internal.id,
        linkage: auto,
        ...extra,
      },
    });
  const context = { userId: user.id, conversationId: conv.id, runId: run.id };
  const expense = async () => {
    const { totals } = await new ReadTools(db).summary(user.id, {
      dateFrom: "2026-05-01T00:00:00Z",
      dateTo: "2026-06-01T00:00:00Z",
    });
    return totals[0]?.expense;
  };
  return { user, conv, run, internal, food, books, spend, context, expense };
}

test("a suggested category only clears an automatic mark, and Internal only marks unlinked rows", () => {
  const ids = ["int"];
  const suggest = (linkage: unknown, patch: object, linked = false) =>
    withSuggestedLinkage({ categoryId: "int", linkage }, patch as any, ids, mark, linked);
  assert.deepEqual(suggest(auto, { categoryId: "food" }), { categoryId: "food", linkage: null });
  for (const linkage of [chosen, mark, { type: "reimbursement" }, { type: "reimbursed" }, null])
    assert.deepEqual(suggest(linkage, { categoryId: "food" }), { categoryId: "food" });
  // An explicit linkage, no category or a cleared category decides nothing.
  assert.deepEqual(suggest(auto, { categoryId: "food", linkage: mark }), { categoryId: "food", linkage: mark });
  assert.deepEqual(suggest(auto, { label: "x" }), { label: "x" });
  assert.deepEqual(suggest(auto, { categoryId: null }), { categoryId: null });
  assert.deepEqual(suggest(null, { categoryId: "int" }), { categoryId: "int", linkage: mark });
  assert.deepEqual(suggest(null, { categoryId: "int" }, true), { categoryId: "int" });
  for (const linkage of [auto, chosen, { type: "reimbursement" }])
    assert.deepEqual(suggest(linkage, { categoryId: "int" }), { categoryId: "int" });
});

test("the user's own category or type edit keeps the mark in step", () => {
  const edit = (value: any, patch: any) => withChosenLinkage(value, patch, ["int"]);
  for (const linkage of [auto, chosen])
    assert.deepEqual(edit({ categoryId: "int", linkage }, { categoryId: "food" }), { categoryId: "food", linkage: null });
  assert.deepEqual(edit({ linkage: { type: "reimbursement" } }, { categoryId: "food" }), { categoryId: "food" });
  assert.deepEqual(edit({ linkage: null }, { categoryId: "int" }), { categoryId: "int", linkage: chosen });
  assert.deepEqual(edit({ categoryId: "food" }, { linkage: chosen }), { linkage: chosen, categoryId: "int" });
  assert.deepEqual(edit({ categoryId: "int", linkage: auto }, { linkage: null }), { linkage: null, categoryId: null });
  assert.deepEqual(edit({ categoryId: "food", linkage: auto }, { linkage: null }), { linkage: null });
  assert.deepEqual(edit({ linkage: auto }, { categoryId: null, label: "x" }), { categoryId: null, label: "x" });
});

test("older review rows: only an untouched automatic mark under a changed category is cleared", () => {
  const row = (value: object, source: object = { transactionId: "t" }) =>
    ({ id: "t", version: 3, source, original: { categoryId: "int", linkage: auto }, value }) as any;
  const [cleared, kept, internal, same, staged] = alignReviewRows(
    [
      row({ categoryId: "food", linkage: { ...auto } }),
      row({ categoryId: "food", linkage: chosen }),
      row({ categoryId: "int", linkage: auto }),
      { ...row({ categoryId: "food", linkage: auto }), original: { categoryId: "food", linkage: auto } },
      row({ categoryId: "food", linkage: auto }, { draftId: "d", rowId: "t" }),
    ],
    ["int"],
  );
  assert.deepEqual(cleared.value, { categoryId: "food", linkage: null });
  assert.equal(cleared.version, 3);
  assert.deepEqual(kept.value, { categoryId: "int", linkage: chosen });
  assert.deepEqual(internal.value.linkage, auto);
  assert.deepEqual(same.value.linkage, auto);
  assert.deepEqual(staged.value.linkage, auto);
});

test("review responses carry category and account colours; the model's context doesn't", () =>
  withChatDb(async (db) => {
    const { user, spend, context, food } = await seed(db);
    const t = await spend("Corner kiosk");
    const service = new ReviewService(db);
    const review = await service.create(context, { title: "Colours", transactionIds: [t.id] });
    const check = (v: Awaited<ReturnType<ReviewService["get"]>>) => {
      assert.deepEqual(
        Object.fromEntries(v.categories.map((c) => [c.name, c.color])),
        { Internal: "#9ca3af", Snacks: "#ff9800", Books: "#4caf50" },
      );
      assert.equal(v.accounts[0].color, "#123456");
    };
    check(await service.get(user.id, review.id));
    check(
      await service.update(user.id, review.id, { rowId: t.id, version: 1, patch: { categoryId: food.id } }),
    );
    check(await service.cancel(user.id, review.id, { version: 2 }));
    const model = await new ReadTools(db).context(user.id);
    assert.ok([...model.categories, ...model.accounts].every((v) => !("color" in v)));
  }));

test("suggested categories on saved rows reach the proposal, its preview and the totals", () =>
  withChatDb(async (db) => {
    const { user, conv, run, internal, food, books, spend, context, expense } = await seed(db);
    const marked = await spend("Wallet payment A");
    const own = await spend("Own transfer", { linkage: chosen });
    const regular = await spend("Wallet payment B", { categoryId: books.id, linkage: undefined });
    const paidBack = await spend("Shared meal", { categoryId: books.id, linkage: undefined });
    const payback = await spend("From a friend", { amountOut: null, amountIn: 4, linkage: { type: "reimbursement" } });
    await db.reimbursementLink.create({
      data: {
        userId: user.id,
        amount: 4,
        reimbursementTransactionId: payback.id,
        expenseTransactionId: paidBack.id,
      },
    });
    const service = new ReviewService(db);
    const suggest = (id: string, categoryId: string) => ({ transactionId: id, patch: { categoryId } });
    const review = await service.create(context, {
      title: "Marks",
      transactionIds: [marked, own, regular, paidBack, payback].map((t) => t.id),
      suggestions: [
        suggest(marked.id, food.id),
        suggest(own.id, food.id),
        suggest(regular.id, internal.id),
        suggest(paidBack.id, internal.id),
        suggest(payback.id, food.id),
      ],
    });
    const value = (id: string) => review.rows.find((r) => r.id === id)!.value;
    assert.equal(value(marked.id).linkage, null);
    assert.deepEqual(value(own.id).linkage, chosen);
    assert.equal(value(regular.id).linkage.type, "internal");
    assert.equal(value(regular.id).linkage.autoDetected, true);
    assert.equal(value(paidBack.id).linkage, null);
    assert.equal(value(payback.id).linkage.type, "reimbursement");

    await db.chatRun.update({ where: { id: run.id }, data: { status: "awaiting_confirmation" } });
    await new ChatService(db).submitMessage(user.id, conv.id, {
      text: "Done",
      idempotencyKey: "submit",
      reviewId: review.id,
      reviewVersion: 1,
    });
    const message = await db.chatMessage.findFirstOrThrow({
      where: { conversationId: conv.id, role: "user" },
    });
    const sent = (message.blocks as any[])[1].data.rows.find((r: any) => r.id === marked.id);
    assert.ok("linkage" in sent.value && sent.value.linkage === null);

    const next = await db.chatRun.findFirstOrThrow({ where: { idempotencyKey: "submit" } });
    const approvals = new ApprovalService(db, new TransactionActions(db));
    const before = await expense();
    const edit = (id: string, categoryId: string) => ({ id, patch: { categoryId } });
    // The model repeats the categories only; the proposal fills in the marks.
    const proposal = await approvals.proposeAction(
      { ...context, runId: next.id },
      {
        kind: "edit_transactions",
        edits: [edit(marked.id, food.id), edit(own.id, food.id), edit(regular.id, internal.id)],
      },
    );
    const args = (proposal.arguments as any).edits;
    assert.deepEqual(args[0].patch, { categoryId: food.id, linkage: null });
    assert.deepEqual(args[1].patch, { categoryId: food.id });
    assert.deepEqual(args[2].patch, { categoryId: internal.id, linkage: mark });
    const change = (proposal.preview as any).changes.find((c: any) => c.id === marked.id);
    assert.equal(change.before.linkage.type, "internal");
    assert.equal(change.after.linkage, null);
    assert.equal(change.after.category.name, "Snacks");
    // The two unmarked payments.
    assert.equal(before, "20.00");
    assert.equal((await approvals.decideAction(user.id, proposal.id, "approve")).status, "applied");
    // Marked is now spending; regular became internal; own stays internal.
    assert.equal(await expense(), "20.00");
    const stored = await db.transaction.findUniqueOrThrow({ where: { id: marked.id } });
    assert.equal(stored.linkage, null);
    assert.equal(stored.categoryId, food.id);
    assert.equal(await db.reimbursementLink.count(), 1);
    const listed = await new ReadTools(db).transactionPage(user.id, {
      dateFrom: "2026-05-01T00:00:00Z",
      dateTo: "2026-06-01T00:00:00Z",
    });
    const ids = listed.rows.map((r) => r.id);
    assert.ok(ids.includes(marked.id) && !ids.includes(own.id) && !ids.includes(regular.id));
  }));

test("a proposal clearing only the mark adds the payment to spending", () =>
  withChatDb(async (db) => {
    const { user, food, spend, context, expense } = await seed(db);
    const t = await spend("Wallet payment", { categoryId: food.id });
    const keep = await spend("Wallet payment 2");
    const approvals = new ApprovalService(db, new TransactionActions(db));
    assert.equal(await expense(), "0.00");
    const proposal = await approvals.proposeAction(context, {
      kind: "edit_transactions",
      edits: [
        { id: t.id, patch: { categoryId: food.id } },
        { id: keep.id, patch: { categoryId: food.id, linkage: { type: "internal" } } },
      ],
    });
    assert.equal((proposal.arguments as any).edits[1].patch.linkage.type, "internal");
    assert.equal((await approvals.decideAction(user.id, proposal.id, "approve")).status, "applied");
    assert.equal(await expense(), "10.00");
  }));

test("a link to a staged row keeps a saved expense from being marked internal", () =>
  withChatDb(async (db) => {
    const { user, internal, food, spend, context } = await seed(db);
    const expense = await spend("Group tickets", { categoryId: food.id, linkage: undefined });
    const { row } = await stagedRow(db, user.id, { description: "Payback", amountIn: 4, date: "2026-05-06" });
    await db.reimbursementLink.create({
      data: { userId: user.id, amount: 4, reimbursementDraftRowId: row.id, expenseTransactionId: expense.id },
    });
    const review = await new ReviewService(db).create(context, {
      title: "Linked",
      transactionIds: [expense.id],
      suggestions: [{ transactionId: expense.id, patch: { categoryId: internal.id } }],
    });
    assert.equal(review.rows[0].value.linkage, null);
    const prepared = await new TransactionActions(db).prepare(user.id, {
      kind: "edit_transactions",
      edits: [{ id: expense.id, patch: { categoryId: internal.id } }],
    });
    assert.deepEqual((prepared.preview as any).linkChanges, []);
  }));

async function stagedRow(db: PrismaClient, userId: string, payload: object, draftId?: string) {
  const draft = draftId
    ? { id: draftId }
    : await db.importDraft.create({
        data: {
          userId,
          mode: "main",
          sourceFilename: "sample.txt",
          sourceSha256: "sample",
          expiresAt: new Date(Date.now() + 60000),
        },
      });
  const row = await db.importDraftRow.create({
    data: {
      draftId: draft.id,
      rowIndex: await db.importDraftRow.count({ where: { draftId: draft.id } }),
      parsedPayload: payload as object,
      currentPayload: payload as object,
    },
  });
  return { draft, row };
}

test("suggested and direct category edits on staged rows follow the same rule", () =>
  withChatDb(async (db) => {
    const { user, internal, food, context } = await seed(db);
    const payload = (linkage: object | null, categoryId: string) => ({
      description: "Staged payment",
      date: "2026-05-05",
      amountOut: 6,
      currency: "SGD",
      categoryId,
      linkage,
    });
    const first = await stagedRow(db, user.id, payload(auto, internal.id));
    const add = async (linkage: object | null, categoryId: string) =>
      (await stagedRow(db, user.id, payload(linkage, categoryId), first.draft.id)).row;
    const own = await add(chosen, internal.id);
    const plain = await add(null, food.id);
    const direct = await add(auto, internal.id);
    const directOwn = await add(chosen, internal.id);
    const linked = await add(null, food.id);
    const payback = (
      await stagedRow(
        db,
        user.id,
        { ...payload({ type: "reimbursement" }, internal.id), amountOut: null, amountIn: 2 },
        first.draft.id,
      )
    ).row;
    await db.reimbursementLink.create({
      data: { userId: user.id, amount: 2, reimbursementDraftRowId: payback.id, expenseDraftRowId: linked.id },
    });
    const service = new ReviewService(db);
    const suggest = (id: string, categoryId: string) => ({ stagedRowId: id, patch: { categoryId } });
    const review = await service.create(context, {
      title: "Staged",
      stagedRowIds: [first.row.id, own.id, plain.id, linked.id, payback.id],
      suggestions: [
        suggest(first.row.id, food.id),
        suggest(own.id, food.id),
        suggest(plain.id, internal.id),
        suggest(linked.id, internal.id),
        suggest(payback.id, food.id),
      ],
    });
    const stored = async (id: string) =>
      (await db.importDraftRow.findUniqueOrThrow({ where: { id } })).currentPayload as any;
    assert.equal((await stored(first.row.id)).linkage, null);
    assert.equal((await stored(first.row.id)).categoryId, food.id);
    assert.deepEqual((await stored(own.id)).linkage, chosen);
    assert.equal((await stored(plain.id)).linkage.type, "internal");
    assert.equal((await stored(linked.id)).linkage, null);
    assert.equal((await stored(payback.id)).linkage.type, "reimbursement");
    assert.equal(await db.reimbursementLink.count(), 1);
    const shown = await service.get(user.id, review.id);
    assert.equal(shown.rows.find((r) => r.id === first.row.id)!.value.linkage, null);
    // The user changes their mind: their category clears even their own mark.
    const row = shown.rows.find((r) => r.id === own.id)!;
    await service.update(user.id, review.id, {
      rowId: own.id,
      version: row.version,
      patch: { categoryId: food.id },
    });
    assert.equal((await stored(own.id)).linkage, null);
    const result = await withDatabase(db, () =>
      new ImportTools(db).editRows(context, {
        draftId: first.draft.id,
        rows: [direct, directOwn].map((r) => ({ rowId: r.id, version: r.version, categoryId: food.id })),
      }),
    );
    assert.equal(result.failed.length, 0);
    assert.equal((await stored(direct.id)).linkage, null);
    assert.deepEqual((await stored(directOwn.id)).linkage, chosen);
  }));

test("a review opened before the rule is corrected on read, edit and submission", () =>
  withChatDb(async (db) => {
    const { user, conv, run, internal, food, books, spend, context } = await seed(db);
    const rows = [];
    for (const name of ["A", "B", "C", "D"]) {
      const t = await spend(`Wallet payment ${name}`);
      const original = {
        date: t.date.toISOString(),
        description: t.description,
        label: null,
        categoryId: internal.id,
        accountIdentifier: null,
        amountIn: null,
        amountOut: 10,
        balance: null,
        currency: "SGD",
        linkage: auto,
      };
      rows.push({
        id: t.id,
        version: 1,
        source: { transactionId: t.id },
        original,
        value: { ...original, categoryId: food.id } as any,
      });
    }
    // B: the user chose Internal. C: they edited the label and category.
    rows[1].value.linkage = chosen;
    rows[1].version = 2;
    Object.assign(rows[2].value, { label: "Mine", categoryId: books.id, linkage: null });
    rows[2].version = 3;
    const review = await db.chatTransactionReview.create({
      data: { ...context, title: "Older", instructions: "", version: 5, rows: rows as any },
    });
    const service = new ReviewService(db);
    const shown = await service.get(user.id, review.id);
    assert.equal(shown.version, 5);
    assert.deepEqual(shown.rows.map((r) => r.version), [1, 2, 3, 1]);
    assert.deepEqual(shown.rows.map((r) => r.value.linkage), [null, chosen, null, null]);
    assert.deepEqual(
      shown.rows.map((r) => r.value.categoryId),
      [food.id, internal.id, books.id, food.id],
    );
    assert.equal(shown.rows[2].value.label, "Mine");
    // A browser that loaded the old rows can still save with the version it has.
    const edited = await service.update(user.id, review.id, {
      rowId: rows[0].id,
      version: 1,
      patch: { label: "Edited" },
    });
    assert.equal(edited.rows[0].value.linkage, null);
    assert.equal(edited.rows[0].version, 2);
    // Choosing Internal now sticks, through another read and the submission.
    await service.update(user.id, review.id, {
      rowId: rows[3].id,
      version: 1,
      patch: { linkage: { type: "internal", autoDetected: false } },
    });
    const again = await service.get(user.id, review.id);
    assert.deepEqual(again.rows[3].value.linkage, chosen);
    assert.equal(again.rows[3].value.categoryId, internal.id);
    await db.chatRun.update({ where: { id: run.id }, data: { status: "awaiting_confirmation" } });
    await new ChatService(db).submitMessage(user.id, conv.id, {
      text: "Done",
      idempotencyKey: "submit",
      reviewId: review.id,
      reviewVersion: again.version,
    });
    const message = await db.chatMessage.findFirstOrThrow({
      where: { conversationId: conv.id, role: "user" },
    });
    const sent = (message.blocks as any[])[1].data.rows;
    assert.deepEqual(sent.map((r: any) => r.value.linkage), [null, chosen, null, chosen]);
    const closed = await service.get(user.id, review.id);
    assert.equal(closed.status, "submitted");
    assert.deepEqual(closed.rows.map((r) => r.value.linkage), [null, chosen, null, chosen]);
  }));

test("an untouched older review is corrected at submission", () =>
  withChatDb(async (db) => {
    const { user, conv, run, internal, food, spend, context } = await seed(db);
    const t = await spend("Wallet payment");
    const original = { date: "2026-05-04", description: "Wallet payment", categoryId: internal.id, linkage: auto, amountOut: 10 };
    const review = await db.chatTransactionReview.create({
      data: {
        ...context,
        title: "Older",
        instructions: "",
        rows: [{ id: t.id, version: 1, source: { transactionId: t.id }, original, value: { ...original, categoryId: food.id } }],
      },
    });
    await db.chatRun.update({ where: { id: run.id }, data: { status: "awaiting_confirmation" } });
    await new ChatService(db).submitMessage(user.id, conv.id, {
      text: "Done",
      idempotencyKey: "submit",
      reviewId: review.id,
      reviewVersion: 1,
    });
    const message = await db.chatMessage.findFirstOrThrow({ where: { conversationId: conv.id, role: "user" } });
    assert.equal((message.blocks as any[])[1].data.rows[0].value.linkage, null);
  }));
