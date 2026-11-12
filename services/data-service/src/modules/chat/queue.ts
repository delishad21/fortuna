import { ChatQueuedMessage, Prisma, PrismaClient } from "@prisma/client";
import { CHAT_LIMITS, SUBMITTED_REVIEW_TITLE } from "./contracts";
import { ReviewRow, withLiveStagedRows } from "./reviews.service";
import { json } from "./tools/transactions";
/**
 * Each conversation has a first-in, first-out queue of messages sent while it was replying.
 * The oldest queued message becomes the conversation's next run as soon as nothing is queued
 * for the worker or running there, and the user's runs are under the per-user cap. Every
 * path that queues, edits, removes, finishes or stops takes the user's row lock first and
 * then calls `dispatchQueue`, so two finishing paths can never start the same message: the
 * second one finds it already gone, and the run's idempotency key (the message's) is unique.
 */
type Tx = Prisma.TransactionClient;
export const lockUser = (tx: Tx, userId: string) =>
  tx.$queryRaw`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
export const QUEUE_FULL = `This conversation already has ${CHAT_LIMITS.queuedPerConversation} messages waiting. Wait for one to start, or remove one.`;
/** What the model is told when a queued review's rows changed before its turn. */
export const CHANGED_REVIEW_NOTE =
  "Some rows changed after the user queued this review (edited elsewhere, or no longer staged). The user's edits for those rows may no longer apply: re-read them before acting on them, and tell the user which ones changed.";
const order: Prisma.ChatQueuedMessageOrderByWithRelationInput[] = [
  { queuedAt: "asc" },
  { id: "asc" },
];
export type QueueAttachment = {
  id: string;
  filename: string;
  mediaType: "image" | "statement";
};
/** The attachments as message blocks, or why they can't be sent. */
export async function checkAttachments(
  tx: Tx,
  userId: string,
  conversationId: string,
  ids: string[],
): Promise<{ files: QueueAttachment[]; problem: string | null }> {
  if (!ids.length) return { files: [], problem: null };
  const found = await tx.chatAttachment.findMany({
    where: { id: { in: ids }, userId, conversationId },
    include: { statementFile: true },
  });
  const byId = new Map(found.map((f) => [f.id, f]));
  const gone = ids.flatMap((id) => {
    const f = byId.get(id);
    if (!f) return ["an attachment"];
    const file = f.statementFile;
    return file.deletedAt ? [file.filename] : [];
  });
  return {
    files: ids.flatMap((id) => {
      const f = byId.get(id);
      return f
        ? [
            {
              id: f.id,
              filename: f.statementFile.filename,
              mediaType: f.statementFile.contentType.startsWith("image/")
                ? ("image" as const)
                : ("statement" as const),
            },
          ]
        : [];
    }),
    problem: gone.length
      ? `${gone.join(", ")} ${gone.length === 1 ? "was" : "were"} deleted`
      : null,
  };
}
/** Each review row's version as it stands now, to compare against at the review's turn. */
export async function reviewSnapshot(tx: Tx, rows: ReviewRow[]) {
  return (await withLiveStagedRows(tx, rows)).map((r) => ({
    id: r.id,
    version: r.version,
  }));
}
/** The review's rows that changed or disappeared since it was queued. */
async function changedReviewRows(
  tx: Tx,
  userId: string,
  rows: ReviewRow[],
  snapshot: Array<{ id: string; version: number }>,
) {
  const queuedVersion = new Map(snapshot.map((r) => [r.id, r.version]));
  const stagedIds = rows.flatMap((r) => (r.source.rowId ? [r.source.rowId] : []));
  const savedIds = rows.flatMap((r) =>
    r.source.transactionId ? [r.source.transactionId] : [],
  );
  const [staged, saved] = await Promise.all([
    tx.importDraftRow.findMany({
      where: {
        id: { in: stagedIds },
        draft: { userId, status: { notIn: ["committed", "discarded"] } },
      },
      select: { id: true, version: true },
    }),
    tx.transaction.findMany({
      where: { id: { in: savedIds }, userId },
      select: { id: true },
    }),
  ]);
  const live = new Map(staged.map((r) => [r.id, r.version]));
  const kept = new Set(saved.map((t) => t.id));
  return rows.flatMap((row) => {
    const description = String(row.value?.description ?? row.id);
    if (row.source.rowId) {
      const version = live.get(row.source.rowId);
      if (version === undefined)
        return [{ rowId: row.id, description, reason: "no longer staged" }];
      if (version !== queuedVersion.get(row.id))
        return [
          { rowId: row.id, description, reason: "changed after you queued it" },
        ];
      return [];
    }
    return row.source.transactionId && !kept.has(row.source.transactionId)
      ? [{ rowId: row.id, description, reason: "deleted" }]
      : [];
  });
}
/** A time after the conversation's last message, so the new turn always sorts after it. */
async function nextMessageTime(tx: Tx, conversationId: string) {
  const last = await tx.chatMessage.findFirst({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const now = Date.now();
  return new Date(
    last && last.createdAt.getTime() >= now ? last.createdAt.getTime() + 1 : now,
  );
}
const fail = (tx: Tx, item: ChatQueuedMessage, error: string) =>
  tx.chatQueuedMessage.update({
    where: { id: item.id },
    data: { status: "failed", error },
  });
/** Turns one queued message into the conversation's next user message and run. */
async function startQueued(
  tx: Tx,
  item: ChatQueuedMessage,
): Promise<string | null> {
  const conversation = await tx.chatConversation.findFirst({
    where: { id: item.conversationId, userId: item.userId, deletedAt: null },
  });
  if (!conversation) {
    await tx.chatQueuedMessage.delete({ where: { id: item.id } });
    return null;
  }
  const connection = await tx.chatConnection.findFirst({
    where: { userId: item.userId, selected: true, status: "connected" },
  });
  if (!connection) {
    await fail(tx, item, "Not sent: connect an AI provider in Settings, then retry.");
    return null;
  }
  if (item.kind === "continuation") {
    // A reply that started after the approval already saw its outcome.
    if (
      await tx.chatRun.count({
        where: {
          conversationId: item.conversationId,
          createdAt: { gte: item.createdAt },
        },
      })
    ) {
      await tx.chatQueuedMessage.delete({ where: { id: item.id } });
      return null;
    }
  } else {
    const ids = item.attachmentIds as string[];
    const { files, problem } = await checkAttachments(
      tx,
      item.userId,
      item.conversationId,
      ids,
    );
    if (problem) {
      await fail(
        tx,
        item,
        `Not sent: ${problem} while this message waited. Remove the file and attach it again, or remove this message.`,
      );
      return null;
    }
    const review = item.reviewId
      ? await tx.chatTransactionReview.findFirst({
          where: { id: item.reviewId, userId: item.userId },
        })
      : null;
    if (item.reviewId && review?.status !== "queued") {
      await fail(tx, item, "Not sent: this review was closed while it waited.");
      return null;
    }
    let reviewBlock: Record<string, unknown> | null = null;
    if (review) {
      const rows = review.rows as unknown as ReviewRow[];
      const changed = await changedReviewRows(
        tx,
        item.userId,
        rows,
        (item.reviewRows as Array<{ id: string; version: number }>) || [],
      );
      reviewBlock = {
        type: "data",
        title: SUBMITTED_REVIEW_TITLE,
        data: {
          reviewId: review.id,
          title: review.title,
          rows: await withLiveStagedRows(tx, rows),
          ...(changed.length
            ? { changedSinceQueued: changed, note: CHANGED_REVIEW_NOTE }
            : {}),
        },
      };
      await tx.chatTransactionReview.update({
        where: { id: review.id },
        data: { status: "submitted" },
      });
    }
    await tx.chatMessage.create({
      data: {
        userId: item.userId,
        conversationId: item.conversationId,
        role: "user",
        createdAt: await nextMessageTime(tx, item.conversationId),
        blocks: json([
          { type: "text", text: item.text },
          ...(reviewBlock ? [reviewBlock] : []),
          ...files.map((f) => ({ type: "attachment", ...f })),
        ]),
      },
    });
    await tx.chatConversation.update({
      where: { id: item.conversationId },
      data: {
        updatedAt: new Date(),
        ...(conversation.title === "New conversation"
          ? { title: item.text.slice(0, 80) || "Statement import" }
          : {}),
      },
    });
  }
  // The new turn moves on without deciding anything: the waiting run is done, and its
  // proposals and reviews stay pending until the user confirms, rejects or submits them.
  await tx.chatRun.updateMany({
    where: { conversationId: item.conversationId, status: "awaiting_confirmation" },
    data: { status: "completed" },
  });
  const run = await tx.chatRun.create({
    data: {
      userId: item.userId,
      conversationId: item.conversationId,
      idempotencyKey: item.idempotencyKey,
      provider: connection.provider,
      model:
        connection.provider === "codex" ? "gpt-6-luna" : "openai/gpt-6-luna-pro",
      effort: connection.provider === "codex" ? "max" : null,
      connectionGeneration: connection.generation,
    },
  });
  await tx.chatQueuedMessage.delete({ where: { id: item.id } });
  return run.id;
}
/**
 * Starts the next queued message of each of the user's idle conversations, oldest first,
 * while the user's queued-or-running runs are under the cap. A message that can't start is
 * marked failed with the reason and the one after it goes instead. Call with the user locked.
 * Returns the started runs by queued message id.
 */
export async function dispatchQueue(tx: Tx, userId: string) {
  const started = new Map<string, string>();
  let active = await tx.chatRun.count({
    where: { userId, status: { in: ["queued", "running"] } },
  });
  if (active >= CHAT_LIMITS.activeRunsPerUser) return started;
  const waiting = await tx.$queryRaw<Array<{ conversation_id: string }>>`
    SELECT q.conversation_id FROM chat_queued_messages q
    WHERE q.user_id=${userId} AND q.status='queued'
      AND NOT EXISTS (SELECT 1 FROM chat_runs r WHERE r.conversation_id=q.conversation_id
                      AND r.status IN ('queued','running'))
    GROUP BY q.conversation_id ORDER BY MIN(q.queued_at)`;
  for (const { conversation_id: conversationId } of waiting) {
    if (active >= CHAT_LIMITS.activeRunsPerUser) break;
    for (;;) {
      const next = await tx.chatQueuedMessage.findFirst({
        where: { userId, conversationId, status: "queued" },
        orderBy: order,
      });
      if (!next) break;
      const runId = await startQueued(tx, next);
      if (runId) {
        started.set(next.id, runId);
        active++;
        break;
      }
    }
  }
  return started;
}
/** Runs `dispatchQueue` in its own transaction, for paths that finished outside one. */
export const dispatchQueueNow = (db: PrismaClient, userId: string) =>
  db.$transaction(async (tx) => {
    await lockUser(tx, userId);
    return dispatchQueue(tx, userId);
  });
/** A queued message's place in its conversation's queue, from 1. */
export async function queuePosition(tx: Tx, item: ChatQueuedMessage) {
  return (
    (await tx.chatQueuedMessage.count({
      where: {
        conversationId: item.conversationId,
        status: "queued",
        OR: [
          { queuedAt: { lt: item.queuedAt } },
          { queuedAt: item.queuedAt, id: { lt: item.id } },
        ],
      },
    })) + 1
  );
}
/** Returns a queued review to the user, editable again. */
async function releaseReview(tx: Tx, item: ChatQueuedMessage) {
  if (item.reviewId)
    await tx.chatTransactionReview.updateMany({
      where: { id: item.reviewId, status: "queued" },
      data: { status: "pending" },
    });
}
/** Removes queued messages (all of the conversation's, or one) and unlocks their reviews. */
export async function removeQueued(
  tx: Tx,
  where: { userId: string; conversationId: string; id?: string },
) {
  const items = await tx.chatQueuedMessage.findMany({ where });
  for (const item of items) await releaseReview(tx, item);
  await tx.chatQueuedMessage.deleteMany({
    where: { id: { in: items.map((i) => i.id) } },
  });
  return items.length;
}
/** Queues the run that picks up after an approval, behind whatever is already waiting. */
export async function queueContinuation(
  tx: Tx,
  run: { id: string; userId: string; conversationId: string },
) {
  const key = "continuation-" + run.id;
  const where = {
    userId: run.userId,
    conversationId: run.conversationId,
    idempotencyKey: key,
  };
  if (
    (await tx.chatRun.findUnique({
      where: { userId_conversationId_idempotencyKey: where },
    })) ||
    (await tx.chatQueuedMessage.findUnique({
      where: { userId_conversationId_idempotencyKey: where },
    }))
  )
    return;
  await tx.chatQueuedMessage.create({ data: { ...where, kind: "continuation" } });
}
