import { test } from "node:test";
import assert from "node:assert/strict";
import { withChatDb } from "../chat/test-harness";
import { withDatabase } from "../../lib/database-context";
import { TransactionService } from "./transactions.service";
import { createToolRegistry } from "../chat/tools/registry";

test("account-scoped import rules only touch that account's transactions", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "rule-account" } });
    const other = await db.user.create({ data: { username: "rule-other" } });
    await db.accountIdentifier.createMany({
      data: [
        {
          userId: user.id,
          accountIdentifier: "4265-****-****-4591",
          color: "#111111",
        },
        {
          userId: user.id,
          accountIdentifier: "5323-****-****-2124",
          color: "#222222",
        },
        { userId: other.id, accountIdentifier: "9999", color: "#333333" },
      ],
    });
    await withDatabase(db, async () => {
      await TransactionService.createImportRule(user.id, {
        name: "Partner bus rides",
        accountIdentifier: "4265-****-****-4591",
        matchType: "description_contains",
        matchValue: "BUS/MRT",
        markInternal: true,
      });
      await TransactionService.createImportRule(user.id, {
        name: "Any account coffee",
        matchType: "description_contains",
        matchValue: "COFFEE",
        setLabel: "Coffee",
      });
      const result = await TransactionService.applyImportRules(
        user.id,
        undefined,
        [
          {
            date: "2026-09-01",
            description: "BUS/MRT 1",
            amountOut: 2,
            accountIdentifier: "4265-****-****-4591",
          } as any,
          {
            date: "2026-09-01",
            description: "BUS/MRT 2",
            amountOut: 2,
            accountIdentifier: "5323-****-****-2124",
          } as any,
          {
            date: "2026-09-01",
            description: "BUS/MRT 3",
            amountOut: 2,
            metadata: { accountIdentifier: "4265-****-****-4591" },
          } as any,
          { date: "2026-09-01", description: "BUS/MRT 4", amountOut: 2 } as any,
          {
            date: "2026-09-01",
            description: "COFFEE",
            amountOut: 5,
            accountIdentifier: "5323-****-****-2124",
          } as any,
        ],
      );
      assert.deepEqual(
        result.map((t: any) => t.linkage?.type ?? null),
        ["internal", null, "internal", null, null],
      );
      assert.equal((result[4] as any).label, "Coffee");
      await assert.rejects(
        TransactionService.createImportRule(user.id, {
          name: "Someone else's account",
          accountIdentifier: "9999",
          matchType: "always",
        }),
        /Account 9999 not found/,
      );
    });
    const rule = await db.importRule.findFirstOrThrow({
      where: { userId: user.id, name: "Partner bus rides" },
    });
    assert.equal(rule.accountIdentifier, "4265-****-****-4591");

    const conversation = await db.chatConversation.create({
      data: { userId: user.id },
    });
    const run = await db.chatRun.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        idempotencyKey: "rule",
        provider: "codex",
        model: "test",
      },
    });
    const tools = createToolRegistry(db);
    const context = {
      userId: user.id,
      conversationId: conversation.id,
      runId: run.id,
    } as any;
    const proposed = await tools.execute(context, "propose_action", {
      action: {
        kind: "update_import_rule",
        name: "Card bus rides",
        accountIdentifier: "5323-****-****-2124",
        matchType: "description_contains",
        matchValue: "BUS/MRT",
        markInternal: true,
      },
    });
    assert.deepEqual(
      proposed.blocks.map((b) => b.type),
      ["link"],
    );
    await assert.rejects(
      tools.execute(context, "propose_action", {
        action: {
          kind: "update_import_rule",
          name: "Bad",
          accountIdentifier: "9999",
          matchType: "always",
        },
      }),
      /Account not found/,
    );
  }));
