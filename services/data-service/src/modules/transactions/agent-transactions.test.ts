import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { withChatDb } from "../chat/test-harness";
import { withDatabase } from "../../lib/database-context";
import { hashApiTokenSecret } from "../auth/api-token";
import { agentAnalyticsRouter } from "../analytics/agent-analytics.controller";
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
  app.use("/api/agent/analytics", agentAnalyticsRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, base: `http://127.0.0.1:${(server.address() as any).port}/api/agent` };
}

test("transactions:write is required to write assistant entries", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "entries-scope" } });
    await db.accountIdentifier.create({ data: { userId: user.id, accountIdentifier: "DBS 123" } });
    const readOnly = await token(db, user.id, "readonly1", ["analytics:read", "accounts:write"]);
    const writer = await token(db, user.id, "writer001", ["transactions:write"]);
    await db.apiToken.create({
      data: {
        id: "revoked01",
        userId: user.id,
        name: "revoked",
        secretHash: hashApiTokenSecret("revoked01-secret"),
        scopes: ["transactions:write"],
        revokedAt: new Date(),
      },
    });
    const { server, base } = await serve(db);
    const body = JSON.stringify({
      externalId: "scope-1",
      date: "2026-11-20",
      description: "Coffee",
      amountOut: 4.5,
      account: "DBS 123",
    });
    try {
      assert.equal((await fetch(`${base}/transactions`, { method: "POST", body })).status, 401);
      assert.equal(
        (await fetch(`${base}/transactions`, {
          method: "POST",
          body,
          headers: { ...writer, Authorization: "Bearer pfa_revoked01.revoked01-secret" },
        })).status,
        401,
      );
      const refused = await fetch(`${base}/transactions`, { method: "POST", body, headers: readOnly });
      assert.equal(refused.status, 403);
      assert.deepEqual(((await refused.json()) as any).requiredScopes, ["transactions:write"]);
      assert.equal((await fetch(`${base}/transactions/external/scope-1`, { headers: readOnly })).status, 403);
      assert.equal(await db.transaction.count({ where: { userId: user.id } }), 0);

      assert.equal((await fetch(`${base}/transactions`, { method: "POST", body, headers: writer })).status, 201);
    } finally {
      server.close();
    }
  }));

test("the same externalId updates the entry, which shows in the ledger and analytics at once", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "entries-idem" } });
    const other = await db.user.create({ data: { username: "entries-idem-other" } });
    await db.userSettings.create({ data: { userId: user.id, currency: "SGD" } });
    await db.accountIdentifier.createMany({
      data: [
        { userId: user.id, accountIdentifier: "4265-****-****-4591", label: "UOB One" },
        { userId: user.id, accountIdentifier: "DBS 123-45678-9" },
      ],
    });
    const food = await db.category.create({ data: { userId: user.id, name: "Food", color: "#ff0000" } });
    // A statement row the new entry looks like, and one in another account.
    await db.transaction.create({
      data: {
        userId: user.id,
        date: new Date("2026-11-20T00:00:00Z"),
        description: "KOPITIAM BEDOK",
        amountOut: 6.8,
        accountIdentifier: "4265-****-****-4591",
        entrySource: "statement",
        reconciled: true,
      },
    });
    const writer = await token(db, user.id, "writer002", ["transactions:write", "analytics:read"]);
    const otherWriter = await token(db, other.id, "writer003", ["transactions:write"]);
    const { server, base } = await serve(db);
    const post = (body: Record<string, unknown>, headers = writer) =>
      fetch(`${base}/transactions`, { method: "POST", body: JSON.stringify(body), headers });
    const entry = {
      externalId: "notif-42",
      date: "2026-11-20T12:35:00+08:00",
      description: "KOPITIAM BEDOK",
      label: "Lunch",
      amountOut: 6.8,
      suggestedCategory: "food",
      card: { last4: "4591" },
      metadata: { notification: "You spent SGD 6.80 at KOPITIAM BEDOK" },
    };
    try {
      const first = await post(entry);
      assert.equal(first.status, 201);
      const created = (await first.json()) as any;
      assert.equal(created.created, true);
      assert.equal(created.transaction.entrySource, "assistant");
      assert.equal(created.transaction.reconciled, false);
      assert.equal(created.transaction.account, "4265-****-****-4591");
      assert.deepEqual(created.transaction.card, { last4: "4591" });
      assert.equal(created.transaction.category.id, food.id);
      assert.equal(created.transaction.date, "2026-11-20");
      assert.equal(created.transaction.time, "12:35");
      assert.equal(created.transaction.currency, "SGD");
      assert.deepEqual(created.transaction.metadata, entry.metadata);
      // Possible duplicates come back; the entry is still saved.
      assert.equal(created.possibleDuplicates.length, 1);
      assert.equal(created.possibleDuplicates[0].entrySource, "statement");

      const retried = await post({ ...entry, amountOut: 7.2, label: "Lunch with Mei" });
      assert.equal(retried.status, 200);
      const updated = (await retried.json()) as any;
      assert.equal(updated.created, false);
      assert.equal(updated.transaction.id, created.transaction.id);
      assert.equal(updated.transaction.amountOut, 7.2);
      assert.equal(updated.transaction.label, "Lunch with Mei");
      assert.equal(updated.possibleDuplicates.length, 0);
      assert.equal(await db.transaction.count({ where: { userId: user.id, externalId: "notif-42" } }), 1);

      // External ids belong to one user: the other user's same id is their own row.
      await db.accountIdentifier.create({ data: { userId: other.id, accountIdentifier: "OCBC 1" } });
      assert.equal(
        (await post({ ...entry, card: undefined, suggestedCategory: undefined, account: "OCBC 1" }, otherWriter)).status,
        201,
      );
      assert.equal(await db.transaction.count({ where: { userId: other.id } }), 1);

      // In the ledger, filterable by source and reconciled state.
      await withDatabase(db, async () => {
        const assistantOnly = await TransactionService.getTransactions(user.id, {
          entrySources: ["assistant"],
          reconciled: false,
        });
        assert.deepEqual(assistantOnly.transactions.map((row: any) => row.id), [created.transaction.id]);
        const reconciled = await TransactionService.getTransactions(user.id, { reconciled: true });
        assert.deepEqual(reconciled.transactions.map((row: any) => row.entrySource), ["statement"]);
      });

      // And in analytics straight away.
      const spending = (await (
        await fetch(`${base}/analytics/spending?groupBy=category&from=2026-11-01&to=2026-11-30`, { headers: writer })
      ).json()) as any;
      assert.deepEqual(spending.rows.find((row: any) => row.label === "Food"), { label: "Food", amount: 7.2 });

      // Changes by external id; money in clears money out.
      const patched = await fetch(`${base}/transactions/external/notif-42`, {
        method: "PATCH",
        headers: writer,
        body: JSON.stringify({ amountIn: 7.2, suggestedCategory: "Reimbursement", time: "13:00" }),
      });
      assert.equal(patched.status, 200);
      const refunded = ((await patched.json()) as any).transaction;
      assert.equal(refunded.amountIn, 7.2);
      assert.equal(refunded.amountOut, null);
      assert.equal(refunded.category.name, "Reimbursement");
      assert.equal(refunded.time, "13:00");
      assert.equal(refunded.date, "2026-11-20");
      const stored = await db.transaction.findUniqueOrThrow({ where: { id: created.transaction.id } });
      assert.equal((stored.linkage as any).type, "reimbursement");

      // An unknown suggestion is only a warning: the entry goes in Uncategorized.
      const unknown = await post({ ...entry, externalId: "notif-43", suggestedCategory: "Nope" });
      assert.equal(unknown.status, 201);
      const unknownBody = (await unknown.json()) as any;
      assert.equal(unknownBody.transaction.category.name, "Uncategorized");
      assert.match(unknownBody.warnings[0], /Unknown category "Nope"/);
      await fetch(`${base}/transactions/external/notif-43`, { method: "DELETE", headers: writer });

      // Statement rows aren't the assistant's to change or delete.
      const statementRow = await db.transaction.findFirstOrThrow({ where: { userId: user.id, entrySource: "statement" } });
      assert.equal(
        (await fetch(`${base}/transactions/${statementRow.id}`, { method: "DELETE", headers: writer })).status,
        409,
      );
      assert.equal(
        (await fetch(`${base}/transactions/${created.transaction.id}`, { method: "DELETE", headers: otherWriter })).status,
        404,
      );
      const deleted = await fetch(`${base}/transactions/external/notif-42`, { method: "DELETE", headers: writer });
      assert.equal(deleted.status, 200);
      assert.equal(await db.transaction.count({ where: { userId: user.id } }), 1);
      assert.deepEqual(
        (await db.agentAuditEvent.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } })).map(
          (event) => event.toolName,
        ),
        ["create_transaction", "update_transaction", "update_transaction", "create_transaction", "delete_transaction", "delete_transaction"],
      );
    } finally {
      server.close();
    }
  }));

test("the migration marks imported rows as reconciled statement rows and the rest as manual", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "entries-backfill" } });
    const batch = await db.importBatch.create({
      data: { userId: user.id, filename: "dbs.pdf", fileType: "pdf", parserId: "dbs_statement", status: "COMMITTED", expiresAt: new Date() },
    });
    const day = new Date("2026-10-01T00:00:00Z");
    const rows = {
      batched: { importBatchId: batch.id },
      parsed: { metadata: { parserId: "dbs_statement" } },
      filed: { metadata: { sourceFilename: "uob.pdf" } },
      byHand: { metadata: { note: "cash" } },
      bare: {},
    };
    const ids: Record<string, string> = {};
    for (const [name, data] of Object.entries(rows)) {
      const row = await db.transaction.create({
        data: { userId: user.id, date: day, description: name, amountOut: 1, ...data },
      });
      ids[name] = row.id;
    }

    const migration = readFileSync(
      path.join(__dirname, "../../../prisma/migrations/20261126000100_transaction_entry_source/migration.sql"),
      "utf8",
    );
    const backfill = /UPDATE "transactions"[\s\S]+?;/.exec(migration)![0];
    await db.$executeRawUnsafe(backfill);

    const after = await db.transaction.findMany({ where: { userId: user.id } });
    const byName = Object.fromEntries(after.map((row) => [row.description, row]));
    for (const name of ["batched", "parsed", "filed"]) {
      assert.equal(byName[name].entrySource, "statement", name);
      assert.equal(byName[name].reconciled, true, name);
      assert.ok(byName[name].reconciledAt, name);
    }
    for (const name of ["byHand", "bare"]) {
      assert.equal(byName[name].entrySource, "manual", name);
      assert.equal(byName[name].reconciled, false, name);
      assert.equal(byName[name].reconciledAt, null, name);
    }
  }));

test("imports save statement rows as reconciled", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "entries-import" } });
    await withDatabase(db, async () => {
      const result = await TransactionService.commitImport(
        user.id,
        [{ date: new Date("2026-10-02T00:00:00Z"), description: "GRAB", amountOut: 12, accountIdentifier: "DBS" }],
        [0],
        { filename: "dbs.pdf", fileType: "pdf", parserId: "dbs_statement" },
      );
      assert.equal(result.success, true, result.error);
    });
    const [row] = await db.transaction.findMany({ where: { userId: user.id } });
    assert.equal(row.entrySource, "statement");
    assert.equal(row.reconciled, true);
    assert.ok(row.reconciledAt);
  }));
