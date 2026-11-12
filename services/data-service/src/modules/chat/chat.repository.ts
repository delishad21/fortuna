import { PrismaClient } from "@prisma/client";
import { cancelPending, expireProposals } from "./pending";
import { lockUser, removeQueued } from "./queue";
export class ChatRepository {
  constructor(private db: PrismaClient) {}
  createConversation(userId: string) {
    return this.db.chatConversation.create({ data: { userId } });
  }
  async getConversation(userId: string, id: string) {
    await expireProposals(this.db, { userId, conversationId: id });
    return this.db.chatConversation.findFirst({
      where: { id, userId, deletedAt: null },
      include: {
        messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        attachments: {
          include: {
            statementFile: {
              select: { filename: true, deletedAt: true },
            },
          },
        },
        queue: { orderBy: [{ queuedAt: "asc" }, { id: "asc" }] },
        runs: {
          orderBy: { createdAt: "desc" },
          take: 50,
          include: {
            proposals: true,
            reviews: {
              select: {
                id: true,
                title: true,
                status: true,
                version: true,
                decidedAt: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });
  }
  listConversations(userId: string) {
    return this.db.chatConversation.findMany({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true, title: true, updatedAt: true },
    });
  }
  async deleteConversation(userId: string, id: string) {
    // Soft-delete until active workers observe cancellation; finance records are never cascaded.
    return this.db.$transaction(async (tx) => {
      await lockUser(tx, userId);
      await removeQueued(tx, { userId, conversationId: id });
      await tx.chatRun.updateMany({
        where: {
          userId,
          conversationId: id,
          status: { in: ["queued", "running", "awaiting_confirmation"] },
        },
        data: { cancelRequested: true, status: "cancelled" },
      });
      await cancelPending(tx, { userId, conversationId: id });
      return tx.chatConversation.updateMany({
        where: { id, userId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    });
  }
}
