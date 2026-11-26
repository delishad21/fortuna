import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import type { PrismaClient } from "@prisma/client";
import { withChatDb } from "../chat/test-harness";
import { withDatabase } from "../../lib/database-context";
import { hashApiTokenSecret } from "../auth/api-token";
import { createAgentTransactionsRouter } from "../transactions/agent-transactions.controller";
import { TransactionService } from "../transactions/transactions.service";
import { sourcesRouter } from "./sources.controller";

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
  app.use("/api/agent/sources", sourcesRouter);
  app.use("/api/agent/transactions", createAgentTransactionsRouter(db));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, base: `http://127.0.0.1:${(server.address() as any).port}/api/agent` };
}

const notifId = (key: string, postTime: number) => `notif:com.uob.mighty:0|com.uob.mighty|${key}|null|10213:${postTime}`;

test("sources: scopes, disabled by default, suggestions, and the watch list in the guide", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "sources-scopes" } });
    const paylah = await db.financialAccount.create({ data: { userId: user.id, name: "Paylah" } });
    await db.transaction.create({
      data: {
        userId: user.id,
        date: new Date("2026-08-01T00:00:00Z"),
        description: "PAYLAH",
        amountOut: 1,
        accountId: paylah.id,
        metadata: { parserId: "dbs_paylah_statement" },
      },
    });
    const nothing = await token(db, user.id, "srcnone01", ["analytics:read"]);
    const reader = await token(db, user.id, "srcread01", ["accounts:read"]);
    const writer = await token(db, user.id, "srcwrit01", ["accounts:read", "accounts:write"]);
    const entries = await token(db, user.id, "srcentr01", ["transactions:write"]);
    const reviewer = await token(db, user.id, "srcrevw01", ["transactions:review"]);
    const { server, base } = await serve(db);
    const get = (path: string, headers?: Record<string, string>) => fetch(`${base}${path}`, { headers });
    try {
      // Reading what to watch: any of transactions:write, transactions:review, accounts:read.
      assert.equal((await get("/transactions/context/sources")).status, 401);
      assert.equal((await get("/transactions/context/sources", nothing)).status, 403);
      for (const headers of [reader, entries, reviewer])
        assert.equal((await get("/transactions/context/sources", headers)).status, 200);
      // Managing sources: accounts:read lists, accounts:write changes.
      assert.equal((await get("/sources", nothing)).status, 403);
      assert.equal((await get("/sources", reader)).status, 200);
      const body = JSON.stringify({ kind: "email", accountId: paylah.id, senders: ["paylah.alert@dbs.com"], confirmed: true });
      assert.equal((await fetch(`${base}/sources`, { method: "POST", body, headers: reader })).status, 403);
      assert.equal((await fetch(`${base}/sources`, { method: "POST", body, headers: entries })).status, 403);
      assert.equal(
        (await fetch(`${base}/sources`, { method: "POST", body: JSON.stringify({ kind: "email", accountId: paylah.id, senders: ["paylah.alert@dbs.com"] }), headers: writer })).status,
        400,
      );

      // PayLah alert emails are suggested from the PayLah imports, not added.
      const suggested = (await (await get("/sources/suggestions", reader)).json()) as any;
      assert.equal(suggested.suggestions.length, 1);
      assert.equal(suggested.suggestions[0].accountId, paylah.id);
      assert.deepEqual(suggested.suggestions[0].senders, ["paylah.alert@dbs.com"]);
      assert.equal(await db.transactionSource.count(), 0);

      const created = await fetch(`${base}/sources`, { method: "POST", body, headers: writer });
      assert.equal(created.status, 201);
      const { source } = (await created.json()) as any;
      assert.equal(source.enabled, false);
      assert.equal(source.channel, "main");
      assert.equal(((await (await get("/sources/suggestions", reader)).json()) as any).suggestions.length, 0);
      let watching = (await (await get("/transactions/context/sources", entries)).json()) as any;
      assert.deepEqual(watching.email.senders, []);

      const enabled = await fetch(`${base}/sources/${source.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: true, subjectPatterns: ["Transaction Alerts"], confirmed: true }),
        headers: writer,
      });
      assert.equal(enabled.status, 200);
      watching = (await (await get("/transactions/context/sources", entries)).json()) as any;
      assert.deepEqual(watching.email.senders, ["paylah.alert@dbs.com"]);
      assert.equal(watching.email.sources[0].account.name, "Paylah");
      assert.deepEqual(watching.email.sources[0].subjectPatterns, ["Transaction Alerts"]);

      const guide = (await (await get("/transactions/guide", entries)).json()) as any;
      assert.deepEqual(guide.sources.watching.email.senders, ["paylah.alert@dbs.com"]);
      assert.equal(guide.sources.tool, "get_entry_sources");
      assert.equal(guide.externalIds.email.format, "email:<Message-ID>");
      assert.equal(guide.externalIds.notification.format, "notif:<package>:<key>:<postTime>");
      assert.ok(guide.write.send.sourceId);
      assert.ok(guide.fortunaDecides.mainAndBackup);

      const audit = await db.agentAuditEvent.findMany({ where: { userId: user.id, targetType: "transaction_source" } });
      assert.deepEqual(audit.map((event) => event.toolName).sort(), ["create_source", "update_source"]);
    } finally {
      server.close();
    }
  }));

test("each externalId scheme is idempotent, and deleted entries stay deleted", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "sources-idem" } });
    await db.userSettings.create({ data: { userId: user.id, currency: "SGD" } });
    const writer = await token(db, user.id, "idemwrit1", ["transactions:write"]);
    const { server, base } = await serve(db);
    const post = (body: Record<string, unknown>) =>
      fetch(`${base}/transactions`, { method: "POST", body: JSON.stringify(body), headers: writer });
    const entry = { date: "2026-11-26T12:35:00+08:00", description: "KOPITIAM BEDOK", amountOut: 6.8, card: { last4: "4591" } };
    try {
      // Email: the Message-ID with or without brackets is one id.
      const first = await post({ ...entry, externalId: "email:<CAF7xk2@mail.gmail.com>" });
      assert.equal(first.status, 201);
      const saved = ((await first.json()) as any).transaction;
      assert.equal(saved.externalId, "email:CAF7xk2@mail.gmail.com");
      assert.equal(saved.sources[0].kind, "email");
      const again = await post({ ...entry, externalId: "email:CAF7xk2@mail.gmail.com", description: "KOPITIAM BEDOK 2" });
      assert.equal(again.status, 200);
      assert.equal(((await again.json()) as any).transaction.description, "KOPITIAM BEDOK 2");
      assert.equal(await db.transaction.count({ where: { userId: user.id } }), 1);

      // Notification: the same package, key and post time is one id; a new post time is a new message.
      const notif = notifId("7", 1764131700000);
      assert.equal((await post({ ...entry, amountOut: 3.2, externalId: notif })).status, 201);
      assert.equal((await post({ ...entry, amountOut: 3.2, externalId: notif })).status, 200);
      assert.equal(await db.transaction.count({ where: { userId: user.id } }), 2);
      assert.equal((await post({ ...entry, amountOut: 3.2, externalId: notifId("7", 1764131760000) })).status, 201);
      assert.equal(await db.transaction.count({ where: { userId: user.id } }), 3);
      assert.equal((await fetch(`${base}/transactions/external/${encodeURIComponent(notif)}`, { headers: writer })).status, 200);

      // Ids that break their scheme are refused.
      const bad = await post({ ...entry, externalId: "notif:com.uob.mighty:7:1764131700" });
      assert.equal(bad.status, 400);
      assert.match(((await bad.json()) as any).error, /notif:<package>:<key>:<postTime>/);
      assert.equal((await post({ ...entry, externalId: "email:not-a-message-id" })).status, 400);

      // An entry deleted (here by the user in the app) isn't brought back by a re-read.
      const id = saved.id;
      await withDatabase(db, () => TransactionService.deleteTransaction(id, user.id));
      const reread = await post({ ...entry, externalId: "email:CAF7xk2@mail.gmail.com" });
      assert.equal(reread.status, 200);
      const skipped = (await reread.json()) as any;
      assert.equal(skipped.skipped, "deleted");
      assert.equal(skipped.transaction, null);
      assert.equal(await db.transaction.count({ where: { userId: user.id } }), 2);
    } finally {
      server.close();
    }
  }));

test("a card's backup channel merges into its main channel's entry, whichever comes first", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "sources-channels" } });
    await db.userSettings.create({ data: { userId: user.id, currency: "SGD" } });
    const account = await db.financialAccount.create({ data: { userId: user.id, name: "UOB One", type: "credit_card" } });
    const card = await db.card.create({ data: { userId: user.id, accountId: account.id, last4: "4591" } });
    const app = await db.transactionSource.create({
      data: { userId: user.id, accountId: account.id, cardId: card.id, kind: "notification", senders: ["com.uob.mighty"], channel: "main", enabled: true },
    });
    const mail = await db.transactionSource.create({
      data: {
        userId: user.id,
        accountId: account.id,
        cardId: card.id,
        kind: "email",
        senders: ["unialerts@uobgroup.com"],
        identifiers: ["ending 4591"],
        channel: "backup",
        enabled: true,
      },
    });
    const writer = await token(db, user.id, "chanwrit1", ["transactions:write"]);
    const { server, base } = await serve(db);
    const post = async (body: Record<string, unknown>) => {
      const response = await fetch(`${base}/transactions`, { method: "POST", body: JSON.stringify(body), headers: writer });
      return { status: response.status, body: (await response.json()) as any };
    };
    const count = () => db.transaction.count({ where: { userId: user.id } });
    try {
      // Main first: the notification names no card; the source's card books it.
      const main = await post({
        externalId: notifId("1", 1764131700000),
        date: "2026-11-26T12:35:00+08:00",
        description: "KOPITIAM BEDOK",
        amountOut: 6.8,
      });
      assert.equal(main.status, 201);
      assert.equal(main.body.transaction.sources[0].sourceId, app.id);
      const stored = await db.transaction.findUniqueOrThrow({ where: { id: main.body.transaction.id } });
      assert.equal(stored.cardId, card.id);
      assert.equal(stored.accountId, account.id);

      // The backup email about it is merged in, found by its sender.
      const email = {
        externalId: "email:<uob-1@uobgroup.com>",
        sender: "UOB Alerts <unialerts@uobgroup.com>",
        date: "2026-11-26T12:36:00+08:00",
        description: "Kopitiam Bedok Pte Ltd",
        amountOut: 6.8,
        card: { last4: "4591" },
        metadata: { emailSubject: "Transaction Alert", body: "Card ending 4591 SGD 6.80" },
      };
      const backup = await post(email);
      assert.equal(backup.status, 200);
      assert.equal(backup.body.created, false);
      assert.equal(backup.body.merged.into, main.body.transaction.id);
      assert.equal(backup.body.merged.as, "backup");
      assert.ok(backup.body.merged.matchReasons.includes("Same card"));
      assert.equal(backup.body.transaction.description, "KOPITIAM BEDOK");
      assert.deepEqual(
        backup.body.transaction.sources.map((item: any) => [item.sourceId, item.channel, item.primary]),
        [
          [app.id, "main", true],
          [mail.id, "backup", false],
        ],
      );
      assert.equal(await count(), 1);
      // Re-reading either message changes nothing more.
      assert.equal((await post(email)).body.merged.into, main.body.transaction.id);
      assert.equal((await post({ externalId: notifId("1", 1764131700000), date: "2026-11-26T12:35:00+08:00", description: "KOPITIAM BEDOK", amountOut: 6.8 })).status, 200);
      assert.equal(await count(), 1);
      assert.equal(await db.transactionSourceReport.count({ where: { transactionId: main.body.transaction.id } }), 2);

      // Backup first: the main channel's notification takes the entry over.
      const early = await post({
        ...email,
        externalId: "email:uob-2@uobgroup.com",
        date: "2026-11-26T19:02:00+08:00",
        description: "Grab Singapore",
        amountOut: 14.5,
      });
      assert.equal(early.status, 201);
      const late = await post({
        externalId: notifId("2", 1764154920000),
        date: "2026-11-26T19:02:00+08:00",
        description: "GRAB*RIDES",
        amountOut: 14.5,
      });
      assert.equal(late.status, 200);
      assert.equal(late.body.merged.into, early.body.transaction.id);
      assert.equal(late.body.merged.as, "main");
      assert.equal(late.body.transaction.externalId, notifId("2", 1764154920000));
      assert.equal(late.body.transaction.description, "GRAB*RIDES");
      assert.equal(await count(), 2);
      // The backup's id still finds the entry and re-sending it doesn't change it back.
      const resent = await post({ ...email, externalId: "email:uob-2@uobgroup.com", date: "2026-11-26T19:02:00+08:00", description: "Grab Singapore", amountOut: 14.5 });
      assert.equal(resent.body.merged.into, early.body.transaction.id);
      assert.equal(resent.body.transaction.description, "GRAB*RIDES");

      // Two purchases with the same amount hours apart stay two.
      const second = await post({
        externalId: notifId("3", 1764160000000),
        date: "2026-11-26T20:30:00+08:00",
        description: "KOPITIAM BEDOK",
        amountOut: 6.8,
      });
      assert.equal(second.status, 201);
      const secondEmail = await post({ ...email, externalId: "email:uob-3@uobgroup.com", date: "2026-11-26T20:31:00+08:00" });
      assert.equal(secondEmail.body.merged?.into, second.body.transaction.id);
      assert.equal(await count(), 3);

      // A source only takes ids of its kind.
      const wrongKind = await post({ ...email, externalId: notifId("9", 1764160000001), sourceId: mail.id });
      assert.equal(wrongKind.status, 400);

      // Deleting by the backup's id unlinks that message; the entry stays.
      const unlink = await fetch(`${base}/transactions/external/${encodeURIComponent("email:uob-1@uobgroup.com")}`, {
        method: "DELETE",
        headers: writer,
      });
      assert.deepEqual(((await unlink.json()) as any).unlinked, true);
      assert.equal(await count(), 3);
      const after = await db.transaction.findUniqueOrThrow({ where: { id: main.body.transaction.id } });
      assert.equal((after.metadata as any).sources.length, 1);
    } finally {
      server.close();
    }
  }));

test("merging accounts and moving cards take their sources along", () =>
  withChatDb(async (db) => {
    const { mergeAccount, updateCard } = await import("../accounts/accounts.service");
    const user = await db.user.create({ data: { username: "sources-merge" } });
    const from = await db.financialAccount.create({ data: { userId: user.id, name: "Card ending 4591", autoCreated: true } });
    const into = await db.financialAccount.create({ data: { userId: user.id, name: "UOB One" } });
    const third = await db.financialAccount.create({ data: { userId: user.id, name: "Other" } });
    const twinFrom = await db.card.create({ data: { userId: user.id, accountId: from.id, last4: "4591" } });
    const twinInto = await db.card.create({ data: { userId: user.id, accountId: into.id, last4: "4591" } });
    const onCard = await db.transactionSource.create({
      data: { userId: user.id, accountId: from.id, cardId: twinFrom.id, kind: "notification", senders: ["com.uob.mighty"] },
    });
    const onAccount = await db.transactionSource.create({
      data: { userId: user.id, accountId: from.id, kind: "email", senders: ["unialerts@uobgroup.com"] },
    });
    await withDatabase(db, () => db.$transaction((tx) => mergeAccount(tx, user.id, from.id, into.id)));
    const moved = await db.transactionSource.findMany({ where: { id: { in: [onCard.id, onAccount.id] } }, orderBy: { kind: "asc" } });
    assert.deepEqual(moved.map((item) => [item.kind, item.accountId, item.cardId]), [
      ["email", into.id, null],
      ["notification", into.id, twinInto.id],
    ]);
    await withDatabase(db, () => db.$transaction((tx) => updateCard(tx, user.id, twinInto.id, { accountId: third.id })));
    assert.equal((await db.transactionSource.findUniqueOrThrow({ where: { id: onCard.id } })).accountId, third.id);
  }));
