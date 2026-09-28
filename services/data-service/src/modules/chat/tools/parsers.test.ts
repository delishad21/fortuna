import { test } from "node:test";
import assert from "node:assert/strict";
import { withChatDb } from "../test-harness";
import { ParserFactoryService } from "../../imports/parser-factory.service";
import { withDatabase } from "../../../lib/database-context";
test("parser workspace cannot retain expired or another user’s statements", () =>
  withChatDb(async (db) =>
    withDatabase(db, async () => {
      const a = await db.user.create({ data: { username: "parser-a" } }),
        b = await db.user.create({ data: { username: "parser-b" } });
      const file = await db.statementFile.create({
        data: {
          userId: b.id,
          filename: "test.csv",
          contentType: "text/csv",
          sha256: "x",
          storagePath: "/no-real-file",
          sizeBytes: 1,
          expiresAt: new Date(0),
        },
      });
      await assert.rejects(
        ParserFactoryService.createWorkspace(a.id, [file.id]),
        /unavailable/,
      );
      await assert.rejects(
        ParserFactoryService.createWorkspace(b.id, [file.id]),
        /unavailable/,
      );
      assert.equal(
        (await db.statementFile.findUniqueOrThrow({ where: { id: file.id } }))
          .retained,
        false,
      );
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
