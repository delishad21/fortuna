import { IMAGE_NOT_STATEMENT, isImageType } from "../media";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { withDatabase } from "../../../lib/database-context";
import { HermesWorkflowService as workflow } from "../../imports/hermes-workflow.service";
import { ChatError, idSchema, ChatContext } from "../contracts";
import { paylahHint } from "../../imports/paylah-emails";
import { draftAmountIssues } from "../../imports/draft-review";
import { rowSchema } from "./documents";
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
/** Rows whose amounts look wrong, so the chat raises them before anything else. */
function amountIssueHint(draft: {
  mode?: string;
  rows: Array<{ rowIndex: number; currentPayload: unknown }>;
}) {
  const issues = draftAmountIssues(
    draft.rows.map((row) => row.currentPayload),
    { runningBalance: draft.mode !== "trip" },
  );
  const amountIssues = draft.rows.flatMap((row, index) =>
    issues[index].errors.length || issues[index].warnings.length
      ? [{ rowIndex: row.rowIndex, errors: issues[index].errors, warnings: issues[index].warnings }]
      : [],
  );
  return amountIssues.length
    ? {
        amountIssues,
        amountIssuesNote:
          "These rows' amounts don't match the statement as parsed. Tell the user before suggesting labels; don't commit until they're fixed.",
      }
    : {};
}
export class ImportTools {
  constructor(private db: PrismaClient) {}
  async list(userId: string) {
    return workflow.listDrafts(userId);
  }
  async inspect(userId: string, raw: unknown) {
    const { draftId } = z.object({ draftId: idSchema }).strict().parse(raw);
    const draft = await workflow.getDraft(userId, draftId);
    return { ...draft, ...paylahHint(draft.rows, "chat") };
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
    const staged = draft.rows.length
      ? draft
      : await workflow.parseDraft(context.userId, draft.id, input.parserId, actor);
    return { ...staged, ...amountIssueHint(staged) };
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
  /**
   * Edit staged rows through the same path as the staged import page, writing each row's
   * full current payload with only description, label, category and metadata changed.
   * Amounts, dates, accounts and links stay as the bank row has them. Nothing is committed.
   */
  async editRows(context: ChatContext, raw: unknown) {
    const metadataValue = z.union([
      z.string().max(500),
      z.number(),
      z.boolean(),
      z.null(),
    ]);
    const input = z
      .object({
        draftId: idSchema,
        rows: z
          .array(
            z
              .object({
                rowId: idSchema,
                version: z.number().int().positive(),
                description: z.string().trim().min(1).max(500).optional(),
                label: z.string().max(500).nullable().optional(),
                categoryId: idSchema.nullable().optional(),
                metadata: z
                  .record(z.string().min(1).max(64), metadataValue)
                  .refine((m) => Object.keys(m).length <= 20, "At most 20 metadata keys")
                  .optional(),
              })
              .strict(),
          )
          .min(1)
          .max(100)
          .refine(
            (rows) => new Set(rows.map((r) => r.rowId)).size === rows.length,
            "Rows must be unique",
          ),
      })
      .strict()
      .parse(raw);
    const categoryIds = [
      ...new Set(input.rows.map((r) => r.categoryId).filter(Boolean) as string[]),
    ];
    if (
      categoryIds.length &&
      (await this.db.category.count({
        where: { id: { in: categoryIds }, userId: context.userId },
      })) !== categoryIds.length
    )
      throw new ChatError(404, "Category not found; use IDs from get_context");
    const rows = await this.db.importDraftRow.findMany({
      where: {
        id: { in: input.rows.map((r) => r.rowId) },
        draftId: input.draftId,
        draft: { userId: context.userId },
      },
      select: { id: true, currentPayload: true },
    });
    const current = new Map(rows.map((r) => [r.id, r.currentPayload]));
    const updated: Array<{ rowId: string; version: number }> = [];
    const failed: Array<{ rowId: string; error: string }> = [];
    for (const edit of input.rows) {
      const payload = current.get(edit.rowId) as Record<string, unknown> | undefined;
      if (!payload || typeof payload !== "object") {
        failed.push({ rowId: edit.rowId, error: "Row not found in this draft" });
        continue;
      }
      const next: Record<string, unknown> = { ...payload };
      if (edit.description !== undefined) next.description = edit.description;
      if (edit.label !== undefined) next.label = edit.label;
      if (edit.categoryId !== undefined) next.categoryId = edit.categoryId;
      if (edit.metadata)
        next.metadata = {
          ...((payload.metadata as Record<string, unknown> | null) || {}),
          ...edit.metadata,
        };
      try {
        const row = await workflow.updateRow(
          context.userId,
          input.draftId,
          edit.rowId,
          {
            expectedVersion: edit.version,
            currentPayload: next,
            reviewStatus: "edited",
          },
          actor,
        );
        updated.push({ rowId: edit.rowId, version: row.version });
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (!status || status >= 500) throw error;
        failed.push({
          rowId: edit.rowId,
          error:
            status === 409
              ? `${(error as Error).message}. Inspect the draft again for the current version.`
              : (error as Error).message,
        });
      }
    }
    return { draftId: input.draftId, updated, failed, committed: false };
  }
  /** Add rows a parser missed to an open staged import; they are reviewed and committed with it. */
  async addRows(context: ChatContext, raw: unknown) {
    const input = z
      .object({
        draftId: idSchema,
        expectedVersion: z.number().int().positive(),
        reason: z.string().trim().min(1).max(300),
        rows: z.array(rowSchema).min(1).max(50),
      })
      .strict()
      .parse(raw);
    const categoryIds = [
      ...new Set(input.rows.map((r) => r.categoryId).filter(Boolean) as string[]),
    ];
    if (
      categoryIds.length &&
      (await this.db.category.count({
        where: { id: { in: categoryIds }, userId: context.userId },
      })) !== categoryIds.length
    )
      throw new ChatError(404, "Category not found; use IDs from get_context");
    const settings = await this.db.userSettings.findUnique({
      where: { userId: context.userId },
      select: { currency: true },
    });
    try {
      const { draft, rows } = await withDatabase(this.db, () =>
        workflow.addDraftRows(
          context.userId,
          input.draftId,
          {
            expectedVersion: input.expectedVersion,
            reason: input.reason,
            rows: input.rows.map((row) => ({
              ...row,
              date: new Date(row.date).toISOString(),
              currency: row.currency || settings?.currency || "SGD",
              metadata: row.metadata || {},
            })),
          },
          actor,
        ),
      );
      return {
        id: draft.id,
        version: draft.version,
        added: rows.map((r) => ({
          id: r.id,
          rowIndex: r.rowIndex,
          version: r.version,
          payload: r.currentPayload,
        })),
        committed: false,
      };
    } catch (error) {
      if ((error as Error).message === "Import draft is stale")
        throw new ChatError(409, "Import draft is stale. Inspect it again for the current version.");
      throw error;
    }
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
