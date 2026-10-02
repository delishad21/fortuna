import { test } from "node:test";
import assert from "node:assert/strict";
import { withChatDb } from "./test-harness";
import { RunRepository } from "./run.repository";
import { ChatService } from "./chat.service";
test("duplicate sends create one run and competing workers cannot both claim it", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "queue-owner" } });
    const service = new ChatService(db);
    await db.chatConnection.create({
      data: {
        userId: user.id,
        provider: "openrouter",
        selected: true,
        status: "connected",
      },
    });
    const conversation = await service.createConversation(user.id);
    const message = { text: "Hello", attachmentIds: [], idempotencyKey: "one" };
    const results = await Promise.all([
      service.submitMessage(user.id, conversation.id, message),
      service.submitMessage(user.id, conversation.id, message),
    ]);
    assert.equal(results[0].runId, results[1].runId);
    assert.equal(await db.chatMessage.count(), 1);
    const repo = new RunRepository(db);
    const claims = await Promise.all([repo.claimRun(), repo.claimRun()]);
    assert.equal(claims.filter(Boolean).length, 1);
    const run = claims.find(Boolean)!;
    await repo.appendEvent(run, { type: "text_delta", text: "hello" });
    await assert.rejects(
      repo.appendEvent(
        { ...run, leaseToken: "old-worker" },
        { type: "text_delta", text: "wrong" },
      ),
    );
    assert.equal((await repo.listEvents(user.id, run.id, 0)).events.length, 1);
    await assert.rejects(repo.listEvents("someone-else", run.id, 0));
    await repo.cancelRun(user.id, run.id);
    await assert.rejects(
      repo.appendEvent(run, { type: "text_delta", text: "too late" }),
    );
  }));
test("expired claims recover with a new fencing token", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "recovery-owner" } });
    const conv = await db.chatConversation.create({
      data: { userId: user.id },
    });
    await db.chatRun.create({
      data: {
        userId: user.id,
        conversationId: conv.id,
        idempotencyKey: "one",
        provider: "openrouter",
        model: "test",
      },
    });
    const repo = new RunRepository(db);
    const original = (await repo.claimRun())!;
    await db.chatRun.update({
      where: { id: original.id },
      data: { leaseUntil: new Date(0) },
    });
    const recovered = (await repo.claimRun())!;
    assert.equal(original.id, recovered.id);
    assert.notEqual(original.leaseToken, recovered.leaseToken);
    await assert.rejects(
      repo.appendEvent(original, { type: "text_delta", text: "stale" }),
    );
    await repo.appendEvent(recovered, {
      type: "text_delta",
      text: "recovered",
    });
    assert.equal(
      (await repo.listEvents(user.id, original.id, 0)).events.length,
      1,
    );
  }));

test("invalid tool arguments name the failing fields for the model", async () => {
  const { z } = await import("zod");
  const { invalidArguments } = await import("./runner");
  const parsed = z
    .object({ matchType: z.enum(["always", "description_contains"]) })
    .strict()
    .safeParse({ matchType: "contains", extra: 1 });
  assert.equal(parsed.success, false);
  const text = invalidArguments(parsed.error!);
  assert.match(
    text,
    /matchType: Invalid enum value\. Expected 'always' \| 'description_contains', received 'contains'/,
  );
  assert.match(text, /Unrecognized key/);
});

test("transaction lists that repeat a review or proposal are not shown again", async () => {
  const { dropRepeatedLists } = await import("./runner");
  const list = (ids: string[], total = ids.length) => ({
    type: "component",
    component: "transaction_list",
    total,
    rows: ids.map((id) => ({ id })),
  });
  const review = { type: "review", id: "r" };
  const covered = new Set(["t1", "t2", "t3"]);
  assert.deepEqual(dropRepeatedLists([review, list(["t1", "t2"])], covered), [
    review,
  ]);
  // A list with transactions beyond the review is kept.
  assert.equal(dropRepeatedLists([list(["t1", "t9"])], covered).length, 1);
  assert.equal(dropRepeatedLists([list(["t1"], 40)], covered).length, 1);
  assert.equal(dropRepeatedLists([list(["t1"])], new Set()).length, 1);
});
