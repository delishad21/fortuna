import { test } from "node:test";
import assert from "node:assert/strict";
import { withChatDb } from "./test-harness";
import { withDatabase } from "../../lib/database-context";
import { ChatService } from "./chat.service";
import { RunRepository } from "./run.repository";
import { ApprovalService } from "./approvals.service";
import { MemoryService, MEMORY_LIMIT } from "./memories.service";
import { TransactionActions } from "./tools/transactions";
import { createToolRegistry } from "./tools/registry";

type Db = Parameters<Parameters<typeof withChatDb>[0]>[0];

async function connectedUser(db: Db, name: string) {
  const user = await db.user.create({ data: { username: name } });
  await db.chatConnection.create({
    data: {
      userId: user.id,
      provider: "openrouter",
      selected: true,
      status: "connected",
    },
  });
  return user;
}
const message = (key: string) => ({
  text: "How much did I spend?",
  attachmentIds: [],
  idempotencyKey: key,
});

test("two conversations of one user both get runs; a second message in the same one waits", () =>
  withChatDb(async (db) => {
    const user = await connectedUser(db, "two-chats");
    const chat = new ChatService(db);
    const a = await chat.createConversation(user.id);
    const b = await chat.createConversation(user.id);
    const [first, second] = (await Promise.all([
      chat.submitMessage(user.id, a.id, message("a1")),
      chat.submitMessage(user.id, b.id, message("b1")),
    ])) as Array<{ runId: string }>;
    assert.notEqual(first.runId, second.runId);
    assert.equal(await db.chatRun.count({ where: { status: "queued" } }), 2);
    const waiting = (await chat.submitMessage(user.id, a.id, message("a2"))) as any;
    assert.equal(waiting.queued, true);
    assert.equal(await db.chatRun.count({ where: { conversationId: a.id } }), 1);
    const repo = new RunRepository(db);
    const claimed = (await repo.claimRun())!;
    // The other run waits behind it, and its events say so.
    const behind = claimed.id === first.runId ? second.runId : first.runId;
    const events = await repo.listEvents(user.id, behind, 0);
    assert.equal(events.status, "queued");
    assert.equal(events.queued, true);
    assert.equal((await repo.listEvents(user.id, claimed.id, 0)).queued, false);
  }));

test("concurrent update_staged_rows on the same row: one saves, the other reports a version failure", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const user = await db.user.create({ data: { username: "row-race" } });
      const contexts = await Promise.all(
        ["one", "two"].map(async (key) => {
          const conversation = await db.chatConversation.create({
            data: { userId: user.id },
          });
          const run = await db.chatRun.create({
            data: {
              userId: user.id,
              conversationId: conversation.id,
              idempotencyKey: key,
              provider: "openrouter",
              model: "test",
              status: "running",
            },
          });
          return {
            userId: user.id,
            conversationId: conversation.id,
            runId: run.id,
          };
        }),
      );
      const payload = {
        date: "2026-10-03",
        description: "BUS/MRT 123",
        amountOut: 12.09,
        currency: "SGD",
        accountIdentifier: "UOB 1234",
        metadata: { note: "kept" },
      };
      const draft = await db.importDraft.create({
        data: {
          userId: user.id,
          mode: "main",
          parserId: "uob",
          sourceFilename: "UOB Oct.pdf",
          sourceSha256: "sha-row-race",
          status: "review",
          expiresAt: new Date(Date.now() + 86400000),
          rows: {
            create: [
              {
                rowIndex: 0,
                parsedPayload: payload,
                currentPayload: payload,
                reviewStatus: "unresolved",
              },
            ],
          },
        },
        include: { rows: true },
      });
      const row = draft.rows[0];
      const tools = createToolRegistry(db);
      const results = await Promise.all(
        contexts.map(
          async (context, i) =>
            (
              await tools.execute(context, "update_staged_rows", {
                draftId: draft.id,
                rows: [
                  { rowId: row.id, version: row.version, label: `Label ${i}` },
                ],
              })
            ).model as any,
        ),
      );
      const saved = results.filter((r) => r.updated.length === 1);
      const failed = results.filter((r) => r.failed.length === 1);
      assert.equal(saved.length, 1);
      assert.equal(failed.length, 1);
      assert.match(failed[0].failed[0].error, /stale.*Read it again/);
      const after = await db.importDraftRow.findUniqueOrThrow({
        where: { id: row.id },
      });
      assert.equal(after.version, row.version + 1);
      const label = (after.currentPayload as any).label;
      assert.equal(label, results.indexOf(saved[0]) === 0 ? "Label 0" : "Label 1");
      assert.equal((after.currentPayload as any).metadata.note, "kept");
    }),
  ));

test("an approval still queues its continuation while another conversation is replying", () =>
  withChatDb(async (db) => {
    const user = await connectedUser(db, "continue");
    const [mine, busy] = await Promise.all(
      [0, 1].map(() => db.chatConversation.create({ data: { userId: user.id } })),
    );
    const run = await db.chatRun.create({
      data: {
        userId: user.id,
        conversationId: mine.id,
        idempotencyKey: "one",
        provider: "openrouter",
        model: "test",
        status: "awaiting_confirmation",
      },
    });
    await db.chatRun.create({
      data: {
        userId: user.id,
        conversationId: busy.id,
        idempotencyKey: "other",
        provider: "openrouter",
        model: "test",
        status: "running",
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
    const service = new ApprovalService(db, new TransactionActions(db));
    const proposal = await service.proposeAction(
      { userId: user.id, conversationId: mine.id, runId: run.id },
      {
        kind: "edit_transactions",
        edits: [{ id: target.id, patch: { label: "Team lunch" } }],
      },
    );
    assert.equal(
      (await service.decideAction(user.id, proposal.id, "approve")).status,
      "applied",
    );
    assert.equal(
      await db.chatRun.count({
        where: { conversationId: mine.id, status: "queued" },
      }),
      1,
    );
  }));

test("notes saved from conversations at the same time never pass the limit", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "notes" } });
    await db.chatMemory.createMany({
      data: Array.from({ length: MEMORY_LIMIT - 1 }, (_, i) => ({
        userId: user.id,
        content: `Note ${i}`,
      })),
    });
    const memories = new MemoryService(db);
    const results = await Promise.allSettled([
      memories.save(user.id, { content: "From chat A" }),
      memories.save(user.id, { content: "From chat B" }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      await db.chatMemory.count({ where: { userId: user.id } }),
      MEMORY_LIMIT,
    );
  }));
