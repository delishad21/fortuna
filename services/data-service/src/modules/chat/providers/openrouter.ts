import {
  ChatProvider,
  ProviderInput,
  ProviderEvent,
  CHAT_INSTRUCTIONS,
} from "./provider";
import { CHAT_LIMITS, ChatError, toolResultForModel } from "../contracts";
export async function* readSse(response: Response): AsyncIterable<any> {
  if (!response.body) throw new Error("Provider stream is missing");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    bytes = 0,
    done = false;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 16 * 1024 * 1024)
        throw new Error("Provider response is too large");
      buffer += decoder.decode(part.value, { stream: true });
      // Normalize only complete lines so CRLF split across packets remains valid.
      for (let end; (end = buffer.indexOf("\n")) >= 0;) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          done = true;
          return;
        }
        try {
          yield JSON.parse(data);
        } catch {
          throw new Error("Invalid provider stream");
        }
      }
    }
    if (!done) throw new Error("Provider stream was incomplete");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function providerError(status: number) {
  return new ChatError(
    status,
    status === 401
      ? "OpenRouter key is invalid. Reconnect in Settings."
      : status === 402
        ? "OpenRouter credits are exhausted."
        : status === 429
          ? "OpenRouter rate limit reached. Try again shortly."
          : "OpenRouter is unavailable. Please try again.",
  );
}
export class OpenRouterProvider implements ChatProvider {
  constructor(
    private keyForUser: (userId: string) => Promise<string>,
    private request: typeof fetch = fetch,
  ) {}
  async testConnection(userId: string) {
    const key = await this.keyForUser(userId);
    const response = await this.request("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: "Bearer " + key },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      return {
        connected: false,
        modelAvailable: false,
        needsReconnect: response.status === 401,
        error: providerError(response.status).message,
      };
    const models = await this.request("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(15000),
    });
    if (!models.ok) throw providerError(models.status);
    const body = (await models.json()) as any;
    const model = body.data?.find((m: any) => m.id === "openai/gpt-6-luna-pro");
    const available = !!model?.supported_parameters?.includes("tools");
    return {
      connected: true,
      modelAvailable: available,
      needsReconnect: false,
      ...(!available
        ? { error: "GPT-6 Luna Pro with tools is unavailable" }
        : {}),
    };
  }
  async *run(
    input: ProviderInput,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    const messages: any[] = [
      { role: "system", content: CHAT_INSTRUCTIONS },
      ...input.messages,
    ];
    let toolCount = 0;
    for (let turn = 0; turn < CHAT_LIMITS.modelTurns; turn++) {
      signal.throwIfAborted();
      if (JSON.stringify(messages).length > 192000)
        throw new Error(
          "Conversation context is too large. Start a new conversation.",
        );
      const key = await this.keyForUser(input.userId);
      const response = await this.request(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
            "X-OpenRouter-Title": "Fortuna",
          },
          body: JSON.stringify({
            model: "openai/gpt-6-luna-pro",
            messages,
            tools: input.tools.map((t) => ({
              type: "function",
              function: {
                name: t.name,
                description: t.description,
                parameters: t.inputSchema,
              },
            })),
            stream: true,
            max_tokens: 16384,
            provider: { require_parameters: true, allow_fallbacks: false },
          }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(600000)]),
        },
      );
      if (!response.ok) throw providerError(response.status);
      let text = "",
        finish: string | undefined;
      const calls = new Map<
        number,
        {
          id: string;
          type: "function";
          function: { name: string; arguments: string };
        }
      >();
      for await (const event of readSse(response)) {
        if (event.error)
          throw new Error("OpenRouter could not complete the response");
        const choice = event.choices?.[0],
          delta = choice?.delta;
        if (choice?.finish_reason) finish = choice.finish_reason;
        if (typeof delta?.content === "string") {
          text += delta.content;
          yield { type: "text_delta", text: delta.content };
        }
        for (const fragment of delta?.tool_calls || []) {
          if (
            !Number.isInteger(fragment.index) ||
            fragment.index < 0 ||
            fragment.index >= CHAT_LIMITS.toolCalls
          )
            throw new Error("Invalid provider tool call");
          const call = calls.get(fragment.index) || {
            id: "",
            type: "function" as const,
            function: { name: "", arguments: "" },
          };
          call.id += fragment.id || "";
          call.function.name += fragment.function?.name || "";
          call.function.arguments += fragment.function?.arguments || "";
          if (call.function.arguments.length > 128000)
            throw new Error("Tool arguments too large");
          calls.set(fragment.index, call);
        }
        if (event.usage) yield { type: "usage", usage: event.usage };
      }
      if (!calls.size) {
        if (finish !== "stop")
          throw new Error(
            "OpenRouter response did not finish. Please try again.",
          );
        yield { type: "completed" };
        return;
      }
      if (finish !== "tool_calls")
        throw new Error("Incomplete provider tool request");
      const toolCalls = [...calls.values()];
      messages.push({
        role: "assistant",
        content: text || null,
        tool_calls: toolCalls,
      });
      for (const call of toolCalls) {
        if (++toolCount > CHAT_LIMITS.toolCalls)
          throw new Error("Conversation tool limit reached");
        if (!call.id || !input.tools.some((t) => t.name === call.function.name))
          throw new Error("Requested tool is unavailable");
        let args: unknown;
        try {
          args = JSON.parse(call.function.arguments);
        } catch {
          throw new Error("Invalid tool arguments");
        }
        yield { type: "tool_call", name: call.function.name, callId: call.id };
        const result = await input.executeTool(
          call.function.name,
          args,
          call.id,
        );
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: toolResultForModel(result),
        });
      }
    }
    throw new Error(
      "Conversation step limit reached. Continue with another message.",
    );
  }
}
