import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ChatError } from "../contracts";
export const rangeFields = {
  dateFrom: z.string().datetime({ offset: true }),
  dateTo: z.string().datetime({ offset: true }),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  accountIdentifier: z.string().max(120).optional(),
  categoryId: z.string().max(128).optional(),
  search: z.string().max(120).optional(),
  includeInternal: z.boolean().default(false),
};
export const summarySchema = z
  .object({
    ...rangeFields,
    groupBy: z
      .enum(["currency", "category", "merchant", "account", "day"])
      .default("currency"),
  })
  .strict()
  .refine(
    (v) =>
      new Date(v.dateTo) > new Date(v.dateFrom) &&
      new Date(v.dateTo).getTime() - new Date(v.dateFrom).getTime() <=
        366 * 10 * 86400000,
    "Choose a date range of at most ten years",
  );
export const transactionsSchema = z
  .object({
    ...rangeFields,
    offset: z.number().int().min(0).max(100000).default(0),
    limit: z.number().int().min(1).max(100).default(30),
  })
  .strict();
export class ReadTools {
  constructor(private db: PrismaClient) {}
  private async assertFilters(
    userId: string,
    filters: { categoryId?: string; accountIdentifier?: string },
  ) {
    if (
      filters.categoryId &&
      !(await this.db.category.findFirst({
        where: { id: filters.categoryId, userId },
      }))
    )
      throw new ChatError(404, "Category not found");
    if (
      filters.accountIdentifier &&
      !(await this.db.accountIdentifier.findFirst({
        where: { accountIdentifier: filters.accountIdentifier, userId },
      }))
    )
      throw new ChatError(404, "Account not found");
  }
  async summary(userId: string, raw: unknown) {
    const filters = summarySchema.parse(raw);
    await this.assertFilters(userId, filters);
    const groups = {
      currency: Prisma.sql`COALESCE(t.currency,'SGD')`,
      category: Prisma.sql`COALESCE(c.name,'Uncategorized')`,
      merchant: Prisma.sql`COALESCE(NULLIF(t.label,''),t.description)`,
      account: Prisma.sql`COALESCE(t.account_number,'Unassigned')`,
      day: Prisma.sql`TO_CHAR(t.date AT TIME ZONE 'UTC','YYYY-MM-DD')`,
    };
    const grouping = groups[filters.groupBy];
    const rows = await this.db.$queryRaw<
      Array<{
        group: string;
        currency: string;
        expense: Prisma.Decimal;
        income: Prisma.Decimal;
        unallocated: Prisma.Decimal;
        count: bigint;
      }>
    >`
   SELECT ${grouping} AS "group", COALESCE(t.currency,'SGD') AS currency,
    SUM(CASE WHEN t.linkage->>'type'='internal' OR LOWER(c.name)='internal' THEN CASE WHEN ${filters.includeInternal} THEN COALESCE(t.amount_out,0) ELSE 0 END
        ELSE GREATEST(COALESCE(t.amount_out,0)-COALESCE((SELECT SUM(GREATEST((a->>'amount')::numeric,0)) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.linkage->'reimbursedByAllocations')='array' THEN t.linkage->'reimbursedByAllocations' ELSE '[]'::jsonb END) a),0),0) END) AS expense,
    SUM(CASE WHEN t.linkage->>'type'='reimbursement' THEN 0 WHEN t.linkage->>'type'='internal' OR LOWER(c.name)='internal' THEN CASE WHEN ${filters.includeInternal} THEN COALESCE(t.amount_in,0) ELSE 0 END ELSE COALESCE(t.amount_in,0) END) AS income,
    SUM(CASE WHEN t.linkage->>'type'='reimbursement' THEN GREATEST(COALESCE(t.amount_in,0)-COALESCE((SELECT SUM(GREATEST((a->>'amount')::numeric,0)) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.linkage->'reimbursesAllocations')='array' THEN t.linkage->'reimbursesAllocations' ELSE '[]'::jsonb END) a),0),0) ELSE 0 END) AS unallocated,
    COUNT(*) AS count
   FROM transactions t LEFT JOIN categories c ON c.id=t.category_id AND c.user_id=t.user_id
   WHERE t.user_id=${userId} AND t.date>=${new Date(filters.dateFrom)} AND t.date<${new Date(filters.dateTo)}
   ${filters.currency ? Prisma.sql`AND t.currency=${filters.currency}` : Prisma.empty}
   ${filters.accountIdentifier ? Prisma.sql`AND t.account_number=${filters.accountIdentifier}` : Prisma.empty}
   ${filters.categoryId ? Prisma.sql`AND t.category_id=${filters.categoryId}` : Prisma.empty}
   ${filters.search ? Prisma.sql`AND (t.description ILIKE ${"%" + filters.search + "%"} OR t.label ILIKE ${"%" + filters.search + "%"})` : Prisma.empty}
   GROUP BY ${grouping},COALESCE(t.currency,'SGD') ORDER BY "group",currency`;
    return {
      filters,
      totals: rows.map((r) => ({
        group: r.group,
        currency: r.currency,
        expense: r.expense.toFixed(2),
        income: r.income.toFixed(2),
        unallocatedReimbursement: r.unallocated.toFixed(2),
        count: Number(r.count),
      })),
      note: "Range includes the start and excludes the end. Currencies are not converted. Reimbursements reduce linked spending; unallocated reimbursement is shown separately.",
    };
  }
  private transactionWhere(
    userId: string,
    filters: z.infer<typeof transactionsSchema>,
  ): Prisma.TransactionWhereInput {
    return {
      userId,
      ...(!filters.includeInternal
        ? {
            AND: [
              {
                OR: [
                  { linkage: { equals: Prisma.DbNull } },
                  {
                    NOT: { linkage: { path: ["type"], equals: "internal" } },
                  },
                ],
              },
              {
                OR: [
                  { categoryId: null },
                  {
                    category: {
                      name: { not: "Internal", mode: "insensitive" as const },
                    },
                  },
                ],
              },
            ],
          }
        : {}),
      date: { gte: new Date(filters.dateFrom), lt: new Date(filters.dateTo) },
      ...(filters.currency ? { currency: filters.currency } : {}),
      ...(filters.accountIdentifier
        ? { accountIdentifier: filters.accountIdentifier }
        : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.search
        ? {
            OR: [
              {
                description: {
                  contains: filters.search,
                  mode: "insensitive" as const,
                },
              },
              {
                label: {
                  contains: filters.search,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {}),
    };
  }
  async transactions(userId: string, raw: unknown) {
    return (await this.transactionPage(userId, raw)).rows;
  }
  /** One page of matching transactions plus the total match count, for paginated display. */
  async transactionPage(userId: string, raw: unknown) {
    const filters = transactionsSchema.parse(raw);
    await this.assertFilters(userId, filters);
    const where = this.transactionWhere(userId, filters);
    const [rows, total] = await Promise.all([
      this.db.transaction.findMany({
        where,
        orderBy: [{ date: "desc" }, { id: "asc" }],
        skip: filters.offset,
        take: filters.limit,
        select: {
          id: true,
          date: true,
          description: true,
          label: true,
          amountIn: true,
          amountOut: true,
          currency: true,
          category: { select: { id: true, name: true, color: true } },
          accountIdentifier: true,
          linkage: true,
          updatedAt: true,
        },
      }),
      this.db.transaction.count({ where }),
    ]);
    return { rows, total };
  }
  async context(userId: string) {
    const [categories, accounts] = await Promise.all([
      this.db.category.findMany({
        where: { userId },
        select: { id: true, name: true },
        take: 300,
      }),
      this.db.accountIdentifier.findMany({
        where: { userId },
        select: { id: true, accountIdentifier: true },
        take: 100,
      }),
    ]);
    return { categories, accounts, currentDate: new Date().toISOString() };
  }
}
