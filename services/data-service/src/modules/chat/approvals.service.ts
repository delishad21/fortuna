import { PrismaClient } from "@prisma/client";
import { withTransactionClient } from "../../lib/database-context";
import { ChatContext, ChatError } from "./contracts";
import { ActionHandler, StaleAction, json } from "./tools/transactions";
export class ApprovalService {
  constructor(
    private db: PrismaClient,
    private handler: ActionHandler,
  ) {}
  async proposeAction(context: ChatContext, input: unknown) {
    const run = await this.db.chatRun.findFirst({
      where: {
        id: context.runId,
        userId: context.userId,
        conversationId: context.conversationId,
        cancelRequested: false,
        conversation: { deletedAt: null },
      },
    });
    if (!run) throw new ChatError(404, "Run not found");
    const prepared = await this.handler.prepare(context.userId, input);
    return this.db.chatActionProposal.create({
      data: {
        ...context,
        ...prepared,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
  }
  async refreshAction(userId: string, proposalId: string) {
    const old = await this.db.chatActionProposal.findFirst({
      where: {
        id: proposalId,
        userId,
        run: { cancelRequested: false, conversation: { deletedAt: null } },
      },
    });
    if (!old || !["stale", "pending"].includes(old.status))
      throw new ChatError(409, "This proposal cannot be refreshed");
    const prepared = await this.handler.prepare(userId, old.arguments);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM chat_action_proposals WHERE id=${proposalId} AND user_id=${userId} FOR UPDATE`;
      const current = await tx.chatActionProposal.findUniqueOrThrow({
        where: { id: proposalId },
      });
      if (!["stale", "pending"].includes(current.status))
        throw new ChatError(409, "Proposal already decided");
      if (
        await tx.chatRun.count({
          where: {
            userId,
            id: { not: old.runId },
            status: { in: ["queued", "running", "awaiting_confirmation"] },
          },
        })
      )
        throw new ChatError(
          409,
          "Finish or stop your active conversation first",
        );
      const existing = await tx.chatActionProposal.findFirst({
        where: {
          userId,
          runId: old.runId,
          status: "pending",
          stateHash: prepared.stateHash,
          kind: prepared.kind,
          arguments: { equals: prepared.arguments },
          id: { not: old.id },
        },
      });
      if (existing) return existing;
      await tx.chatActionProposal.update({
        where: { id: old.id },
        data: { status: "stale" },
      });
      const fresh = await tx.chatActionProposal.create({
        data: {
          userId,
          runId: old.runId,
          conversationId: old.conversationId,
          ...prepared,
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      await tx.chatRun.updateMany({
        where: {
          id: old.runId,
          status: { in: ["completed", "awaiting_confirmation"] },
        },
        data: { status: "awaiting_confirmation" },
      });
      await tx.chatMessage.create({
        data: {
          userId,
          conversationId: old.conversationId,
          role: "assistant",
          blocks: json([
            {
              type: "text",
              text: "The preview has been refreshed. Review it before confirming.",
            },
            {
              type: "link",
              kind: "proposal",
              id: fresh.id,
              label: "Review changes",
            },
          ]),
        },
      });
      return fresh;
    });
  }
  async decideAction(
    userId: string,
    proposalId: string,
    decision: "approve" | "reject",
    duplicateOverride = false,
  ) {
    const effects: Array<() => Promise<void>> = [];
    const result = await this.db.$transaction(
      async (tx) =>
        withTransactionClient(
          tx,
          async () => {
            await tx.$queryRaw`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
            await tx.$queryRaw`SELECT id FROM chat_action_proposals WHERE id=${proposalId} AND user_id=${userId} FOR UPDATE`;
            const proposal = await tx.chatActionProposal.findFirst({
              where: {
                id: proposalId,
                userId,
                run: { conversation: { deletedAt: null } },
              },
            });
            if (!proposal) throw new ChatError(404, "Proposal not found");
            if (proposal.status !== "pending")
              return { status: proposal.status, result: proposal.result };
            if (decision === "reject") {
              await tx.chatActionProposal.update({
                where: { id: proposalId },
                data: { status: "rejected", decidedAt: new Date() },
              });
              await tx.chatMessage.create({
                data: {
                  userId,
                  conversationId: proposal.conversationId,
                  role: "assistant",
                  blocks: json([
                    {
                      type: "text",
                      text: "The user rejected the proposed changes. Do not retry them without a new request.",
                    },
                  ]),
                },
              });
              return { status: "rejected", result: null };
            }
            const run = await tx.chatRun.findUniqueOrThrow({
              where: { id: proposal.runId },
            });
            if (run.cancelRequested)
              throw new ChatError(409, "This conversation run was stopped");
            if (proposal.expiresAt <= new Date()) {
              await tx.chatActionProposal.update({
                where: { id: proposalId },
                data: { status: "stale" },
              });
              return { status: "stale", result: null };
            }
            let outcome;
            try {
              outcome = await this.handler.execute(
                tx,
                userId,
                proposal.arguments,
                proposal.stateHash,
                duplicateOverride,
              );
            } catch (error) {
              if (error instanceof StaleAction) {
                await tx.chatActionProposal.update({
                  where: { id: proposalId },
                  data: { status: "stale" },
                });
                return { status: "stale", result: null };
              }
              throw error;
            }
            await tx.chatActionProposal.update({
              where: { id: proposalId },
              data: {
                status: "applied",
                result: outcome,
                decidedAt: new Date(),
              },
            });
            await tx.agentAuditEvent.create({
              data: {
                userId,
                actorType: "user",
                actorId: userId,
                toolName: "chat_action_applied",
                targetType: "chat_proposal",
                targetId: proposalId,
                beforeValue: json(proposal.preview),
                afterValue: outcome,
              },
            });
            await tx.chatMessage.create({
              data: {
                userId,
                conversationId: proposal.conversationId,
                role: "assistant",
                blocks: json([
                  { type: "text", text: "Changes applied." },
                  { type: "data", title: "Applied action", data: outcome },
                ]),
              },
            });
            return { status: "applied", result: outcome };
          },
          effects,
        ),
      { timeout: 60000 },
    );
    for (const effect of effects) await effect().catch(() => {});
    // Retried decisions also reconcile the continuation if the process stopped after commit.
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
      const proposal = await tx.chatActionProposal.findFirst({
        where: { id: proposalId, userId },
        include: { run: true },
      });
      if (
        !proposal ||
        (await tx.chatActionProposal.count({
          where: { runId: proposal.runId, status: "pending" },
        }))
      )
        return;
      const run = proposal.run;
      if (
        run.cancelRequested ||
        !["awaiting_confirmation", "completed"].includes(run.status)
      )
        return;
      await tx.chatRun.updateMany({
        where: { id: run.id, status: "awaiting_confirmation" },
        data: { status: "completed" },
      });
      if (!["applied", "rejected"].includes(proposal.status)) return;
      const key = "continuation-" + run.id;
      if (
        await tx.chatRun.findUnique({
          where: {
            userId_conversationId_idempotencyKey: {
              userId,
              conversationId: run.conversationId,
              idempotencyKey: key,
            },
          },
        })
      )
        return;
      if (
        await tx.chatRun.count({
          where: {
            userId,
            status: { in: ["queued", "running", "awaiting_confirmation"] },
          },
        })
      )
        return;
      const connection = await tx.chatConnection.findFirst({
        where: {
          userId,
          provider: run.provider,
          selected: true,
          status: "connected",
          generation: run.connectionGeneration,
        },
      });
      if (!connection) return;
      await tx.chatRun.create({
        data: {
          userId,
          conversationId: run.conversationId,
          idempotencyKey: key,
          provider: run.provider,
          model: run.model,
          effort: run.effort,
          connectionGeneration: connection.generation,
        },
      });
    });
    return result;
  }
}
