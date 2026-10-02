import { ZodError } from "zod";
import { compactBlocks } from "./tools/components";
import { loadModelImages } from "./media";
import { ProviderMessage } from "./providers/provider";
import { safeChatError } from "./errors";
import { PrismaClient } from "@prisma/client";
import { withDatabase } from "../../lib/database-context";
import { ChatProvider } from "./providers/provider";
import { ClaimedRun, RunRepository } from "./run.repository";
import { createToolRegistry } from "./tools/registry";
import { json, stateHash } from "./tools/transactions";
import { CHAT_LIMITS, ChatError, ToolResult } from "./contracts";
/** Tool output the user sees in the saved reply; everything else is for the model only. */
const USER_VISIBLE_BLOCKS = new Set(["link", "review", "component"]);
/** Name each invalid field so the model can correct its own call. */
export function invalidArguments(error: ZodError) {
  const issues = error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return `Tool arguments are invalid. Fix these fields and call the tool again: ${issues}`.slice(
    0,
    1500,
  );
}
/** Transactions this run already shows inside a review or an approval preview. */
async function coveredTransactionIds(db: PrismaClient, runId: string) {
  const [reviews, proposals] = await Promise.all([
    db.chatTransactionReview.findMany({
      where: { runId },
      select: { rows: true },
    }),
    db.chatActionProposal.findMany({
      where: { runId },
      select: { preview: true },
    }),
  ]);
  return new Set<string>([
    ...reviews.flatMap((r) =>
      ((r.rows as any[]) || []).flatMap((row) =>
        row?.source?.transactionId ? [String(row.source.transactionId)] : [],
      ),
    ),
    ...proposals.flatMap((p) =>
      (((p.preview as any)?.changes as any[]) || []).map((c) => String(c.id)),
    ),
  ]);
}
/** A transaction list that only repeats a review's or proposal's transactions adds nothing. */
export function dropRepeatedLists<T extends { type: string }>(
  blocks: T[],
  covered: Set<string>,
) {
  if (!covered.size) return blocks;
  return blocks.filter((b: any) => {
    if (b.type !== "component" || b.component !== "transaction_list")
      return true;
    const rows: Array<{ id: string }> = b.rows || [];
    return !(
      b.total <= covered.size &&
      rows.length > 0 &&
      rows.every((r) => covered.has(String(r.id)))
    );
  });
}
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
    const history = conversation.messages.reverse();
    const messages: ProviderMessage[] = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: JSON.stringify(compactBlocks(m.blocks)),
    }));
    if (JSON.stringify(messages).length > 192000)
      throw new ChatError(
        400,
        "This conversation is too long. Start a new conversation.",
      );
    const images = await loadModelImages(db, run.userId, history);
    history.forEach((m, i) => {
      const attached = (Array.isArray(m.blocks) ? m.blocks : [])
        .map((b: any) => b?.type === "attachment" && images.get(b.id))
        .filter(Boolean) as NonNullable<ProviderMessage["images"]>;
      if (attached.length) messages[i].images = attached;
    });
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
                text: invalidArguments(error as ZodError),
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
    const shown = outcomes.flatMap((v) =>
      (v.result as unknown as ToolResult).blocks.filter((b) =>
        USER_VISIBLE_BLOCKS.has(b.type),
      ),
    );
    const blocks: any[] = [
      { type: "text", text: output },
      ...dropRepeatedLists(shown, await coveredTransactionIds(db, run.id)),
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
