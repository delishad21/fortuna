import { safeChatError } from "./errors";
import { PrismaClient } from "@prisma/client";
import { withDatabase } from "../../lib/database-context";
import { ChatProvider } from "./providers/provider";
import { ClaimedRun, RunRepository } from "./run.repository";
import { createToolRegistry } from "./tools/registry";
import { json, stateHash } from "./tools/transactions";
import { CHAT_LIMITS, ChatError, ToolResult } from "./contracts";
export async function executeRun(
  db: PrismaClient,
  run: ClaimedRun,
  provider: ChatProvider,
  parentSignal: AbortSignal,
) {
  const repo = new RunRepository(db),
    tools = createToolRegistry(db),
    controller = new AbortController();
  const signal = AbortSignal.any([
    parentSignal,
    controller.signal,
    AbortSignal.timeout(CHAT_LIMITS.runMilliseconds),
  ]);
  const heartbeat = setInterval(() => {
    void repo
      .heartbeat(run)
      .then((ok) => {
        if (!ok) controller.abort();
      })
      .catch(() => controller.abort());
  }, 15000);
  const context = {
    userId: run.userId,
    runId: run.id,
    conversationId: run.conversationId,
  };
  let output = "";
  let completed = false;
  try {
    const conversation = await db.chatConversation.findFirst({
      where: { id: run.conversationId, userId: run.userId, deletedAt: null },
      include: {
        messages: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 50,
        },
      },
    });
    if (!conversation) throw new ChatError(404, "Conversation not found");
    const messages = conversation.messages.reverse().map((m) => ({
      role: m.role as "user" | "assistant",
      content: JSON.stringify(m.blocks),
    }));
    if (JSON.stringify(messages).length > 192000)
      throw new ChatError(
        400,
        "This conversation is too long. Start a new conversation.",
      );
    if (run.attempts > 1)
      await repo.appendEvent(run, {
        type: "reset",
        text: "Resuming interrupted conversation",
      });
    const executeTool = async (
      name: string,
      args: unknown,
      callId: string,
    ): Promise<ToolResult> => {
      signal.throwIfAborted();
      const connection = await db.chatConnection.findFirst({
        where: {
          userId: run.userId,
          provider: run.provider,
          generation: run.connectionGeneration,
          status: "connected",
        },
      });
      if (!connection || !(await repo.heartbeat(run)))
        throw new ChatError(409, "Connection changed or conversation stopped");
      const stableId = tools.isReadOnly(name)
        ? callId
        : stateHash({ name, args });
      const previous = await db.chatToolInvocation.findUnique({
        where: { runId_callId: { runId: run.id, callId: stableId } },
      });
      if (previous?.status === "completed")
        return previous.result as unknown as ToolResult;
      if (previous && !tools.isReadOnly(name))
        throw new ChatError(
          409,
          "An interrupted action needs review. Check your staged imports and pending approvals before retrying.",
        );
      const invocation =
        previous ||
        (await db.chatToolInvocation.create({
          data: {
            ...context,
            callId: stableId,
            name,
            arguments: json(args),
            status: "running",
          },
        }));
      let result: ToolResult;
      try {
        result = await withDatabase(db, () =>
          tools.execute(context, name, args),
        );
      } catch (error) {
        if (safeChatError(error))
          result = { blocks: [{ type: "text", text: safeChatError(error)! }] };
        else if ((error as { name?: string }).name === "ZodError")
          result = {
            blocks: [
              {
                type: "text",
                text: "Tool arguments are invalid. Check the tool schema and owned record IDs.",
              },
            ],
          };
        else throw error;
      }
      signal.throwIfAborted();
      await db.chatToolInvocation.update({
        where: { id: invocation.id },
        data: { status: "completed", result: json(result) },
      });
      await repo.appendEvent(run, {
        type: "tool_result",
        name,
        result: json(result),
      });
      return result;
    };
    for await (const event of provider.run(
      { userId: run.userId, messages, tools: tools.definitions, executeTool },
      signal,
    )) {
      signal.throwIfAborted();
      if (event.type === "text_delta") {
        output += event.text;
        if (output.length > 100000)
          throw new ChatError(
            400,
            "Assistant response exceeded the size limit",
          );
      }
      if (event.type === "completed") completed = true;
      await repo.appendEvent(run, json(event));
    }
    if (!completed) throw new Error("Provider response interrupted");
    const outcomes = await db.chatToolInvocation.findMany({
      where: { runId: run.id, status: "completed" },
      orderBy: { createdAt: "asc" },
    });
    const blocks: any[] = [
      { type: "text", text: output },
      ...outcomes.flatMap((v) =>
        (v.result as unknown as ToolResult).blocks.filter(
          (b) => b.type !== "text",
        ),
      ),
    ];
    const pending = await db.chatActionProposal.count({
      where: { runId: run.id, status: "pending" },
    });
    await repo.finish(
      run,
      pending ||
        (await db.chatTransactionReview.count({
          where: { runId: run.id, status: "pending" },
        }))
        ? "awaiting_confirmation"
        : "completed",
      json(blocks),
    );
  } catch (error) {
    const message = signal.aborted
      ? "Conversation stopped or timed out. Saved data is preserved."
      : safeChatError(error) ||
        "The assistant could not finish. Check the provider connection and try again; saved data is preserved.";
    await repo
      .finish(run, "failed", json([{ type: "text", text: message }]), message)
      .catch(() => {});
  } finally {
    clearInterval(heartbeat);
    controller.abort();
  }
}
