import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { JsonRpcClient } from "./json-rpc";
import { selectCodexModel, restrictedThreadParams } from "./codex";
import { codexUserDirectory } from "./codex-runtime";
test("fragmented RPC frames resolve matching requests and deny unexpected server capabilities", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const wire: string[] = [];
  input.on("data", (v) => wire.push(v.toString()));
  const rpc = new JsonRpcClient(input, output);
  const pending = rpc.call("account/read", {});
  output.write('{"id":1,"res');
  output.write('ult":{"account":null}}\n');
  assert.deepEqual(await pending, { account: null });
  output.write(
    '{"id":20,"method":"item/commandExecution/requestApproval","params":{}}\n',
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(JSON.parse(wire[1]).error.code, -32601);
  rpc.close();
});
test("RPC fails pending calls on disconnect and rejects oversized frames", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const rpc = new JsonRpcClient(input, output);
  const pending = rpc.call("model/list", {});
  output.end();
  await assert.rejects(pending, /closed/);
  const otherOut = new PassThrough();
  const other = new JsonRpcClient(new PassThrough(), otherOut);
  const next = other.call("model/list", {});
  otherOut.write("x".repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(next, /large/);
});
test("Codex refuses a missing model or reasoning effort rather than falling back", () => {
  assert.throws(
    () =>
      selectCodexModel([
        {
          model: "gpt-6-luna",
          supportedReasoningEfforts: [{ reasoningEffort: "high" }],
        },
      ]),
    /max/,
  );
  assert.throws(
    () =>
      selectCodexModel([
        {
          model: "other",
          supportedReasoningEfforts: [{ reasoningEffort: "max" }],
        },
      ]),
    /unavailable/,
  );
  assert.deepEqual(
    selectCodexModel([
      {
        model: "gpt-6-luna",
        supportedReasoningEfforts: [{ reasoningEffort: "max" }],
      },
    ]),
    { model: "gpt-6-luna", effort: "max" },
  );
});
test("runtime paths cannot be selected by an account identifier and thread has no environments", () => {
  const a = codexUserDirectory("/tmp/chat-codex", "../../alice");
  const b = codexUserDirectory("/tmp/chat-codex", "bob");
  assert.ok(a.startsWith("/tmp/chat-codex/"));
  assert.notEqual(a, b);
  assert.equal(a.includes(".."), false);
  const params = restrictedThreadParams([]);
  assert.deepEqual(params.environments, []);
  assert.deepEqual(params.runtimeWorkspaceRoots, []);
  assert.equal(params.config["features.shell_tool"], false);
  assert.equal(params.config.web_search, "disabled");
});
test("cancelling during thread creation never starts a model turn or reuses that session", async () => {
  const { EventEmitter } = await import("node:events");
  const { CodexProvider } = await import("./codex");
  const controller = new AbortController();
  const calls: string[] = [];
  let stopped = false;
  const rpc = Object.assign(new EventEmitter(), {
    call: async (method: string) => {
      calls.push(method);
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
      if (method === "thread/start") {
        controller.abort();
        return { thread: { id: "thread" } };
      }
      throw new Error("Should not start turn");
    },
    onToolCall: undefined,
  });
  const session = { rpc, busy: false, lastUsed: 0 };
  const provider = new CodexProvider({
    getClient: async () => session,
    stop: () => {
      stopped = true;
    },
  } as any);
  await assert.rejects(async () => {
    for await (const _ of provider.run(
      {
        userId: "u",
        messages: [],
        tools: [],
        executeTool: async () => ({ blocks: [] }),
      },
      controller.signal,
    )) {
    }
  });
  assert.equal(calls.includes("turn/start"), false);
  assert.equal(stopped, true);
});
