import { PrismaClient } from "@prisma/client";
export class ChatRepository {
  constructor(private db: PrismaClient) {}
  createConversation(userId: string) {
    return this.db.chatConversation.create({ data: { userId } });
  }
  getConversation(userId: string, id: string) {
    return this.db.chatConversation.findFirst({
      where: { id, userId, deletedAt: null },
      include: {
        messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        attachments: {
          include: {
            statementFile: {
              select: { filename: true, expiresAt: true, deletedAt: true },
            },
          },
        },
        runs: {
          orderBy: { createdAt: "desc" },
          take: 50,
          include: { proposals: true },
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
      await tx.chatRun.updateMany({
        where: {
          userId,
          conversationId: id,
          status: { in: ["queued", "running", "awaiting_confirmation"] },
        },
        data: { cancelRequested: true, status: "cancelled" },
      });
      await tx.chatActionProposal.updateMany({
        where: { userId, conversationId: id, status: "pending" },
        data: { status: "rejected", decidedAt: new Date() },
      });
      return tx.chatConversation.updateMany({
        where: { id, userId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    });
  }
}
