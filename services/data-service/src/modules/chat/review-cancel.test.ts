import { test } from "node:test";
import assert from "node:assert/strict";
import { withChatDb } from "./test-harness";
import { ChatService } from "./chat.service";
import { RunRepository } from "./run.repository";
import { ReviewService, cancelledReviewNote } from "./reviews.service";
import { executeRun } from "./runner";
import { pendingForModel } from "./pending";
import { ChatProvider, ProviderInput } from "./providers/provider";

type Db = Parameters<Parameters<typeof withChatDb>[0]>[0];

async function setup(db: Db, name: string) {
  const user = await db.user.create({ data: { username: name } });
  await db.chatConnection.create({
    data: {
      userId: user.id,
      provider: "openrouter",
      selected: true,
      status: "connected",
    },
  });
  const chat = new ChatService(db);
  const conversation = await chat.createConversation(user.id);
  const transaction = await db.transaction.create({
    data: {
      userId: user.id,
      date: new Date("2026-10-03"),
      description: "Kopi",
      amountOut: 4.5,
    },
  });
  const run = await db.chatRun.create({
    data: {
      userId: user.id,
      conversationId: conversation.id,
      idempotencyKey: "review-run",
      provider: "openrouter",
      model: "test",
      status: "completed",
    },
  });
  const review = await db.chatTransactionReview.create({
    data: {
      userId: user.id,
      conversationId: conversation.id,
      runId: run.id,
      title: "Label October",
      instructions: "",
      rows: [
        {
          id: transaction.id,
          version: 1,
          source: { transactionId: transaction.id },
          original: { description: "Kopi", label: null },
          value: { description: "Kopi", label: "Food" },
        },
      ],
    },
  });
  return {
    user,
    chat,
    conversation,
    review,
    reviews: new ReviewService(db),
    repo: new RunRepository(db),
  };
}
const message = (key: string, extra: object = {}) => ({
  text: key,
  attachmentIds: [],
  idempotencyKey: key,
  ...extra,
});
const status = async (db: Db, id: string) =>
  (await db.chatTransactionReview.findUniqueOrThrow({ where: { id } }));

test("cancelling a pending review closes it as cancelled by the user and records it", () =>
  withChatDb(async (db) => {
    const { user, conversation, review, reviews } = await setup(db, "rc-pending");
    const other = await db.user.create({ data: { username: "rc-other" } });
    await assert.rejects(
      reviews.cancel(other.id, review.id, { version: 1 }),
      (e: any) => e.status === 404,
    );
    await assert.rejects(
      reviews.cancel(user.id, review.id, { version: 2 }),
      (e: any) => e.status === 409 && /changed on another device/.test(e.message),
    );
    assert.equal((await status(db, review.id)).status, "pending");
    const closed = await reviews.cancel(user.id, review.id, { version: 1 });
    assert.equal(closed.status, "cancelled");
    assert.ok(closed.decidedAt);
    // A second tap finds it already cancelled and changes nothing.
    await reviews.cancel(user.id, review.id, { version: 1 });
    const notes = await db.chatMessage.findMany({
      where: { conversationId: conversation.id },
    });
    assert.deepEqual(
      notes.map((m) => [m.role, (m.blocks as any[])[0].text]),
      [["assistant", cancelledReviewNote("Label October")]],
    );
    // Closed: no more edits, and it can't be sent.
    await assert.rejects(
      reviews.update(user.id, review.id, {
        rowId: (review.rows as any[])[0].id,
        version: 1,
        patch: { label: "Drinks" },
      }),
      (e: any) => e.status === 409,
    );
  }));

test("cancelling a queued review removes its queued message", () =>
  withChatDb(async (db) => {
    const { user, chat, conversation, review, reviews, repo } = await setup(
      db,
      "rc-queued",
    );
    await chat.submitMessage(user.id, conversation.id, message("busy"));
    await chat.submitMessage(
      user.id,
      conversation.id,
      message("rev", { reviewId: review.id, reviewVersion: 1 }),
    );
    await chat.submitMessage(user.id, conversation.id, message("after"));
    assert.equal((await status(db, review.id)).status, "queued");
    await reviews.cancel(user.id, review.id, { version: 1 });
    assert.equal((await status(db, review.id)).status, "cancelled");
    assert.deepEqual(
      (await db.chatQueuedMessage.findMany()).map((q) => q.idempotencyKey),
      ["after"],
    );
    // The reply finishes and the next message goes; the review is never sent.
    const running = (await repo.claimRun())!;
    await repo.finish(running, "completed", [{ type: "text", text: "done" }]);
    const next = await db.chatRun.findFirstOrThrow({ where: { status: "queued" } });
    assert.equal(next.idempotencyKey, "after");
    assert.equal((await status(db, review.id)).status, "cancelled");
  }));

test("a review that already started or was sent can't be cancelled", () =>
  withChatDb(async (db) => {
    const { user, chat, conversation, review, reviews, repo } = await setup(
      db,
      "rc-started",
    );
    await chat.submitMessage(user.id, conversation.id, message("busy"));
    await chat.submitMessage(
      user.id,
      conversation.id,
      message("rev", { reviewId: review.id, reviewVersion: 1 }),
    );
    const running = (await repo.claimRun())!;
    await repo.finish(running, "completed", [{ type: "text", text: "done" }]);
    // Its turn came: it is the reply that runs now.
    assert.equal((await status(db, review.id)).status, "submitted");
    await assert.rejects(
      reviews.cancel(user.id, review.id, { version: 1 }),
      (e: any) => e.status === 409 && /already sent/.test(e.message),
    );
    await db.chatTransactionReview.update({
      where: { id: review.id },
      data: { status: "superseded" },
    });
    await assert.rejects(
      reviews.cancel(user.id, review.id, { version: 1 }),
      (e: any) => e.status === 409 && /already closed/.test(e.message),
    );
  }));

test("the next reply reads that the user cancelled the review", () =>
  withChatDb(async (db) => {
    const { user, chat, conversation, review, reviews, repo } = await setup(
      db,
      "rc-context",
    );
    assert.equal(
      (await pendingForModel(db, user.id, conversation.id, "none"))?.reviews
        .length,
      1,
    );
    await reviews.cancel(user.id, review.id, { version: 1 });
    assert.equal(
      await pendingForModel(db, user.id, conversation.id, "none"),
      null,
    );
    await chat.submitMessage(user.id, conversation.id, message("anything-else"));
    const run = (await repo.claimRun())!;
    let seen: ProviderInput["messages"] = [];
    const provider: ChatProvider = {
      testConnection: async () => ({
        connected: true,
        modelAvailable: true,
        needsReconnect: false,
      }),
      async *run(input: ProviderInput) {
        seen = input.messages;
        yield { type: "text_delta", text: "Nothing else." };
        yield { type: "completed" };
      },
    };
    await executeRun(db, run, provider, new AbortController().signal);
    const note = JSON.stringify(cancelledReviewNote("Label October")).slice(1, -1);
    assert.ok(
      seen.some((m) => m.role === "assistant" && String(m.content).includes(note)),
    );
    assert.ok(!JSON.stringify(seen).includes("pending_approvals"));
  }));
