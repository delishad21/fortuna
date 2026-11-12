import { test } from "node:test";
import assert from "node:assert/strict";
import { withChatDb } from "./test-harness";
import { ChatService } from "./chat.service";
import { RunRepository, ClaimedRun } from "./run.repository";
import { ReviewService } from "./reviews.service";
import { ApprovalService } from "./approvals.service";
import { TransactionActions } from "./tools/transactions";
import { CHAT_LIMITS, SUBMITTED_REVIEW_TITLE } from "./contracts";
import { CHANGED_REVIEW_NOTE, QUEUE_FULL, dispatchQueueNow } from "./queue";

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
  return { user, chat, conversation, repo: new RunRepository(db) };
}
const message = (key: string, text = key, extra: object = {}) => ({
  text,
  attachmentIds: [],
  idempotencyKey: key,
  ...extra,
});
/** What the worker does: claim the run and finish it. */
async function finishNext(
  repo: RunRepository,
  status: "completed" | "failed" = "completed",
): Promise<ClaimedRun> {
  const run = (await repo.claimRun())!;
  assert.ok(run, "a run is waiting for the worker");
  await repo.finish(
    run,
    status,
    [{ type: "text", text: `reply to ${run.idempotencyKey}` }],
    status === "failed" ? "Provider failed" : undefined,
  );
  return run;
}
const texts = async (db: Db, conversationId: string) =>
  (
    await db.chatMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })
  ).map((m) => `${m.role}:${(m.blocks as any[])[0].text}`);

test("a message sent during a reply is queued and starts when the reply finishes", () =>
  withChatDb(async (db) => {
    const { user, chat, conversation, repo } = await setup(db, "q-basic");
    const first = await chat.submitMessage(user.id, conversation.id, message("one"));
    assert.ok("runId" in first && first.runId);
    await repo.claimRun();
    const second = await chat.submitMessage(
      user.id,
      conversation.id,
      message("two"),
    );
    assert.deepEqual(
      { queued: (second as any).queued, position: (second as any).position },
      { queued: true, position: 1 },
    );
    // Sending it again with the same key doesn't queue a copy.
    assert.equal(
      (await chat.submitMessage(user.id, conversation.id, message("two")) as any)
        .queuedId,
      (second as any).queuedId,
    );
    assert.equal(await db.chatQueuedMessage.count(), 1);
    // The queued message is not in the history the running reply reads.
    assert.deepEqual(await texts(db, conversation.id), ["user:one"]);
    const running = await db.chatRun.findFirstOrThrow({
      where: { status: "running" },
    });
    await repo.finish(
      { ...running, leaseToken: running.leaseToken! },
      "completed",
      [{ type: "text", text: "reply to one" }],
    );
    assert.equal(await db.chatQueuedMessage.count(), 0);
    const next = await db.chatRun.findFirstOrThrow({
      where: { status: "queued" },
    });
    assert.equal(next.idempotencyKey, "two");
    assert.deepEqual(await texts(db, conversation.id), [
      "user:one",
      "assistant:reply to one",
      "user:two",
    ]);
    // The same key now finds the run it became.
    assert.equal(
      (await chat.submitMessage(user.id, conversation.id, message("two")) as any)
        .runId,
      next.id,
    );
  }));

test("three queued messages run in order, each as its own turn", () =>
  withChatDb(async (db) => {
    const { user, chat, conversation, repo } = await setup(db, "q-order");
    await chat.submitMessage(user.id, conversation.id, message("m0"));
    const positions = [];
    for (const key of ["m1", "m2", "m3"])
      positions.push(
        ((await chat.submitMessage(user.id, conversation.id, message(key))) as any)
          .position,
      );
    assert.deepEqual(positions, [1, 2, 3]);
    for (let i = 0; i < 4; i++) await finishNext(repo);
    assert.deepEqual(await texts(db, conversation.id), [
      "user:m0",
      "assistant:reply to m0",
      "user:m1",
      "assistant:reply to m1",
      "user:m2",
      "assistant:reply to m2",
      "user:m3",
      "assistant:reply to m3",
    ]);
    assert.equal(await db.chatRun.count({ where: { status: "completed" } }), 4);
  }));

test("a failed reply doesn't drop the queue: the next message starts", () =>
  withChatDb(async (db) => {
    const { user, chat, conversation, repo } = await setup(db, "q-fail");
    await chat.submitMessage(user.id, conversation.id, message("a"));
    await chat.submitMessage(user.id, conversation.id, message("b"));
    await chat.submitMessage(user.id, conversation.id, message("c"));
    await finishNext(repo, "failed");
    assert.equal(
      (await db.chatRun.findFirstOrThrow({ where: { status: "queued" } }))
        .idempotencyKey,
      "b",
    );
    assert.equal(await db.chatQueuedMessage.count(), 1);
  }));

test("Stop keeps the queue and starts the next message, or clears it when asked", () =>
  withChatDb(async (db) => {
    const { user, chat, conversation, repo } = await setup(db, "q-stop");
    const first = (await chat.submitMessage(
      user.id,
      conversation.id,
      message("a"),
    )) as any;
    await repo.claimRun();
    await chat.submitMessage(user.id, conversation.id, message("b"));
    await chat.submitMessage(user.id, conversation.id, message("c"));
    assert.deepEqual(await repo.cancelRun(user.id, first.runId), {
      cancelled: true,
    });
    const next = await db.chatRun.findFirstOrThrow({
      where: { status: "queued" },
    });
    assert.equal(next.idempotencyKey, "b");
    assert.equal(await db.chatQueuedMessage.count(), 1);
    await repo.cancelRun(user.id, next.id, "clear");
    assert.equal(await db.chatQueuedMessage.count(), 0);
    assert.equal(
      await db.chatRun.count({ where: { status: { in: ["queued", "running"] } } }),
      0,
    );
  }));

test("a queued message can be edited or removed until it starts", () =>
  withChatDb(async (db) => {
    const { user, chat, conversation, repo } = await setup(db, "q-edit");
    await chat.submitMessage(user.id, conversation.id, message("a"));
    const b = (await chat.submitMessage(
      user.id,
      conversation.id,
      message("b"),
    )) as any;
    const c = (await chat.submitMessage(
      user.id,
      conversation.id,
      message("c"),
    )) as any;
    const queue = await chat.editQueued(user.id, conversation.id, b.queuedId, {
      text: "b, reworded",
    });
    assert.deepEqual(
      queue.map((q) => q.text),
      ["b, reworded", "c"],
    );
    await chat.removeQueued(user.id, conversation.id, c.queuedId);
    await assert.rejects(
      chat.editQueued(user.id, conversation.id, c.queuedId, { text: "x" }),
      (e: any) => e.status === 409,
    );
    await finishNext(repo);
    assert.deepEqual((await texts(db, conversation.id)).at(-1), "user:b, reworded");
    // Once started it can't be edited or removed any more.
    await assert.rejects(
      chat.removeQueued(user.id, conversation.id, b.queuedId),
      (e: any) => e.status === 409,
    );
    assert.equal(await db.chatRun.count(), 2);
  }));

test("at most ten messages wait per conversation; the per-user cap counts only runs", () =>
  withChatDb(async (db) => {
    const { user, chat, conversation, repo } = await setup(db, "q-limits");
    await chat.submitMessage(user.id, conversation.id, message("first"));
    for (let i = 0; i < CHAT_LIMITS.queuedPerConversation; i++)
      await chat.submitMessage(user.id, conversation.id, message(`q${i}`));
    await assert.rejects(
      chat.submitMessage(user.id, conversation.id, message("one-too-many")),
      (e: any) => e.status === 409 && e.message === QUEUE_FULL,
    );
    // Ten waiting messages don't use up the cap: other conversations still reply.
    const others = await Promise.all(
      Array.from({ length: CHAT_LIMITS.activeRunsPerUser }, () =>
        chat.createConversation(user.id),
      ),
    );
    const results = [];
    for (const [i, c] of others.entries())
      results.push(
        (await chat.submitMessage(user.id, c.id, message(`other${i}`))) as any,
      );
    assert.ok(results[0].runId && results[1].runId);
    // The fourth conversation is over the cap: its message waits instead of being refused.
    assert.equal(results[2].queued, true);
    assert.equal(
      await db.chatRun.count({
        where: { userId: user.id, status: { in: ["queued", "running"] } },
      }),
      CHAT_LIMITS.activeRunsPerUser,
    );
    // When a reply finishes somewhere, the oldest waiting conversation goes first.
    const done = await finishNext(repo);
    assert.equal(done.idempotencyKey, "first");
    const queuedKeys = (
      await db.chatRun.findMany({ where: { status: "queued" } })
    ).map((r) => r.idempotencyKey);
    assert.ok(queuedKeys.includes("q0"));
    assert.ok(!queuedKeys.includes("other2"));
    assert.equal(
      await db.chatRun.count({
        where: { userId: user.id, status: { in: ["queued", "running"] } },
      }),
      CHAT_LIMITS.activeRunsPerUser,
    );
  }));

test("two paths finishing at once start the queued message exactly once", () =>
  withChatDb(async (db) => {
    const { user, chat, conversation, repo } = await setup(db, "q-race");
    await chat.submitMessage(user.id, conversation.id, message("a"));
    const run = (await repo.claimRun())!;
    await chat.submitMessage(user.id, conversation.id, message("b"));
    await Promise.allSettled([
      repo.finish(run, "completed", [{ type: "text", text: "done" }]),
      repo.cancelRun(user.id, run.id),
      dispatchQueueNow(db, user.id),
      dispatchQueueNow(db, user.id),
    ]);
    assert.equal(await db.chatRun.count({ where: { idempotencyKey: "b" } }), 1);
    assert.equal(await db.chatQueuedMessage.count(), 0);
    assert.equal(
      (await texts(db, conversation.id)).filter((t) => t === "user:b").length,
      1,
    );
  }));

test("an attachment deleted while queued fails that message clearly; the next one goes", () =>
  withChatDb(async (db) => {
    const { user, chat, conversation, repo } = await setup(db, "q-files");
    const file = await db.statementFile.create({
      data: {
        userId: user.id,
        filename: "DBS Oct.pdf",
        contentType: "application/pdf",
        storagePath: "/tmp/none",
        sha256: "sha-queue",
        sizeBytes: 10,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const attachment = await db.chatAttachment.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        statementFileId: file.id,
      },
    });
    await chat.submitMessage(user.id, conversation.id, message("a"));
    const withFile = (await chat.submitMessage(
      user.id,
      conversation.id,
      message("b", "import this", { attachmentIds: [attachment.id] }),
    )) as any;
    await chat.submitMessage(user.id, conversation.id, message("c"));
    await db.statementFile.update({
      where: { id: file.id },
      data: { deletedAt: new Date() },
    });
    await finishNext(repo);
    const failed = await db.chatQueuedMessage.findUniqueOrThrow({
      where: { id: withFile.queuedId },
    });
    assert.equal(failed.status, "failed");
    assert.match(failed.error!, /DBS Oct\.pdf was deleted while this message waited/);
    assert.equal(
      (await db.chatRun.findFirstOrThrow({ where: { status: "queued" } }))
        .idempotencyKey,
      "c",
    );
    // Sending it without the file queues it again, at the end.
    await chat.editQueued(user.id, conversation.id, withFile.queuedId, {
      text: "import this",
      attachmentIds: [],
    });
    await finishNext(repo);
    assert.equal(
      (await db.chatRun.findFirstOrThrow({ where: { status: "queued" } }))
        .idempotencyKey,
      "b",
    );
    // A file already gone is refused when queueing.
    await assert.rejects(
      chat.submitMessage(
        user.id,
        conversation.id,
        message("d", "again", { attachmentIds: [attachment.id] }),
      ),
      (e: any) => e.status === 400,
    );
  }));

async function stagedReview(db: Db, userId: string, conversationId: string) {
  const payload = (description: string) => ({
    date: "2026-10-03",
    description,
    amountOut: 4.5,
    currency: "SGD",
  });
  const draft = await db.importDraft.create({
    data: {
      userId,
      mode: "main",
      parserId: "dbs",
      sourceFilename: "DBS Oct.pdf",
      sourceSha256: "sha-review-" + conversationId,
      status: "review",
      expiresAt: new Date(Date.now() + 86400000),
      rows: {
        create: ["Kopi", "Bus"].map((d, i) => ({
          rowIndex: i,
          parsedPayload: payload(d),
          currentPayload: payload(d),
          reviewStatus: "unresolved",
        })),
      },
    },
    include: { rows: { orderBy: { rowIndex: "asc" } } },
  });
  const run = await db.chatRun.create({
    data: {
      userId,
      conversationId,
      idempotencyKey: "review-run",
      provider: "openrouter",
      model: "test",
      status: "awaiting_confirmation",
    },
  });
  const review = await db.chatTransactionReview.create({
    data: {
      userId,
      conversationId,
      runId: run.id,
      title: "Check October",
      instructions: "",
      rows: draft.rows.map((r) => ({
        id: r.id,
        version: r.version,
        source: { draftId: draft.id, rowId: r.id },
        original: r.currentPayload,
        value: r.currentPayload,
      })),
    },
  });
  return { draft, review };
}

test("a review sent back during a reply is locked while queued, then sent with its rows", () =>
  withChatDb(async (db) => {
    const { user, chat, conversation, repo } = await setup(db, "q-review");
    const { review } = await stagedReview(db, user.id, conversation.id);
    await chat.submitMessage(user.id, conversation.id, message("busy"));
    await assert.rejects(
      chat.submitMessage(
        user.id,
        conversation.id,
        message("rev", "Here is my review", {
          reviewId: review.id,
          reviewVersion: review.version + 1,
        }),
      ),
      (e: any) => e.status === 409 && /changed on another device/.test(e.message),
    );
    const queued = (await chat.submitMessage(
      user.id,
      conversation.id,
      message("rev", "Here is my review", {
        reviewId: review.id,
        reviewVersion: review.version,
      }),
    )) as any;
    assert.equal(queued.queued, true);
    assert.equal(
      (await db.chatTransactionReview.findUniqueOrThrow({ where: { id: review.id } }))
        .status,
      "queued",
    );
    // Locked: no edits, and it can't be sent a second time.
    await assert.rejects(
      new ReviewService(db).update(user.id, review.id, {
        rowId: (review.rows as any[])[0].id,
        version: 1,
        patch: { label: "Coffee" },
      }),
      (e: any) => e.status === 409,
    );
    await assert.rejects(
      chat.submitMessage(
        user.id,
        conversation.id,
        message("rev2", "again", {
          reviewId: review.id,
          reviewVersion: review.version,
        }),
      ),
      (e: any) => e.status === 409,
    );
    await finishNext(repo);
    assert.equal(
      (await db.chatTransactionReview.findUniqueOrThrow({ where: { id: review.id } }))
        .status,
      "submitted",
    );
    const sent = await db.chatMessage.findFirstOrThrow({
      where: { conversationId: conversation.id, role: "user" },
      orderBy: { createdAt: "desc" },
    });
    const data = (sent.blocks as any[]).find(
      (b) => b.title === SUBMITTED_REVIEW_TITLE,
    ).data;
    assert.equal(data.rows.length, 2);
    assert.equal(data.changedSinceQueued, undefined);
  }));

test("a queued review whose rows changed still starts, and says which edits may not apply", () =>
  withChatDb(async (db) => {
    const { user, chat, conversation, repo } = await setup(db, "q-review-changed");
    const { review, draft } = await stagedReview(db, user.id, conversation.id);
    await chat.submitMessage(user.id, conversation.id, message("busy"));
    await chat.submitMessage(
      user.id,
      conversation.id,
      message("rev", "Here is my review", {
        reviewId: review.id,
        reviewVersion: review.version,
      }),
    );
    // While it waits, the running reply edits one row and the other leaves the draft.
    await db.importDraftRow.update({
      where: { id: draft.rows[0].id },
      data: {
        version: { increment: 1 },
        currentPayload: { ...(draft.rows[0].currentPayload as any), label: "Coffee" },
      },
    });
    await db.importDraftRow.delete({ where: { id: draft.rows[1].id } });
    await finishNext(repo);
    const run = await db.chatRun.findFirstOrThrow({
      where: { idempotencyKey: "rev" },
    });
    assert.equal(run.status, "queued");
    const sent = await db.chatMessage.findFirstOrThrow({
      where: { conversationId: conversation.id, role: "user" },
      orderBy: { createdAt: "desc" },
    });
    const data = (sent.blocks as any[]).find(
      (b) => b.title === SUBMITTED_REVIEW_TITLE,
    ).data;
    assert.deepEqual(
      data.changedSinceQueued.map((c: any) => [c.description, c.reason]),
      [
        ["Kopi", "changed after you queued it"],
        ["Bus", "no longer staged"],
      ],
    );
    assert.equal(data.note, CHANGED_REVIEW_NOTE);
  }));

test("removing or clearing a queued review gives it back to the user to edit", () =>
  withChatDb(async (db) => {
    const { user, chat, conversation, repo } = await setup(db, "q-review-remove");
    const { review } = await stagedReview(db, user.id, conversation.id);
    const busy = (await chat.submitMessage(
      user.id,
      conversation.id,
      message("busy"),
    )) as any;
    await chat.submitMessage(
      user.id,
      conversation.id,
      message("rev", "Here is my review", {
        reviewId: review.id,
        reviewVersion: review.version,
      }),
    );
    await repo.cancelRun(user.id, busy.runId, "clear");
    assert.equal(
      (await db.chatTransactionReview.findUniqueOrThrow({ where: { id: review.id } }))
        .status,
      "pending",
    );
  }));

test("the reply after an approval waits in the queue behind the current reply", () =>
  withChatDb(async (db) => {
    const { user, chat, conversation, repo } = await setup(db, "q-continue");
    const source = await db.chatRun.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        idempotencyKey: "proposer",
        provider: "openrouter",
        model: "test",
        status: "awaiting_confirmation",
      },
    });
    const target = await db.transaction.create({
      data: {
        userId: user.id,
        date: new Date("2026-10-01"),
        description: "Lunch",
        amountOut: 20,
      },
    });
    const approvals = new ApprovalService(db, new TransactionActions(db));
    const proposal = await approvals.proposeAction(
      { userId: user.id, conversationId: conversation.id, runId: source.id },
      {
        kind: "edit_transactions",
        edits: [{ id: target.id, patch: { label: "Team lunch" } }],
      },
    );
    // A new message is replying when the user approves.
    await chat.submitMessage(user.id, conversation.id, message("question"));
    await repo.claimRun();
    assert.equal(
      (await approvals.decideAction(user.id, proposal.id, "approve")).status,
      "applied",
    );
    const waiting = await db.chatQueuedMessage.findFirstOrThrow({});
    assert.equal(waiting.kind, "continuation");
    // Deciding again doesn't queue it twice.
    await approvals.decideAction(user.id, proposal.id, "approve");
    assert.equal(await db.chatQueuedMessage.count(), 1);
    const running = await db.chatRun.findFirstOrThrow({
      where: { status: "running" },
    });
    await repo.finish(
      { ...running, leaseToken: running.leaseToken! },
      "completed",
      [{ type: "text", text: "answer" }],
    );
    assert.equal(
      (await db.chatRun.findFirstOrThrow({ where: { status: "queued" } }))
        .idempotencyKey,
      "continuation-" + source.id,
    );
  }));
