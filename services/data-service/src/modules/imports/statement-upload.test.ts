import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import multer from "multer";
import { once } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { withChatDb } from "../chat/test-harness";
import { withDatabase } from "../../lib/database-context";
import { hashApiTokenSecret } from "../auth/api-token";

const PASSWORD = "S1234567A-dob";
const LOCKED = Buffer.from("%PDF-1.7\n1 0 obj << /Filter /Standard >> endobj\ntrailer << /Encrypt 1 0 R >>\n%%EOF");
const UNLOCKED = Buffer.from("%PDF-1.7\n% decrypted statement\n%%EOF");
const CSV = Buffer.from("Date,Description,Amount\n2026-12-01,KOPITIAM,4.50\n");

async function token(db: PrismaClient, userId: string, id: string, scopes: string[]) {
  await db.apiToken.create({
    data: { id, userId, name: id, secretHash: hashApiTokenSecret(`${id}-secret`), scopes },
  });
  return { Authorization: `Bearer pfa_${id}.${id}-secret` };
}

/** Stands in for the file parser's /pdf/unlock, and records every password it was sent. */
async function fakeParser() {
  const received: string[] = [];
  const app = express();
  app.post("/pdf/unlock", multer().single("file"), (request, response) => {
    if (request.header("x-internal-service-token") !== "upload-test-internal")
      return response.status(401).json({ error: "Internal service authentication required" });
    const password = request.body.password as string | undefined;
    if (password) received.push(password);
    if (!request.file!.buffer.includes("/Encrypt")) return response.json({ status: "not_locked" });
    if (!password) return response.json({ status: "password_required" });
    if (password !== PASSWORD) return response.json({ status: "password_incorrect" });
    response.set("X-Pdf-Status", "unlocked").type("application/pdf").send(UNLOCKED);
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, received, url: `http://127.0.0.1:${(server.address() as any).port}` };
}

test("API tokens upload statements, with an optional PDF password that is never kept", () =>
  withChatDb(async (db) => {
    const storage = await mkdtemp(path.join(tmpdir(), "statement-upload-"));
    process.env.STATEMENT_STORAGE_DIR = storage;
    process.env.INTERNAL_SERVICE_TOKEN = "upload-test-internal";
    const parser = await fakeParser();
    process.env.PARSER_SERVICE_URL = parser.url;
    const { hermesWorkflowRouter } = await import("./hermes-workflow.controller");
    const { StatementLibrary } = await import("./statement-library");

    const user = await db.user.create({ data: { username: "upload-twee" } });
    const writer = await token(db, user.id, "tweeup01", ["statements:write", "transactions:write"]);
    const noScope = await token(db, user.id, "tweeup02", ["transactions:write", "drafts:read"]);

    const app = express();
    app.use(express.json());
    app.use((_request, _response, next) => void withDatabase(db, async () => next()));
    app.use("/api/agent", hermesWorkflowRouter);
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as any).port}/api/agent`;
    const upload = (bytes: Buffer, name: string, type: string, headers: Record<string, string>, password?: string) => {
      const form = new FormData();
      form.append("file", new Blob([bytes], { type }), name);
      if (password !== undefined) form.append("password", password);
      return fetch(`${base}/statements`, { method: "POST", body: form, headers });
    };

    try {
      // Scope: no token, or a token without statements:write, stores nothing.
      assert.equal((await upload(CSV, "uob.csv", "text/csv", {})).status, 401);
      const refused = await upload(CSV, "uob.csv", "text/csv", noScope);
      assert.equal(refused.status, 403);
      assert.deepEqual(((await refused.json()) as any).requiredScopes, ["statements:write"]);
      assert.equal(await db.statementFile.count({ where: { userId: user.id } }), 0);

      // A CSV is stored as uploaded and returns the fileRef the draft tools take.
      const csv = await upload(CSV, "uob.csv", "text/csv", writer);
      assert.equal(csv.status, 201);
      const { statement: csvStatement } = (await csv.json()) as any;
      assert.match(csvStatement.id, /^upload_/);
      assert.equal(csvStatement.filename, "uob.csv");
      assert.equal(csvStatement.duplicate, false);
      const stored = await db.statementFile.findUniqueOrThrow({ where: { id: csvStatement.id } });
      assert.deepEqual(await readFile(stored.storagePath), CSV);
      const fetched = await fetch(`${base}/statements/${csvStatement.id}`, {
        headers: await token(db, user.id, "tweeup03", ["drafts:read"]),
      });
      assert.equal(((await fetched.json()) as any).statement.id, csvStatement.id);
      const again = await upload(CSV, "uob.csv", "text/csv", writer);
      assert.equal(again.status, 200);
      assert.equal(((await again.json()) as any).statement.id, csvStatement.id);

      // A locked PDF without its password, or with the wrong one, is refused with a code twee can ask about.
      const missing = await upload(LOCKED, "dbs.pdf", "application/pdf", writer);
      assert.equal(missing.status, 422);
      const missingBody = (await missing.json()) as any;
      assert.equal(missingBody.code, "pdf_password_required");
      assert.match(missingBody.error, /password-protected/);
      const wrong = await upload(LOCKED, "dbs.pdf", "application/pdf", writer, "not-it");
      assert.equal(wrong.status, 422);
      const wrongText = await wrong.text();
      assert.equal(JSON.parse(wrongText).code, "pdf_password_incorrect");
      assert.equal(wrongText.includes("not-it"), false);
      assert.equal(await db.statementFile.count({ where: { userId: user.id } }), 1);

      // The right password: the decrypted copy is stored, so parsing later needs no password.
      const opened = await upload(LOCKED, "dbs.pdf", "application/pdf", writer, PASSWORD);
      assert.equal(opened.status, 201);
      const openedText = await opened.text();
      assert.equal(openedText.includes(PASSWORD), false);
      const { statement: pdfStatement } = JSON.parse(openedText);
      const pdf = await db.statementFile.findUniqueOrThrow({ where: { id: pdfStatement.id } });
      assert.deepEqual(await readFile(pdf.storagePath), UNLOCKED);
      assert.equal(pdf.contentType, "application/pdf");
      assert.equal(pdf.sizeBytes, UNLOCKED.length);
      // Uploading the same locked statement again finds the same file.
      const reupload = await upload(LOCKED, "dbs.pdf", "application/pdf", writer, PASSWORD);
      assert.equal(((await reupload.json()) as any).statement.id, pdfStatement.id);

      // The password is in no stored row: not the file, not the audit trail.
      const audit = await db.agentAuditEvent.findMany({ where: { userId: user.id } });
      assert.ok(audit.some((event) => event.targetId === pdfStatement.id));
      assert.equal(JSON.stringify(audit).includes(PASSWORD), false);
      assert.equal(JSON.stringify(await db.statementFile.findMany({ where: { userId: user.id } })).includes(PASSWORD), false);
      // A PDF that isn't locked never reaches the parser without a password.
      parser.received.length = 0;
      const plain = await upload(UNLOCKED, "plain.pdf", "application/pdf", writer);
      assert.equal(plain.status, 200);
      assert.deepEqual(parser.received, []);

      // Type and size limits are the web upload's.
      assert.equal((await upload(Buffer.from("GIF89a"), "x.gif", "image/gif", writer)).status, 415);
      const huge = await upload(Buffer.alloc(25 * 1024 * 1024 + 1, 0x20), "big.csv", "text/csv", writer);
      assert.equal(huge.status, 413);

      // Both uploads show in the Statements list.
      const listed = await new StatementLibrary(db).list(user.id);
      assert.deepEqual(
        listed.map((file) => [file.id, file.filename]).sort(),
        [[csvStatement.id, "uob.csv"], [pdfStatement.id, "dbs.pdf"]].sort(),
      );
    } finally {
      server.close();
      parser.server.close();
    }
  }));
