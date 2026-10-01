import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { withChatDb } from "./test-harness";

const png = Buffer.concat([
  Buffer.from("89504e470d0a1a0a", "hex"),
  Buffer.from("screenshot"),
]);

test("image uploads are verified, owner-only and never parsed as statements", () =>
  withChatDb(async (db) => {
    process.env.STATEMENT_STORAGE_DIR = await mkdtemp(
      path.join(tmpdir(), "chat-uploads-"),
    );
    process.env.INTERNAL_SERVICE_TOKEN = "chat-test-internal";
    const { createChatRouter } = await import("./chat.controller");
    const { createToolRegistry } = await import("./tools/registry");
    const alice = await db.user.create({ data: { username: "img-alice" } });
    const bob = await db.user.create({ data: { username: "img-bob" } });
    const conversation = await db.chatConversation.create({
      data: { userId: alice.id },
    });
    const app = express();
    app.use(express.json());
    app.use("/api/chat", createChatRouter(db));
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${(server.address() as any).port}/api/chat`;
    const as = (userId: string) => ({
      "x-internal-service-token": "chat-test-internal",
      "x-authenticated-user-id": userId,
    });
    const upload = (bytes: Buffer, type: string, name: string) => {
      const form = new FormData();
      form.append("conversationId", conversation.id);
      form.append("file", new Blob([bytes], { type }), name);
      return fetch(`${url}/files`, {
        method: "POST",
        headers: as(alice.id),
        body: form,
      });
    };
    try {
      const ok = await upload(png, "application/octet-stream", "pay.png");
      assert.equal(ok.status, 201);
      const created: any = await ok.json();
      assert.equal(created.kind, "image");
      const stored = await db.statementFile.findUniqueOrThrow({
        where: { id: created.statementFileId },
      });
      assert.equal(stored.contentType, "image/png");

      const spoofed = await upload(
        Buffer.from("%PDF-1.7"),
        "image/png",
        "fake.png",
      );
      assert.equal(spoofed.status, 400);
      const heic = await upload(
        Buffer.from("\0\0\0\x18ftypheic\0\0\0\0", "latin1"),
        "image/heic",
        "photo.heic",
      );
      assert.equal(heic.status, 400);
      assert.match(((await heic.json()) as any).error, /HEIC/);

      const content = await fetch(
        `${url}/attachments/${created.attachmentId}/content`,
        { headers: as(alice.id) },
      );
      assert.equal(content.status, 200);
      assert.equal(content.headers.get("content-type"), "image/png");
      assert.deepEqual(Buffer.from(await content.arrayBuffer()), png);
      const stranger = await fetch(
        `${url}/attachments/${created.attachmentId}/content`,
        { headers: as(bob.id) },
      );
      assert.equal(stranger.status, 404);

      const tools = createToolRegistry(db);
      const context = {
        userId: alice.id,
        conversationId: conversation.id,
      } as any;
      for (const [name, input] of [
        ["inspect_statement", { attachmentId: created.attachmentId }],
        [
          "stage_statement",
          { attachmentId: created.attachmentId, parserId: "dbs_statement" },
        ],
      ] as const)
        await assert.rejects(
          tools.execute(context, name, input),
          /attachment is an image/,
        );
    } finally {
      server.close();
    }
  }));
