import { test } from "node:test";
import assert from "node:assert/strict";
import { withChatDb } from "./test-harness";
import { RunRepository } from "./run.repository";
import { executeRun } from "./runner";
import { ChatProvider, ProviderInput } from "./providers/provider";
test("worker persists text and tool results independently of any client connection", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "worker-owner" } });
    const conversation = await db.chatConversation.create({
      data: { userId: user.id },
    });
    await db.chatConnection.create({
      data: {
        userId: user.id,
        provider: "openrouter",
        selected: true,
        status: "connected",
      },
    });
    await db.chatMessage.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        role: "user",
        blocks: [{ type: "text", text: "List my accounts" }],
      },
    });
    await db.chatRun.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        idempotencyKey: "one",
        provider: "openrouter",
        model: "test",
      },
    });
    const repo = new RunRepository(db);
    const run = (await repo.claimRun())!;
    const provider: ChatProvider = {
      testConnection: async () => ({
        connected: true,
        modelAvailable: true,
        needsReconnect: false,
      }),
      async *run(input: ProviderInput) {
        const result = await input.executeTool("get_context", {}, "call-1");
        assert.ok(result.blocks.length);
        yield { type: "text_delta", text: "Here are your accounts." };
        yield { type: "completed" };
      },
    };
    await executeRun(db, run, provider, new AbortController().signal);
    assert.equal(
      (await db.chatRun.findUniqueOrThrow({ where: { id: run.id } })).status,
      "completed",
    );
    assert.equal(
      await db.chatToolInvocation.count({ where: { status: "completed" } }),
      1,
    );
    assert.ok(
      JSON.stringify(await db.chatMessage.findMany()).includes(
        "Here are your accounts.",
      ),
    );
  }));
