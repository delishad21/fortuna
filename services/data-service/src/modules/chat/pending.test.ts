import { test } from "node:test";
import assert from "node:assert/strict";
import { withChatDb } from "./test-harness";
import { ApprovalService } from "./approvals.service";
import { ChatService } from "./chat.service";
import { ReviewService } from "./reviews.service";
import { RunRepository } from "./run.repository";
import { TransactionActions } from "./tools/transactions";
import { pendingForModel, proposalTargets } from "./pending";

type Db = Parameters<Parameters<typeof withChatDb>[0]>[0];
/** A run that finished with one proposal and one review waiting for the user. */
async function waiting(db: Db, name: string) {
  const user = await db.user.create({ data: { username: name } });
  const chat = new ChatService(db);
  const conversation = await chat.createConversation(user.id);
  await db.chatConnection.create({
    data: {
      userId: user.id,
      provider: "openrouter",
      selected: true,
      status: "connected",
    },
  });
  const run = await db.chatRun.create({
    data: {
      userId: user.id,
      conversationId: conversation.id,
      idempotencyKey: "first",
      provider: "openrouter",
      model: "test",
      status: "running",
    },
  });
  const [lunch, taxi] = await Promise.all(
    ["Lunch", "Taxi"].map((description) =>
      db.transaction.create({
        data: {
          userId: user.id,
          date: new Date("2026-11-01"),
          description,
          amountOut: 12,
        },
      }),
    ),
  );
  const context = {
    userId: user.id,
    conversationId: conversation.id,
    runId: run.id,
  };
  const approvals = new ApprovalService(db, new TransactionActions(db));
  const proposal = await approvals.proposeAction(context, {
    kind: "edit_transactions",
    edits: [{ id: lunch.id, patch: { label: "Team lunch" } }],
  });
  const reviews = new ReviewService(db);
  const review = await reviews.create(context, {
    title: "Taxi check",
    transactionIds: [taxi.id],
  });
  await db.chatRun.update({
    where: { id: run.id },
    data: { status: "awaiting_confirmation" },
  });
  return {
    user,
    chat,
    conversation,
    run,
    lunch,
    taxi,
    context,
    approvals,
    reviews,
    proposal,
    review,
  };
}
const status = async (db: Db, id: string) =>
  (await db.chatActionProposal.findUniqueOrThrow({ where: { id } })).status;

test("a new message leaves proposals and reviews pending and a later confirm still applies", () =>
  withChatDb(async (db) => {
    const w = await waiting(db, "pending-message");
    await w.chat.submitMessage(w.user.id, w.conversation.id, {
      text: "Also, what did I spend on food?",
      idempotencyKey: "second",
    });
    assert.equal(await status(db, w.proposal.id), "pending");
    assert.equal((await w.reviews.get(w.user.id, w.review.id)).status, "pending");
    // The waiting run is done, so it no longer blocks; the new message is queued.
    assert.equal(
      (await db.chatRun.findUniqueOrThrow({ where: { id: w.run.id } })).status,
      "completed",
    );
    const second = await db.chatRun.findFirstOrThrow({
      where: { idempotencyKey: "second" },
    });
    assert.equal(second.status, "queued");
    // The next run is told what is still waiting.
    const told = await pendingForModel(
      db,
      w.user.id,
      w.conversation.id,
      second.id,
    );
    assert.deepEqual(
      told?.proposals.map((p) => p.proposalId),
      [w.proposal.id],
    );
    assert.deepEqual(
      told?.reviews.map((r) => r.reviewId),
      [w.review.id],
    );
    // Confirming afterwards applies the change and records the outcome for the agent.
    await db.chatRun.update({
      where: { id: second.id },
      data: { status: "completed" },
    });
    const outcome = await w.approvals.decideAction(
      w.user.id,
      w.proposal.id,
      "approve",
    );
    assert.equal(outcome.status, "applied");
    assert.equal(
      (await db.transaction.findUniqueOrThrow({ where: { id: w.lunch.id } }))
        .label,
      "Team lunch",
    );
    const replies = await db.chatMessage.findMany({
      where: { conversationId: w.conversation.id, role: "assistant" },
    });
    assert.ok(
      replies.some((m) => JSON.stringify(m.blocks).includes("Changes applied")),
    );
    const after = await pendingForModel(
      db,
      w.user.id,
      w.conversation.id,
      second.id,
    );
    assert.deepEqual(after?.proposals, []);
  }));

test("a stale proposal still asks for a fresh preview after a new message", () =>
  withChatDb(async (db) => {
    const w = await waiting(db, "pending-stale");
    await w.chat.submitMessage(w.user.id, w.conversation.id, {
      text: "Something else",
      idempotencyKey: "second",
    });
    await db.transaction.update({
      where: { id: w.lunch.id },
      data: { label: "Changed by hand" },
    });
    assert.equal(
      (await w.approvals.decideAction(w.user.id, w.proposal.id, "approve"))
        .status,
      "stale",
    );
  }));

test("stopping the run and an explicit reject still close them, each with its own reason", () =>
  withChatDb(async (db) => {
    const w = await waiting(db, "pending-close");
    const rejected = await w.approvals.decideAction(
      w.user.id,
      w.proposal.id,
      "reject",
    );
    assert.equal(rejected.status, "rejected");
    assert.equal(await status(db, w.proposal.id), "rejected");

    const s = await waiting(db, "pending-stop");
    await db.chatRun.update({
      where: { id: s.run.id },
      data: { status: "running" },
    });
    assert.deepEqual(await new RunRepository(db).cancelRun(s.user.id, s.run.id), {
      cancelled: true,
    });
    assert.equal(await status(db, s.proposal.id), "cancelled");
    assert.equal((await s.reviews.get(s.user.id, s.review.id)).status, "cancelled");
  }));

test("proposals expire after their lifetime and say so instead of rejected", () =>
  withChatDb(async (db) => {
    const w = await waiting(db, "pending-expiry");
    await db.chatActionProposal.update({
      where: { id: w.proposal.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const conversation = await w.chat.getConversation(
      w.user.id,
      w.conversation.id,
    );
    assert.equal(conversation?.runs[0].proposals[0].status, "expired");
    assert.equal(
      (await w.approvals.decideAction(w.user.id, w.proposal.id, "approve"))
        .status,
      "expired",
    );
    assert.equal(
      (await db.transaction.findUniqueOrThrow({ where: { id: w.lunch.id } }))
        .label,
      null,
    );
    // A fresh preview starts a new 24 hours; the old one still reads as expired.
    const fresh = await w.approvals.refreshAction(w.user.id, w.proposal.id);
    assert.equal(fresh.status, "pending");
    assert.equal(await status(db, w.proposal.id), "expired");
  }));

test("a newer proposal for the same rows replaces the older one; others stay pending", () =>
  withChatDb(async (db) => {
    const w = await waiting(db, "pending-replace");
    const other = await w.approvals.proposeAction(w.context, {
      kind: "edit_transactions",
      edits: [{ id: w.taxi.id, patch: { label: "Airport taxi" } }],
    });
    assert.equal(await status(db, w.proposal.id), "pending");
    const newer = await w.approvals.proposeAction(w.context, {
      kind: "edit_transactions",
      edits: [{ id: w.lunch.id, patch: { label: "Client lunch" } }],
    });
    assert.deepEqual(newer.replaced, [w.proposal.id]);
    assert.equal(await status(db, w.proposal.id), "superseded");
    assert.equal(await status(db, other.id), "pending");
    assert.deepEqual(
      proposalTargets({ kind: "discard_draft", draftIds: ["d1"] }),
      proposalTargets({ kind: "restage_draft", draftId: "d1" }),
    );
  }));
