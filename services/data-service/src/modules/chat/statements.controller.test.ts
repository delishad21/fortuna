import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withChatDb } from "./test-harness";
import { createChatRouter } from "./chat.controller";

test("the Statements list downloads originals and refuses to delete one an open import uses", () =>
  withChatDb(async (db) => {
    process.env.INTERNAL_SERVICE_TOKEN = "chat-test-internal";
    const user = await db.user.create({ data: { username: "statements-api" } });
    const other = await db.user.create({ data: { username: "statements-other" } });
    const storagePath = path.join(await mkdtemp(path.join(tmpdir(), "statements-api-")), "file");
    await writeFile(storagePath, "%PDF-1.4 original");
    const file = await db.statementFile.create({
      data: {
        userId: user.id,
        filename: "DBS Oct 2026.pdf",
        contentType: "application/pdf",
        storagePath,
        sha256: "statements-api",
        sizeBytes: 17,
      },
    });
    const draft = await db.importDraft.create({
      data: {
        userId: user.id,
        mode: "main",
        sourceFilename: file.filename,
        sourceFileId: file.id,
        sourceSha256: "statements-api",
        status: "review",
        expiresAt: new Date("2099-01-01"),
      },
    });
    const app = express();
    app.use(express.json());
    app.use("/api/chat", createChatRouter(db));
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${(server.address() as any).port}/api/chat/statements`;
    const headers = (userId: string) => ({
      "x-internal-service-token": "chat-test-internal",
      "x-authenticated-user-id": userId,
    });
    try {
      const listed = (await (await fetch(url, { headers: headers(user.id) })).json()) as any;
      assert.equal(listed.statements.length, 1);
      assert.equal(listed.statements[0].filename, "DBS Oct 2026.pdf");
      assert.equal(listed.statements[0].sizeBytes, 17);
      assert.equal(listed.statements[0].inUse, true);
      assert.equal(listed.statements[0].imports[0].id, draft.id);
      assert.equal("storagePath" in listed.statements[0], false);
      assert.deepEqual(
        ((await (await fetch(url, { headers: headers(other.id) })).json()) as any).statements,
        [],
      );

      const download = await fetch(`${url}/${file.id}/content`, { headers: headers(user.id) });
      assert.equal(download.status, 200);
      assert.equal(download.headers.get("content-type"), "application/pdf");
      assert.match(download.headers.get("content-disposition")!, /^attachment; filename="DBS Oct 2026\.pdf"/);
      assert.equal(await download.text(), "%PDF-1.4 original");
      assert.equal((await fetch(`${url}/${file.id}/content`, { headers: headers(other.id) })).status, 404);

      const refused = await fetch(`${url}/${file.id}`, { method: "DELETE", headers: headers(user.id) });
      assert.equal(refused.status, 409);
      assert.match(((await refused.json()) as any).error, /still used by an open import/);
      assert.ok(existsSync(storagePath));

      await db.importDraft.update({ where: { id: draft.id }, data: { status: "committed" } });
      assert.equal((await fetch(`${url}/${file.id}`, { method: "DELETE", headers: headers(other.id) })).status, 404);
      const deleted = await fetch(`${url}/${file.id}`, { method: "DELETE", headers: headers(user.id) });
      assert.equal(deleted.status, 200);
      assert.equal(existsSync(storagePath), false);
      assert.equal((await fetch(`${url}/${file.id}/content`, { headers: headers(user.id) })).status, 404);
      assert.deepEqual(
        ((await (await fetch(url, { headers: headers(user.id) })).json()) as any).statements,
        [],
      );
    } finally {
      server.close();
    }
  }));
