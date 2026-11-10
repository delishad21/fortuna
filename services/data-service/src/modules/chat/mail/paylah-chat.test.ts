import { test } from "node:test";
import assert from "node:assert/strict";
import { withChatDb } from "../test-harness";
import { RunRepository } from "../run.repository";
import { executeRun } from "../runner";
import { ChatProvider, ProviderInput } from "../providers/provider";
import { createToolRegistry } from "../tools/registry";
import { sealCredential } from "../credentials";
import { MailConnectionService } from "./gmail";
import { alertHtml, paynowTransfer, scanAndPay } from "./alert-fixtures";
import { fakeImap } from "./fake-imap";
import { withDatabase } from "../../../lib/database-context";

const SENDER = "paylah.alert@dbs.com";

test("the chat names matched PayLah top-ups in a staged DBS draft from Gmail and leaves it uncommitted", () =>
  withChatDb(async (db) => {
    process.env.CHAT_ENCRYPTION_KEY_V1 = Buffer.alloc(32, 3).toString("base64");
    const user = await db.user.create({ data: { username: "paylah-chat" } });
    const conversation = await db.chatConversation.create({ data: { userId: user.id } });
    await db.chatConnection.create({
      data: { userId: user.id, provider: "openrouter", selected: true, status: "connected" },
    });
    await db.mailConnection.create({
      data: {
        userId: user.id,
        address: "someone@gmail.com",
        secret: sealCredential(user.id, "abcdefghijklmnop", "gmail-imap") as any,
      },
    });
    const imap = fakeImap([
      { uid: 1, from: SENDER, date: "2026-09-21T04:17:40Z", messageId: "<juice@amazonses.com>", html: scanAndPay },
      { uid: 2, from: SENDER, date: "2026-09-15T00:05:10Z", messageId: "<tax@amazonses.com>", html: paynowTransfer },
      {
        uid: 3,
        from: SENDER,
        date: "2026-09-21T09:00:00Z",
        messageId: "<other-day@amazonses.com>",
        html: alertHtml({ ref: "PLPE0000000000000033", kind: "your PayLah! Scan & Pay Transfer", when: "21 Sep 17:00 (SGT)", amount: "SGD8.00", to: "NO SUCH ROW" }),
      },
    ]);
    const tools = createToolRegistry(db, { mail: new MailConnectionService(db, imap.factory) });

    // The user's September DBS statement, already staged.
    const stagingRun = await db.chatRun.create({
      data: { userId: user.id, conversationId: conversation.id, idempotencyKey: "stage", provider: "openrouter", model: "test", status: "completed" },
    });
    const staged = await tools.execute(
      { userId: user.id, conversationId: conversation.id, runId: stagingRun.id },
      "stage_rows",
      {
        sourceName: "DBS consolidated Sep 2026",
        rows: [
          { date: "2026-09-21", description: "Advice Funds Transfer TOP-UP TO PAYLAH! : JOHAN", amountOut: 4.5 },
          { date: "2026-09-15", description: "Advice Funds Transfer TOP-UP TO PAYLAH! : 96310000", amountOut: 1250 },
          { date: "2026-09-10", description: "Advice Funds Transfer TOP-UP TO PAYLAH! : JOHAN", amountOut: 9.99 },
          { date: "2026-09-12", description: "GRAB SINGAPORE", amountOut: 10 },
        ],
      },
    );
    const draftId = (staged.model as { id: string }).id;

    await db.chatMessage.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        role: "user",
        blocks: [{ type: "text", text: "Match my PayLah emails to the September DBS draft" }],
      },
    });
    await db.chatRun.create({
      data: { userId: user.id, conversationId: conversation.id, idempotencyKey: "match", provider: "openrouter", model: "test" },
    });
    const run = (await new RunRepository(db).claimRun())!;

    let unmatched: string[] = [];
    // A scripted model that follows the guide: same SGT date and exact amount.
    const provider: ChatProvider = {
      testConnection: async () => ({ connected: true, modelAvailable: true, needsReconnect: false }),
      async *run(input: ProviderInput) {
        assert.ok(input.tools.some((t) => t.name === "search_paylah_emails"));
        const guide = (await input.executeTool("get_paylah_email_guide", {}, "c1")).model as any;
        assert.equal(guide.payments.tool, "update_staged_rows");
        const draft = (await input.executeTool("inspect_staged_import", { draftId }, "c2")).model as any;
        assert.match(draft.paylahHint, /3 PayLah payment row\(s\)/);
        const found = (await input.executeTool("search_paylah_emails", { from: "2026-09-01", to: "2026-09-30" }, "c3")).model as any;
        const free = draft.rows.filter((r: any) => /TOP-UP TO PAYLAH!/.test(r.currentPayload.description));
        const edits = [];
        for (const email of found.emails) {
          const row = free.find(
            (r: any) => String(r.currentPayload.date).slice(0, 10) === email.date && Number(r.currentPayload.amountOut).toFixed(2) === email.amount,
          );
          if (!row) continue;
          free.splice(free.indexOf(row), 1);
          edits.push({
            rowId: row.id,
            version: row.version,
            description: email.counterparty,
            metadata: {
              paymentChannel: "PayLah",
              emailTransactionRef: email.transactionRef,
              emailMessageId: email.messageId,
              emailDateTime: email.dateTime,
              emailKind: email.kind,
              reconciliation: "PayLah email 1-to-1 match",
            },
          });
        }
        const saved = (await input.executeTool("update_staged_rows", { draftId, rows: edits }, "c4")).model as any;
        assert.equal(saved.updated.length, 2);
        assert.equal(saved.committed, false);
        unmatched = free.map((r: any) => r.currentPayload.description);
        yield { type: "text_delta", text: `Named 2 PayLah payments. Unmatched: ${unmatched.join(", ")}` };
        yield { type: "completed" };
      },
    };
    await executeRun(db, run, provider, new AbortController().signal, tools);
    assert.equal((await db.chatRun.findUniqueOrThrow({ where: { id: run.id } })).status, "completed");

    const rows = await db.importDraftRow.findMany({ where: { draftId }, orderBy: { rowIndex: "asc" } });
    const payload = (i: number) => rows[i].currentPayload as any;
    assert.equal(payload(0).description, "THE JUICE MAN MAN");
    assert.deepEqual(
      { ...payload(0).metadata, fixedRuleId: undefined },
      {
        ...payload(0).metadata,
        fixedRuleId: undefined,
        paymentChannel: "PayLah",
        emailTransactionRef: "PLPE4626409400000001",
        emailMessageId: "<juice@amazonses.com>",
        emailDateTime: "2026-09-21 12:17 SGT",
        emailKind: "PayLah! Scan & Pay Transfer",
        reconciliation: "PayLah email 1-to-1 match",
      },
    );
    assert.equal(Number(payload(0).amountOut), 4.5, "amounts stay as the bank row has them");
    assert.equal(String(payload(0).date).slice(0, 10), "2026-09-21");
    assert.equal(payload(1).description, "TAX WEX PENXX ANDXXX (Mobile ending 1712)");
    assert.equal(payload(1).metadata.emailKind, "PayNow Transfer");
    assert.equal(payload(2).description, "Advice Funds Transfer TOP-UP TO PAYLAH! : JOHAN", "no email, left alone");
    assert.equal(payload(2).metadata?.emailTransactionRef, undefined);
    assert.deepEqual(unmatched, ["Advice Funds Transfer TOP-UP TO PAYLAH! : JOHAN"]);

    const draft = await db.importDraft.findUniqueOrThrow({ where: { id: draftId } });
    assert.notEqual(draft.status, "committed");
    assert.equal(await db.transaction.count({ where: { userId: user.id } }), 0, "nothing reaches the ledger");

    // What the model saw and what is stored for the run: parsed fields, no mail bodies.
    const stored = JSON.stringify(await db.chatToolInvocation.findMany({ where: { runId: run.id } }));
    assert.equal(stored.includes("Dear Sir"), false);
    assert.equal(stored.includes("<td"), false);
    assert.ok(imap.calls.some((c) => c.op === "mailboxOpen" && (c.args[1] as any).readOnly === true));
    delete process.env.CHAT_ENCRYPTION_KEY_V1;
  }));

test("the edit tool only changes description, label, category and metadata", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "paylah-edit" } });
    const conversation = await db.chatConversation.create({ data: { userId: user.id } });
    const run = await db.chatRun.create({
      data: { userId: user.id, conversationId: conversation.id, idempotencyKey: "edit", provider: "openrouter", model: "test", status: "running" },
    });
    const context = { userId: user.id, conversationId: conversation.id, runId: run.id };
    const tools = createToolRegistry(db);
    const staged = await tools.execute(context, "stage_rows", {
      sourceName: "DBS Sep",
      rows: [{ date: "2026-09-21", description: "TOP-UP TO PAYLAH! : JOHAN", amountOut: 4.5 }],
    });
    const draftId = (staged.model as { id: string }).id;
    const [row] = await db.importDraftRow.findMany({ where: { draftId } });
    for (const field of ["amountOut", "date", "accountIdentifier", "linkage"])
      await assert.rejects(
        tools.execute(context, "update_staged_rows", {
          draftId,
          rows: [{ rowId: row.id, version: row.version, [field]: null }],
        }),
        /Unrecognized key/,
      );
    const stale = await withDatabase(db, () =>
      tools.execute(context, "update_staged_rows", {
        draftId,
        rows: [{ rowId: row.id, version: row.version + 5, description: "X" }],
      }),
    );
    assert.match((stale.model as any).failed[0].error, /stale/);
    assert.equal(tools.isReadOnly("search_paylah_emails"), true);
    assert.equal(tools.isReadOnly("get_paylah_email_guide"), true);
    assert.equal(tools.isReadOnly("update_staged_rows"), false);
    const noMail = await tools.execute(context, "search_paylah_emails", { from: "2026-09-01", to: "2026-09-30" }).catch((e) => e);
    assert.match(String(noMail.message), /No mailbox is connected/);
  }));
