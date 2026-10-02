import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { withChatDb } from "./test-harness";
import { withDatabase } from "../../lib/database-context";
import { TransactionService } from "../transactions/transactions.service";
import { createToolRegistry } from "./tools/registry";
import { findStagedDuplicates } from "../imports/staged-duplicates";
import { ReviewService } from "./reviews.service";
import { ComponentTools } from "./tools/components";
import { ReadTools } from "./tools/read";
import { MEMORY_LIMIT, MemoryService } from "./memories.service";
import { RunRepository } from "./run.repository";
import { executeRun } from "./runner";
import { ChatProvider, ProviderInput } from "./providers/provider";

type Db = Parameters<Parameters<typeof withChatDb>[0]>[0];
async function setup(db: Db, name: string) {
  const user = await db.user.create({ data: { username: name } });
  const conversation = await db.chatConversation.create({
    data: { userId: user.id },
  });
  const run = await db.chatRun.create({
    data: {
      userId: user.id,
      conversationId: conversation.id,
      idempotencyKey: name,
      provider: "openrouter",
      model: "test",
      status: "running",
    },
  });
  const context = {
    userId: user.id,
    conversationId: conversation.id,
    runId: run.id,
  } as any;
  return { user, conversation, run, context };
}
async function attach(
  db: Db,
  userId: string,
  conversationId: string,
  filename: string,
  contentType: string,
  bytes: Buffer,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "chat-doc-"));
  const storagePath = path.join(dir, filename);
  await writeFile(storagePath, bytes);
  const file = await db.statementFile.create({
    data: {
      userId,
      filename,
      contentType,
      storagePath,
      sha256: `${filename}-${bytes.length}`,
      sizeBytes: bytes.length,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  return db.chatAttachment.create({
    data: { userId, conversationId, statementFileId: file.id },
  });
}

const journey = (
  time: string,
  amount: number,
  route = "Bus 9 Blk 233 - Bedok Mkt Pl",
) => ({
  date: "2026-08-29",
  description: route,
  amountOut: amount,
  metadata: { time },
});

test("stage_rows stages extracted rows with rules, keeps identical journeys and dedupes re-staging", () =>
  withChatDb(async (db) => {
    const { user, conversation, context } = await setup(db, "stage-rows");
    const other = await db.user.create({ data: { username: "stage-other" } });
    const foreign = await db.category.create({
      data: { userId: other.id, name: "Theirs", color: "#000000" },
    });
    await db.accountIdentifier.create({
      data: {
        userId: user.id,
        accountIdentifier: "SimplyGo 4591",
        color: "#123456",
      },
    });
    await withDatabase(db, () =>
      TransactionService.createImportRule(user.id, {
        name: "School run",
        accountIdentifier: "SimplyGo 4591",
        matchType: "description_contains",
        matchValue: "Townsville",
        setLabel: "Partner commute",
      }),
    );
    const pdf = await attach(
      db,
      user.id,
      conversation.id,
      "simplygo.pdf",
      "application/pdf",
      Buffer.from("%PDF-1.4"),
    );
    const tools = createToolRegistry(db);
    const input = {
      attachmentId: pdf.id,
      sourceName: "SimplyGo Aug 2026",
      accountIdentifier: "SimplyGo 4591",
      rows: [
        journey("01:10 PM", 1.28),
        journey("01:10 PM", 1.28),
        journey("07:45 AM", 1.61, "Simei - Townsville Pr Sch"),
      ],
    };
    const staged = await tools.execute(context, "stage_rows", input);
    assert.deepEqual(
      staged.blocks.map((b: any) => [b.type, b.kind]),
      [["link", "draft"]],
    );
    const draft = await db.importDraft.findUniqueOrThrow({
      where: { id: (staged.model as any).id },
      include: { rows: { orderBy: { rowIndex: "asc" } } },
    });
    assert.equal(draft.status, "review");
    assert.equal(draft.parserId, "assistant_rows");
    assert.equal(draft.sourceFilename, "SimplyGo Aug 2026");
    assert.equal(draft.rows.length, 3);
    const payloads = draft.rows.map((r) => r.currentPayload as any);
    assert.equal(payloads[0].accountIdentifier, "SimplyGo 4591");
    assert.equal(payloads[0].currency, "SGD");
    assert.equal(payloads[2].label, "Partner commute");
    assert.equal(draft.rows[2].reviewStatus, "auto_applied");
    // Identical journeys from one source are two people, not a duplicate.
    const summaries = draft.rows.map((r) => {
      const p = r.currentPayload as any;
      return {
        draftId: draft.id,
        rowId: r.id,
        rowIndex: r.rowIndex,
        filename: draft.sourceFilename,
        date: String(p.date).slice(0, 10),
        description: p.description,
        amountIn: null,
        amountOut: p.amountOut,
        distinctWithinDraft: p.metadata.distinctWithinDraft === true,
      };
    });
    assert.equal(findStagedDuplicates(summaries).length, 0);
    assert.equal(
      findStagedDuplicates(
        summaries.map((s) => ({ ...s, distinctWithinDraft: false })),
      ).length,
      1,
    );
    const again = await tools.execute(context, "stage_rows", input);
    assert.equal((again.model as any).id, draft.id);
    assert.equal((again.model as any).duplicate, true);
    await assert.rejects(
      tools.execute(context, "stage_rows", {
        rows: [{ ...journey("x", 1), categoryId: foreign.id }],
      }),
      /category was not found/,
    );
    await assert.rejects(
      tools.execute(context, "stage_rows", {
        rows: [
          {
            date: "2026-08-29",
            description: "Both",
            amountIn: 1,
            amountOut: 1,
          },
        ],
      }),
      /exactly one of amountIn or amountOut/,
    );
  }));

test("read_attachment pages through documents and refuses images", () =>
  withChatDb(async (db) => {
    const { user, conversation, context } = await setup(db, "read-doc");
    process.env.INTERNAL_SERVICE_TOKEN = "chat-test-internal";
    const pdf = await attach(
      db,
      user.id,
      conversation.id,
      "long.pdf",
      "application/pdf",
      Buffer.from("%PDF-1.4 x"),
    );
    const png = await attach(
      db,
      user.id,
      conversation.id,
      "pay.png",
      "image/png",
      Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("x")]),
    );
    const realFetch = globalThis.fetch;
    let startPage: string | null = null;
    globalThis.fetch = (async (url: any, options: any) => {
      assert.match(String(url), /\/candidate\/inspect$/);
      startPage = (options.body as FormData).get("startPage") as string;
      return new Response(
        JSON.stringify({
          fixture: {
            filename: "long.pdf",
            sha256: "hidden",
            documentType: "pdf",
            pageCount: 15,
            pages: [{ page: 13, text: "Journey page 13" }],
            nextPage: null,
            truncated: false,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      const tools = createToolRegistry(db);
      const read = await tools.execute(context, "read_attachment", {
        attachmentId: pdf.id,
        fromPage: 13,
      });
      assert.equal(startPage, "13");
      assert.deepEqual(read.blocks, []);
      assert.equal((read.model as any).pages[0].text, "Journey page 13");
      assert.equal((read.model as any).sha256, undefined);
      assert.ok(tools.isReadOnly("read_attachment"));
      await assert.rejects(
        tools.execute(context, "read_attachment", { attachmentId: png.id }),
        /already visible/,
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  }));

test("review suggestions keep their reason and confidence", () =>
  withChatDb(async (db) => {
    const { user, context } = await setup(db, "review-reason");
    const t = await db.transaction.create({
      data: {
        userId: user.id,
        date: new Date("2026-08-29"),
        description: "Bus 9",
        amountOut: 1.28,
      },
    });
    const review = await new ReviewService(db).create(context, {
      title: "Whose rides",
      transactionIds: [t.id],
      suggestions: [
        {
          transactionId: t.id,
          patch: { label: "Partner" },
          reason: "Same bus, same minute as your ride",
          confidence: 0.55,
        },
      ],
    });
    assert.deepEqual(review.rows[0].suggestion, {
      reason: "Same bus, same minute as your ride",
      confidence: 0.55,
    });
    await assert.rejects(
      new ReviewService(db).create(context, {
        title: "Bad",
        transactionIds: [t.id],
        suggestions: [
          { transactionId: t.id, patch: { label: "x" }, confidence: 2 },
        ],
      }),
    );
  }));

test("comparison totals labelled series and tracks a running monthly difference", () =>
  withChatDb(async (db) => {
    const { user } = await setup(db, "comparison");
    await db.accountIdentifier.createMany({
      data: [
        { userId: user.id, accountIdentifier: "SimplyGo", color: "#111111" },
        { userId: user.id, accountIdentifier: "Card", color: "#222222" },
      ],
    });
    const base = { userId: user.id, currency: "SGD" };
    await db.transaction.createMany({
      data: [
        {
          ...base,
          date: new Date("2026-08-10"),
          description: "Journey",
          amountOut: 30,
          accountIdentifier: "SimplyGo",
        },
        {
          ...base,
          date: new Date("2026-09-03"),
          description: "Journey",
          amountOut: 20,
          accountIdentifier: "SimplyGo",
        },
        {
          ...base,
          date: new Date("2026-08-31"),
          description: "BUS/MRT",
          amountOut: 25,
          accountIdentifier: "Card",
          linkage: { type: "internal" },
        },
        {
          ...base,
          date: new Date("2026-09-07"),
          description: "BUS/MRT",
          amountOut: 24,
          accountIdentifier: "Card",
          linkage: { type: "internal" },
        },
      ],
    });
    const range = {
      dateFrom: "2026-08-01T00:00:00Z",
      dateTo: "2026-10-01T00:00:00Z",
    };
    const block = await new ComponentTools(db, new ReadTools(db)).show(
      user.id,
      {
        component: "comparison",
        title: "SimplyGo vs card",
        byMonth: true,
        series: [
          {
            label: "Journeys",
            filters: { ...range, accountIdentifier: "SimplyGo" },
          },
          {
            label: "Card charges",
            filters: {
              ...range,
              accountIdentifier: "Card",
              includeInternal: true,
            },
          },
        ],
      },
    );
    if (block.component !== "comparison") return assert.fail();
    assert.deepEqual(
      block.series.map((s) => s.label),
      ["Journeys", "Card charges"],
    );
    assert.deepEqual(block.currencies, [
      { currency: "SGD", totals: ["50.00", "49.00"], difference: "1.00" },
    ]);
    assert.deepEqual(
      block.months!.map((m) => [
        m.period,
        m.values,
        m.difference,
        m.cumulative,
      ]),
      [
        ["2026-08", ["30.00", "25.00"], "5.00", "5.00"],
        ["2026-09", ["20.00", "24.00"], "-4.00", "1.00"],
      ],
    );
    // Internal top-ups are excluded unless the series asks for them.
    const excluded = await new ComponentTools(db, new ReadTools(db)).show(
      user.id,
      {
        component: "comparison",
        title: "Without internal",
        series: [
          {
            label: "Journeys",
            filters: { ...range, accountIdentifier: "SimplyGo" },
          },
          { label: "Card", filters: { ...range, accountIdentifier: "Card" } },
        ],
      },
    );
    if (excluded.component !== "comparison") return assert.fail();
    assert.equal(excluded.currencies[0].totals[1], "0.00");
    await assert.rejects(
      new ComponentTools(db, new ReadTools(db)).show(user.id, {
        component: "comparison",
        title: "No series",
        filters: range,
      }),
    );
  }));

test("memories are owned, capped, editable and given to every run", () =>
  withChatDb(async (db) => {
    const { user, conversation, context } = await setup(db, "memory-owner");
    const other = await db.user.create({ data: { username: "memory-other" } });
    const tools = createToolRegistry(db);
    const saved = await tools.execute(context, "remember", {
      content: "Simei to Townsville Pr Sch journeys are my partner's",
    });
    assert.deepEqual(
      saved.blocks.map((b: any) => [b.type, b.action]),
      [["memory", "saved"]],
    );
    const id = (saved.model as any).saved.id;
    const service = new MemoryService(db);
    await service.save(user.id, {
      id,
      content: "Townsville journeys are hers",
    });
    assert.deepEqual(
      (await service.list(user.id)).map((n) => n.content),
      ["Townsville journeys are hers"],
    );
    await assert.rejects(
      service.save(other.id, { id, content: "hijack" }),
      /not found/,
    );
    await assert.rejects(service.remove(other.id, id), /not found/);
    await db.chatMemory.createMany({
      data: Array.from({ length: MEMORY_LIMIT - 1 }, (_, i) => ({
        userId: user.id,
        content: `note ${i}`,
      })),
    });
    await assert.rejects(
      service.save(user.id, { content: "one too many" }),
      /up to 100/,
    );
    await db.chatMemory.deleteMany({
      where: { userId: user.id, content: { startsWith: "note " } },
    });

    // A run sees the notes first, and image attachments still land on their own message.
    await db.chatConnection.create({
      data: {
        userId: user.id,
        provider: "openrouter",
        selected: true,
        status: "connected",
      },
    });
    const png = await attach(
      db,
      user.id,
      conversation.id,
      "pay.png",
      "image/png",
      Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("y")]),
    );
    await db.chatMessage.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        role: "user",
        blocks: [
          { type: "text", text: "Whose ride is this?" },
          {
            type: "attachment",
            id: png.id,
            filename: "pay.png",
            mediaType: "image",
          },
        ],
      },
    });
    await db.chatRun.update({
      where: { id: context.runId },
      data: { status: "queued" },
    });
    const run = (await new RunRepository(db).claimRun())!;
    let seen: ProviderInput["messages"] = [];
    const provider: ChatProvider = {
      testConnection: async () => ({
        connected: true,
        modelAvailable: true,
        needsReconnect: false,
      }),
      async *run(input: ProviderInput) {
        seen = input.messages;
        yield { type: "completed" };
      },
    };
    await executeRun(db, run, provider, new AbortController().signal);
    assert.equal(seen.length, 2);
    const notes = JSON.parse(seen[0].content);
    assert.equal(notes.type, "saved_notes");
    assert.deepEqual(notes.notes, [
      { id, content: "Townsville journeys are hers" },
    ]);
    assert.equal(seen[0].images, undefined);
    assert.equal(seen[1].images?.[0].attachmentId, png.id);

    const forgotten = await tools.execute(context, "forget", { id });
    assert.deepEqual(
      forgotten.blocks.map((b: any) => b.action),
      ["forgotten"],
    );
    assert.equal(await db.chatMemory.count({ where: { userId: user.id } }), 0);
  }));
