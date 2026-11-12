import { ZodError } from "zod";
import { compactBlocks } from "./tools/components";
import { loadModelImages } from "./media";
import { MemoryService } from "./memories.service";
import { pendingForModel } from "./pending";
import { ProviderMessage } from "./providers/provider";
import { safeChatError } from "./errors";
import { Prisma, PrismaClient } from "@prisma/client";
import { withDatabase } from "../../lib/database-context";
import { ChatProvider } from "./providers/provider";
import { ClaimedRun, RunRepository } from "./run.repository";
import { createToolRegistry } from "./tools/registry";
import { json, stateHash } from "./tools/transactions";
import { CHAT_LIMITS, ChatError, ToolResult } from "./contracts";
/** Tool output the user sees in the saved reply; everything else is for the model only. */
const USER_VISIBLE_BLOCKS = new Set(["link", "review", "component", "memory"]);
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
/** What the model is told when a tool fails for a reason that can't be shown. */
export function toolFailure(name: string) {
  return `${name} failed with an internal error, so nothing it would have done was done. Try it once more; if it fails again, tell the user it failed and carry on without it.`;
}
const READ_CALLS =
  CHAT_LIMITS.toolCalls - CHAT_LIMITS.toolCallsReservedForWrites;
/** Why the run's next tool call is refused, given the calls it already made; null when it may run. */
export function toolCallRefusal(used: number, readOnly: boolean) {
  const { toolCalls, toolCallsReservedForWrites } = CHAT_LIMITS;
  if (used >= toolCalls)
    return `Tool budget used up: this run has made all ${toolCalls} of its tool calls. Do not call more tools. Reply with what you have and tell the user what is left, so they can continue with another message.`;
  if (readOnly && used >= READ_CALLS)
    return `Tool budget used up for read-only tools: the last ${toolCallsReservedForWrites} of this run's ${toolCalls} tool calls are kept for write tools (staging, reviews, proposals, notes), and ${toolCalls - used} are left. Use them to save what you found, or reply with what you have.`;
  return null;
}
/** The remaining budget, told to the model with every tool result. */
export function toolBudgetNote(used: number) {
  const { toolCalls, toolCallsReservedForWrites } = CHAT_LIMITS;
  return `Tool budget: ${Math.max(0, toolCalls - used)} of ${toolCalls} calls left in this run, ${Math.max(0, READ_CALLS - used)} of them for read-only tools (the last ${toolCallsReservedForWrites} are kept for write tools).`;
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
/** The reply as the user sees it: steps taken, text, and what the tools displayed. */
async function replyBlocks(db: PrismaClient, runId: string, output: string) {
  const outcomes = await db.chatToolInvocation.findMany({
    where: { runId, status: { in: ["completed", "refused", "failed"] } },
    orderBy: { createdAt: "asc" },
  });
  const shown = outcomes.flatMap((v) =>
    (v.result as unknown as ToolResult).blocks.filter((b) =>
      USER_VISIBLE_BLOCKS.has(b.type),
    ),
  );
  const steps = outcomes.map((v) => {
    const first = (v.result as unknown as ToolResult).blocks[0];
    return { name: v.name, ok: first?.type !== "text" };
  });
  return [
    ...(steps.length ? [{ type: "activity", steps }] : []),
    { type: "text", text: output },
    ...dropRepeatedLists(shown, await coveredTransactionIds(db, runId)),
  ] as any[];
}
export async function executeRun(
  db: PrismaClient,
  run: ClaimedRun,
  provider: ChatProvider,
  parentSignal: AbortSignal,
  tools = createToolRegistry(db),
) {
  const repo = new RunRepository(db),
    controller = new AbortController();
  const signal = AbortSignal.any([parentSignal, controller.signal]);
  const started = Date.now();
  let lastProgress = started;
  let stopReason: "idle" | "limit" | "lease" | "tools" | null = null;
  const progress = () => {
    lastProgress = Date.now();
  };
  const stop = (reason: NonNullable<typeof stopReason>) => {
    stopReason ??= reason;
    controller.abort();
  };
  const heartbeat = setInterval(
    () => {
      const now = Date.now();
      if (now - started >= CHAT_LIMITS.runMilliseconds) return stop("limit");
      if (now - lastProgress >= CHAT_LIMITS.idleMilliseconds)
        return stop("idle");
      void repo
        .heartbeat(run)
        .then((ok) => {
          if (!ok) stop("lease");
        })
        .catch(() => stop("lease"));
    },
    Math.min(15000, CHAT_LIMITS.idleMilliseconds),
  );
  const context = {
    userId: run.userId,
    runId: run.id,
    conversationId: run.conversationId,
  };
  let output = "";
  let completed = false;
  let toolCalls = 0,
    refusedCalls = 0;
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
    const notes = await new MemoryService(db).forModel(run.userId);
    const messages: ProviderMessage[] = [
      ...(notes
        ? [{ role: "user" as const, content: JSON.stringify(notes) }]
        : []),
      ...history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: JSON.stringify(compactBlocks(m.blocks)),
      })),
    ];
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
      if (attached.length) messages[i + (notes ? 1 : 0)].images = attached;
    });
    // Approvals from earlier turns stay open; say so just before the newest message.
    const waiting = await pendingForModel(
      db,
      run.userId,
      run.conversationId,
      run.id,
    );
    if (waiting && history.length)
      messages.splice(messages.length - 1, 0, {
        role: "user",
        content: JSON.stringify(waiting),
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
      progress();
      const refusal = toolCallRefusal(toolCalls, tools.isReadOnly(name));
      if (refusal) {
        // Recorded like any other call, so the activity and run reports count it.
        const result: ToolResult = {
          blocks: [{ type: "text", text: refusal }],
        };
        await db.chatToolInvocation.upsert({
          where: { runId_callId: { runId: run.id, callId } },
          create: {
            ...context,
            callId,
            name,
            arguments: json(args),
            status: "refused",
            result: json(result),
          },
          update: {},
        });
        await repo.appendEvent(run, {
          type: "tool_result",
          name,
          result: json(result),
        });
        if (++refusedCalls > CHAT_LIMITS.refusedToolCalls) stop("tools");
        signal.throwIfAborted();
        return result;
      }
      toolCalls++;
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
        return {
          ...(previous.result as unknown as ToolResult),
          budget: toolBudgetNote(toolCalls),
        };
      if (previous && previous.status !== "failed" && !tools.isReadOnly(name))
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
      if (previous?.status === "failed")
        await db.chatToolInvocation.update({
          where: { id: invocation.id },
          data: { status: "running", result: Prisma.DbNull },
        });
      let result: ToolResult;
      let status = "completed";
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
        else {
          // Never leave the call recorded as running: say it failed, without internals.
          console.error(`Chat tool ${name} failed`, error);
          status = "failed";
          result = { blocks: [{ type: "text", text: toolFailure(name) }] };
        }
      }
      await db.chatToolInvocation.update({
        where: { id: invocation.id },
        data: { status, result: json(result) },
      });
      signal.throwIfAborted();
      progress();
      await repo.appendEvent(run, {
        type: "tool_result",
        name,
        result: json(result),
      });
      return { ...result, budget: toolBudgetNote(toolCalls) };
    };
    for await (const event of provider.run(
      { userId: run.userId, messages, tools: tools.definitions, executeTool },
      signal,
    )) {
      signal.throwIfAborted();
      progress();
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
    const blocks = await replyBlocks(db, run.id, output);
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
    const message =
      stopReason === "tools"
        ? `Stopped after the assistant kept calling tools once its ${CHAT_LIMITS.toolCalls}-call budget was used up. Everything prepared so far is kept below; send a message to continue.`
        : stopReason === "limit"
          ? "Stopped after 45 minutes. Everything prepared so far is kept below; send a message to continue."
          : stopReason === "idle"
            ? "Stopped after 10 minutes without progress. Everything prepared so far is kept below; send a message to continue."
            : signal.aborted
              ? "Conversation stopped. Everything prepared so far is kept below."
              : safeChatError(error) ||
                "The assistant could not finish. Check the provider connection and try again; everything prepared so far is kept below.";
    // Keep what the run already produced (reviews, proposals, components) reachable.
    const salvaged = await replyBlocks(db, run.id, output).catch(() => []);
    await repo
      .finish(
        run,
        "failed",
        json([
          ...salvaged.filter((b) => !(b.type === "text" && !b.text)),
          { type: "text", text: message },
        ]),
        message,
      )
      .catch(() => {});
  } finally {
    clearInterval(heartbeat);
    controller.abort();
  }
}
