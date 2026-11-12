import { Prisma, PrismaClient, ChatRun } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ChatError } from "./contracts";
import { cancelPending } from "./pending";
import { dispatchQueue, dispatchQueueNow, lockUser, removeQueued } from "./queue";
export type ClaimedRun = ChatRun & { leaseToken: string };
export class RunRepository {
  constructor(private db: PrismaClient) {}
  async claimRun(): Promise<ClaimedRun | null> {
    // A run interrupted too often fails; what was queued behind it goes next.
    const abandoned = await this.db.$queryRaw<Array<{ user_id: string }>>`
      UPDATE chat_runs SET status='failed', lease_until=NULL, updated_at=NOW(),
        error='Run interrupted repeatedly. Your saved data is preserved.'
      WHERE status='running' AND lease_until<NOW() AND attempts>=3
      RETURNING user_id`;
    for (const userId of new Set(abandoned.map((r) => r.user_id)))
      await dispatchQueueNow(this.db, userId);
    return this.db.$transaction(async (tx) => {
      const ids = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM chat_runs WHERE cancel_requested=false AND (status='queued' OR (status='running' AND lease_until<NOW() AND attempts<3)) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!ids.length) return null;
      return (await tx.chatRun.update({
        where: { id: ids[0].id },
        data: {
          status: "running",
          leaseToken: randomUUID(),
          leaseUntil: new Date(Date.now() + 60000),
          attempts: { increment: 1 },
        },
      })) as ClaimedRun;
    });
  }
  async heartbeat(run: ClaimedRun) {
    const result = await this.db.chatRun.updateMany({
      where: {
        id: run.id,
        leaseToken: run.leaseToken,
        status: "running",
        cancelRequested: false,
        leaseUntil: { gt: new Date() },
      },
      data: { leaseUntil: new Date(Date.now() + 60000) },
    });
    return result.count === 1;
  }
  async appendEvent(run: ClaimedRun, payload: Prisma.InputJsonValue) {
    return this.db.$transaction(async (tx) => {
      const updated = await tx.chatRun.updateMany({
        where: {
          id: run.id,
          userId: run.userId,
          leaseToken: run.leaseToken,
          status: "running",
          cancelRequested: false,
          leaseUntil: { gt: new Date() },
        },
        data: { nextSequence: { increment: 1 } },
      });
      if (!updated.count) throw new ChatError(409, "Run is no longer active");
      const latest = await tx.chatRun.findUniqueOrThrow({
        where: { id: run.id },
      });
      return tx.chatRunEvent.create({
        data: {
          userId: run.userId,
          conversationId: run.conversationId,
          runId: run.id,
          sequence: latest.nextSequence,
          payload,
        },
      });
    });
  }
  async listEvents(userId: string, runId: string, after: number) {
    if (!Number.isSafeInteger(after) || after < 0)
      throw new ChatError(400, "Invalid event cursor");
    const run = await this.db.chatRun.findFirst({
      where: { id: runId, userId, conversation: { deletedAt: null } },
    });
    if (!run) throw new ChatError(404, "Run not found");
    const events = await this.db.chatRunEvent.findMany({
      where: { userId, runId, sequence: { gt: after } },
      orderBy: { sequence: "asc" },
      take: 100,
    });
    // A queued run that other runs are ahead of waits for the worker; the UI says so.
    const queued =
      run.status === "queued" &&
      (await this.db.chatRun.count({
        where: { status: "running", id: { not: run.id } },
      })) > 0;
    return {
      events,
      status: run.status,
      queued,
      error: run.error,
      cursor: events.at(-1)?.sequence || after,
    };
  }
  /** Stops one reply. Messages queued behind it are kept (and the next starts) or cleared. */
  async cancelRun(
    userId: string,
    runId: string,
    queue: "keep" | "clear" = "keep",
  ) {
    return this.db.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const run = await tx.chatRun.findFirst({ where: { id: runId, userId } });
      if (run && queue === "clear")
        await removeQueued(tx, {
          userId,
          conversationId: run.conversationId,
        });
      const count = await tx.chatRun.updateMany({
        where: {
          id: runId,
          userId,
          status: { in: ["queued", "running", "awaiting_confirmation"] },
        },
        data: { cancelRequested: true, status: "cancelled" },
      });
      // Stopping a run closes what it left waiting; only an active run can be stopped.
      if (count.count) await cancelPending(tx, { userId, runId });
      await dispatchQueue(tx, userId);
      return { cancelled: count.count > 0 };
    });
  }
  async finish(
    run: ClaimedRun,
    status: "completed" | "awaiting_confirmation" | "failed",
    blocks: Prisma.InputJsonValue,
    error?: string,
  ) {
    return this.db.$transaction(async (tx) => {
      await lockUser(tx, run.userId);
      const changed = await tx.chatRun.updateMany({
        where: {
          id: run.id,
          leaseToken: run.leaseToken,
          status: "running",
          cancelRequested: false,
          leaseUntil: { gt: new Date() },
        },
        data: { status, error: error || null, leaseUntil: null },
      });
      if (!changed.count) throw new ChatError(409, "Run is no longer active");
      await tx.chatMessage.create({
        data: {
          userId: run.userId,
          conversationId: run.conversationId,
          role: "assistant",
          blocks,
        },
      });
      // The next queued message, here or in a conversation held back by the cap, goes now.
      await dispatchQueue(tx, run.userId);
    });
  }
}
