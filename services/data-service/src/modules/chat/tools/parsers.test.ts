import { test } from "node:test";
import assert from "node:assert/strict";
import { withChatDb } from "../test-harness";
import { ParserFactoryService } from "../../imports/parser-factory.service";
import { withDatabase } from "../../../lib/database-context";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createToolRegistry } from "./registry";
import { staleParserNote } from "../../imports/parser-versions";
import { parserServiceError } from "../../imports/parser-factory.service";

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
  };
  return { user, conversation, context };
}
async function attach(
  db: Db,
  userId: string,
  conversationId: string,
  filename: string,
  expiresAt = new Date(Date.now() + 86400000),
) {
  const dir = await mkdtemp(path.join(tmpdir(), "chat-parser-"));
  const storagePath = path.join(dir, filename);
  await writeFile(storagePath, "%PDF-1.4");
  const file = await db.statementFile.create({
    data: {
      id: `upload_${filename.replace(/\W/g, "")}`,
      userId,
      filename,
      contentType: "application/pdf",
      storagePath,
      sha256: filename,
      sizeBytes: 8,
      expiresAt,
    },
  });
  return db.chatAttachment.create({
    data: { userId, conversationId, statementFileId: file.id },
  });
}
async function withFetch(
  fake: (url: string, options: any) => Response | Promise<Response>,
  work: () => Promise<void>,
) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, options: any) =>
    fake(String(url), options)) as typeof fetch;
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
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
test("parser workspace refuses another user's or a deleted statement, and takes an old one", () =>
  withChatDb(async (db) =>
    withDatabase(db, async () => {
      const a = await db.user.create({ data: { username: "parser-a" } }),
        b = await db.user.create({ data: { username: "parser-b" } });
      const file = (data: Record<string, unknown>) =>
        db.statementFile.create({
          data: {
            userId: b.id,
            contentType: "text/csv",
            storagePath: "/no-real-file",
            sizeBytes: 1,
            ...data,
          } as any,
        });
      // Uploaded long ago, from before statements were kept: its old expiry means nothing.
      const old = await file({
        filename: "old.csv",
        sha256: "x",
        expiresAt: new Date(0),
        retained: false,
        createdAt: new Date("2026-01-01"),
      });
      const deleted = await file({
        filename: "gone.csv",
        sha256: "y",
        status: "deleted",
        deletedAt: new Date(),
      });
      await assert.rejects(
        ParserFactoryService.createWorkspace(a.id, [old.id]),
        /is not a statement file of this user/,
      );
      await assert.rejects(
        ParserFactoryService.createWorkspace(b.id, [deleted.id]),
        /gone\.csv \(.+\) was deleted from the Statements list by the user/,
      );
      const workspace = await ParserFactoryService.createWorkspace(b.id, [old.id]);
      assert.deepEqual(workspace.statementFileIds, [old.id]);
    }),
  ));
test("parser approval rejects a report for different source even if marked passed", () =>
  withChatDb(async (db) =>
    withDatabase(db, async () => {
      const user = await db.user.create({ data: { username: "parser-owner" } });
      const workspace = await db.parserWorkspace.create({
        data: {
          userId: user.id,
          statementFileIds: [],
          fixtureConsentAt: new Date(),
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      const candidate = await db.parserCandidate.create({
        data: {
          workspaceId: workspace.id,
          parserId: "custom_test",
          parserType: "python",
          sourceCode: "def parse(content, specification): return []",
          specification: {},
          status: "submitted",
          testReport: { passed: true, sourceSha256: "different" },
        },
      });
      await assert.rejects(
        ParserFactoryService.approve(user.id, workspace.id, candidate.id),
        /source/,
      );
      assert.equal(await db.dynamicParserVersion.count(), 0);
    }),
  ));

test("parser_step workspace takes attachment IDs and needs no approval, even for an old statement", () =>
  withChatDb(async (db) =>
    withDatabase(db, async () => {
      const { user, conversation, context } = await setup(db, "workspace-ids");
      const uob = await attach(db, user.id, conversation.id, "uob.pdf");
      // A statement from another conversation, uploaded weeks ago with a 7-day expiry.
      const other = await db.chatConversation.create({ data: { userId: user.id } });
      const old = await attach(
        db,
        user.id,
        other.id,
        "simplygo.pdf",
        new Date("2026-10-01T00:00:00Z"),
      );
      const tools = createToolRegistry(db);
      const result = (
        await tools.execute(context, "parser_step", {
          operation: "workspace",
          statementFileIds: [uob.id, old.statementFileId],
        })
      ).model as any;
      const workspace = await db.parserWorkspace.findUniqueOrThrow({
        where: { id: result.workspaceId },
      });
      assert.deepEqual(workspace.statementFileIds, [
        uob.statementFileId,
        old.statementFileId,
      ]);
      assert.match(result.message, /exactly these statements/);
      assert.equal(await db.chatActionProposal.count(), 0);
      // retain_fixture is no longer a proposal kind.
      await assert.rejects(
        tools.execute(context, "propose_action", {
          action: { kind: "retain_fixture", statementFileIds: [uob.id] },
        }),
      );
      assert.equal(await db.chatActionProposal.count(), 0);
      const definitions = JSON.stringify(tools.definitions);
      assert.doesNotMatch(definitions, /retain_fixture|re-upload|upload it again|expire after|expired on/);
    }),
  ));

test("parser_step workspace reuses only a workspace holding exactly the requested statements", () =>
  withChatDb(async (db) =>
    withDatabase(db, async () => {
      const { user, conversation, context } = await setup(db, "workspace-exact");
      const simplygo = await attach(db, user.id, conversation.id, "simplygo.pdf"),
        uob = await attach(db, user.id, conversation.id, "uob.pdf"),
        mari = await attach(db, user.id, conversation.id, "mari.pdf");
      const mixed = await db.parserWorkspace.create({
        data: {
          userId: user.id,
          statementFileIds: [
            mari.statementFileId,
            simplygo.statementFileId,
            uob.statementFileId,
          ],
          fixtureConsentAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      const tools = createToolRegistry(db);
      const workspace = async (ids: string[]) =>
        (
          await tools.execute(context, "parser_step", {
            operation: "workspace",
            statementFileIds: ids,
          })
        ).model as any;
      // A statement that only sits in a mixed workspace gets one of its own.
      const alone = await workspace([simplygo.statementFileId]);
      assert.notEqual(alone.workspaceId, mixed.id);
      const created = await db.parserWorkspace.findUniqueOrThrow({
        where: { id: alone.workspaceId },
      });
      assert.deepEqual(created.statementFileIds, [simplygo.statementFileId]);
      assert.ok(created.fixtureConsentAt);
      assert.ok(created.expiresAt > new Date());
      // Asking again reuses it, and the same set in another order reuses the mixed one.
      assert.equal((await workspace([simplygo.id])).workspaceId, alone.workspaceId);
      assert.equal(
        (
          await workspace([
            uob.statementFileId,
            mari.statementFileId,
            simplygo.statementFileId,
          ])
        ).workspaceId,
        mixed.id,
      );
      // An expired exact match is replaced by a new workspace.
      const expired = await db.parserWorkspace.create({
        data: {
          userId: user.id,
          statementFileIds: [uob.statementFileId],
          fixtureConsentAt: new Date(),
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      const renewed = await workspace([uob.statementFileId]);
      assert.notEqual(renewed.workspaceId, expired.id);
      assert.deepEqual(
        (
          await db.parserWorkspace.findUniqueOrThrow({
            where: { id: renewed.workspaceId },
          })
        ).statementFileIds,
        [uob.statementFileId],
      );
      assert.equal(await db.chatActionProposal.count(), 0);
    }),
  ));

test("statement ID errors say which ID is wrong and why", () =>
  withChatDb(async (db) =>
    withDatabase(db, async () => {
      const { user, conversation, context } = await setup(db, "workspace-errors");
      const other = await db.chatConversation.create({
        data: { userId: user.id },
      });
      const elsewhere = await attach(db, user.id, other.id, "elsewhere.pdf");
      const gone = await attach(db, user.id, conversation.id, "gone.pdf");
      await db.statementFile.update({
        where: { id: gone.statementFileId },
        data: { status: "deleted", deletedAt: new Date() },
      });
      const tools = createToolRegistry(db);
      const workspace = (ids: string[]) =>
        tools.execute(context, "parser_step", {
          operation: "workspace",
          statementFileIds: ids,
        });
      // An attachment of another conversation isn't mapped, but its statement file is named.
      await assert.rejects(
        workspace([elsewhere.id]),
        new RegExp(
          `not found: ${elsewhere.id} is a chat attachment ID, not a statement file; the attachment's statementFileId is ${elsewhere.statementFileId}`,
        ),
      );
      await assert.rejects(
        workspace([gone.id]),
        /gone\.pdf \(upload_gonepdf\) was deleted from the Statements list by the user/,
      );
      await assert.rejects(workspace(["nope123"]), /not found: nope123 is not a statement file/);
      assert.equal(await db.parserWorkspace.count(), 0);
    }),
  ));

test("parser_step inspect takes an attachment ID; save explains the candidate's fields", () =>
  withChatDb(async (db) =>
    withDatabase(db, async () => {
      const { user, conversation, context } = await setup(db, "parser-step");
      const pdf = await attach(db, user.id, conversation.id, "uob.pdf");
      const workspace = await ParserFactoryService.createWorkspace(user.id, [
        pdf.statementFileId,
      ]);
      const tools = createToolRegistry(db);
      await withFetch(
        () => jsonResponse({ fixture: { pages: [{ page: 1, text: "UOB" }] } }),
        async () => {
          const inspected = await tools.execute(context, "parser_step", {
            operation: "inspect",
            workspaceId: workspace.id,
            fileId: pdf.id,
          });
          assert.equal((inspected.model as any).fixture.pages[0].text, "UOB");
        },
      );
      await assert.rejects(
        tools.execute(context, "parser_step", {
          operation: "save",
          workspaceId: workspace.id,
          candidate: { name: "uob", code: "def parse(c, s): return []" },
        }),
        (error: Error) => {
          assert.match(
            error.message,
            /Unrecognized key\(s\) in object: 'name', 'code'/,
          );
          assert.match(
            error.message,
            /parserId .*parserType .*sourceCode .*specification/,
          );
          return true;
        },
      );
      await assert.rejects(
        tools.execute(context, "parser_step", {
          operation: "save",
          workspaceId: workspace.id,
          candidate: {
            parserId: "uob_custom_pdf",
            parserType: "python",
            specification: { source: "def parse(c, s): return []" },
          },
        }),
        /candidate\.sourceCode is required for a python parser.*Code never goes in specification/,
      );
      const definition = tools.definitions.find(
        (d: any) => d.name === "parser_step",
      ) as any;
      assert.deepEqual(
        Object.keys(definition.inputSchema.properties.candidate.properties),
        ["parserId", "parserType", "sourceCode", "specification"],
      );
    }),
  ));

test("a candidate that fails on a fixture reports the parser service's reason", () =>
  withChatDb(async (db) =>
    withDatabase(db, async () => {
      const { user, conversation, context } = await setup(db, "parser-test");
      const mari = await attach(db, user.id, conversation.id, "mari.pdf");
      const uob = await attach(db, user.id, conversation.id, "uob.pdf");
      const workspace = await ParserFactoryService.createWorkspace(user.id, [
        mari.statementFileId,
        uob.statementFileId,
      ]);
      const candidate = await db.parserCandidate.create({
        data: {
          workspaceId: workspace.id,
          parserId: "uob_custom_pdf",
          parserType: "python",
          sourceCode: "def parse(content, specification): return []",
          specification: {},
        },
      });
      const tools = createToolRegistry(db);
      let call = 0;
      await withFetch(
        () =>
          ++call === 1
            ? jsonResponse(
                {
                  error: "UOB statement date not found",
                  report: { passed: false },
                },
                400,
              )
            : jsonResponse({ report: { passed: true, transactionCount: 3 } }),
        async () => {
          const result = await tools.execute(context, "parser_step", {
            operation: "test",
            workspaceId: workspace.id,
            candidateId: candidate.id,
          });
          const report = (result.model as any).report;
          assert.equal(report.passed, false);
          assert.equal(report.fixtures[0].filename, "mari.pdf");
          assert.match(
            report.fixtures[0].errors[0],
            /raised an error on this fixture: UOB statement date not found\. Every statement in the workspace is tested/,
          );
          assert.equal(report.fixtures[1].passed, true);
        },
      );
      await withFetch(
        () =>
          new Response("<html>Internal Server Error</html>", { status: 500 }),
        async () => {
          await assert.rejects(
            ParserFactoryService.test(user.id, workspace.id, candidate.id),
            (error: any) =>
              error.status === 502 && /HTTP 500/.test(error.message),
          );
        },
      );
    }),
  ));

test("parser service errors are one short line without paths", () => {
  assert.equal(
    parserServiceError({
      error:
        'Traceback\n  File "/app/app/sandbox_harness.py", line 3\nValueError: bad',
    }),
    'Traceback File "<path>", line 3 ValueError: bad',
  );
  assert.equal(parserServiceError({ error: "x".repeat(900) }).length, 500);
  assert.equal(parserServiceError(null), "");
});

test("a draft staged by another parser version says to re-stage it", () => {
  assert.equal(
    staleParserNote("mari_credit_card_pdf", "builtin-abc", "builtin-abc"),
    null,
  );
  assert.equal(
    staleParserNote("mari_credit_card_pdf", "dynamic-v2", undefined),
    null,
  );
  assert.match(
    staleParserNote("mari_credit_card_pdf", "dynamic-v2", "builtin-abc")!,
    /^Staged with an older version of mari_credit_card_pdf \(dynamic-v2; the current one is builtin-abc\); re-stage to use the current one\./,
  );
});

test("inspect_staged_import flags a draft staged by an older parser", () =>
  withChatDb(async (db) =>
    withDatabase(db, async () => {
      const { user, context } = await setup(db, "stale-draft");
      const draft = await db.importDraft.create({
        data: {
          userId: user.id,
          mode: "main",
          parserId: "mari_credit_card_pdf",
          parserVersion: "dynamic-v2",
          sourceFilename: "mari.pdf",
          sourceSha256: "mari",
          status: "review",
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      const tools = createToolRegistry(db);
      const inspect = () =>
        tools.execute(context, "inspect_staged_import", { draftId: draft.id });
      await withFetch(
        (url) => {
          assert.match(url, /\/parsers\?mode=all$/);
          return jsonResponse({
            parsers: [
              { id: "mari_credit_card_pdf", parserVersion: "builtin-abc" },
            ],
          });
        },
        async () => {
          assert.match(
            ((await inspect()).model as any).parserVersionNote,
            /older version of mari_credit_card_pdf/,
          );
          await db.importDraft.update({
            where: { id: draft.id },
            data: { parserVersion: "builtin-abc" },
          });
          assert.equal(
            ((await inspect()).model as any).parserVersionNote,
            undefined,
          );
        },
      );
    }),
  ));
