import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { withChatDb } from "../test-harness";
import { withDatabase } from "../../../lib/database-context";
import { createToolRegistry } from "./registry";
import { sealCredential } from "../credentials";
import { HermesWorkflowService } from "../../imports/hermes-workflow.service";
import { paylahEmailGuide } from "../../imports/paylah-emails";
import { planRestage } from "../../imports/restage";
import { compareFigures, draftFigures, printedFigures } from "./statement-totals";

type Db = Parameters<Parameters<typeof withChatDb>[0]>[0];

async function setup(db: Db, name: string) {
  const user = await db.user.create({ data: { username: name } });
  const conversation = await db.chatConversation.create({ data: { userId: user.id } });
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
  return { user, context: { userId: user.id, conversationId: conversation.id, runId: run.id } };
}

async function withFetch(
  fake: (url: string, options: any) => Response | Promise<Response>,
  work: () => Promise<void>,
) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, options: any) => fake(String(url), options)) as typeof fetch;
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  process.env.INTERNAL_SERVICE_TOKEN = "test-token";
  try {
    await work();
  } finally {
    globalThis.fetch = realFetch;
    if (token === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
    else process.env.INTERNAL_SERVICE_TOKEN = token;
  }
}
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** No parser version to compare against; the parser service is mocked per test where it matters. */
const noParsers = (url: string) =>
  /\/parsers/.test(url) ? jsonResponse({ parsers: [] }) : jsonResponse({ error: "unexpected" }, 500);

async function statementFile(db: Db, userId: string, name: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "chat-draft-"));
  const storagePath = path.join(dir, name);
  await writeFile(storagePath, "%PDF-1.4");
  return db.statementFile.create({
    data: {
      id: `upload_${name.replace(/\W/g, "")}_${Math.random().toString(36).slice(2, 8)}`,
      userId,
      filename: name,
      contentType: "application/pdf",
      storagePath,
      sha256: `${name}-${Math.random()}`,
      sizeBytes: 8,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
}

/** A DBS-like statement of `count` rows with a running balance, some labelled, ten PayLah top-ups. */
function statementRows(count: number, categoryId: string) {
  let balance = 5000;
  return Array.from({ length: count }, (_, i) => {
    const credit = i % 10 === 9;
    const amount = 3 + (i % 17) * 1.25;
    balance = Math.round((balance + (credit ? amount : -amount)) * 100) / 100;
    const paylah = i % 13 === 0;
    const day = String(1 + (i % 28)).padStart(2, "0");
    return {
      date: `2026-09-${day}`,
      description: paylah
        ? `Advice Funds Transfer TOP-UP TO PAYLAH! : JOHAN ${i}`
        : credit
          ? `Incoming PayNow Ref ${100000 + i} FROM SOMEONE ${i}`
          : `Debit Card Transaction MERCHANT NUMBER ${i} SINGAPORE SGP`,
      ...(credit ? { amountIn: amount } : { amountOut: amount }),
      balance: i === 40 ? balance + 1 : balance,
      currency: "SGD",
      accountIdentifier: "DBS 123-45678-9",
      ...(i % 3 === 0 && !paylah ? { label: `Label ${i}`, categoryId } : {}),
      metadata: {
        sourceFilename: "DBS Sep 2026.pdf",
        parserId: "dbs_posb_consolidated",
        accountIdentifier: "DBS 123-45678-9",
        statementLine: `Line ${i} of the statement with some extra text the parser keeps`,
      },
    };
  });
}

async function draftWithRows(
  db: Db,
  userId: string,
  rows: Array<Record<string, unknown>>,
  extra: { sourceFileId?: string; parserId?: string; parserVersion?: string } = {},
) {
  return db.importDraft.create({
    data: {
      userId,
      mode: "main",
      parserId: extra.parserId ?? "dbs_posb_consolidated",
      parserVersion: extra.parserVersion ?? "builtin-old",
      sourceFilename: "DBS Sep 2026.pdf",
      sourceSha256: `sha-${Math.random()}`,
      sourceFileId: extra.sourceFileId,
      status: "review",
      expiresAt: new Date(Date.now() + 7 * 86400000),
      rows: {
        create: rows.map((payload, rowIndex) => ({
          rowIndex,
          parsedPayload: payload as never,
          currentPayload: payload as never,
          reviewStatus: "unresolved",
        })),
      },
    },
    include: { rows: { orderBy: { rowIndex: "asc" } } },
  });
}

test("inspect_staged_import returns a small summary by default and filtered row pages on request", (t) =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, context } = await setup(db, "inspect-summary");
      const category = await db.category.create({ data: { userId: user.id, name: "Food" } });
      const draft = await draftWithRows(db, user.id, statementRows(130, category.id));
      const tools = createToolRegistry(db);
      const inspect = async (input: Record<string, unknown>) =>
        (await tools.execute(context, "inspect_staged_import", { draftId: draft.id, ...input }))
          .model as any;
      await withFetch(noParsers, async () => {
        const whole = JSON.stringify(await HermesWorkflowService.getDraft(user.id, draft.id)).length;
        const summary = await inspect({});
        const size = JSON.stringify(summary).length;
        t.diagnostic(`130-row draft: whole draft ${whole} bytes, default inspect ${size} bytes`);
        assert.ok(size < 15000, `summary is ${size} bytes`);
        assert.ok(whole > size * 5);
        assert.equal(summary.counts.rows, 130);
        assert.equal(summary.counts.credits, 13);
        assert.equal(summary.parserId, "dbs_posb_consolidated");
        assert.equal(summary.parserVersion, "builtin-old");
        assert.equal(summary.version, draft.version);
        assert.ok(summary.counts.unlabelled > 0 && summary.counts.unlabelled < 130);
        assert.equal(summary.counts.byReviewStatus.unresolved, 130);
        assert.deepEqual(summary.period, { from: "2026-09-01", to: "2026-09-28" });
        assert.equal(summary.totals.length, 1);
        assert.equal(summary.amountIssueCount, 2, "the wrong balance breaks two steps");
        assert.equal(summary.amountIssues[0].rowIndex, 40);
        assert.equal(summary.paylah.unmatchedTopUps, 10);
        assert.equal(summary.paylah.gmailConnected, false);
        assert.match(summary.paylahHint, /Gmail isn't connected/);
        assert.equal(summary.rowsNeedingReview.total, 130);
        assert.equal(summary.rowsNeedingReview.first.length, 15);
        assert.ok(summary.rowsNeedingReview.first.every((r: any) => r.id && r.version === 1));
        assert.equal(summary.rows, undefined, "no full rows");

        const unlabelled = await inspect({ unlabelled: true, limit: 100 });
        assert.equal(unlabelled.total, summary.counts.unlabelled);
        assert.equal(unlabelled.rows.length, Math.min(100, unlabelled.total));
        assert.ok(unlabelled.rows.every((r: any) => !r.label || !r.categoryId));
        assert.ok(unlabelled.rows.every((r: any) => r.id && r.version && r.rowIndex !== undefined));
        assert.ok(JSON.stringify(unlabelled).length < 40000);

        const page = await inspect({ limit: 50 });
        assert.equal(page.total, 130);
        assert.equal(page.nextOffset, 50);
        const last = await inspect({ offset: 100, limit: 50 });
        assert.equal(last.rows.length, 30);
        assert.equal(last.nextOffset, null);

        const credits = await inspect({ direction: "in" });
        assert.equal(credits.total, 13);
        assert.ok(credits.rows.every((r: any) => Number(r.amountIn) > 0 && !r.amountOut));

        const days = await inspect({ dateFrom: "2026-09-03", dateTo: "2026-09-04" });
        assert.ok(days.total > 0);
        assert.ok(days.rows.every((r: any) => ["2026-09-03", "2026-09-04"].includes(r.date)));

        const paylah = await inspect({ search: "top-up to paylah", fields: ["description", "metadata"] });
        assert.equal(paylah.total, 10);
        assert.equal(paylah.rows[0].amountOut, undefined, "only the fields asked for");
        assert.equal(paylah.rows[0].metadata.parserId, "dbs_posb_consolidated");

        const picked = await inspect({
          rowIds: [draft.rows[3].id, draft.rows[4].id, "not_a_row"],
          fields: ["payload", "status"],
        });
        assert.deepEqual(
          picked.rows.map((r: any) => r.id),
          [draft.rows[3].id, draft.rows[4].id],
        );
        assert.deepEqual(picked.notInDraft, ["not_a_row"]);
        assert.equal(picked.rows[0].payload.description, draft.rows[3].currentPayload!["description" as never]);
        assert.equal(picked.rows[0].reviewStatus, "unresolved");

        const review = await inspect({ needsReview: true, limit: 5 });
        assert.equal(review.total, 130);
        assert.ok(review.rows[0].review.reasons.length > 0);

        await assert.rejects(inspect({ limit: 101 }), /100/);

        // Edits still work from a filtered page's versions.
        const row = unlabelled.rows[0];
        const saved = (
          await tools.execute(context, "update_staged_rows", {
            draftId: draft.id,
            rows: [{ rowId: row.id, version: row.version, label: "Coffee", categoryId: category.id }],
          })
        ).model as any;
        assert.equal(saved.updated.length, 1);

        // With Gmail connected the summary names the tool and the statement period.
        process.env.CHAT_ENCRYPTION_KEY_V1 = Buffer.alloc(32, 3).toString("base64");
        await db.mailConnection.create({
          data: {
            userId: user.id,
            address: "someone@gmail.com",
            secret: sealCredential(user.id, "abcdefghijklmnop", "gmail-imap") as any,
          },
        });
        const connected = await inspect({});
        assert.equal(connected.paylah.gmailConnected, true);
        assert.match(connected.paylahHint, /search_paylah_emails with from 2026-09-01 and to 2026-09-28/);
      });
    }),
  ));

test("update_staged_rows takes a whole statement in one call and says to batch beyond its limit", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, context } = await setup(db, "bulk-edit");
      const category = await db.category.create({ data: { userId: user.id, name: "Food" } });
      const draft = await draftWithRows(db, user.id, statementRows(150, category.id));
      const tools = createToolRegistry(db);
      const result = (
        await tools.execute(context, "update_staged_rows", {
          draftId: draft.id,
          rows: draft.rows.map((row) => ({ rowId: row.id, version: row.version, label: "Bulk" })),
        })
      ).model as any;
      assert.equal(result.updated.length, 150);
      assert.equal(result.failed.length, 0);
      await assert.rejects(
        tools.execute(context, "update_staged_rows", {
          draftId: draft.id,
          rows: Array.from({ length: 501 }, (_, i) => ({ rowId: `row_${i}`, version: 1 })),
        }),
        /At most 500 rows per call; send the rest in another call/,
      );
    }),
  ));

test("find_transactions gives the total and where the next page starts", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, context } = await setup(db, "find-pages");
      await db.transaction.createMany({
        data: Array.from({ length: 120 }, (_, i) => ({
          userId: user.id,
          date: new Date(Date.UTC(2026, 8, 1 + (i % 28))),
          description: `Coffee ${i}`,
          amountOut: 4,
        })),
      });
      const tools = createToolRegistry(db);
      const range = { dateFrom: "2026-09-01T00:00:00+08:00", dateTo: "2026-10-01T00:00:00+08:00" };
      const first = (await tools.execute(context, "find_transactions", { ...range, limit: 100 })).model as any;
      assert.equal(first.total, 120);
      assert.equal(first.rows.length, 100);
      assert.equal(first.nextOffset, 100);
      const second = (
        await tools.execute(context, "find_transactions", { ...range, limit: 100, offset: 100 })
      ).model as any;
      assert.equal(second.rows.length, 20);
      assert.equal(second.nextOffset, null);
      const definition = tools.definitions.find((d) => d.name === "find_transactions")!;
      assert.match(definition.description, /at most 100 per call/);
    }),
  ));

test("inspect_statement reads the pages asked for", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, context } = await setup(db, "statement-pages");
      const file = await statementFile(db, user.id, "long.pdf");
      const attachment = await db.chatAttachment.create({
        data: { userId: user.id, conversationId: context.conversationId, statementFileId: file.id },
      });
      const tools = createToolRegistry(db);
      const seen: Array<[string | null, string | null]> = [];
      await withFetch(
        (url, options) => {
          assert.match(url, /\/candidate\/inspect$/);
          const form = options.body as FormData;
          seen.push([form.get("startPage") as string | null, form.get("endPage") as string | null]);
          return jsonResponse({ fixture: { pages: [{ page: 13, text: "Page 13" }], nextPage: null } });
        },
        async () => {
          await tools.execute(context, "inspect_statement", {
            attachmentId: attachment.id,
            startPage: 13,
            endPage: 14,
          });
          await tools.execute(context, "inspect_statement", { attachmentId: attachment.id, fromPage: 5 });
          await assert.rejects(
            tools.execute(context, "inspect_statement", {
              attachmentId: attachment.id,
              startPage: 4,
              endPage: 2,
            }),
            /endPage must not be before startPage/,
          );
        },
      );
      assert.deepEqual(seen, [
        ["13", "14"],
        ["5", null],
      ]);
    }),
  ));

test("find_similar_transactions finds past labels for several merchants in one call", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, context } = await setup(db, "similar");
      const food = await db.category.create({ data: { userId: user.id, name: "Food" } });
      const transport = await db.category.create({ data: { userId: user.id, name: "Transport" } });
      const day = (d: number) => new Date(Date.UTC(2026, 7, d));
      await db.transaction.createMany({
        data: [
          ...[1, 2, 3].map((d) => ({
            userId: user.id,
            date: day(d),
            description: "THE JUICE MAN MAN",
            label: "Juice",
            categoryId: food.id,
            amountOut: 4.5,
          })),
          { userId: user.id, date: day(4), description: "JUICE BAR TAMPINES", label: "Juice", categoryId: food.id, amountOut: 6 },
          { userId: user.id, date: day(5), description: "GRAB SINGAPORE", label: "Grab ride", categoryId: transport.id, amountOut: 12 },
          { userId: user.id, date: day(6), description: "THE CAFE", label: "Cafe", categoryId: food.id, amountOut: 5 },
        ],
      });
      const tools = createToolRegistry(db);
      const { results } = (
        await tools.execute(context, "find_similar_transactions", {
          descriptions: ["THE JUICE MAN MAN SINGAPORE", "Grab* ride 1234567", "nothing like it"],
          direction: "out",
        })
      ).model as any;
      assert.equal(results.length, 3);
      assert.equal(results[0].matches[0].description, "THE JUICE MAN MAN");
      assert.ok(results[0].matches.every((m: any) => m.description !== "THE CAFE"), "'the' says nothing");
      assert.deepEqual(results[0].commonLabels[0], {
        label: "Juice",
        categoryId: food.id,
        count: 4,
        category: "Food",
      });
      assert.equal(results[0].matches[3].description, "JUICE BAR TAMPINES", "half the words: last");
      assert.equal(results[1].matches[0].label, "Grab ride");
      assert.equal(results[1].matches[0].category, "Transport");
      assert.equal(results[2].matchCount, 0);
    }),
  ));

test("get_reimbursement_candidates lists saved and staged expenses an incoming payment could repay", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, context } = await setup(db, "reimbursement-candidates");
      const dinner = await db.transaction.create({
        data: { userId: user.id, date: new Date("2026-09-10T12:00:00Z"), description: "DINNER PLACE", amountOut: 60 },
      });
      const draft = await draftWithRows(db, user.id, [
        {
          date: "2026-09-12",
          description: "Advice Funds Transfer MAXED OUT FROM PAYLAH! : MADELINE",
          amountIn: 30,
          currency: "SGD",
          linkage: { type: "reimbursement", reimbursesAllocations: [] },
        },
        { date: "2026-09-11", description: "TAXI", amountOut: 18, currency: "SGD" },
      ]);
      const tools = createToolRegistry(db);
      const result = (
        await tools.execute(context, "get_reimbursement_candidates", { draftRowId: draft.rows[0].id })
      ).model as any;
      assert.equal(result.lookingFor, "expense");
      assert.equal(result.subject.roleProblem, null);
      assert.equal(result.saved.total, 1);
      assert.equal(result.saved.items[0].transactionId, dinner.id);
      assert.equal(result.saved.items[0].available, 60);
      assert.equal(result.saved.items[0].date, "2026-09-10");
      assert.equal(result.staged.items[0].stagedRowId, draft.rows[1].id);
      assert.equal(result.staged.items[0].stagedDraftId, draft.id);
      const narrowed = (
        await tools.execute(context, "get_reimbursement_candidates", {
          draftRowId: draft.rows[0].id,
          amountEquals: 18,
        })
      ).model as any;
      assert.equal(narrowed.saved.total, 0);
      assert.equal(narrowed.staged.total, 1);
      await assert.rejects(
        tools.execute(context, "get_reimbursement_candidates", {}),
        /Pass draftRowId or transactionId/,
      );
    }),
  ));

test("restage_draft re-parses with the current parser and keeps labels, metadata and links on matching rows", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      process.env.COMMIT_TOKEN_SECRET = "chat-test-commit-token-secret-at-least-32-characters";
      const { user, context } = await setup(db, "restage");
      const food = await db.category.create({ data: { userId: user.id, name: "Food" } });
      const file = await statementFile(db, user.id, "dbs.pdf");
      const row = (date: string, description: string, amounts: Record<string, number>) => ({
        date,
        description,
        currency: "SGD",
        accountIdentifier: "DBS 1",
        ...amounts,
      });
      const oldRows = [
        row("2026-09-01", "Advice Funds Transfer TOP-UP TO PAYLAH! : JOHAN", { amountOut: 4.5 }),
        row("2026-09-02", "GRAB SINGAPORE", { amountOut: 12 }),
        row("2026-09-03", "Advice Funds Transfer MAXED OUT FROM PAYLAH! : MADELINE", { amountIn: 30 }),
        row("2026-09-04", "GHOST ROW THE OLD PARSER MADE UP", { amountOut: 1 }),
      ].map((p, i) => (i === 3 ? { ...p, metadata: { parseWarning: "Check this row" } } : p));
      const draft = await draftWithRows(db, user.id, oldRows, {
        sourceFileId: file.id,
        parserVersion: "builtin-old",
      });
      const ids = draft.rows.map((r) => r.id);
      // Work done on the draft: a PayLah payment named from its email, a label, a reimbursement link.
      await db.importDraftRow.update({
        where: { id: ids[0] },
        data: {
          reviewStatus: "edited",
          version: 3,
          currentPayload: {
            ...oldRows[0],
            description: "THE JUICE MAN MAN",
            label: "Juice",
            categoryId: food.id,
            metadata: { paymentChannel: "PayLah", emailTransactionRef: "PLPE1" },
          },
        },
      });
      await db.importDraftRow.update({
        where: { id: ids[2] },
        data: {
          currentPayload: { ...oldRows[2], label: "Madeline paid back", linkage: { type: "reimbursement" } },
        },
      });
      const dinner = await db.transaction.create({
        data: { userId: user.id, date: new Date("2026-08-30T12:00:00Z"), description: "DINNER", amountOut: 60 },
      });
      await db.reimbursementLink.create({
        data: { userId: user.id, amount: 30, reimbursementDraftRowId: ids[2], expenseTransactionId: dinner.id },
      });
      await db.reimbursementLink.create({
        data: { userId: user.id, amount: 1, reimbursementDraftRowId: ids[2], expenseDraftRowId: ids[3] },
      });
      const added = await HermesWorkflowService.addDraftRows(
        user.id,
        draft.id,
        {
          expectedVersion: draft.version,
          reason: "Statement shows a cashback the parser skipped",
          rows: [{ ...row("2026-09-20", "CASHBACK", { amountIn: 5 }), metadata: {} } as never],
        },
        { actorType: "system", actorId: "fortuna-chat" },
      );
      // The fixed parser: drops the ghost row, finds a missed fee, keeps the rest.
      const newRows = [
        row("2026-09-01", "Advice Funds Transfer TOP-UP TO PAYLAH! : JOHAN", { amountOut: 4.5 }),
        row("2026-09-02", "GRAB SINGAPORE", { amountOut: 12 }),
        row("2026-09-02", "CARD FEE", { amountOut: 2 }),
        row("2026-09-03", "Advice Funds Transfer MAXED OUT FROM PAYLAH! : MADELINE", { amountIn: 30 }),
      ];
      let parses = 0;
      const tools = createToolRegistry(db);
      await withFetch(
        (url) => {
          if (/\/parse$/.test(url)) {
            parses += 1;
            return jsonResponse({ parserVersion: "builtin-new", transactions: newRows });
          }
          return jsonResponse({ parsers: [] });
        },
        async () => {
          const proposed = (await tools.execute(context, "restage_draft", { draftId: draft.id })).model as any;
          const preview = proposed.preview;
          assert.equal(preview.facts.rowsKept, 3);
          assert.equal(preview.facts.rowsAdded, 1);
          assert.equal(preview.facts.rowsRemoved, 1);
          assert.equal(preview.facts.rowsAddedByHandKept, 1);
          assert.equal(preview.facts.reimbursementLinksKept, 1);
          assert.equal(preview.facts.reimbursementLinksRemoved, 1);
          assert.match(preview.facts.parser, /builtin-old → builtin-new/);
          assert.match(preview.lists.map((l: any) => l.items.join()).join(), /CARD FEE/);
          assert.match(preview.lists.map((l: any) => l.items.join()).join(), /GHOST ROW/);
          assert.equal(await db.importDraftRow.count({ where: { draftId: draft.id } }), 5, "nothing written yet");

          const decision = await tools.approvals.decideAction(user.id, proposed.proposalId, "approve");
          assert.equal(decision.status, "applied");
          assert.equal(parses, 2, "the approval parses again and checks it matches the preview");
        },
      );
      const after = await db.importDraft.findUniqueOrThrow({
        where: { id: draft.id },
        include: { rows: { orderBy: { rowIndex: "asc" } } },
      });
      assert.equal(after.parserVersion, "builtin-new");
      const payload = (i: number) => after.rows[i].currentPayload as any;
      assert.deepEqual(
        after.rows.map((r) => [r.rowIndex, (r.currentPayload as any).description]),
        [
          [0, "THE JUICE MAN MAN"],
          [1, "GRAB SINGAPORE"],
          [2, "CARD FEE"],
          [3, "Advice Funds Transfer MAXED OUT FROM PAYLAH! : MADELINE"],
          [4, "CASHBACK"],
        ],
      );
      assert.equal(after.rows[0].id, ids[0], "matched rows keep their id");
      assert.equal(payload(0).label, "Juice");
      assert.equal(payload(0).categoryId, food.id);
      assert.equal(payload(0).metadata.emailTransactionRef, "PLPE1");
      assert.equal(after.rows[0].reviewStatus, "edited");
      assert.equal(after.rows[0].version, 4);
      assert.equal(after.rows[3].id, ids[2]);
      assert.equal(payload(3).linkage.type, "reimbursement");
      assert.equal(after.rows[4].id, added.rows[0].id, "a row added by hand stays");
      const links = await db.reimbursementLink.findMany({ where: { userId: user.id } });
      assert.equal(links.length, 1);
      assert.equal(links[0].reimbursementDraftRowId, ids[2]);
      assert.equal(links[0].expenseTransactionId, dinner.id);
      assert.equal(await db.importDraftRow.count({ where: { id: ids[3] } }), 0, "the ghost row is gone");
    }),
  ));

test("restage pairs rows by date, amounts and description, the parser's first", () => {
  const old = (id: string, parsed: object, current: object = parsed) => ({
    id,
    rowIndex: 0,
    version: 1,
    selected: true,
    reviewStatus: "unresolved",
    parsedPayload: parsed,
    currentPayload: current,
    provenance: null,
  });
  const a = { date: "2026-09-01", description: "Coffee", amountOut: 4 };
  const plan = planRestage(
    [
      old("1", a),
      old("2", a),
      old("3", { ...a, description: "Typo" }, { ...a, description: "Tea" }),
    ],
    [a, { ...a, description: "tea " }, { ...a, amountOut: 5 }],
  );
  assert.deepEqual(
    plan.matches.map((m) => [m.old.id, m.newIndex]),
    [
      ["1", 0],
      ["3", 1],
    ],
  );
  assert.deepEqual(plan.added, [2]);
  assert.deepEqual(plan.removed.map((r) => r.id), ["2"]);
});

test("discard_draft is an approval card and discards only after approval", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, context } = await setup(db, "discard");
      const file = await statementFile(db, user.id, "old.pdf");
      const draft = await draftWithRows(
        db,
        user.id,
        [{ date: "2026-09-01", description: "Coffee", amountOut: 4, label: "Coffee" }],
        { sourceFileId: file.id },
      );
      const tools = createToolRegistry(db);
      const proposed = await tools.execute(context, "discard_draft", { draftIds: [draft.id] });
      assert.equal(proposed.blocks[0].type, "link");
      const model = proposed.model as any;
      assert.equal(model.preview.title, "Discard DBS Sep 2026.pdf");
      assert.match(model.preview.lists[0].items[0], /1 row, 1 labelled or edited; statement file deleted/);
      assert.equal((await db.importDraft.findUniqueOrThrow({ where: { id: draft.id } })).status, "review");
      const decision = await tools.approvals.decideAction(user.id, model.proposalId, "approve");
      assert.equal(decision.status, "applied");
      assert.equal((await db.importDraft.findUniqueOrThrow({ where: { id: draft.id } })).status, "discarded");
      assert.equal((await db.statementFile.findUniqueOrThrow({ where: { id: file.id } })).status, "deleted");
      await assert.rejects(
        tools.execute(context, "discard_draft", { draftIds: [draft.id] }),
        /already discarded/,
      );
    }),
  ));

test("statement figures are read from summary lines and compared with the draft", () => {
  const figures = printedFigures([
    {
      page: 1,
      text: [
        "Balance Brought Forward 1,000.00",
        "01 Sep Coffee 4.00 996.00",
        "Total Withdrawals 4.00",
        "Balance Carried Forward 996.00",
      ].join("\n"),
    },
  ]);
  assert.deepEqual(
    figures.map((f) => [f.kind, f.value]),
    [
      ["opening", "1000.00"],
      ["moneyOut", "4.00"],
      ["closing", "996.00"],
    ],
  );
  const groups = draftFigures([
    { date: "2026-09-01", description: "Coffee", amountOut: 4, balance: 996, accountIdentifier: "A", currency: "SGD" },
  ]);
  const checks = compareFigures(groups, figures);
  assert.ok(checks.every((c) => c.matches), JSON.stringify(checks));
  const missing = compareFigures(
    draftFigures([{ date: "2026-09-01", description: "Coffee", amountOut: 3, balance: 997 }]),
    figures,
  );
  const out = missing.find((c) => c.check === "money out")!;
  assert.equal(out.matches, false);
  assert.equal(out.difference, "-1.00");

  // A card statement: previous balance + charges - credits = new balance.
  const card = printedFigures([
    { page: 1, text: "PREVIOUS BALANCE 100.00\nTOTAL BALANCE FOR UOB ONE CARD 150.00" },
  ]);
  const net = compareFigures(draftFigures([{ amountOut: 70 }, { amountIn: 20 }]), card).find((c) =>
    c.check.startsWith("net change"),
  )!;
  assert.equal(net.matches, true);
});

test("check_statement_totals compares a staged import with its statement in one call", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, context } = await setup(db, "totals");
      const file = await statementFile(db, user.id, "dbs.pdf");
      const draft = await draftWithRows(
        db,
        user.id,
        [
          { date: "2026-09-01", description: "Coffee", amountOut: 4, balance: 996, accountIdentifier: "A", currency: "SGD" },
          { date: "2026-09-02", description: "Salary", amountIn: 100, balance: 1096, accountIdentifier: "A", currency: "SGD" },
        ],
        { sourceFileId: file.id },
      );
      const tools = createToolRegistry(db);
      await withFetch(
        () =>
          jsonResponse({
            fixture: {
              pages: [
                {
                  page: 1,
                  text: "Balance Brought Forward 1,000.00\nTotal Deposits 150.00\nBalance Carried Forward 1,146.00",
                },
              ],
              nextPage: null,
            },
          }),
        async () => {
          const result = (await tools.execute(context, "check_statement_totals", { draftId: draft.id }))
            .model as any;
          assert.equal(result.draft[0].count, 2);
          assert.equal(result.draft[0].openingBalance, "1000.00");
          assert.equal(result.draft[0].closingBalance, "1096.00");
          const byCheck = Object.fromEntries(result.checks.map((c: any) => [c.check, c]));
          assert.equal(byCheck["opening balance"].matches, true);
          assert.equal(byCheck["closing balance"].matches, false);
          assert.equal(byCheck["closing balance"].difference, "-50.00");
          assert.equal(byCheck["money in"].difference, "-50.00");
          assert.match(result.result, /2 of 3 figures differ/);
        },
      );
    }),
  ));

test("list_import_rules and test_import_rule show what a rule matches without changing anything", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, context } = await setup(db, "rules");
      const rule = await db.importRule.create({
        data: {
          userId: user.id,
          name: "Grab is transport",
          matchType: "description_contains",
          matchValue: "grab",
          setLabel: "Grab",
          sortOrder: -1,
        },
      });
      await draftWithRows(db, user.id, [
        { date: "2026-09-01", description: "GRAB SINGAPORE", amountOut: 12 },
        { date: "2026-09-02", description: "Coffee", amountOut: 4 },
      ]);
      await db.transaction.create({
        data: { userId: user.id, date: new Date(), description: "Grab ride", amountOut: 9 },
      });
      const tools = createToolRegistry(db);
      const list = (await tools.execute(context, "list_import_rules", {})).model as any;
      assert.equal(list.rules[0].id, rule.id);
      const tested = (await tools.execute(context, "test_import_rule", { ruleId: rule.id })).model as any;
      assert.equal(tested.staged.matched, 1);
      assert.equal(tested.staged.examples[0].description, "GRAB SINGAPORE");
      assert.equal(tested.saved.matched, 1);
      const draftRule = (
        await tools.execute(context, "test_import_rule", {
          rule: { matchType: "description_contains", matchValue: "coffee" },
        })
      ).model as any;
      assert.equal(draftRule.staged.matched, 1);
      assert.equal(draftRule.saved.matched, 0);
      assert.equal(await db.importRule.count({ where: { userId: user.id, name: { not: rule.name }, matchValue: "coffee" } }), 0);
      assert.ok(tools.isReadOnly("test_import_rule") && tools.isReadOnly("list_import_rules"));
    }),
  ));

test("every tool the chat's PayLah guide names is a chat tool", () =>
  withChatDb(async (db) => {
    const tools = createToolRegistry(db);
    const names = new Set(tools.definitions.map((d) => d.name));
    const guide = JSON.stringify(paylahEmailGuide("chat"));
    const named = [...guide.matchAll(/\b([a-z]+(?:_[a-z]+)+)\b/g)]
      .map((m) => m[1])
      .filter((word) => /^(get|find|search|update|request|propose|inspect|add|stage|suggest)_/.test(word));
    assert.ok(named.length >= 5, named.join());
    for (const name of named) assert.ok(names.has(name), `${name} is named in the guide but isn't a chat tool`);
    for (const name of ["restage_draft", "discard_draft", "check_statement_totals", "find_similar_transactions", "get_reimbursement_candidates"])
      assert.ok(names.has(name), name);
  }));
