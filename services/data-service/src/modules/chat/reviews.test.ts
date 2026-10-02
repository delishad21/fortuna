import { test } from "node:test";
import assert from "node:assert/strict";
import { withChatDb } from "./test-harness";
import { ReviewService } from "./reviews.service";
import { ChatService } from "./chat.service";
test("review edits are owned, versioned, shared and superseded without changing the ledger", () =>
  withChatDb(async (db) => {
    const a = await db.user.create({ data: { username: "review-a" } });
    const b = await db.user.create({ data: { username: "review-b" } });
    const chat = new ChatService(db);
    const c = await chat.createConversation(a.id);
    await db.chatConnection.create({
      data: {
        userId: a.id,
        provider: "codex",
        selected: true,
        status: "connected",
      },
    });
    const run = await db.chatRun.create({
      data: {
        userId: a.id,
        conversationId: c.id,
        idempotencyKey: "initial",
        provider: "codex",
        model: "test",
        status: "running",
      },
    });
    const transaction = await db.transaction.create({
      data: {
        userId: a.id,
        date: new Date(),
        description: "Original",
        amountOut: 12,
      },
    });
    const service = new ReviewService(db);
    const context = { userId: a.id, conversationId: c.id, runId: run.id };
    await assert.rejects(
      service.create(
        { ...context, userId: b.id },
        { transactionIds: [transaction.id], title: "Review" },
      ),
    );
    const review = await service.create(context, {
      transactionIds: [transaction.id],
      title: "Review",
    });
    await assert.rejects(service.get(b.id, review.id));
    await service.update(a.id, review.id, {
      rowId: transaction.id,
      version: 1,
      patch: { label: "Lunch" },
    });
    assert.equal(
      (await service.get(a.id, review.id)).rows[0].value.label,
      "Lunch",
    );
    await assert.rejects(
      service.update(a.id, review.id, {
        rowId: transaction.id,
        version: 1,
        patch: { label: "Stale" },
      }),
      /changed/,
    );
    assert.equal(
      (
        await db.transaction.findUniqueOrThrow({
          where: { id: transaction.id },
        })
      ).label,
      null,
    );
    const proposal = await db.chatActionProposal.create({
      data: {
        ...context,
        kind: "edit_transactions",
        arguments: {},
        preview: {},
        stateHash: "test",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await db.chatRun.update({
      where: { id: run.id },
      data: { status: "awaiting_confirmation" },
    });
    await chat.submitMessage(a.id, c.id, {
      text: "Different task",
      idempotencyKey: "next",
    });
    assert.equal((await service.get(a.id, review.id)).status, "superseded");
    assert.equal(
      (
        await db.chatActionProposal.findUniqueOrThrow({
          where: { id: proposal.id },
        })
      ).status,
      "rejected",
    );
    await assert.rejects(
      service.update(a.id, review.id, {
        rowId: transaction.id,
        version: 2,
        patch: { label: "Late" },
      }),
      /closed/,
    );
    await assert.rejects(
      chat.submitMessage(a.id, c.id, {
        text: "Review",
        idempotencyKey: "late",
        reviewId: review.id,
      }),
      /closed/,
    );
  }));
test("submitting a review uses the saved version, queues once, and preserves structured sources", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "review-submit" } });
    const chat = new ChatService(db),
      service = new ReviewService(db);
    const conv = await chat.createConversation(user.id);
    await db.chatConnection.create({
      data: {
        userId: user.id,
        provider: "codex",
        selected: true,
        status: "connected",
      },
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
    const transaction = await db.transaction.create({
      data: {
        userId: user.id,
        date: new Date(),
        description: "Review me",
        amountOut: 15,
      },
    });
    const review = await service.create(
      { userId: user.id, conversationId: conv.id, runId: run.id },
      { title: "Review", transactionIds: [transaction.id] },
    );
    await service.update(user.id, review.id, {
      rowId: transaction.id,
      version: 1,
      patch: { label: "Edited" },
    });
    await db.chatRun.update({
      where: { id: run.id },
      data: { status: "awaiting_confirmation" },
    });
    const message = {
      text: "My review",
      idempotencyKey: "submit",
      reviewId: review.id,
      reviewVersion: 2,
    };
    await assert.rejects(
      chat.submitMessage(user.id, conv.id, { ...message, reviewVersion: 1 }),
      /changed/,
    );
    assert.equal((await service.get(user.id, review.id)).status, "pending");
    const result = await chat.submitMessage(user.id, conv.id, message);
    assert.deepEqual(
      await chat.submitMessage(user.id, conv.id, message),
      result,
    );
    const saved = await db.chatMessage.findFirstOrThrow({
      where: { conversationId: conv.id, role: "user" },
    });
    const blocks = saved.blocks as any[];
    assert.equal(blocks[1].data.rows[0].value.label, "Edited");
    assert.equal(blocks[1].data.rows[0].source.transactionId, transaction.id);
    assert.equal(await db.chatRun.count({ where: { status: "queued" } }), 1);
    assert.equal((await service.get(user.id, review.id)).status, "submitted");
    assert.equal(
      (
        await db.transaction.findUniqueOrThrow({
          where: { id: transaction.id },
        })
      ).label,
      null,
    );
  }));

test("staged rows sync with their draft and concurrent devices cannot overwrite each other", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "review-staged" } }),
      other = await db.user.create({
        data: { username: "review-staged-other" },
      });
    const conv = await db.chatConversation.create({
      data: { userId: user.id },
    });
    const run = await db.chatRun.create({
      data: {
        userId: user.id,
        conversationId: conv.id,
        idempotencyKey: "review",
        provider: "codex",
        model: "test",
        status: "running",
      },
    });
    const draft = await db.importDraft.create({
      data: {
        userId: user.id,
        mode: "bank",
        sourceFilename: "test.csv",
        sourceSha256: "test",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const payload = {
      description: "Staged lunch",
      date: "2026-09-01",
      amountOut: 10,
    };
    const row = await db.importDraftRow.create({
      data: {
        draftId: draft.id,
        rowIndex: 0,
        parsedPayload: payload,
        currentPayload: payload,
      },
    });
    const service = new ReviewService(db),
      context = { userId: user.id, conversationId: conv.id, runId: run.id };
    const review = await service.create(context, {
      title: "Staged review",
      stagedRowIds: [row.id],
    });
    const results = await Promise.allSettled(
      ["Web", "Phone"].map((label) =>
        service.update(user.id, review.id, {
          rowId: row.id,
          version: 1,
          patch: { label },
        }),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    await assert.rejects(
      service.update(other.id, review.id, {
        rowId: row.id,
        version: 2,
        patch: { label: "Intruder" },
      }),
    );
    // The winning edit lands in the draft, the source shared with the staged import page.
    const saved = (
      await db.importDraftRow.findUniqueOrThrow({ where: { id: row.id } })
    ).currentPayload as any;
    assert.ok(["Web", "Phone"].includes(saved.label));
    assert.equal(saved.description, payload.description);
    assert.equal(
      (await service.get(user.id, review.id)).rows[0].source.draftId,
      draft.id,
    );
  }));

test("reviews arrive pre-filled with owned suggestions and keep the original", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "review-suggest" } });
    const other = await db.user.create({ data: { username: "review-other" } });
    const c = await new ChatService(db).createConversation(user.id);
    const run = await db.chatRun.create({
      data: {
        userId: user.id,
        conversationId: c.id,
        idempotencyKey: "suggest",
        provider: "codex",
        model: "test",
        status: "running",
      },
    });
    const internal = await db.category.create({
      data: { userId: user.id, name: "Internal", color: "#999999" },
    });
    const foreign = await db.category.create({
      data: { userId: other.id, name: "Theirs", color: "#000000" },
    });
    const [a, b] = await Promise.all(
      ["BUS/MRT 1", "BUS/MRT 2"].map((description) =>
        db.transaction.create({
          data: {
            userId: user.id,
            date: new Date("2026-08-24"),
            description,
            amountOut: 2,
          },
        }),
      ),
    );
    const service = new ReviewService(db);
    const context = { userId: user.id, conversationId: c.id, runId: run.id };
    const patch = {
      categoryId: internal.id,
      linkage: { type: "internal" as const },
    };
    const review = await service.create(context, {
      title: "BUS/MRT on card 4591",
      transactionIds: [a.id, b.id],
      suggestions: [
        { transactionId: a.id, patch },
        { transactionId: b.id, patch },
      ],
    });
    assert.equal(review.instructions, "");
    for (const row of review.rows) {
      assert.equal(row.original.categoryId, null);
      assert.equal(row.value.categoryId, internal.id);
      assert.deepEqual(row.value.linkage, { type: "internal" });
      assert.equal(row.value.description, row.original.description);
    }
    await assert.rejects(
      service.create(context, {
        title: "Foreign category",
        transactionIds: [a.id],
        suggestions: [
          { transactionId: a.id, patch: { categoryId: foreign.id } },
        ],
      }),
      /category or account was not found/,
    );
    await assert.rejects(
      service.create(context, {
        title: "Outside the review",
        transactionIds: [a.id],
        suggestions: [{ transactionId: b.id, patch: { label: "x" } }],
      }),
      /must target transactions in this review/,
    );
    await assert.rejects(
      service.create(context, {
        title: "Wordy",
        instructions: "x".repeat(161),
        transactionIds: [a.id],
      }),
    );
  }));
