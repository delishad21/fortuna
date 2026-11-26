import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { forwardAgentImage, forwardAgentPath, isAgentToken } from "./forward";

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

test("an API token's image passes through with its bytes and type", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(bytes, { status: 200, headers: { "content-type": "image/png", "content-length": "4" } });
  }) as typeof fetch;
  const request = new Request("http://x/api/images/img_1", { headers: { authorization: "Bearer pfa_t.s" } });
  assert.equal(isAgentToken(request), true);
  assert.equal(isAgentToken(new Request("http://x", { headers: { authorization: "Bearer fm_x.y" } })), false);
  const response = await forwardAgentImage(request, "img_1");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(seen!.url, "http://localhost:4001/api/images/img_1");
  assert.equal((seen!.init.headers as Record<string, string>).Authorization, "Bearer pfa_t.s");
});

test("an image the token can't see stays a 404, and odd ids never reach the data service", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response('{"error":"Image not found"}', { status: 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const request = new Request("http://x/api/images/img_2", { headers: { authorization: "Bearer pfa_t.s" } });
  assert.equal((await forwardAgentImage(request, "img_2")).status, 404);
  assert.equal((await forwardAgentImage(request, "../users")).status, 404);
  assert.equal(calls, 1);
});
