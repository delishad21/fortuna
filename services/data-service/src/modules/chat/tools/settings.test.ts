import { test } from "node:test";
import assert from "node:assert/strict";
import { withChatDb } from "../test-harness";
import { ApprovalService } from "../approvals.service";
import { SettingsActions } from "./settings";
test("account creation is only performed after human approval", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "settings-owner" } });
    const conv = await db.chatConversation.create({
      data: { userId: user.id },
    });
    const run = await db.chatRun.create({
      data: {
        userId: user.id,
        conversationId: conv.id,
        idempotencyKey: "one",
        provider: "openrouter",
        model: "test",
      },
    });
    const service = new ApprovalService(db, new SettingsActions(db));
    const proposal = await service.proposeAction(
      { userId: user.id, runId: run.id, conversationId: conv.id },
      { kind: "create_account", accountIdentifier: "DBS", color: "#6633ff" },
    );
    assert.equal(await db.accountIdentifier.count(), 0);
    await service.decideAction(user.id, proposal.id, "approve");
    assert.equal(await db.accountIdentifier.count(), 1);
  }));
