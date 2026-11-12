import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { withChatDb } from "../chat/test-harness";
import { withDatabase } from "../../lib/database-context";
import { HermesWorkflowService } from "./hermes-workflow.service";

const actor = { actorType: "user" as const };
const DAY = 24 * 60 * 60 * 1000;
const folder = mkdtempSync(path.join(tmpdir(), "statement-file-use-"));

async function seed(db: PrismaClient) {
  process.env.COMMIT_TOKEN_SECRET = "statement-file-use-test-secret-at-least-32-characters";
  const user = await db.user.create({ data: { username: `files-${Date.now()}-${Math.random()}` } });
  await db.accountIdentifier.create({ data: { userId: user.id, accountIdentifier: "DBS" } });
  return user;
}

async function statementFile(db: PrismaClient, userId: string, name: string) {
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
      expiresAt: new Date(Date.now() + 5 * DAY),
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

/** Attaches the file to a new chat, added daysAgo, optionally sent in a message now. */
async function attachToChat(
  db: PrismaClient,
  userId: string,
  fileId: string,
  options: { daysAgo: number; sentNow?: boolean },
) {
  const conversation = await db.chatConversation.create({ data: { userId } });
  const attachment = await db.chatAttachment.create({
    data: {
      userId,
      conversationId: conversation.id,
      statementFileId: fileId,
      createdAt: new Date(Date.now() - options.daysAgo * DAY),
    },
  });
  if (options.sentNow)
    await db.chatMessage.create({
      data: {
        userId,
        conversationId: conversation.id,
        role: "user",
        blocks: [
          { type: "text", text: "Import this" },
          { type: "attachment", id: attachment.id, filename: "-6.pdf", mediaType: "statement" },
        ],
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

async function assertKept(db: PrismaClient, file: { id: string; storagePath: string; expiresAt: Date }) {
  const stored = await db.statementFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.equal(stored.deletedAt, null);
  assert.equal(stored.status, "available");
  assert.equal(stored.expiresAt.getTime(), file.expiresAt.getTime(), "the kept file keeps its expiry");
  assert.ok(existsSync(file.storagePath));
}

async function assertDeleted(db: PrismaClient, file: { id: string; storagePath: string }) {
  const stored = await db.statementFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.ok(stored.deletedAt);
  assert.equal(stored.status, "deleted");
  assert.equal(existsSync(file.storagePath), false);
}

test("discarding a draft deletes its statement file when nothing else uses it", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const user = await seed(db);
      const file = await statementFile(db, user.id, "old.pdf");
      // A chat that used the file over a week ago no longer holds it.
      await attachToChat(db, user.id, file.id, { daysAgo: 8 });
      const draft = await stageDraft(db, user.id, file);
      await HermesWorkflowService.discardDraft(user.id, draft.id, actor);
      await assertDeleted(db, file);
    }),
  ));

test("discarding a draft keeps a statement file another open draft uses, until that one closes", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const user = await seed(db);
      const file = await statementFile(db, user.id, "dbs.pdf");
      const older = await stageDraft(db, user.id, file);
      const newer = await stageDraft(db, user.id, file);
      await HermesWorkflowService.discardDraft(user.id, older.id, actor);
      await assertKept(db, file);
      await HermesWorkflowService.discardDraft(user.id, newer.id, actor);
      await assertDeleted(db, file);
    }),
  ));

test("discarding an old draft keeps a statement file just sent to a chat", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const user = await seed(db);
      const file = await statementFile(db, user.id, "-6.pdf");
      // Attached two days ago, sent again in a message now (12 Nov's case).
      await attachToChat(db, user.id, file.id, { daysAgo: 2, sentNow: true });
      const draft = await stageDraft(db, user.id, file);
      // The Import history dialog says the file stays.
      const [listed] = await HermesWorkflowService.listDrafts(user.id);
      assert.equal(listed.sourceFileInChat, true);
      await HermesWorkflowService.discardDraft(user.id, draft.id, actor);
      await assertKept(db, file);
    }),
  ));

test("discarding a draft keeps a statement file in a chat whose run is still open", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const user = await seed(db);
      const file = await statementFile(db, user.id, "uob.pdf");
      await attachToChat(db, user.id, file.id, { daysAgo: 8 });
      const conversation = await db.chatAttachment.findFirstOrThrow({ where: { statementFileId: file.id } });
      await db.chatRun.create({
        data: {
          userId: user.id,
          conversationId: conversation.conversationId,
          idempotencyKey: "open",
          provider: "openrouter",
          model: "test",
          status: "awaiting_confirmation",
        },
      });
      const draft = await stageDraft(db, user.id, file);
      await HermesWorkflowService.discardDraft(user.id, draft.id, actor);
      await assertKept(db, file);
    }),
  ));

test("committing a draft deletes its statement file unless a chat still uses it", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const user = await seed(db);
      const alone = await statementFile(db, user.id, "alone.pdf");
      const aloneDraft = await stageDraft(db, user.id, alone);
      await commit(user.id, aloneDraft.id);
      await assertDeleted(db, alone);

      const shared = await statementFile(db, user.id, "shared.pdf");
      await attachToChat(db, user.id, shared.id, { daysAgo: 0 });
      const sharedDraft = await stageDraft(db, user.id, shared);
      await commit(user.id, sharedDraft.id);
      await assertKept(db, shared);
    }),
  ));

test("committing a draft keeps a statement file another open draft uses", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const user = await seed(db);
      const file = await statementFile(db, user.id, "dbs.pdf");
      const first = await stageDraft(db, user.id, file);
      await stageDraft(db, user.id, file);
      await commit(user.id, first.id);
      await assertKept(db, file);
    }),
  ));

test("the cleanup keeps an expired file an open draft uses and deletes it once nothing does", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const user = await seed(db);
      const file = await statementFile(db, user.id, "expired.pdf");
      const draft = await stageDraft(db, user.id, file);
      const later = new Date(Date.now() + 6 * DAY);
      assert.equal((await HermesWorkflowService.cleanupExpiredData(later)).deletedFiles, 0);
      await assertKept(db, file);
      await db.importDraft.update({ where: { id: draft.id }, data: { status: "discarded" } });
      assert.equal((await HermesWorkflowService.cleanupExpiredData(later)).deletedFiles, 1);
      await assertDeleted(db, file);
    }),
  ));
