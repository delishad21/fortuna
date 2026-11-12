import { test } from "node:test";
import assert from "node:assert/strict";
import { forwardChatRequest } from "./proxy";
test("proxy rejects arbitrary paths and rejects oversized bodies before forwarding", async () => {
  const req = new Request("https://fortuna.test/api/chat", {
    method: "POST",
    body: "{}",
  });
  await assert.rejects(
    forwardChatRequest(req, "alice", ["..", "transactions"], {
      url: "http://127.0.0.1:1",
      token: "test",
    }),
  );
  await assert.rejects(
    forwardChatRequest(
      new Request(req, { body: "x".repeat(256 * 1024 + 1) }),
      "alice",
      ["conversations"],
      { url: "http://127.0.0.1:1", token: "test" },
    ),
    /large/,
  );
});
test("proxy allows editing and removing queued messages, and nothing else under the queue", async () => {
  const forwarded: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: URL, init: RequestInit) => {
    forwarded.push(`${init.method} ${url.pathname}`);
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const config = { url: "http://data.test", token: "test" };
    const call = (method: string, path: string[]) =>
      forwardChatRequest(
        new Request("https://fortuna.test/api/chat", {
          method,
          ...(method === "DELETE" ? {} : { body: "{}" }),
        }),
        "alice",
        path,
        config,
      );
    await call("PUT", ["conversations", "c1", "queue", "q1"]);
    await call("DELETE", ["conversations", "c1", "queue", "q1"]);
    await call("DELETE", ["conversations", "c1", "queue"]);
    await assert.rejects(call("POST", ["conversations", "c1", "queue"]));
    await assert.rejects(call("PUT", ["conversations", "c1", "queue"]));
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(forwarded, [
    "PUT /api/chat/conversations/c1/queue/q1",
    "DELETE /api/chat/conversations/c1/queue/q1",
    "DELETE /api/chat/conversations/c1/queue",
  ]);
});
