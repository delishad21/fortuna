import { test } from "node:test";
import assert from "node:assert/strict";
import { withChatDb } from "../test-harness";
import { ApprovalService } from "../approvals.service";
import { ImportActions } from "./imports";
test("approved staged commit is atomic and repeated approval cannot import twice", () =>
  withChatDb(async (db) => {
    process.env.COMMIT_TOKEN_SECRET =
      "chat-test-commit-token-secret-at-least-32-characters";
    const user = await db.user.create({ data: { username: "import-owner" } });
    await db.accountIdentifier.create({
      data: { userId: user.id, accountIdentifier: "DBS" },
    });
    const payload = {
      date: "2026-08-10",
      description: "Coffee",
      amountOut: 3.5,
      accountIdentifier: "DBS",
      currency: "SGD",
    };
    const draft = await db.importDraft.create({
      data: {
        userId: user.id,
        mode: "main",
        sourceFilename: "test.csv",
        sourceSha256: "test",
        status: "review",
        expiresAt: new Date("2099-01-01"),
        rows: {
          create: {
            rowIndex: 0,
            parsedPayload: payload,
            currentPayload: payload,
            reviewStatus: "accepted",
          },
        },
      },
    });
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
    const service = new ApprovalService(db, new ImportActions(db));
    const proposal = await service.proposeAction(
      { userId: user.id, runId: run.id, conversationId: conv.id },
      { kind: "commit_drafts", draftIds: [draft.id] },
    );
    assert.equal(await db.transaction.count(), 0);
    const first = await service.decideAction(user.id, proposal.id, "approve");
    const again = await service.decideAction(user.id, proposal.id, "approve");
    assert.deepEqual(again, first);
    assert.equal(first.status, "applied");
    assert.equal(await db.transaction.count(), 1);
    assert.equal(
      (await db.importDraft.findUniqueOrThrow({ where: { id: draft.id } }))
        .status,
      "committed",
    );
  }));
