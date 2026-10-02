import { test } from "node:test";
import assert from "node:assert/strict";
import { withChatDb } from "./test-harness";
import { RunRepository } from "./run.repository";
import { executeRun } from "./runner";
import { CHAT_LIMITS } from "./contracts";
import { ChatProvider, ProviderInput } from "./providers/provider";
import { createToolRegistry } from "./tools/registry";

test("a stalled run stops on inactivity and keeps what it already prepared", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "stalled-run" } });
    const conversation = await db.chatConversation.create({
      data: { userId: user.id },
    });
    await db.chatConnection.create({
      data: {
        userId: user.id,
        provider: "codex",
        selected: true,
        status: "connected",
      },
    });
    await db.chatMessage.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        role: "user",
        blocks: [{ type: "text", text: "Remember my partner's commute" }],
      },
    });
    await db.chatRun.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        idempotencyKey: "stall",
        provider: "codex",
        model: "test",
      },
    });
    const run = (await new RunRepository(db).claimRun())!;
    const limits = CHAT_LIMITS as { idleMilliseconds: number };
    const original = limits.idleMilliseconds;
    limits.idleMilliseconds = 300;
    const provider: ChatProvider = {
      testConnection: async () => ({
        connected: true,
        modelAvailable: true,
        needsReconnect: false,
      }),
      async *run(input: ProviderInput, signal: AbortSignal) {
        await input.executeTool(
          "remember",
          { content: "Townsville journeys are hers" },
          "c1",
        );
        yield {
          type: "text_delta",
          text: "Saved your note. Now building the parser",
        };
        // Then the model goes quiet.
        await new Promise((resolve) =>
          signal.addEventListener("abort", resolve),
        );
        signal.throwIfAborted();
      },
    };
    const started = Date.now();
    try {
      await executeRun(db, run, provider, new AbortController().signal);
    } finally {
      limits.idleMilliseconds = original;
    }
    assert.ok(Date.now() - started < 5000);
    const saved = await db.chatRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(saved.status, "failed");
    assert.match(saved.error || "", /10 minutes without progress/);
    const reply = await db.chatMessage.findFirstOrThrow({
      where: { conversationId: conversation.id, role: "assistant" },
    });
    const blocks = reply.blocks as any[];
    assert.deepEqual(
      blocks.map((b) => b.type),
      ["activity", "text", "memory", "text"],
    );
    assert.equal(blocks[1].text, "Saved your note. Now building the parser");
    assert.equal(blocks[2].content, "Townsville journeys are hers");
    assert.match(blocks[3].text, /kept below/);
  }));

test("parser_step explains how to get a workspace", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "parser-ws" } });
    const tools = createToolRegistry(db);
    const context = { userId: user.id, conversationId: "c", runId: "r" } as any;
    const result = await tools
      .execute(context, "parser_step", { operation: "inspect", fileId: "f1" })
      .catch((e) => e);
    assert.match(String(result.message), /retain_fixture proposal/);
  }));
