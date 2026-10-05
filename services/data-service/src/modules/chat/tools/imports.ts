import { IMAGE_NOT_STATEMENT, isImageType } from "../media";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { withDatabase } from "../../../lib/database-context";
import { HermesWorkflowService as workflow } from "../../imports/hermes-workflow.service";
import { ChatError, idSchema, ChatContext } from "../contracts";
import {
  ActionHandler,
  PreparedAction,
  StaleAction,
  stateHash,
  json,
} from "./transactions";
const actor = { actorType: "system" as const, actorId: "fortuna-chat" };
export const commitDraftsSchema = z
  .object({
    kind: z.literal("commit_drafts"),
    draftIds: z.array(idSchema).min(1).max(20),
  })
  .strict()
  .refine(
    (v) => new Set(v.draftIds).size === v.draftIds.length,
    "Drafts must be unique",
  );
export class ImportActions implements ActionHandler {
  constructor(private db: PrismaClient) {}
  private async snapshot(
    tx: Prisma.TransactionClient,
    userId: string,
    draftIds: string[],
  ) {
    const drafts = await tx.importDraft.findMany({
      where: { id: { in: draftIds }, userId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        version: true,
        mode: true,
        targetTripId: true,
        sourceFile: {
          select: {
            id: true,
            deletedAt: true,
            retained: true,
            expiresAt: true,
          },
        },
        rows: {
          orderBy: { rowIndex: "asc" },
          select: {
            id: true,
            version: true,
            selected: true,
            currentPayload: true,
          },
        },
        proposals: {
          orderBy: { id: "asc" },
          select: { id: true, status: true, payloadHash: true },
        },
      },
    });
    if (drafts.length !== draftIds.length)
      throw new ChatError(404, "Import draft not found");
    const ledger = await tx.transaction.findMany({
      where: { userId },
      orderBy: { id: "asc" },
      select: { id: true, updatedAt: true },
    });
    return { drafts, ledger };
  }
  async prepare(userId: string, raw: unknown): Promise<PreparedAction> {
    const input = commitDraftsSchema.parse(raw);
    return withDatabase(this.db, async () => {
      const review = await workflow.prepareSelection(
        userId,
        input.draftIds,
        actor,
      );
      return {
        kind: input.kind,
        arguments: json(input),
        stateHash: stateHash(
          await this.snapshot(this.db, userId, input.draftIds),
        ),
        preview: json({
          title: "Commit staged imports",
          valid: review.valid,
          duplicates: review.duplicates,
          drafts: review.validations.map(
            ({ draftId, filename, validation }) => ({
              draftId,
              filename,
              valid: validation.valid,
              errors: validation.errors,
              warnings: validation.warnings,
              summary: validation.summary,
            }),
          ),
        }),
      };
    });
  }
  async execute(
    tx: Prisma.TransactionClient,
    userId: string,
    raw: unknown,
    expectedHash: string,
    duplicateOverride: boolean,
  ) {
    const input = commitDraftsSchema.parse(raw);
    await tx.$queryRaw`SELECT id FROM import_drafts WHERE user_id=${userId} AND id IN (${Prisma.join(input.draftIds)}) ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT r.id FROM import_draft_rows r JOIN import_drafts d ON d.id=r.draft_id WHERE d.user_id=${userId} AND d.id IN (${Prisma.join(input.draftIds)}) ORDER BY r.id FOR UPDATE OF r`;
    await tx.$queryRaw`SELECT id FROM transactions WHERE user_id=${userId} ORDER BY id FOR UPDATE`;
    if (
      stateHash(await this.snapshot(tx, userId, input.draftIds)) !==
      expectedHash
    )
      throw new StaleAction(
        "The selected imports or saved transactions changed",
      );
    const review = await workflow.prepareSelection(
      userId,
      input.draftIds,
      actor,
    );
    if (!review.valid)
      throw new ChatError(
        409,
        "Some source rows require review. Open the staged imports from the preview.",
      );
    if (review.duplicates.length && !duplicateOverride)
      throw new ChatError(
        409,
        "Review the duplicate matches and explicitly choose to commit them anyway.",
      );
    const items = review.validations.map((item) => {
      const validation = item.validation;
      if (!("confirmationToken" in validation) || !validation.confirmationToken)
        throw new ChatError(409, "Draft validation requires review");
      return { draftId: item.draftId, confirmationToken: validation.confirmationToken };
    });
    // One commit for every selected import, so links between them are kept.
    const results = await workflow.commitDrafts(userId, items, true, {
      actorType: "user",
      actorId: userId,
    });
    return json({ draftResults: results });
  }
}
export class ImportTools {
  constructor(private db: PrismaClient) {}
  async list(userId: string) {
    return workflow.listDrafts(userId);
  }
  async inspect(userId: string, raw: unknown) {
    const { draftId } = z.object({ draftId: idSchema }).strict().parse(raw);
    return workflow.getDraft(userId, draftId);
  }
  async stage(context: ChatContext, raw: unknown) {
    const input = z
      .object({
        attachmentId: idSchema,
        parserId: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
        mode: z.enum(["main", "trip"]).default("main"),
        targetTripId: idSchema.optional(),
      })
      .strict()
      .parse(raw);
    const attachment = await this.db.chatAttachment.findFirst({
      where: {
        id: input.attachmentId,
        userId: context.userId,
        conversationId: context.conversationId,
      },
      include: { statementFile: true },
    });
    if (
      !attachment ||
      attachment.statementFile.deletedAt ||
      (!attachment.statementFile.retained &&
        attachment.statementFile.expiresAt <= new Date())
    )
      throw new ChatError(
        404,
        "Statement expired or missing. Upload it again.",
      );
    if (isImageType(attachment.statementFile.contentType))
      throw new ChatError(400, IMAGE_NOT_STATEMENT);
    const draft = await workflow.createDraft(
      context.userId,
      {
        fileRef: attachment.statementFileId,
        mode: input.mode,
        parserId: input.parserId,
        targetTripId: input.targetTripId,
      },
      actor,
    );
    if (draft.rows.length) return draft;
    return workflow.parseDraft(context.userId, draft.id, input.parserId, actor);
  }
  async assign(context: ChatContext, raw: unknown) {
    const input = z
      .object({
        draftId: idSchema,
        expectedVersion: z.number().int().positive(),
        accountIdentifier: z.string().min(1).max(120),
        selectedOnly: z.boolean().default(true),
      })
      .strict()
      .parse(raw);
    return workflow.assignDraftAccount(
      context.userId,
      input.draftId,
      input,
      actor,
    );
  }
  async labels(context: ChatContext, raw: unknown) {
    const input = z
      .object({
        draftId: idSchema,
        inputVersion: z.number().int().positive(),
        proposals: z
          .array(
            z
              .object({
                draftRowId: idSchema,
                inputRowVersion: z.number().int().positive(),
                proposedLabel: z.string().max(500).nullable().optional(),
                proposedCategoryId: idSchema.nullable().optional(),
                confidence: z.number().min(0).max(1),
                reason: z.string().min(1).max(2000),
                idempotencyKey: z.string().min(8).max(160),
              })
              .strict(),
          )
          .min(1)
          .max(100),
      })
      .strict()
      .parse(raw);
    const run = await this.db.chatRun.findFirstOrThrow({
      where: { id: context.runId, userId: context.userId },
    });
    return workflow.submitProposals(
      context.userId,
      input.draftId,
      {
        ...input,
        model: run.model,
        effort: run.effort || undefined,
        promptVersion: "fortuna-chat-v1",
        proposals: input.proposals.map((p) => ({
          ...p,
          idempotencyKey: stateHash([
            context.userId,
            context.runId,
            p.idempotencyKey,
          ]),
        })),
      },
      actor,
    );
  }
}
