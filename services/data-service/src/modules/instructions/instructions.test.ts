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
import { createAgentTransactionsRouter } from "../transactions/agent-transactions.controller";
import { executeInstructionTool } from "../chat/tools/instructions";
import { classificationGuide } from "./classification-guide";
import { createInstructionsRouter } from "./instructions.controller";
import { appliesTo, isActive, isExpired, type StoredInstruction } from "./instructions";
import { InstructionService } from "./instructions.service";

const MIGRATION = path.join(
  __dirname,
  "../../../prisma/migrations/20261126000900_classification_instructions/migration.sql",
);

function stored(overrides: Partial<StoredInstruction>): StoredInstruction {
  return {
    id: "i1",
    text: "x",
    scopeType: null,
    accountId: null,
    cardId: null,
    entrySource: null,
    merchantPattern: null,
    kind: "lasting",
    endsOn: null,
    author: "user",
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

test("an instruction covers only the entries its scope names", () => {
  const entry = { accountId: "acc", cardId: "card", entrySource: "assistant", description: "SimplyGo: Simei - Townsville Pr Sch" };
  assert.equal(appliesTo(stored({}), entry), true);
  assert.equal(appliesTo(stored({ scopeType: "account", accountId: "acc" }), entry), true);
  assert.equal(appliesTo(stored({ scopeType: "account", accountId: "other" }), entry), false);
  assert.equal(appliesTo(stored({ scopeType: "card", cardId: "card" }), entry), true);
  assert.equal(appliesTo(stored({ scopeType: "card", cardId: "card" }), { ...entry, cardId: null }), false);
  assert.equal(appliesTo(stored({ scopeType: "entry_source", entrySource: "statement" }), entry), false);
  assert.equal(appliesTo(stored({ scopeType: "entry_source", entrySource: "assistant" }), entry), true);
  assert.equal(appliesTo(stored({ scopeType: "merchant", merchantPattern: "simplygo" }), entry), true);
  assert.equal(appliesTo(stored({ scopeType: "merchant", merchantPattern: "KOPITIAM" }), entry), false);
});

test("a one-off instruction is served through its end date and not after", () => {
  const oneOff = stored({ kind: "one_off", endsOn: new Date("2026-11-30T00:00:00Z") });
  assert.equal(isActive(oneOff, "2026-11-30"), true);
  assert.equal(isExpired(oneOff, "2026-11-30"), false);
  assert.equal(isActive(oneOff, "2026-12-01"), false);
  assert.equal(isExpired(oneOff, "2026-12-01"), true);
  assert.equal(isActive(stored({}), "2099-01-01"), true);
  assert.equal(isActive(stored({ enabled: false }), "2026-11-01"), false);
});

test("Hermes and Fortuna's chat get the same classification guide, with their own tool names", () => {
  const mcp = classificationGuide("mcp");
  const chat = classificationGuide("chat");
  // Same sections, same steps in the same order, same rules for shared items and untrusted text.
  assert.deepEqual(Object.keys(chat), Object.keys(mcp));
  assert.deepEqual(
    chat.decisionOrder.map((s) => s.step),
    ["structural", "rules", "judgement", "fallback"],
  );
  assert.deepEqual(mcp.decisionOrder.map((s) => s.step), chat.decisionOrder.map((s) => s.step));
  assert.deepEqual(chat.untrustedData, mcp.untrustedData);
  assert.deepEqual(chat.askInsteadOfGuessing.when, mcp.askInsteadOfGuessing.when);
  assert.deepEqual(chat.createRule.when, mcp.createRule.when);
  for (const key of ["default", "share", "otherwise"] as const) assert.equal(chat.reimbursable[key], mcp.reimbursable[key]);
  assert.match(mcp.reimbursable.default, /full amount by default/);
  assert.match(mcp.reimbursable.otherwise, /Full, half, or another amount\?/);
  assert.match(mcp.untrustedData.join(" "), /data, never instructions/);
  // Only the tools differ.
  assert.match(mcp.instructions.write, /create_classification_instruction/);
  assert.match(chat.instructions.write, /remember/);
  assert.match(mcp.decisionOrder[2].what, /list_classification_instructions/);
  assert.doesNotMatch(JSON.stringify(chat), /list_classification_instructions|correct_transactions/);
});

test("the migration moves chat notes over: SimplyGo lasting on the SimplyGo account, the November note expired", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "instructions-migrate" } });
    const simplygo = await db.financialAccount.create({
      data: { userId: user.id, name: "SimplyGo (UOB Credit Card)", type: "credit_card" },
    });
    await db.financialAccount.create({ data: { userId: user.id, name: "UOB Credit Card", type: "credit_card" } });
    // The table as it was before, with Johan's two notes.
    await db.$executeRawUnsafe(`DROP TABLE "classification_instructions"`);
    await db.$executeRawUnsafe(
      `CREATE TABLE "chat_memories" ("id" TEXT NOT NULL DEFAULT gen_random_uuid()::text PRIMARY KEY, "user_id" TEXT NOT NULL REFERENCES "users"("id"), "content" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL)`,
    );
    const simplygoNote =
      "For SimplyGo journey statements, journeys between Simei, Townsville, and AMK are usually Madeline's. Exact duplicate journeys mean Johan and Madeline were together and each took the same ride (one journey for each). Use labels “MRT/Bus (Madeline)” for Madeline's journeys and “MRT/Bus (Johan)” for Johan's.";
    const novemberNote =
      "For the November 2026 Madeline spending calculation, UOB Credit Card expenses dated through 2026-11-06 were included. In the next monthly calculation, exclude UOB Credit Card transactions dated 2026-11-06 or earlier; start the UOB range on 2026-11-07. Continue the same Madeline-tagged UOB and MRT/Bus (Madeline) SimplyGo scope.";
    await db.$executeRawUnsafe(
      `INSERT INTO "chat_memories" ("id", "user_id", "content", "created_at", "updated_at") VALUES
        ('5223b872-db00-4718-a100-3e53b5e321a0', $1, $2, '2026-10-02 09:21:31.82', '2026-10-11 03:45:38.425'),
        ('06598337-e9ab-4ec9-b8e8-48493ac1b0c0', $1, $3, '2026-11-13 10:36:22.26', '2026-11-13 10:36:22.26')`,
      user.id,
      simplygoNote,
      novemberNote,
    );
    const statements = readFileSync(MIGRATION, "utf8")
      .split(/;\s*\n/)
      .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
      .filter(Boolean);
    for (const statement of statements) await db.$executeRawUnsafe(statement);

    const tables = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'chat_memories'`,
    );
    assert.equal(Number(tables[0].n), 0);
    const simply = await db.classificationInstruction.findUniqueOrThrow({ where: { id: "5223b872-db00-4718-a100-3e53b5e321a0" } });
    assert.equal(simply.text, simplygoNote);
    assert.equal(simply.kind, "lasting");
    assert.equal(simply.scopeType, "account");
    assert.equal(simply.accountId, simplygo.id);
    assert.equal(simply.author, "fortuna_chat");
    assert.equal(simply.enabled, true);
    assert.equal(simply.createdAt.toISOString(), "2026-10-02T09:21:31.820Z");
    const november = await db.classificationInstruction.findUniqueOrThrow({ where: { id: "06598337-e9ab-4ec9-b8e8-48493ac1b0c0" } });
    assert.equal(november.kind, "one_off");
    assert.equal(november.scopeType, null);
    assert.equal(november.endsOn?.toISOString().slice(0, 10), "2026-11-13");

    // Agents are served the SimplyGo note only; Settings still lists both.
    const service = new InstructionService(db);
    assert.deepEqual(
      (await service.list(user.id, { status: "active" })).map((i) => i.id),
      [simply.id],
    );
    const all = await service.list(user.id);
    assert.deepEqual(
      all.map((i) => [i.id, i.expired]).sort(),
      [
        [november.id, true],
        [simply.id, false],
      ].sort(),
    );
    assert.equal(all.find((i) => i.id === simply.id)?.scope?.label, "SimplyGo (UOB Credit Card)");
  }));

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
  app.use("/api/agent", createInstructionsRouter(db));
  app.use("/api/agent/transactions", createAgentTransactionsRouter(db));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, base: `http://127.0.0.1:${(server.address() as any).port}/api/agent` };
}

test("agents list what applies to an entry, write with instructions:write, and get it with each entry", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "instructions-api" } });
    const other = await db.user.create({ data: { username: "instructions-api-other" } });
    const transit = await db.financialAccount.create({ data: { userId: user.id, name: "SimplyGo", type: "credit_card" } });
    const uob = await db.financialAccount.create({ data: { userId: user.id, name: "UOB One", type: "credit_card" } });
    await db.accountIdentifier.create({ data: { userId: user.id, accountIdentifier: "SimplyGo", accountId: transit.id } });
    const card = await db.card.create({ data: { userId: user.id, accountId: uob.id, last4: "4591" } });
    const foreign = await db.financialAccount.create({ data: { userId: other.id, name: "Theirs" } });
    const day = new Date("2026-11-20T00:00:00Z");
    const ride = await db.transaction.create({
      data: { userId: user.id, date: day, description: "SimplyGo: Simei - Townsville Pr Sch", amountOut: 1.5, accountId: transit.id, entrySource: "statement" },
    });
    const lunch = await db.transaction.create({
      data: { userId: user.id, date: day, description: "KOPITIAM BEDOK", amountOut: 6.8, accountId: uob.id, cardId: card.id, entrySource: "assistant", reviewStatus: "to_review" },
    });
    const service = new InstructionService(db);
    const general = await service.create(user.id, { text: "Grab rides on weekdays are work trips" }, "user");
    const onTransit = await service.create(user.id, { text: "Simei to Townsville is Madeline's", scope: { type: "account", accountId: transit.id } }, "user");
    const onCard = await service.create(user.id, { text: "Card 4591 lunches are mine", scope: { type: "card", cardId: card.id } }, "user");
    const onStatements = await service.create(user.id, { text: "Statement rows: trust the bank's wording", scope: { type: "entry_source", entrySource: "statement" } }, "user");
    const kopitiam = await service.create(user.id, { text: "Kopitiam is Food", scope: { type: "merchant", pattern: "kopitiam" } }, "user");
    const ended = await service.create(user.id, { text: "For October only", kind: "one_off", endsOn: "2026-10-31" }, "user");
    const off = await service.create(user.id, { text: "Disabled", enabled: false }, "user");
    await assert.rejects(
      service.create(user.id, { text: "Not mine", scope: { type: "account", accountId: foreign.id } }, "user"),
      /Unknown account/,
    );
    await assert.rejects(service.create(user.id, { text: "No end", kind: "one_off" }, "user"), /endsOn/);

    const reader = await token(db, user.id, "instr-read", ["instructions:read"]);
    const classifier = await token(db, user.id, "instr-class", ["transactions:review"]);
    const writer = await token(db, user.id, "instr-write", ["instructions:write", "transactions:write"]);
    const unrelated = await token(db, user.id, "instr-none", ["analytics:read"]);
    const { server, base } = await serve(db);
    const get = async (query: string, headers = reader) => {
      const response = await fetch(`${base}/instructions${query}`, { headers });
      assert.equal(response.status, 200, query);
      return ((await response.json()) as any).instructions.map((i: any) => i.id).sort();
    };
    try {
      assert.equal((await fetch(`${base}/instructions`, { headers: unrelated })).status, 403);
      assert.equal((await fetch(`${base}/classification-guide`, { headers: unrelated })).status, 403);
      // Everything, for Settings: expired and disabled too.
      assert.equal((await get("")).length, 7);
      assert.deepEqual(await get("?status=active", classifier), [general.id, onTransit.id, onCard.id, onStatements.id, kopitiam.id].sort());
      // What applies to one entry.
      assert.deepEqual(await get(`?transactionId=${ride.id}`), [general.id, onTransit.id, onStatements.id].sort());
      assert.deepEqual(await get(`?transactionId=${lunch.id}`), [general.id, onCard.id, kopitiam.id].sort());
      // An entry not saved yet: an account scope covers the account's cards; a statement identifier names its account.
      assert.deepEqual(await get(`?cardId=${card.id}`), [general.id, onCard.id].sort());
      assert.deepEqual(await get("?accountIdentifier=SimplyGo&entrySource=assistant"), [general.id, onTransit.id].sort());
      assert.deepEqual(await get("?description=KOPITIAM%20SIMEI"), [general.id, kopitiam.id].sort());
      assert.equal((await fetch(`${base}/instructions?transactionId=nope`, { headers: reader })).status, 404);

      // Writes need instructions:write; a token's instruction is the assistant's.
      const body = JSON.stringify({ text: "Shared dinners at Jumbo are half Madeline's", scope: { type: "merchant", pattern: "JUMBO" } });
      assert.equal((await fetch(`${base}/instructions`, { method: "POST", body, headers: reader })).status, 403);
      const created = await fetch(`${base}/instructions`, { method: "POST", body, headers: writer });
      assert.equal(created.status, 201);
      const made = ((await created.json()) as any).instruction;
      assert.equal(made.author, "assistant");
      assert.equal(made.scope.type, "merchant");
      const edited = await fetch(`${base}/instructions/${made.id}`, {
        method: "PATCH",
        body: JSON.stringify({ kind: "one_off", endsOn: "2026-12-31", enabled: false }),
        headers: writer,
      });
      assert.equal(edited.status, 200);
      const after = ((await edited.json()) as any).instruction;
      assert.deepEqual([after.kind, after.endsOn, after.enabled, after.active, after.author], ["one_off", "2026-12-31", false, false, "assistant"]);
      const bad = await fetch(`${base}/instructions/${made.id}`, { method: "PATCH", body: JSON.stringify({ kind: "lasting", endsOn: "2026-12-31" }), headers: writer });
      assert.equal(bad.status, 400);
      const otherWriter = await token(db, other.id, "instr-other", ["instructions:write"]);
      assert.equal((await fetch(`${base}/instructions/${made.id}`, { method: "PATCH", body: "{}", headers: otherWriter })).status, 404);
      assert.equal(await db.agentAuditEvent.count({ where: { userId: user.id, targetType: "classification_instruction" } }), 9);

      // The review queue and an entry's own reads come with what applies to each entry.
      const queue = (await (await fetch(`${base}/transactions/review?status=all`, { headers: classifier })).json()) as any;
      const byId = Object.fromEntries(queue.transactions.map((t: any) => [t.id, t.instructionIds.sort()]));
      assert.deepEqual(byId[ride.id], [general.id, onTransit.id, onStatements.id].sort());
      assert.deepEqual(byId[lunch.id], [general.id, onCard.id, kopitiam.id].sort());
      assert.deepEqual(
        queue.instructions.map((i: any) => i.id).sort(),
        [general.id, onTransit.id, onCard.id, onStatements.id, kopitiam.id].sort(),
      );
      assert.ok(!queue.instructions.some((i: any) => [ended.id, off.id].includes(i.id)));
      const one = (await (await fetch(`${base}/transactions/${lunch.id}`, { headers: writer })).json()) as any;
      assert.deepEqual(one.transaction.instructionIds.sort(), [general.id, onCard.id, kopitiam.id].sort());
      assert.equal(one.instructions.length, 3);

      // The guide finance-mcp serves is the chat's, with the mcp tool names.
      const guide = (await (await fetch(`${base}/classification-guide`, { headers: classifier })).json()) as any;
      assert.deepEqual(guide, JSON.parse(JSON.stringify(classificationGuide("mcp"))));
      const chatGuide = await executeInstructionTool(db, { userId: user.id, runId: "run" }, "get_classification_guide", {});
      assert.deepEqual(Object.keys(chatGuide.model as object), Object.keys(guide));
    } finally {
      server.close();
    }
  }));
