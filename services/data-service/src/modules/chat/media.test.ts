import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { withChatDb } from "./test-harness";
import { classifyUpload, detectImageType, loadModelImages } from "./media";
import { RunRepository } from "./run.repository";
import { executeRun } from "./runner";
import { ChatProvider, ProviderInput } from "./providers/provider";
import { OpenRouterProvider } from "./providers/openrouter";
import { CodexProvider } from "./providers/codex";
import { CHAT_LIMITS } from "./contracts";

const png = Buffer.concat([
  Buffer.from("89504e470d0a1a0a", "hex"),
  Buffer.from("fake-png-body"),
]);
const jpeg = Buffer.concat([Buffer.from("ffd8ffe0", "hex"), Buffer.from("x")]);
const webp = Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1");
const heic = Buffer.from("\0\0\0\x18ftypheic\0\0\0\0", "latin1");

test("uploads are classified by their bytes, not the declared type", () => {
  assert.equal(detectImageType(png), "image/png");
  assert.equal(detectImageType(jpeg), "image/jpeg");
  assert.equal(detectImageType(webp), "image/webp");
  assert.equal(detectImageType(Buffer.from("%PDF-1.7")), null);
  assert.deepEqual(
    classifyUpload({ mimetype: "application/octet-stream", buffer: png }),
    { kind: "image", contentType: "image/png" },
  );
  assert.deepEqual(
    classifyUpload({
      mimetype: "application/pdf",
      buffer: Buffer.from("%PDF"),
    }),
    { kind: "statement", contentType: "application/pdf" },
  );
  assert.throws(
    () =>
      classifyUpload({ mimetype: "image/png", buffer: Buffer.from("%PDF") }),
    /PNG, JPEG, WebP or GIF/,
  );
  assert.throws(
    () => classifyUpload({ mimetype: "image/heic", buffer: heic }),
    /HEIC/,
  );
  assert.throws(
    () =>
      classifyUpload({
        mimetype: "image/png",
        buffer: Buffer.concat([png, Buffer.alloc(CHAT_LIMITS.imageBytes)]),
      }),
    /10 MB/,
  );
});

async function seedImages(
  db: Parameters<Parameters<typeof withChatDb>[0]>[0],
  count: number,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "chat-media-"));
  const user = await db.user.create({ data: { username: `media-${count}` } });
  const conversation = await db.chatConversation.create({
    data: { userId: user.id },
  });
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const storagePath = path.join(dir, `image-${i}`);
    await writeFile(storagePath, Buffer.concat([png, Buffer.from(String(i))]));
    const file = await db.statementFile.create({
      data: {
        userId: user.id,
        filename: `shot-${i}.png`,
        contentType: "image/png",
        storagePath,
        sha256: `sha-${i}`,
        sizeBytes: png.length + 1,
        expiresAt: new Date(Date.now() + (i === 0 ? -1000 : 86400000)),
      },
    });
    const attachment = await db.chatAttachment.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        statementFileId: file.id,
      },
    });
    ids.push(attachment.id);
  }
  return { user, conversation, ids, dir };
}
const attachmentBlocks = (ids: string[]) =>
  ids.map((id) => ({ type: "attachment", id, filename: id }));

test("only the most recent unexpired, intact images are sent to the model", () =>
  withChatDb(async (db) => {
    const { user, ids } = await seedImages(db, 11);
    // Tamper with one stored file: content no longer matches its recorded type.
    const tampered = await db.chatAttachment.findUniqueOrThrow({
      where: { id: ids[10] },
      include: { statementFile: true },
    });
    await writeFile(tampered.statementFile.storagePath, "not an image");
    const images = await loadModelImages(db, user.id, [
      { role: "user", blocks: attachmentBlocks(ids.slice(0, 6)) },
      { role: "assistant", blocks: attachmentBlocks(["ignored"]) },
      { role: "user", blocks: attachmentBlocks(ids.slice(6)) },
    ]);
    assert.deepEqual([...images.keys()], ids.slice(3, 10));
    assert.equal(images.has(ids[0]), false);
    const first = images.get(ids[3])!;
    assert.equal(first.filename, "shot-3.png");
    assert.ok(first.dataUrl.startsWith("data:image/png;base64,"));
    const other = await db.user.create({ data: { username: "media-other" } });
    assert.equal(
      (
        await loadModelImages(db, other.id, [
          { role: "user", blocks: attachmentBlocks(ids) },
        ])
      ).size,
      0,
    );
  }));

test("the runner gives providers images separately from the text history", () =>
  withChatDb(async (db) => {
    const { user, conversation, ids } = await seedImages(db, 2);
    await db.chatConnection.create({
      data: {
        userId: user.id,
        provider: "openrouter",
        selected: true,
        status: "connected",
      },
    });
    await db.chatMessage.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        role: "user",
        blocks: [
          { type: "text", text: "Which of these are Apple Pay?" },
          ...attachmentBlocks(ids),
        ],
      },
    });
    await db.chatRun.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        idempotencyKey: "media",
        provider: "openrouter",
        model: "test",
      },
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
        yield { type: "text_delta", text: "Looking." };
        yield { type: "completed" };
      },
    };
    await executeRun(db, run, provider, new AbortController().signal);
    assert.equal(seen.length, 1);
    assert.deepEqual(
      seen[0].images?.map((i) => i.attachmentId),
      [ids[1]],
    );
    assert.equal(seen[0].content.includes("base64"), false);
  }));

const image = {
  attachmentId: "att1",
  filename: "applepay.png",
  dataUrl: "data:image/png;base64,AAAA",
};
test("OpenRouter receives images as content parts and excludes them from the text limit", async () => {
  let body: any;
  const provider = new OpenRouterProvider(
    async () => "key",
    async (_url, options) => {
      body = JSON.parse(String(options!.body));
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
              ),
            );
            c.close();
          },
        }),
      );
    },
  );
  const big = {
    ...image,
    dataUrl: "data:image/png;base64," + "A".repeat(300000),
  };
  for await (const _ of provider.run(
    {
      userId: "u",
      messages: [
        { role: "user", content: "earlier" },
        { role: "user", content: "[blocks]", images: [image, big] },
      ],
      tools: [],
      executeTool: async () => ({ blocks: [] }),
    },
    new AbortController().signal,
  )) {
  }
  assert.equal(body.messages[1].content, "earlier");
  const parts = body.messages[2].content;
  assert.deepEqual(parts[0], { type: "text", text: "[blocks]" });
  assert.match(parts[1].text, /Image attachment att1 \(applepay\.png\)/);
  assert.deepEqual(parts[2], {
    type: "image_url",
    image_url: { url: image.dataUrl },
  });
  assert.equal(parts.length, 5);
});

test("Codex receives images as labelled image input items", async () => {
  let turn: any;
  const rpc = Object.assign(new EventEmitter(), {
    call: async (method: string, params: any) => {
      if (method === "account/read") return { account: { type: "chatgpt" } };
      if (method === "model/list")
        return {
          data: [
            {
              model: "gpt-6-luna",
              supportedReasoningEfforts: [{ reasoningEffort: "max" }],
            },
          ],
        };
      if (method === "thread/start") return { thread: { id: "thread" } };
      if (method === "turn/start") {
        turn = params;
        setImmediate(() =>
          rpc.emit("notification", "turn/completed", {
            threadId: "thread",
            turn: { status: "completed" },
          }),
        );
        return { turn: { id: "turn" } };
      }
      throw new Error("Unexpected " + method);
    },
    onToolCall: undefined,
  });
  const provider = new CodexProvider({
    getClient: async () => ({ rpc, busy: false, lastUsed: 0 }),
    stop: () => {},
  } as any);
  for await (const _ of provider.run(
    {
      userId: "u",
      messages: [{ role: "user", content: "[blocks]", images: [image] }],
      tools: [],
      executeTool: async () => ({ blocks: [] }),
    },
    new AbortController().signal,
  )) {
  }
  assert.equal(turn.input[0].type, "text");
  assert.equal(turn.input[0].text.includes("base64"), false);
  assert.match(turn.input[1].text, /Image attachment att1/);
  assert.deepEqual(turn.input[2], { type: "image", url: image.dataUrl });
});
