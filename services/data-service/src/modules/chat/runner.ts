import { ZodError } from "zod";
import { compactBlocks } from "./tools/components";
import { loadModelImages } from "./media";
import { MemoryService } from "./memories.service";
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
    where: { runId, status: "completed" },
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
) {
  const repo = new RunRepository(db),
    tools = createToolRegistry(db),
    controller = new AbortController();
  const signal = AbortSignal.any([parentSignal, controller.signal]);
  const started = Date.now();
  let lastProgress = started;
  let stopReason: "idle" | "limit" | "lease" | null = null;
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
      progress();
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
      stopReason === "limit"
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
