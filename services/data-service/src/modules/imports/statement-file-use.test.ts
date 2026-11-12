import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { withChatDb } from "../chat/test-harness";
import { withDatabase } from "../../lib/database-context";
import { HermesWorkflowService } from "./hermes-workflow.service";
import { StatementLibrary } from "./statement-library";

const actor = { actorType: "user" as const };
const DAY = 24 * 60 * 60 * 1000;
const folder = mkdtempSync(path.join(tmpdir(), "statement-file-use-"));

async function seed(db: PrismaClient) {
  process.env.COMMIT_TOKEN_SECRET = "statement-file-use-test-secret-at-least-32-characters";
  const user = await db.user.create({ data: { username: `files-${Date.now()}-${Math.random()}` } });
  await db.accountIdentifier.create({ data: { userId: user.id, accountIdentifier: "DBS" } });
  return user;
}

async function statementFile(
  db: PrismaClient,
  userId: string,
  name: string,
  extra: { expiresAt?: Date; retained?: boolean; createdAt?: Date } = {},
) {
  const storagePath = path.join(folder, `${name}-${Math.random()}`);
  writeFileSync(storagePath, "statement");
  return db.statementFile.create({
    data: {
      userId,
      filename: name,
      contentType: "application/pdf",
      storagePath,
      sha256: storagePath,
      sizeBytes: 9,
      ...extra,
    },
  });
}

function stageDraft(db: PrismaClient, userId: string, file: { id: string; filename: string }) {
  const payload = { date: "2026-11-01", accountIdentifier: "DBS", currency: "SGD", description: "Lunch", amountOut: 12 };
  return db.importDraft.create({
    data: {
      userId,
      mode: "main",
      sourceFilename: file.filename,
      sourceFileId: file.id,
      sourceSha256: file.id,
      status: "review",
      expiresAt: new Date("2099-01-01"),
      rows: {
        create: [{ rowIndex: 0, parsedPayload: payload, currentPayload: payload, reviewStatus: "accepted" }],
      },
    },
  });
}

async function commit(userId: string, draftId: string) {
  const selection = await HermesWorkflowService.prepareSelection(userId, [draftId], actor);
  assert.equal(selection.valid, true, JSON.stringify(selection.validations));
  await HermesWorkflowService.commitDrafts(
    userId,
    selection.validations.map(({ draftId, validation }) => ({
      draftId,
      confirmationToken: (validation as any).confirmationToken,
    })),
    true,
    actor,
  );
}

async function assertKept(db: PrismaClient, file: { id: string; storagePath: string }) {
  const stored = await db.statementFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.equal(stored.deletedAt, null);
  assert.equal(stored.status, "available");
  assert.ok(existsSync(file.storagePath));
}

async function assertDeleted(db: PrismaClient, file: { id: string; storagePath: string }) {
  const stored = await db.statementFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.ok(stored.deletedAt);
  assert.equal(stored.status, "deleted");
  assert.equal(existsSync(file.storagePath), false);
}

test("committing or discarding a draft keeps its statement file", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const user = await seed(db);
      const discarded = await statementFile(db, user.id, "discarded.pdf");
      await HermesWorkflowService.discardDraft(user.id, (await stageDraft(db, user.id, discarded)).id, actor);
      await assertKept(db, discarded);

      const committed = await statementFile(db, user.id, "committed.pdf");
      await commit(user.id, (await stageDraft(db, user.id, committed)).id);
      await assertKept(db, committed);
    }),
  ));

test("statement files never expire and the cleanup leaves them alone", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const user = await seed(db);
      // A file from before this change, with an expiry long past and nothing using it.
      const old = await statementFile(db, user.id, "old.pdf", {
        expiresAt: new Date(Date.now() - 30 * DAY),
        retained: false,
        createdAt: new Date(Date.now() - 40 * DAY),
      });
      const later = new Date(Date.now() + 8 * DAY);
      const cleaned = await HermesWorkflowService.cleanupExpiredData(later);
      assert.equal("deletedFiles" in cleaned, false);
      await assertKept(db, old);
      // It can still be staged, and its old expiry doesn't matter.
      const draft = await HermesWorkflowService.createDraft(user.id, { fileRef: old.id, mode: "main" }, actor);
      assert.equal(draft.sourceFileId, old.id);
    }),
  ));

test("uploading the same file again reuses the kept statement and gives it no expiry", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const user = await seed(db);
      const buffer = Buffer.from(`statement ${Math.random()}`);
      const kept = await db.statementFile.create({
        data: {
          userId: user.id,
          filename: "dbs.pdf",
          contentType: "application/pdf",
          storagePath: path.join(folder, "dbs-kept"),
          sha256: createHash("sha256").update(buffer).digest("hex"),
          sizeBytes: buffer.length,
          createdAt: new Date(Date.now() - 30 * DAY),
        },
      });
      assert.equal(kept.expiresAt, null);
      assert.equal(kept.retained, true);
      const again = await HermesWorkflowService.registerStatement(
        user.id,
        { originalname: "dbs (1).pdf", mimetype: "application/pdf", buffer, size: buffer.length },
        actor,
      );
      assert.equal(again.id, kept.id);
      assert.equal(again.duplicate, true);
      assert.equal((await db.statementFile.findUniqueOrThrow({ where: { id: kept.id } })).expiresAt, null);
    }),
  ));

test("a statement is deleted only by hand, and not while an open draft uses it", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const user = await seed(db);
      const other = await seed(db);
      const library = new StatementLibrary(db);
      const file = await statementFile(db, user.id, "dbs.pdf");
      const draft = await stageDraft(db, user.id, file);

      const [listed] = await library.list(user.id);
      assert.equal(listed.id, file.id);
      assert.equal(listed.inUse, true);
      assert.deepEqual(listed.imports.map((d) => [d.id, d.status, d.rows]), [[draft.id, "review", 1]]);

      await assert.rejects(library.remove(user.id, file.id), (error: any) => {
        assert.equal(error.status, 409);
        assert.match(error.message, /dbs\.pdf is still used by an open import/);
        return true;
      });
      await assertKept(db, file);
      await assert.rejects(library.remove(other.id, file.id), { status: 404 });

      await HermesWorkflowService.discardDraft(user.id, draft.id, actor);
      assert.equal((await library.list(user.id))[0].inUse, false);
      assert.deepEqual(await library.remove(user.id, file.id), { id: file.id, deleted: true });
      await assertDeleted(db, file);
      assert.deepEqual(await library.list(user.id), []);
      // The discarded import keeps its record.
      assert.equal((await db.importDraft.findUniqueOrThrow({ where: { id: draft.id } })).sourceFileId, file.id);
      await assert.rejects(library.remove(user.id, file.id), { status: 404 });
    }),
  ));
