import { requireConversationAttachment } from "../../imports/statement-files";
import { currentParserVersions, staleParserNote } from "../../imports/parser-versions";
import { IMAGE_NOT_STATEMENT, isImageType } from "../media";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { internalCategoryIds, withSuggestedLinkage } from "../internal-mark";
import { withDatabase } from "../../../lib/database-context";
import { HermesWorkflowService as workflow } from "../../imports/hermes-workflow.service";
import { ChatError, idSchema, ChatContext } from "../contracts";
import {
  InspectableDraft,
  draftRowsPage,
  draftSummary,
  inspectSchema,
  reconcileView,
  wantsRows,
} from "./draft-inspect";
import { rowSchema } from "./documents";
import {
  ActionHandler,
  PreparedAction,
  StaleAction,
  stateHash,
  json,
} from "./transactions";
const actor = { actorType: "system" as const, actorId: "fortuna-chat" };
/** Why a row edit was refused when the row changed after the model read it. */
const STALE_ROW =
  "Draft row is stale: it changed since you read it, possibly in another conversation. Read it again with inspect_staged_import and redo the edit only if it still applies; don't overwrite the other change.";
/** update_staged_rows takes a whole statement's rows in one call; each row is saved on its own. */
export const STAGED_EDIT_LIMIT = 500;
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
/** Says so when a draft's rows came from an older parser version than the current one. */
async function parserVersionHint(
  userId: string,
  draft: { parserId: string | null; parserVersion: string | null; status: string },
) {
  if (["committed", "discarded"].includes(draft.status)) return {};
  try {
    const current = (await currentParserVersions(userId)).get(
      draft.parserId || "",
    );
    const note = staleParserNote(draft.parserId, draft.parserVersion, current);
    return note ? { parserVersionNote: note } : {};
  } catch {
    return {};
  }
}
export class ImportTools {
  constructor(private db: PrismaClient) {}
  async list(userId: string) {
    return workflow.listDrafts(userId);
  }
  /** The draft's summary, or a filtered page of its rows when any filter is given. */
  async inspect(userId: string, raw: unknown) {
    const input = inspectSchema.parse(raw);
    const draft = (await workflow.getDraft(
      userId,
      input.draftId,
    )) as unknown as InspectableDraft;
    if (input.reconcile)
      return {
        draftId: draft.id,
        version: draft.version,
        reconcile: draft.reconcile ? reconcileView(draft.reconcile) : null,
        ...(draft.reconcile ? {} : { note: "Nothing is logged for this statement's accounts and period: committing is a plain import." }),
      };
    if (wantsRows(input)) return draftRowsPage(draft, input);
    return this.summary(userId, draft);
  }
  /**
   * Change how a staged statement reconciles against logged entries: match a
   * row to another entry, to none, or back to automatic, and choose what
   * happens to entries the statement doesn't show. Nothing is committed.
   */
  async reconcile(context: ChatContext, raw: unknown) {
    const input = z
      .object({
        draftId: idSchema,
        expectedVersion: z.number().int().positive(),
        rows: z
          .array(z.object({ rowId: idSchema, transactionId: z.union([idSchema, z.literal("auto"), z.null()]) }).strict())
          .max(STAGED_EDIT_LIMIT)
          .optional(),
        entries: z
          .array(
            z
              .object({
                transactionId: idSchema,
                action: z.enum(["keep", "delete", "move"]),
                accountId: idSchema.nullable().optional(),
                accountIdentifier: z.string().trim().min(1).max(120).optional(),
              })
              .strict(),
          )
          .max(STAGED_EDIT_LIMIT)
          .optional(),
      })
      .strict()
      .refine((v) => v.rows?.length || v.entries?.length, "Send rows or entries to change")
      .parse(raw);
    // get_context names accounts by identifier; the plan's reasons by account id.
    const identifiers = [
      ...new Set((input.entries || []).flatMap((e) => (e.accountIdentifier && !e.accountId ? [e.accountIdentifier] : []))),
    ];
    const mapped = identifiers.length
      ? await this.db.accountIdentifier.findMany({
          where: { userId: context.userId, accountIdentifier: { in: identifiers } },
          select: { accountIdentifier: true, accountId: true },
        })
      : [];
    const entries = input.entries?.map(({ accountIdentifier, ...entry }) => {
      if (entry.accountId || !accountIdentifier) return entry;
      const found = mapped.find((m) => m.accountIdentifier === accountIdentifier);
      if (!found?.accountId) throw new ChatError(404, `Unknown account "${accountIdentifier}"; use one from get_context`);
      return { ...entry, accountId: found.accountId };
    });
    try {
      const result = await withDatabase(this.db, () =>
        workflow.reconcileDraft(context.userId, input.draftId, { ...input, entries }, actor),
      );
      return {
        draftId: result.draftId,
        version: result.version,
        reconcile: result.reconcile ? reconcileView(result.reconcile, 50) : null,
        committed: false,
      };
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status && status < 500)
        throw new ChatError(
          status,
          (error as Error).message === "Import draft is stale"
            ? "Import draft is stale. Inspect it again for the current version."
            : (error as Error).message,
        );
      throw error;
    }
  }
  private async summary(userId: string, draft: InspectableDraft) {
    const [hint, gmail] = await Promise.all([
      parserVersionHint(userId, draft),
      this.db.mailConnection.count({ where: { userId } }),
    ]);
    return draftSummary(draft, {
      gmailConnected: gmail > 0,
      parserVersionNote: hint.parserVersionNote,
    });
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
    const attachment = await requireConversationAttachment(
      this.db,
      context,
      input.attachmentId,
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
    if (!draft.rows.length)
      await workflow.parseDraft(context.userId, draft.id, input.parserId, actor);
    // The summary, not every row: the model reads rows with inspect_staged_import.
    const staged = (await workflow.getDraft(
      context.userId,
      draft.id,
    )) as unknown as InspectableDraft;
    return {
      ...(draft.duplicate
        ? {
            duplicate: true,
            duplicateNote:
              "This statement was already staged; this is the existing import.",
          }
        : {}),
      ...(await this.summary(context.userId, staged)),
    };
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
    const { draft, account, updatedCount } = await workflow.assignDraftAccount(
      context.userId,
      input.draftId,
      input,
      actor,
    );
    return {
      draftId: draft.id,
      version: draft.version,
      account,
      updatedCount,
      // Row versions moved on; these keep update_staged_rows working without a re-read.
      rowVersions: Object.fromEntries(draft.rows.map((row) => [row.id, row.version])),
    };
  }
  /**
   * Edit staged rows through the same path as the staged import page, writing each row's
   * full current payload with only description, label, category and metadata changed
   * (a category other than Internal also clears an automatic internal mark).
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
          .max(
            STAGED_EDIT_LIMIT,
            `At most ${STAGED_EDIT_LIMIT} rows per call; send the rest in another call`,
          )
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
      select: { id: true, currentPayload: true, version: true },
    });
    const current = new Map(rows.map((r) => [r.id, r]));
    const internalIds = await internalCategoryIds(this.db, context.userId);
    const updated: Array<{ rowId: string; version: number }> = [];
    const failed: Array<{ rowId: string; error: string }> = [];
    for (const edit of input.rows) {
      const row = current.get(edit.rowId);
      const payload = row?.currentPayload as Record<string, unknown> | undefined;
      if (!row || !payload || typeof payload !== "object") {
        failed.push({ rowId: edit.rowId, error: "Row not found in this draft" });
        continue;
      }
      // Never merge into a payload other than the one the caller saw: another conversation
      // may have edited the row. updateRow checks the version again under a row lock.
      if (row.version !== edit.version) {
        failed.push({ rowId: edit.rowId, error: STALE_ROW });
        continue;
      }
      const next: Record<string, unknown> = { ...payload };
      if (edit.description !== undefined) next.description = edit.description;
      if (edit.label !== undefined) next.label = edit.label;
      if (edit.categoryId !== undefined)
        Object.assign(
          next,
          // Committing marks an Internal row by itself; here the mark is only cleared.
          withSuggestedLinkage(
            payload,
            { categoryId: edit.categoryId },
            internalIds,
            {},
            true,
          ),
        );
      if (edit.metadata)
        next.metadata = {
          ...((payload.metadata as Record<string, unknown> | null) || {}),
          ...edit.metadata,
        };
      try {
        const saved = await workflow.updateRow(
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
        updated.push({ rowId: edit.rowId, version: saved.version });
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (!status || status >= 500) throw error;
        failed.push({
          rowId: edit.rowId,
          error:
            status === 409
              ? (error as Error).message === "Draft row is stale"
                ? STALE_ROW
                : `${(error as Error).message}. Inspect the draft again for the current version.`
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
          .max(100, "At most 100 proposals per call; send the rest in another call"),
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
