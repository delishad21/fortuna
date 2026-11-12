import { ReviewRow } from "./reviews.service";
import { PrismaClient } from "@prisma/client";
import { ChatRepository } from "./chat.repository";
import {
  CHAT_LIMITS,
  ChatError,
  queuedEditSchema,
  submitMessageSchema,
} from "./contracts";
import {
  checkAttachments,
  dispatchQueue,
  lockUser,
  QUEUE_FULL,
  queuePosition,
  removeQueued,
  reviewSnapshot,
} from "./queue";
const ATTACHMENT_GONE =
  "An attachment is missing or expired. Please upload it again.";
export class ChatService extends ChatRepository {
  constructor(private client: PrismaClient) {
    super(client);
  }
  /**
   * Queues the message in its conversation and starts it right away when nothing is
   * replying there. Returns the run when it started, or its place in the queue.
   */
  async submitMessage(userId: string, conversationId: string, raw: unknown) {
    const input = submitMessageSchema.parse(raw);
    if (process.env.CHAT_ENABLED === "false")
      throw new ChatError(503, "Chat is temporarily disabled on this server");
    return this.client.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const conversation = await tx.chatConversation.findFirst({
        where: { id: conversationId, userId, deletedAt: null },
      });
      if (!conversation) throw new ChatError(404, "Conversation not found");
      const key = {
        userId_conversationId_idempotencyKey: {
          userId,
          conversationId,
          idempotencyKey: input.idempotencyKey,
        },
      };
      const repeated = await tx.chatRun.findUnique({ where: key });
      if (repeated) return { runId: repeated.id };
      const waiting = await tx.chatQueuedMessage.findUnique({ where: key });
      if (waiting)
        return {
          queued: true,
          queuedId: waiting.id,
          position: await queuePosition(tx, waiting),
        };
      const review = input.reviewId
        ? await tx.chatTransactionReview.findFirst({
            where: { id: input.reviewId, userId, conversationId },
          })
        : null;
      if (input.reviewId && (!review || review.status !== "pending"))
        throw new ChatError(409, "This review is closed");
      if (review && review.version !== input.reviewVersion)
        throw new ChatError(
          409,
          "Review changed on another device. Reload before sending.",
        );
      if (
        !(await tx.chatConnection.findFirst({
          where: { userId, selected: true, status: "connected" },
        }))
      )
        throw new ChatError(409, "Connect an AI provider in Settings first");
      if (
        (
          await checkAttachments(
            tx,
            userId,
            conversationId,
            input.attachmentIds,
          )
        ).problem ||
        (await tx.chatAttachment.count({
          where: { id: { in: input.attachmentIds }, userId, conversationId },
        })) !== input.attachmentIds.length
      )
        throw new ChatError(400, ATTACHMENT_GONE);
      if (
        (await tx.chatQueuedMessage.count({
          where: { conversationId, kind: "message" },
        })) >= CHAT_LIMITS.queuedPerConversation
      )
        throw new ChatError(409, QUEUE_FULL);
      const item = await tx.chatQueuedMessage.create({
        data: {
          userId,
          conversationId,
          idempotencyKey: input.idempotencyKey,
          text: input.text,
          attachmentIds: input.attachmentIds,
          ...(review
            ? {
                reviewId: review.id,
                reviewTitle: review.title,
                reviewRows: await reviewSnapshot(
                  tx,
                  review.rows as unknown as ReviewRow[],
                ),
              }
            : {}),
        },
      });
      // Locked while it waits: no edits, and it can't be sent twice.
      if (review)
        await tx.chatTransactionReview.update({
          where: { id: review.id },
          data: { status: "queued" },
        });
      const started = await dispatchQueue(tx, userId);
      const runId = started.get(item.id);
      if (runId) return { runId };
      const failed = await tx.chatQueuedMessage.findUnique({
        where: { id: item.id },
      });
      if (failed?.status === "failed")
        throw new ChatError(409, failed.error || "Message not sent");
      return {
        queued: true,
        queuedId: item.id,
        position: await queuePosition(tx, item),
      };
    });
  }
  /** Changes a message still waiting its turn; one that failed to start is queued again. */
  async editQueued(
    userId: string,
    conversationId: string,
    id: string,
    raw: unknown,
  ) {
    const input = queuedEditSchema.parse(raw);
    return this.client.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const item = await tx.chatQueuedMessage.findFirst({
        where: {
          id,
          userId,
          conversationId,
          conversation: { deletedAt: null },
        },
      });
      if (!item)
        throw new ChatError(
          409,
          "This message already started or was removed",
        );
      if (item.kind !== "message")
        throw new ChatError(400, "Only your own messages can be edited");
      if (!input.text && !input.attachmentIds.length && !item.reviewId)
        throw new ChatError(400, "Write a message or attach a statement");
      if (
        (await checkAttachments(tx, userId, conversationId, input.attachmentIds))
          .problem ||
        (await tx.chatAttachment.count({
          where: { id: { in: input.attachmentIds }, userId, conversationId },
        })) !== input.attachmentIds.length
      )
        throw new ChatError(400, ATTACHMENT_GONE);
      const retry = item.status === "failed";
      if (retry) {
        // Back to the end of the queue, after what was sent while it waited.
        await tx.$executeRaw`UPDATE chat_queued_messages SET queued_at=clock_timestamp() WHERE id=${id}`;
      }
      await tx.chatQueuedMessage.update({
        where: { id },
        data: {
          text: input.text,
          attachmentIds: input.attachmentIds,
          status: "queued",
          error: null,
        },
      });
      if (retry) await dispatchQueue(tx, userId);
      return this.queueOf(tx, userId, conversationId);
    });
  }
  /** Removes one queued message, or all of them; their reviews can be edited again. */
  async removeQueued(userId: string, conversationId: string, id?: string) {
    return this.client.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const removed = await removeQueued(tx, {
        userId,
        conversationId,
        ...(id ? { id } : {}),
      });
      if (id && !removed)
        throw new ChatError(
          409,
          "This message already started or was removed",
        );
      return this.queueOf(tx, userId, conversationId);
    });
  }
  private queueOf(
    tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
    userId: string,
    conversationId: string,
  ) {
    return tx.chatQueuedMessage.findMany({
      where: { userId, conversationId },
      orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
    });
  }
}
