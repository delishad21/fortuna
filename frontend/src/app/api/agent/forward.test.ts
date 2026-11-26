import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { forwardAgentPath } from "./forward";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const params = (path?: string[]) => ({ params: Promise.resolve({ path }) });

test("refuses a request without a token", async () => {
  const response = await forwardAgentPath(new Request("http://x/api/agent/drafts"), params(), "drafts", "down");
  assert.equal(response.status, 401);
});

test("forwards the path, query, token and body", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response('{"ok":true}', { status: 201, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const request = new Request("http://x/api/agent/drafts/d1/reconcile?x=1", {
    method: "PATCH",
    headers: { authorization: "Bearer pfa_t" },
    body: '{"a":1}',
  });
  const response = await forwardAgentPath(request, params(["d 1", "reconcile"]), "drafts", "down");
  assert.equal(response.status, 201);
  assert.equal(await response.text(), '{"ok":true}');
  assert.equal(seen!.url, "http://localhost:4001/api/agent/drafts/d%201/reconcile?x=1");
  assert.equal(seen!.init.method, "PATCH");
  assert.equal((seen!.init.headers as Record<string, string>).Authorization, "Bearer pfa_t");
  assert.equal(seen!.init.body, '{"a":1}');
});

test("answers 502 when the data service is down", async () => {
  globalThis.fetch = (async () => {
    throw new Error("refused");
  }) as typeof fetch;
  const request = new Request("http://x/api/agent/parser-factory/definitions", {
    headers: { authorization: "Bearer pfa_t" },
  });
  const response = await forwardAgentPath(request, params(["definitions"]), "parser-factory", "down");
  assert.equal(response.status, 502);
});
