import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import type { PrismaClient } from "@prisma/client";
import { withChatDb } from "../chat/test-harness";
import { withDatabase } from "../../lib/database-context";
import { hashApiTokenSecret } from "../auth/api-token";
import { createAgentTransactionsRouter } from "./agent-transactions.controller";
import { TransactionService } from "./transactions.service";

async function token(db: PrismaClient, userId: string, id: string, scopes: string[]) {
  await db.apiToken.create({
    data: { id, userId, name: id, secretHash: hashApiTokenSecret(`${id}-secret`), scopes },
  });
  return { Authorization: `Bearer pfa_${id}.${id}-secret`, "Content-Type": "application/json" };
}

async function serve(db: PrismaClient) {
  const app = express();
  app.use(express.json());
  app.use((_request, _response, next) => void withDatabase(db, async () => next()));
  app.use("/api/agent/transactions", createAgentTransactionsRouter(db));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/agent/transactions`;
  const call = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: (await response.json()) as any };
  };
  return { server, call };
}

const entry = (externalId: string, extra: Record<string, unknown> = {}) => ({
  externalId,
  date: "2026-11-24",
  description: "KOPITIAM BEDOK",
  amountOut: 6.8,
  account: "DBS 123",
  ...extra,
});

async function setup(db: PrismaClient, name: string) {
  const user = await db.user.create({ data: { username: name } });
  await db.userSettings.create({ data: { userId: user.id, currency: "SGD" } });
  await db.accountIdentifier.create({ data: { userId: user.id, accountIdentifier: "DBS 123", label: "DBS Savings" } });
  const food = await db.category.create({ data: { userId: user.id, name: "Food" } });
  const shopping = await db.category.create({ data: { userId: user.id, name: "Shopping" } });
  return { user, food, shopping };
}

test("rules decide before the assistant's suggestion; a disagreement becomes a question", () =>
  withChatDb(async (db) => {
    const { user } = await setup(db, "review-rules");
    const rule = await db.importRule.create({
      data: { userId: user.id, name: "Kopitiam is Food", matchValue: "kopitiam", setCategoryName: "Food", setLabel: "Kopitiam" },
    });
    const writer = await token(db, user.id, "rwriter01", ["transactions:write"]);
    const { server, call } = await serve(db);
    try {
      const ruled = await call("POST", "", writer, entry("r-1", { suggestedCategory: "Shopping" }));
      assert.equal(ruled.status, 201);
      assert.equal(ruled.body.transaction.category.name, "Food");
      assert.equal(ruled.body.transaction.label, "Kopitiam");
      assert.equal(ruled.body.transaction.classification.decidedBy, "rule");
      assert.equal(ruled.body.transaction.classification.ruleId, rule.id);
      assert.equal(ruled.body.transaction.classification.suggestedCategory, "Shopping");
      assert.equal(ruled.body.transaction.reviewStatus, "to_review");
      // The assistant thought otherwise: the rule's result stays and a question asks.
      assert.deepEqual(ruled.body.transaction.reviewReasons, ["question"]);
      assert.equal(ruled.body.transaction.questions[0].source, "rule_conflict");
      const agreed = await call("POST", "", writer, entry("r-1b", { suggestedCategory: "Food", date: "2026-10-01", amountOut: 12 }));
      assert.deepEqual(agreed.body.transaction.reviewReasons, []);

      const suggested = await call("POST", "", writer, entry("r-2", { description: "UNIQLO ION", suggestedCategory: "shopping" }));
      assert.equal(suggested.body.transaction.category.name, "Shopping");
      assert.equal(suggested.body.transaction.classification.decidedBy, "assistant");
      assert.deepEqual(suggested.body.transaction.reviewReasons, ["no_rule_matched", "assistant_category"]);

      const none = await call("POST", "", writer, entry("r-3", { description: "MYSTERY SHOP", amountOut: 3 }));
      assert.equal(none.body.transaction.category.name, "Uncategorized");
      assert.equal(none.body.transaction.classification.decidedBy, "none");
      assert.deepEqual(none.body.transaction.reviewReasons, ["no_rule_matched"]);

      // A rule that marks Internal books the entry to Internal.
      await db.importRule.create({
        data: { userId: user.id, name: "Top-up is internal", matchValue: "TOP-UP TO WALLET", markInternal: true },
      });
      const internal = await call("POST", "", writer, entry("r-4", { description: "TOP-UP TO WALLET", amountOut: 50 }));
      assert.equal(internal.body.transaction.category.name, "Internal");
      assert.equal(internal.body.transaction.classification.decidedBy, "rule");

      // The same externalId re-runs the rules on update.
      const renamed = await call("PATCH", "/external/r-3", writer, { description: "KOPITIAM TAMPINES" });
      assert.equal(renamed.body.transaction.category.name, "Food");
      assert.equal(renamed.body.transaction.classification.decidedBy, "rule");
    } finally {
      server.close();
    }
  }));

test("an unknown card is a question; only an entry naming nothing gets an account Fortuna creates", () =>
  withChatDb(async (db) => {
    const { user } = await setup(db, "review-accounts");
    await db.accountIdentifier.create({ data: { userId: user.id, accountIdentifier: "4265-****-****-4591", label: "UOB One" } });
    const writer = await token(db, user.id, "awriter01", ["transactions:write"]);
    const reviewer = await token(db, user.id, "areview01", ["transactions:review"]);
    const { server, call } = await serve(db);
    try {
      const known = await call("POST", "", writer, entry("a-0", { account: undefined, card: { last4: "4591" } }));
      assert.equal(known.body.transaction.account, "4265-****-****-4591");
      assert.equal(known.body.accountCreated, undefined);

      // A card nobody knows: no account is made up; the entry asks where it belongs.
      const first = await call("POST", "", writer, entry("a-1", { account: undefined, card: { last4: "7788" }, accountName: "Citi Rewards" }));
      assert.equal(first.status, 201);
      assert.equal(first.body.accountCreated, undefined);
      assert.equal(first.body.transaction.accountId, null);
      assert.ok(first.body.transaction.reviewReasons.includes("unknown_account"));
      assert.ok(first.body.transaction.reviewReasons.includes("question"));
      const [asked] = first.body.transaction.questions;
      assert.equal(asked.field, "account");
      assert.equal(asked.key, "unknown_card:7788");
      assert.ok(asked.options.some((option: any) => option.id === "new_account:credit_card"));
      assert.ok(asked.options.some((option: any) => option.id.startsWith("add_card:")));
      assert.equal(await db.card.count({ where: { userId: user.id, last4: "7788" } }), 0);

      // A second purchase on that card asks the same question.
      const second = await call("POST", "", writer, entry("a-2", { account: undefined, card: { last4: "7788" }, amountOut: 9 }));
      assert.equal(second.body.transaction.questions[0].key, "unknown_card:7788");

      // Answering creates the account and its card, and books both entries there.
      const answered = await call("POST", "/review/questions/answer", reviewer, {
        transactionId: first.body.transaction.id,
        questionId: asked.id,
        option: "new_account:credit_card",
      });
      assert.equal(answered.status, 200, JSON.stringify(answered.body));
      const created = await db.financialAccount.findFirstOrThrow({ where: { userId: user.id, name: "Citi Rewards" }, include: { cards: true } });
      assert.equal(created.type, "credit_card");
      assert.equal(created.autoCreated, false);
      assert.deepEqual(created.cards.map((card) => card.last4), ["7788"]);
      assert.equal(answered.body.transaction.accountId, created.id);
      assert.deepEqual(answered.body.transaction.questions, []);
      assert.ok(!answered.body.transaction.reviewReasons.includes("unknown_account"));
      assert.equal(answered.body.alsoAnswered.length, 1);
      const secondRow = await db.transaction.findFirstOrThrow({ where: { userId: user.id, externalId: "a-2" } });
      assert.equal(secondRow.accountId, created.id);
      assert.equal(secondRow.cardId, created.cards[0].id);
      assert.deepEqual(secondRow.questions, []);

      // The next purchase on that card finds it.
      const third = await call("POST", "", writer, entry("a-3", { account: undefined, card: { last4: "7788" }, amountOut: 4 }));
      assert.equal(third.body.transaction.accountId, created.id);
      assert.deepEqual(third.body.transaction.questions, []);

      // Neither account nor card: the fallback still makes one shared unassigned account.
      const bare = await call("POST", "", writer, entry("a-4", { account: undefined, amountOut: 2 }));
      assert.equal(bare.body.transaction.account, "Assistant: no account");
      assert.equal(bare.body.accountCreated.autoCreated, true);
      assert.ok(bare.body.transaction.reviewReasons.includes("new_account"));

      // Merging it into a real account moves its entries.
      const merged = await call("POST", `/review/accounts/${encodeURIComponent("Assistant: no account")}/merge`, reviewer, {
        into: "DBS Savings",
        confirmed: true,
      });
      assert.equal(merged.status, 200);
      assert.equal(merged.body.transactionsMoved, 1);
      const moved = await db.transaction.findFirstOrThrow({ where: { userId: user.id, externalId: "a-4" } });
      assert.equal(moved.accountIdentifier, "DBS 123");
      assert.ok(!moved.reviewReasons.includes("new_account"));
    } finally {
      server.close();
    }
  }));

test("the review queue: list, correct (statement rows too), mark reviewed, and rules from corrections", () =>
  withChatDb(async (db) => {
    const { user, food } = await setup(db, "review-queue");
    const statementRow = await db.transaction.create({
      data: {
        userId: user.id,
        date: new Date("2026-11-02T00:00:00Z"),
        description: "NTUC FAIRPRICE",
        amountOut: 40,
        accountIdentifier: "DBS 123",
        entrySource: "statement",
        reconciled: true,
      },
    });
    const writer = await token(db, user.id, "qwriter01", ["transactions:write"]);
    const reviewer = await token(db, user.id, "qreview01", ["transactions:review"]);
    const { server, call } = await serve(db);
    try {
      const a = (await call("POST", "", writer, entry("q-1", { description: "HAWKER STALL 12" }))).body.transaction;
      const b = (await call("POST", "", writer, entry("q-2", { description: "UNIQLO", suggestedCategory: "Shopping", amountOut: 20 }))).body.transaction;

      const queue = await call("GET", "/review", reviewer);
      assert.equal(queue.status, 200);
      assert.equal(queue.body.total, 2);
      assert.equal(queue.body.reasons.no_rule_matched, 2);
      assert.equal(queue.body.reasons.assistant_category, 1);
      const onlyAssistantGuesses = await call("GET", "/review?reasons=assistant_category", reviewer);
      assert.deepEqual(onlyAssistantGuesses.body.transactions.map((row: any) => row.id), [b.id]);
      // Statement rows are already reviewed.
      const statements = await call("GET", "/review?status=reviewed&entrySource=statement", reviewer);
      assert.deepEqual(statements.body.transactions.map((row: any) => row.id), [statementRow.id]);

      // Correcting reviews the entry, and records that a person decided.
      const corrected = await call("POST", "/review/correct", reviewer, {
        ids: [a.id, statementRow.id],
        category: "Food",
        label: "Hawker",
        createRule: { matchValue: "nope", confirmed: true },
      });
      assert.equal(corrected.status, 400, "a rule must match every corrected description");
      const fixed = await call("POST", "/review/correct", reviewer, { ids: [a.id, statementRow.id], category: "Food" });
      assert.equal(fixed.status, 200);
      for (const row of fixed.body.transactions) {
        assert.equal(row.category.id, food.id);
        assert.equal(row.reviewStatus, "reviewed");
        assert.deepEqual(row.reviewReasons, []);
      }
      assert.equal(fixed.body.transactions.find((row: any) => row.id === a.id).classification.decidedBy, "correction");

      // A later update from the assistant puts it back in the queue, but the correction stands.
      const updated = await call("PATCH", `/${a.id}`, writer, { description: "HAWKER STALL 12 BEDOK", amountOut: 7 });
      assert.equal(updated.body.transaction.reviewStatus, "to_review");
      assert.equal(updated.body.transaction.category.name, "Food");
      assert.equal(updated.body.transaction.classification.decidedBy, "correction");

      // Mark reviewed, reopen, mark again.
      const marked = await call("POST", "/review/status", reviewer, { ids: [a.id, b.id] });
      assert.deepEqual(marked.body.transactions.map((row: any) => row.reviewStatus), ["reviewed", "reviewed"]);
      const reopened = await call("POST", "/review/status", reviewer, { ids: [b.id], status: "to_review" });
      assert.equal(reopened.body.transactions[0].reviewStatus, "to_review");
      assert.equal((await call("GET", "/review", reviewer)).body.total, 1);
      assert.equal((await call("POST", "/review/status", reviewer, { ids: ["missing"] })).status, 404);

      // A correction can become a rule, which classifies the next entry.
      const withRule = await call("POST", "/review/correct", reviewer, {
        ids: [b.id],
        category: "Food",
        createRule: { matchValue: "UNIQLO", confirmed: true },
      });
      assert.equal(withRule.status, 200);
      assert.equal(withRule.body.rule.setCategoryName, "Food");
      assert.equal(withRule.body.rule.enabled, true);
      const next = await call("POST", "", writer, entry("q-3", { description: "UNIQLO TAMPINES", suggestedCategory: "Shopping" }));
      assert.equal(next.body.transaction.category.name, "Food");
      assert.equal(next.body.transaction.classification.ruleId, withRule.body.rule.id);

      // Corrections only use existing accounts.
      const badAccount = await call("POST", "/review/correct", reviewer, { ids: [b.id], account: "Made Up" });
      assert.equal(badAccount.status, 400);

      const audit = await db.agentAuditEvent.findMany({ where: { userId: user.id }, select: { toolName: true } });
      for (const name of ["correct_transaction", "mark_reviewed", "reopen_review", "create_rule_from_correction"])
        assert.ok(audit.some((event) => event.toolName === name), name);

      // The web and phone list filter by review state.
      await withDatabase(db, async () => {
        const toReview = await TransactionService.getTransactions(user.id, { reviewStatus: "to_review" });
        assert.deepEqual(toReview.transactions.map((row: any) => row.externalId), ["q-3"]);
      });
    } finally {
      server.close();
    }
  }));

test("review needs transactions:review, writing needs transactions:write, context takes either", () =>
  withChatDb(async (db) => {
    const { user } = await setup(db, "review-scopes");
    const writer = await token(db, user.id, "swriter01", ["transactions:write"]);
    const reviewer = await token(db, user.id, "sreview01", ["transactions:review"]);
    const other = await token(db, user.id, "sother001", ["analytics:read", "accounts:read"]);
    const { server, call } = await serve(db);
    try {
      assert.equal((await call("GET", "/review", writer)).status, 403);
      assert.equal((await call("POST", "/review/status", writer, { ids: ["x"] })).status, 403);
      assert.equal((await call("POST", "", reviewer, entry("s-1"))).status, 403);
      assert.equal((await call("GET", "/external/s-1", reviewer)).status, 403);
      for (const path of ["/guide", "/context/accounts", "/context/categories", "/context/rules", "/context/similar?description=KOPITIAM"]) {
        assert.equal((await call("GET", path, writer)).status, 200, path);
        assert.equal((await call("GET", path, reviewer)).status, 200, path);
        const refused = await call("GET", path, other);
        assert.equal(refused.status, 403, path);
        assert.deepEqual(refused.body.anyOfScopes, ["transactions:write", "transactions:review"]);
      }
      assert.equal((await call("GET", "/guide", {})).status, 401);
      const guide = (await call("GET", "/guide", writer)).body;
      assert.equal(guide.write.tool, "create_transaction");
      assert.ok(guide.neverDo.some((rule: string) => /invent accounts/.test(rule)));
    } finally {
      server.close();
    }
  }));

test("similar entries reuse the history search and the duplicate scoring", () =>
  withChatDb(async (db) => {
    const { user, food } = await setup(db, "review-similar");
    await db.transaction.create({
      data: {
        userId: user.id,
        date: new Date("2026-11-20T00:00:00Z"),
        description: "KOPITIAM BEDOK",
        label: "Lunch",
        categoryId: food.id,
        amountOut: 6.8,
        accountIdentifier: "DBS 123",
        entrySource: "statement",
      },
    });
    const writer = await token(db, user.id, "mwriter01", ["transactions:write"]);
    const { server, call } = await serve(db);
    try {
      const similar = await call("GET", "/context/similar?description=KOPITIAM%20BEDOK&date=2026-11-20&amount=6.8", writer);
      assert.equal(similar.status, 200);
      assert.equal(similar.body.matches[0].category, "Food");
      assert.equal(similar.body.commonLabels[0].label, "Lunch");
      assert.equal(similar.body.possibleDuplicates.length, 1);
      assert.ok(similar.body.possibleDuplicates[0].matchScore > 0);
    } finally {
      server.close();
    }
  }));

test("existing, imported and manual rows are reviewed; only assistant entries wait", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "review-backfill" } });
    // A row written without the review columns, as every row was before the migration.
    await db.$executeRawUnsafe(
      `INSERT INTO "transactions" ("id", "user_id", "date", "description", "amount_out", "updated_at")
       VALUES ('legacy-row', $1, '2026-10-01', 'OLD ROW', 5, now())`,
      user.id,
    );
    const legacy = await db.transaction.findUniqueOrThrow({ where: { id: "legacy-row" } });
    assert.equal(legacy.reviewStatus, "reviewed");
    assert.deepEqual(legacy.reviewReasons, []);

    await withDatabase(db, async () => {
      const result = await TransactionService.commitImport(
        user.id,
        [{ date: new Date("2026-10-02T00:00:00Z"), description: "GRAB", amountOut: 12, accountIdentifier: "DBS" }],
        [0],
        { filename: "dbs.pdf", fileType: "pdf", parserId: "dbs_statement" },
      );
      assert.equal(result.success, true, result.error);
    });
    const imported = await db.transaction.findFirstOrThrow({ where: { userId: user.id, description: "GRAB" } });
    assert.equal(imported.reviewStatus, "reviewed");
    await assert.rejects(
      db.$executeRawUnsafe(`UPDATE "transactions" SET "review_status" = 'maybe' WHERE "id" = 'legacy-row'`),
    );
  }));

test("the apps' To review screen works the same queue as the trusted frontend", () =>
  withChatDb(async (db) => {
    const previous = process.env.INTERNAL_SERVICE_TOKEN;
    process.env.INTERNAL_SERVICE_TOKEN = "review-test-internal";
    const { user, food } = await setup(db, "review-frontend");
    // An account made in Settings with a card and no statement identifier.
    const wallet = await db.financialAccount.create({ data: { userId: user.id, name: "Everyday Wallet" } });
    const writer = await token(db, user.id, "fwriter01", ["transactions:write"]);
    const app = { "x-internal-service-token": "review-test-internal", "x-authenticated-user-id": user.id, "Content-Type": "application/json" };
    const { server, call } = await serve(db);
    try {
      // An unknown account name is a question now; the queue still finds the entry by account once booked.
      const created = await call("POST", "", writer, entry("f-1", { account: undefined }));
      assert.equal(created.status, 201);
      const autoAccountId = created.body.transaction.accountId;
      assert.ok(autoAccountId);

      assert.equal((await call("GET", "/review", { ...app, "x-internal-service-token": "wrong" })).status, 401);
      const queue = await call("GET", `/review?account=${autoAccountId}`, app);
      assert.equal(queue.status, 200);
      assert.deepEqual(queue.body.transactions.map((row: any) => row.externalId), ["f-1"]);
      assert.ok("imageId" in queue.body.transactions[0]);

      // Corrections can book to an account found by its id, without an identifier.
      const corrected = await call("POST", "/review/correct", app, {
        ids: [created.body.transaction.id],
        category: food.id,
        account: wallet.id,
        markReviewed: false,
      });
      assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
      assert.equal(corrected.body.transactions[0].accountId, wallet.id);
      assert.equal(corrected.body.transactions[0].category.name, "Food");

      const audit = await db.agentAuditEvent.findFirstOrThrow({
        where: { userId: user.id, toolName: "correct_transaction" },
      });
      assert.equal(audit.actorType, "trusted_service");

      // The auto-created account merges into the Settings account.
      const merged = await call("POST", `/review/accounts/${autoAccountId}/merge`, app, { into: wallet.id, confirmed: true });
      assert.equal(merged.status, 200, JSON.stringify(merged.body));
      assert.equal(await db.financialAccount.count({ where: { id: autoAccountId } }), 0);
    } finally {
      server.close();
      process.env.INTERNAL_SERVICE_TOKEN = previous;
    }
  }));
