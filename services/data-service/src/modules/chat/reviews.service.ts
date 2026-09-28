import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ChatContext, ChatError, idSchema } from "./contracts";
import { json } from "./tools/transactions";
import { ReadTools } from "./tools/read";
const amount = z.number().finite().min(0).max(9999999999.99).nullable();
export const reviewPatch = z
  .object({
    date: z
      .string()
      .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date"),
    description: z.string().min(1).max(4000),
    label: z.string().max(1000).nullable(),
    categoryId: idSchema.nullable(),
    accountIdentifier: z.string().max(120).nullable(),
    amountIn: amount,
    amountOut: amount,
    balance: z.number().finite().nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    linkage: z
      .object({
        type: z.enum(["internal", "reimbursement", "reimbursed"]),
        reimbursesAllocations: z
          .array(
            z
              .object({
                transactionId: idSchema.optional(),
                stagedDraftId: idSchema.optional(),
                stagedRowId: idSchema.optional(),
                amount: z.number().finite().positive(),
              })
              .strict(),
          )
          .max(100)
          .optional(),
        leftoverCategoryId: idSchema.nullable().optional(),
        autoDetected: z.boolean().optional(),
        detectionReason: z.string().max(2000).optional(),
      })
      .strict()
      .nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export type ReviewRow = {
  id: string;
  version: number;
  source: { transactionId?: string; draftId?: string; rowId?: string };
  original: any;
  value: any;
};
export const requestReviewSchema = z
  .object({
    title: z.string().min(1).max(120),
    instructions: z
      .string()
      .max(2000)
      .default("Review these transactions and send your edits back."),
    transactionIds: z.array(idSchema).max(100).default([]),
    stagedRowIds: z.array(idSchema).max(100).default([]),
  })
  .strict()
  .refine(
    (v) =>
      v.transactionIds.length + v.stagedRowIds.length > 0 &&
      v.transactionIds.length + v.stagedRowIds.length <= 100,
  );
export class ReviewService {
  constructor(private db: PrismaClient) {}
  async create(context: ChatContext, raw: unknown) {
    const input = requestReviewSchema.parse(raw);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id=${context.userId} FOR UPDATE`;
      const run = await tx.chatRun.findFirst({
        where: {
          id: context.runId,
          userId: context.userId,
          conversationId: context.conversationId,
          cancelRequested: false,
          status: "running",
          conversation: { deletedAt: null },
        },
      });
      if (!run) throw new ChatError(409, "This conversation run has closed");
      const saved = await tx.transaction.findMany({
        where: { userId: context.userId, id: { in: input.transactionIds } },
      });
      const staged = await tx.importDraftRow.findMany({
        where: {
          id: { in: input.stagedRowIds },
          draft: {
            userId: context.userId,
            status: { notIn: ["committed", "discarded"] },
          },
        },
      });
      if (
        saved.length !== input.transactionIds.length ||
        staged.length !== input.stagedRowIds.length
      )
        throw new ChatError(
          404,
          "A transaction was not found or is no longer staged",
        );
      const rows: ReviewRow[] = [
        ...saved.map((t) => {
          const value = {
            date: t.date.toISOString(),
            description: t.description,
            label: t.label,
            categoryId: t.categoryId,
            accountIdentifier: t.accountIdentifier,
            amountIn: t.amountIn === null ? null : Number(t.amountIn),
            amountOut: t.amountOut === null ? null : Number(t.amountOut),
            balance: t.balance === null ? null : Number(t.balance),
            currency: t.currency,
            linkage: t.linkage,
          };
          return {
            id: t.id,
            version: 1,
            source: { transactionId: t.id },
            original: value,
            value,
          };
        }),
        ...staged.map((r) => ({
          id: r.id,
          version: 1,
          source: { draftId: r.draftId, rowId: r.id },
          original: r.currentPayload,
          value: r.currentPayload,
        })),
      ].sort((a, b) =>
        String((a.value as any)?.date).localeCompare(
          String((b.value as any)?.date),
        ),
      );
      const review = await tx.chatTransactionReview.create({
        data: {
          ...context,
          title: input.title,
          instructions: input.instructions,
          rows: json(rows),
        },
      });
      return { ...review, rows };
    });
  }
  async get(userId: string, id: string) {
    const review = await this.db.chatTransactionReview.findFirst({
      where: { id, userId, run: { conversation: { deletedAt: null } } },
    });
    if (!review) throw new ChatError(404, "Review not found");
    const choices = await new ReadTools(this.db).context(userId);
    return {
      ...review,
      rows: review.rows as unknown as ReviewRow[],
      categories: choices.categories,
      accounts: choices.accounts,
    };
  }
  async update(userId: string, id: string, raw: unknown) {
    const input = z
      .object({
        rowId: idSchema,
        version: z.number().int().positive(),
        patch: reviewPatch,
      })
      .strict()
      .parse(raw);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
      const review = await tx.chatTransactionReview.findFirst({
        where: { id, userId, run: { conversation: { deletedAt: null } } },
      });
      if (!review) throw new ChatError(404, "Review not found");
      if (review.status !== "pending")
        throw new ChatError(
          409,
          "This review is closed. Ask Fortuna for a new review.",
        );
      const rows = review.rows as unknown as ReviewRow[];
      const row = rows.find((r) => r.id === input.rowId);
      if (!row) throw new ChatError(404, "Review row not found");
      if (row.version !== input.version)
        throw new ChatError(
          409,
          "This row changed on another device. Your edit was not saved. Reload the row and try again.",
        );
      if (
        input.patch.categoryId &&
        !(await tx.category.findFirst({
          where: { id: input.patch.categoryId, userId },
        }))
      )
        throw new ChatError(404, "Category not found");
      if (
        input.patch.accountIdentifier &&
        !(await tx.accountIdentifier.findFirst({
          where: { accountIdentifier: input.patch.accountIdentifier, userId },
        }))
      )
        throw new ChatError(404, "Account not found");
      row.value = { ...row.value, ...input.patch };
      row.version++;
      const updated = await tx.chatTransactionReview.update({
        where: { id },
        data: { rows: json(rows), version: { increment: 1 } },
      });
      return { ...updated, rows };
    });
  }
}
