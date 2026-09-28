import { test } from "node:test";
import assert from "node:assert/strict";
import { readSse, OpenRouterProvider } from "./openrouter";
function stream(parts: string[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const p of parts) controller.enqueue(new TextEncoder().encode(p));
        controller.close();
      },
    }),
  );
}
test("SSE handles fragmented events, comments and CRLF", async () => {
  const events = [];
  for await (const event of readSse(
    stream([
      ":ping\r\n\r\nda",
      'ta: {"delta":"hi"}\r\n\r\n',
      "data: [DONE]\n\n",
    ]),
  ))
    events.push(event);
  assert.deepEqual(events, [{ delta: "hi" }]);
});
test("truncated and malformed provider streams are errors", async () => {
  await assert.rejects(async () => {
    for await (const _ of readSse(stream(["data: {oops}\n\n"]))) {
    }
  }, /Invalid/);
  await assert.rejects(async () => {
    for await (const _ of readSse(stream(['data: {"ok":true}\n\n']))) {
    }
  }, /incomplete/);
});
test("unknown tool never executes and credentials are not exposed in errors", async () => {
  let executed = false;
  const fetcher: typeof fetch = async () =>
    stream([
      "data: " +
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call1",
                    function: { name: "shell", arguments: "{}" },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }) +
        "\n\ndata: [DONE]\n\n",
    ]);
  const provider = new OpenRouterProvider(async () => "secret-key", fetcher);
  await assert.rejects(async () => {
    for await (const _ of provider.run(
      {
        userId: "alice",
        messages: [{ role: "user", content: "hello" }],
        tools: [],
        executeTool: async () => {
          executed = true;
          return { blocks: [] };
        },
      },
      new AbortController().signal,
    )) {
    }
  }, /unavailable/);
  assert.equal(executed, false);
});
test("tool arguments assemble across chunks and tool result feeds the next turn", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, "openai/gpt-6-luna-pro");
    assert.equal(body.provider.allow_fallbacks, false);
    if (calls++ === 0)
      return stream([
        "data: " +
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "c1",
                      function: { name: "summary", arguments: '{"month":' },
                    },
                  ],
                },
              },
            ],
          }) +
          "\n\n",
        "data: " +
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: "8}" } }],
                },
                finish_reason: "tool_calls",
              },
            ],
          }) +
          "\n\ndata: [DONE]\n\n",
      ]);
    assert.equal(body.messages.at(-1).role, "tool");
    return stream([
      "data: " +
        JSON.stringify({
          choices: [{ delta: { content: "SGD 55.55" }, finish_reason: "stop" }],
        }) +
        "\n\ndata: [DONE]\n\n",
    ]);
  };
  const provider = new OpenRouterProvider(async () => "secret", fetcher);
  const events = [];
  for await (const event of provider.run(
    {
      userId: "alice",
      messages: [],
      tools: [
        {
          name: "summary",
          description: "summary",
          inputSchema: { type: "object" },
        },
      ],
      executeTool: async (name, args) => {
        assert.equal(name, "summary");
        assert.deepEqual(args, { month: 8 });
        return { blocks: [{ type: "text", text: "55.55" }] };
      },
    },
    new AbortController().signal,
  ))
    events.push(event);
  assert.equal(events.filter((e) => e.type === "completed").length, 1);
  assert.ok(
    events.some((e) => e.type === "text_delta" && e.text === "SGD 55.55"),
  );
});
