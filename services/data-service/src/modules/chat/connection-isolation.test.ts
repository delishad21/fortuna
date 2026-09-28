import { test } from "node:test";
import assert from "node:assert/strict";
import { withChatDb } from "./test-harness";
import { ConnectionService } from "./connections.service";
test("disconnecting an unused provider preserves the selected provider pending approval", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "two-providers" } }),
      conversation = await db.chatConversation.create({
        data: { userId: user.id },
      });
    await db.chatConnection.createMany({
      data: [
        {
          userId: user.id,
          provider: "codex",
          selected: true,
          status: "connected",
        },
        {
          userId: user.id,
          provider: "openrouter",
          selected: false,
          status: "connected",
        },
      ],
    });
    const run = await db.chatRun.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        idempotencyKey: "one",
        provider: "codex",
        model: "gpt-6-luna",
        status: "awaiting_confirmation",
      },
    });
    const proposal = await db.chatActionProposal.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        runId: run.id,
        kind: "edit_transactions",
        arguments: {},
        preview: {},
        stateHash: "hash",
        expiresAt: new Date("2099-01-01"),
      },
    });
    await new ConnectionService(db).disconnect(user.id, "openrouter");
    assert.equal(
      (
        await db.chatActionProposal.findUniqueOrThrow({
          where: { id: proposal.id },
        })
      ).status,
      "pending",
    );
    assert.equal(
      (await db.chatRun.findUniqueOrThrow({ where: { id: run.id } })).status,
      "awaiting_confirmation",
    );
  }));
