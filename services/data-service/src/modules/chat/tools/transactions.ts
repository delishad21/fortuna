import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { createHash } from "node:crypto";
import { withTransactionClient } from "../../../lib/database-context";
import { TransactionService } from "../../transactions/transactions.service";
import { ChatError, idSchema } from "../contracts";
const amount = z
  .union([
    z.string().regex(/^\d{1,10}(\.\d{1,2})?$/),
    z.number().finite().min(0).max(9999999999.99),
  ])
  .nullable();
const allocation = z
  .object({
    transactionId: idSchema.optional(),
    stagedDraftId: idSchema.optional(),
    stagedRowId: idSchema.optional(),
    amount: z.number().finite().positive(),
    targetDescription: z.string().max(500).optional(),
    targetDate: z.string().optional(),
  })
  .strict();
const linkage = z
  .object({
    type: z.enum(["internal", "reimbursement"]),
    reimbursesAllocations: z.array(allocation).max(100).optional(),
    leftoverCategoryId: idSchema.nullable().optional(),
  })
  .strict()
  .nullable();
export const editSchema = z
  .object({
    kind: z.literal("edit_transactions"),
    edits: z
      .array(
        z
          .object({
            id: idSchema,
            patch: z
              .object({
                label: z.string().max(1000).nullable().optional(),
                description: z.string().min(1).max(4000).optional(),
                date: z.string().datetime({ offset: true }).optional(),
                amountIn: amount.optional(),
                amountOut: amount.optional(),
                balance: amount.optional(),
                currency: z
                  .string()
                  .regex(/^[A-Z]{3}$/)
                  .optional(),
                accountIdentifier: z.string().min(1).max(120).optional(),
                categoryId: idSchema.nullable().optional(),
                linkage: linkage.optional(),
              })
              .strict()
              .refine((p) => Object.keys(p).length > 0),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (v) => new Set(v.edits.map((e) => e.id)).size === v.edits.length,
    "Select each transaction once",
  );
export const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function canonical(v: any): any {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(canonical);
  return Object.fromEntries(
    Object.keys(v)
      .sort()
      .map((k) => [k, canonical(v[k])]),
  );
}
export const stateHash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(json(value))))
    .digest("hex");
export class StaleAction extends Error {}
export type PreparedAction = {
  kind: string;
  arguments: Prisma.InputJsonValue;
  preview: Prisma.InputJsonValue;
  stateHash: string;
};
export interface ActionHandler {
  prepare(userId: string, input: unknown): Promise<PreparedAction>;
  execute(
    tx: Prisma.TransactionClient,
    userId: string,
    input: unknown,
    expectedHash: string,
    duplicateOverride: boolean,
  ): Promise<Prisma.InputJsonValue>;
}
class PreviewRollback extends Error {
  constructor(public prepared: PreparedAction) {
    super("Preview rollback");
  }
}
export class TransactionActions implements ActionHandler {
  constructor(private db: PrismaClient) {}
  private async snapshot(
    tx: Prisma.TransactionClient,
    userId: string,
    input: z.infer<typeof editSchema>,
  ) {
    const [transactions, categories, accounts] = await Promise.all([
      tx.transaction.findMany({
        where: { userId },
        orderBy: { id: "asc" },
        include: { category: { select: { name: true } } },
      }),
      tx.category.findMany({ where: { userId }, orderBy: { id: "asc" } }),
      tx.accountIdentifier.findMany({
        where: { userId },
        orderBy: { id: "asc" },
      }),
    ]);
    if (transactions.length > 100000)
      throw new ChatError(
        400,
        "This account is too large for a bulk chat edit. Use the transaction editor.",
      );
    const ids = input.edits.flatMap(
      (e) =>
        e.patch.linkage?.reimbursesAllocations?.flatMap((a) =>
          a.stagedRowId ? [a.stagedRowId] : [],
        ) || [],
    );
    const stagedTargets = await tx.importDraftRow.findMany({
      where: { id: { in: ids }, draft: { userId } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        version: true,
        currentPayload: true,
        draft: { select: { id: true, status: true, version: true } },
      },
    });
    return { transactions, categories, accounts, stagedTargets };
  }
  private async lockTargets(
    tx: Prisma.TransactionClient,
    userId: string,
    input: z.infer<typeof editSchema>,
  ) {
    const ids = input.edits.flatMap(
      (e) =>
        e.patch.linkage?.reimbursesAllocations?.flatMap((a) =>
          a.stagedRowId ? [a.stagedRowId] : [],
        ) || [],
    );
    if (ids.length)
      await tx.$queryRaw`SELECT r.id FROM import_draft_rows r JOIN import_drafts d ON d.id=r.draft_id WHERE d.user_id=${userId} AND r.id IN (${Prisma.join(ids)}) ORDER BY r.id FOR UPDATE OF r,d`;
  }
  private async apply(
    tx: Prisma.TransactionClient,
    userId: string,
    input: z.infer<typeof editSchema>,
  ) {
    for (const edit of input.edits) {
      const current = await tx.transaction.findFirst({
        where: { id: edit.id, userId },
      });
      if (!current) throw new ChatError(404, "Transaction not found");
      const patch = edit.patch;
      if (
        patch.categoryId &&
        !(await tx.category.findFirst({
          where: { id: patch.categoryId, userId },
        }))
      )
        throw new ChatError(404, "Category not found");
      if (
        patch.accountIdentifier &&
        !(await tx.accountIdentifier.findFirst({
          where: { accountIdentifier: patch.accountIdentifier, userId },
        }))
      )
        throw new ChatError(404, "Account not found");
      if (
        patch.linkage?.leftoverCategoryId &&
        !(await tx.category.findFirst({
          where: { id: patch.linkage.leftoverCategoryId, userId },
        }))
      )
        throw new ChatError(404, "Category not found");
      for (const allocation of patch.linkage?.reimbursesAllocations || []) {
        if (allocation.stagedRowId || allocation.stagedDraftId) {
          if (
            !allocation.stagedRowId ||
            !allocation.stagedDraftId ||
            !(await tx.importDraftRow.findFirst({
              where: {
                id: allocation.stagedRowId,
                draftId: allocation.stagedDraftId,
                draft: {
                  userId,
                  status: { notIn: ["committed", "discarded"] },
                },
              },
            }))
          )
            throw new ChatError(404, "Staged reimbursement target not found");
        }
      }
      const incoming =
        Number(
          patch.amountIn === undefined ? current.amountIn : patch.amountIn,
        ) || 0;
      const outgoing =
        Number(
          patch.amountOut === undefined ? current.amountOut : patch.amountOut,
        ) || 0;
      if (incoming > 0 === outgoing > 0)
        throw new ChatError(
          400,
          "A transaction needs either income or expense, not both",
        );
      const normalized = {
        ...patch,
        ...(patch.date ? { date: new Date(patch.date) } : {}),
        ...(patch.amountIn !== undefined
          ? {
              amountIn: patch.amountIn === null ? null : Number(patch.amountIn),
            }
          : {}),
        ...(patch.amountOut !== undefined
          ? {
              amountOut:
                patch.amountOut === null ? null : Number(patch.amountOut),
            }
          : {}),
        ...(patch.balance !== undefined
          ? { balance: patch.balance === null ? null : Number(patch.balance) }
          : {}),
      };
      await TransactionService.updateTransaction(
        edit.id,
        userId,
        normalized as never,
      );
    }
  }
  private display(
    record: any,
    categories: Map<string, { id: string; name: string; color: string }>,
  ) {
    return json({
      id: record.id,
      date: record.date,
      description: record.description,
      label: record.label,
      category: record.categoryId
        ? categories.get(record.categoryId) || {
            id: record.categoryId,
            name: record.category?.name || "Category",
            color: null,
          }
        : null,
      amountIn: record.amountIn,
      amountOut: record.amountOut,
      balance: record.balance,
      currency: record.currency,
      accountIdentifier: record.accountIdentifier,
      linkage: record.linkage,
    });
  }
  /** Display data for records a preview mentions: linked transactions, categories, account colours. */
  private references(
    changes: Array<{ before: any; after: any }>,
    snapshot: Awaited<ReturnType<TransactionActions["snapshot"]>>,
    categories: Map<string, { id: string; name: string; color: string }>,
  ) {
    const linked = new Set<string>(),
      staged = new Set<string>(),
      categoryIds = new Set<string>();
    for (const side of changes.flatMap((c) => [c.before, c.after])) {
      const linkage = side?.linkage;
      for (const a of [
        ...(linkage?.reimbursesAllocations || []),
        ...(linkage?.reimbursedByAllocations || []),
      ]) {
        if (a?.transactionId) linked.add(String(a.transactionId));
        if (a?.stagedRowId) staged.add(String(a.stagedRowId));
      }
      if (linkage?.leftoverCategoryId)
        categoryIds.add(String(linkage.leftoverCategoryId));
    }
    const summary = (t: any) => ({
      id: t.id,
      date: t.date,
      description: t.description,
      label: t.label,
      amountIn: t.amountIn,
      amountOut: t.amountOut,
      currency: t.currency,
      accountIdentifier: t.accountIdentifier,
    });
    return json({
      transactions: Object.fromEntries(
        snapshot.transactions
          .filter((t) => linked.has(t.id))
          .map((t) => [t.id, summary(t)]),
      ),
      stagedRows: Object.fromEntries(
        snapshot.stagedTargets
          .filter((r) => staged.has(r.id))
          .map((r) => {
            const p = (r.currentPayload || {}) as any;
            return [
              r.id,
              summary({
                id: r.id,
                date: p.date,
                description: p.description,
                label: p.label,
                amountIn: p.amountIn,
                amountOut: p.amountOut,
                currency: p.currency,
                accountIdentifier: p.accountIdentifier,
              }),
            ];
          }),
      ),
      categories: Object.fromEntries(
        [...categoryIds].flatMap((id) =>
          categories.has(id) ? [[id, categories.get(id)!]] : [],
        ),
      ),
      accounts: Object.fromEntries(
        snapshot.accounts.map((a) => [a.accountIdentifier, a.color]),
      ),
      accountLabels: Object.fromEntries(
        snapshot.accounts.flatMap((a) =>
          a.label ? [[a.accountIdentifier, a.label]] : [],
        ),
      ),
    });
  }
  async prepare(userId: string, raw: unknown): Promise<PreparedAction> {
    const input = editSchema.parse(raw);
    try {
      await this.db.$transaction(
        async (tx) =>
          withTransactionClient(tx, async () => {
            await tx.$queryRaw`SELECT id FROM transactions WHERE user_id=${userId} ORDER BY id FOR UPDATE`;
            await this.lockTargets(tx, userId, input);
            const before = await this.snapshot(tx, userId, input);
            await this.apply(tx, userId, input);
            const after = await this.snapshot(tx, userId, input);
            const categories = new Map(
              after.categories.map((c) => [
                c.id,
                { id: c.id, name: c.name, color: c.color },
              ]),
            );
            const changes = after.transactions.flatMap((row) => {
              const previous = before.transactions.find(
                (r) => r.id === row.id,
              )!;
              const left = this.display(previous, categories),
                right = this.display(row, categories);
              return stateHash(left) === stateHash(right)
                ? []
                : [{ id: row.id, before: left, after: right }];
            });
            const references = this.references(changes, after, categories);
            throw new PreviewRollback({
              kind: input.kind,
              arguments: json(input),
              preview: json({
                title: "Edit saved transactions",
                changes,
                references,
              }),
              stateHash: stateHash(before),
            });
          }),
        { timeout: 30000 },
      );
    } catch (error) {
      if (error instanceof PreviewRollback) return error.prepared;
      throw error;
    }
    throw new Error("Preview did not roll back");
  }
  async execute(
    tx: Prisma.TransactionClient,
    userId: string,
    raw: unknown,
    expectedHash: string,
  ) {
    const input = editSchema.parse(raw);
    await tx.$queryRaw`SELECT id FROM transactions WHERE user_id=${userId} ORDER BY id FOR UPDATE`;
    await this.lockTargets(tx, userId, input);
    if (stateHash(await this.snapshot(tx, userId, input)) !== expectedHash)
      throw new StaleAction("Transactions changed since preview");
    await this.apply(tx, userId, input);
    return json({ transactionIds: input.edits.map((e) => e.id) });
  }
}
