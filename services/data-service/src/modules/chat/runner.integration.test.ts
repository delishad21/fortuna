import { test } from "node:test";
import assert from "node:assert/strict";
import { withChatDb } from "./test-harness";
import { RunRepository } from "./run.repository";
import { executeRun } from "./runner";
import { ChatProvider, ProviderInput } from "./providers/provider";
import { CHAT_LIMITS, toolResultForModel } from "./contracts";
import { createToolRegistry } from "./tools/registry";
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
        assert.ok(result.model);
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
test("calls past the tool budget are refused, recorded and counted in the reply", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "budget-owner" } });
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
        blocks: [{ type: "text", text: "Look at everything" }],
      },
    });
    await db.chatRun.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        idempotencyKey: "budget",
        provider: "openrouter",
        model: "test",
      },
    });
    const run = (await new RunRepository(db).claimRun())!;
    const reads =
      CHAT_LIMITS.toolCalls - CHAT_LIMITS.toolCallsReservedForWrites;
    const seen: string[] = [];
    const provider: ChatProvider = {
      testConnection: async () => ({
        connected: true,
        modelAvailable: true,
        needsReconnect: false,
      }),
      async *run(input: ProviderInput) {
        for (let i = 0; i <= reads; i++)
          seen.push(
            toolResultForModel(
              await input.executeTool("get_context", {}, `read-${i}`),
            ),
          );
        seen.push(
          toolResultForModel(
            await input.executeTool(
              "remember",
              { content: "Budget test note" },
              "write-1",
            ),
          ),
        );
        yield { type: "text_delta", text: "Done." };
        yield { type: "completed" };
      },
    };
    await executeRun(db, run, provider, new AbortController().signal);
    assert.match(seen[0], /Tool budget: 39 of 40 calls left/);
    assert.match(seen[reads], /Tool budget used up for read-only tools/);
    // The refused read did not use the budget, so the write still runs.
    assert.match(seen[reads + 1], /Tool budget: 3 of 40 calls left/);
    const refused = await db.chatToolInvocation.findMany({
      where: { runId: run.id, status: "refused" },
    });
    assert.deepEqual(
      refused.map((r) => r.callId),
      [`read-${reads}`],
    );
    const reply = await db.chatMessage.findFirstOrThrow({
      where: { conversationId: conversation.id, role: "assistant" },
    });
    const activity = (reply.blocks as any[]).find((b) => b.type === "activity");
    assert.equal(activity.steps.length, reads + 2);
    assert.equal(activity.steps.filter((s: any) => !s.ok).length, 1);
  }));
test("a run that keeps calling tools after its budget is used up is stopped", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "budget-loop" } });
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
    await db.chatRun.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        idempotencyKey: "loop",
        provider: "codex",
        model: "test",
      },
    });
    const run = (await new RunRepository(db).claimRun())!;
    const provider: ChatProvider = {
      testConnection: async () => ({
        connected: true,
        modelAvailable: true,
        needsReconnect: false,
      }),
      async *run(input: ProviderInput) {
        // Like Codex, swallow tool errors and keep calling.
        for (let i = 0; i < 100; i++)
          await input.executeTool("get_context", {}, `c${i}`).catch(() => {});
        yield { type: "completed" };
      },
    };
    await executeRun(db, run, provider, new AbortController().signal);
    const saved = await db.chatRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(saved.status, "failed");
    assert.match(saved.error || "", /kept calling tools/);
    const reads =
      CHAT_LIMITS.toolCalls - CHAT_LIMITS.toolCallsReservedForWrites;
    assert.equal(
      await db.chatToolInvocation.count({ where: { runId: run.id } }),
      reads + CHAT_LIMITS.refusedToolCalls + 1,
    );
  }));
test("a tool that throws unexpectedly is recorded as failed and the run carries on", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "failing-tool" } });
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
        blocks: [{ type: "text", text: "Test my parser" }],
      },
    });
    await db.chatRun.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        idempotencyKey: "failing",
        provider: "openrouter",
        model: "test",
      },
    });
    const run = (await new RunRepository(db).claimRun())!;
    const real = createToolRegistry(db);
    const tools = {
      ...real,
      execute: async (context: any, name: string, args: unknown) => {
        if (name === "parser_step")
          throw new Error("connect ECONNREFUSED 172.23.0.5:4000");
        return real.execute(context, name, args);
      },
    };
    const seen: string[] = [];
    const provider: ChatProvider = {
      testConnection: async () => ({
        connected: true,
        modelAvailable: true,
        needsReconnect: false,
      }),
      async *run(input: ProviderInput) {
        seen.push(
          toolResultForModel(
            await input.executeTool(
              "parser_step",
              { operation: "test", workspaceId: "w", candidateId: "c" },
              "call-1",
            ),
          ),
        );
        yield { type: "text_delta", text: "The test failed." };
        yield { type: "completed" };
      },
    };
    await executeRun(db, run, provider, new AbortController().signal, tools);
    assert.match(seen[0], /parser_step failed with an internal error/);
    assert.doesNotMatch(seen[0], /ECONNREFUSED/);
    const invocation = await db.chatToolInvocation.findFirstOrThrow({
      where: { runId: run.id },
    });
    assert.equal(invocation.status, "failed");
    assert.match(JSON.stringify(invocation.result), /internal error/);
    assert.equal(
      (await db.chatRun.findUniqueOrThrow({ where: { id: run.id } })).status,
      "completed",
    );
    const reply = await db.chatMessage.findFirstOrThrow({
      where: { conversationId: conversation.id, role: "assistant" },
    });
    const activity = (reply.blocks as any[]).find((b) => b.type === "activity");
    assert.deepEqual(activity.steps, [{ name: "parser_step", ok: false }]);
  }));
