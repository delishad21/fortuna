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
