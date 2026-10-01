import {
  ChatProvider,
  ProviderInput,
  ProviderEvent,
  ToolDefinition,
  CHAT_INSTRUCTIONS,
  imageLabel,
} from "./provider";
import { CodexRuntime } from "./codex-runtime";
import { CHAT_LIMITS, toolResultForModel } from "../contracts";
export function selectCodexModel(
  models: Array<{
    model: string;
    supportedReasoningEfforts?: Array<{ reasoningEffort: string }>;
  }>,
) {
  const model = models.find((m) => m.model === "gpt-6-luna");
  if (!model) throw new Error("GPT-6 Luna is unavailable for this account");
  if (
    !model.supportedReasoningEfforts?.some((e) => e.reasoningEffort === "max")
  )
    throw new Error("GPT-6 Luna max reasoning is unavailable for this account");
  return { model: "gpt-6-luna", effort: "max" };
}
export function restrictedThreadParams(tools: ToolDefinition[]) {
  return {
    model: "gpt-6-luna",
    ephemeral: true,
    environments: [],
    runtimeWorkspaceRoots: [],
    approvalPolicy: "never",
    sandbox: "read-only",
    baseInstructions: CHAT_INSTRUCTIONS,
    dynamicTools: tools,
    config: {
      "features.shell_tool": false,
      "features.multi_agent": false,
      "features.memories": false,
      "tools.view_image": false,
      "apps._default.enabled": false,
      web_search: "disabled",
    },
  };
}
export class CodexProvider implements ChatProvider {
  constructor(private runtime: CodexRuntime) {}
  async testConnection(userId: string) {
    const { rpc } = await this.runtime.getClient(userId);
    const account = await rpc.call("account/read", { refreshToken: true });
    if (!account.account)
      return { connected: false, modelAvailable: false, needsReconnect: true };
    const models: any[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await rpc.call("model/list", {
        limit: 100,
        includeHidden: true,
        ...(cursor ? { cursor } : {}),
      });
      models.push(...result.data);
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    try {
      selectCodexModel(models);
      return { connected: true, modelAvailable: true, needsReconnect: false };
    } catch (e) {
      return {
        connected: true,
        modelAvailable: false,
        needsReconnect: false,
        error: (e as Error).message,
      };
    }
  }
  async *run(
    input: ProviderInput,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    const status = await this.testConnection(input.userId);
    if (!status.connected || !status.modelAvailable)
      throw new Error(status.error || "Reconnect your Codex account");
    const session = await this.runtime.getClient(input.userId);
    if (session.busy)
      throw new Error("Codex is already running for this account");
    session.busy = true;
    const queue: ProviderEvent[] = [];
    let wake: () => void = () => {};
    let finished = false;
    let failure: Error | undefined;
    let threadId = "";
    let turnId = "";
    let calls = 0;
    const push = (event: ProviderEvent) => {
      queue.push(event);
      wake();
    };
    const closed = () => {
      failure = new Error("Codex disconnected");
      finished = true;
      wake();
    };
    const notification = (method: string, params: any) => {
      if (params.threadId !== threadId) return;
      if (method === "item/agentMessage/delta")
        push({ type: "text_delta", text: params.delta });
      if (method === "turn/completed") {
        finished = true;
        if (params.turn.status !== "completed")
          failure = new Error("Codex turn did not complete");
        wake();
      }
    };
    const abort = () => {
      failure = new Error("Conversation stopped");
      finished = true;
      wake();
      if (threadId && turnId)
        void session.rpc
          .call("turn/interrupt", { threadId, turnId })
          .catch(() => {});
    };
    session.rpc.on("notification", notification);
    session.rpc.on("closed", closed);
    signal.addEventListener("abort", abort, { once: true });
    session.rpc.onToolCall = async (params) => {
      if (
        signal.aborted ||
        params.threadId !== threadId ||
        !input.tools.some((t) => t.name === params.tool) ||
        ++calls > CHAT_LIMITS.toolCalls
      )
        throw new Error("Tool is unavailable");
      push({ type: "tool_call", name: params.tool, callId: params.callId });
      const result = await input.executeTool(
        params.tool,
        params.arguments,
        params.callId,
      );
      return {
        contentItems: [{ type: "inputText", text: toolResultForModel(result) }],
        success: true,
      };
    };
    try {
      signal.throwIfAborted();
      const started = await session.rpc.call(
        "thread/start",
        restrictedThreadParams(input.tools),
      );
      threadId = started.thread.id;
      signal.throwIfAborted();
      const turn = await session.rpc.call("turn/start", {
        threadId,
        model: "gpt-6-luna",
        effort: "max",
        environments: [],
        runtimeWorkspaceRoots: [],
        input: [
          {
            type: "text",
            text: JSON.stringify(
              input.messages.map(({ images: _images, ...m }) => m),
            ),
            text_elements: [],
          },
          ...input.messages
            .flatMap((m) => m.images || [])
            .flatMap((image) => [
              { type: "text", text: imageLabel(image), text_elements: [] },
              { type: "image", url: image.dataUrl },
            ]),
        ],
      });
      turnId = turn.turn.id;
      while (!finished || queue.length) {
        if (queue.length) yield queue.shift()!;
        else
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
      }
      if (failure) throw failure;
      yield { type: "completed" };
    } finally {
      if (signal.aborted || failure) this.runtime.stop(input.userId);
      signal.removeEventListener("abort", abort);
      session.rpc.off("notification", notification);
      session.rpc.off("closed", closed);
      session.rpc.onToolCall = undefined;
      session.busy = false;
      session.lastUsed = Date.now();
    }
  }
}
