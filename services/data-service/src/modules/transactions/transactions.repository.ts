import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import {
  ImportTransactionInput,
  TransactionLinkage,
} from "../duplicates/duplicate-detector";

export class TransactionRepository {
  private static async attachTripFundingSummary<T extends { id: string }>(
    userId: string,
    transactions: T[],
  ) {
    if (transactions.length === 0) {
      return transactions.map((tx) => ({ ...tx, tripFundings: [] }));
    }

    const ids = transactions.map((tx) => tx.id);
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        transactionId: string;
        tripId: string;
        tripName: string;
      }>
    >`
      SELECT
        tf.id,
        tf.bank_transaction_id AS "transactionId",
        t.id AS "tripId",
        t.name AS "tripName"
      FROM trip_fundings tf
      INNER JOIN trips t ON t.id = tf.trip_id
      WHERE
        tf.bank_transaction_id IN (${Prisma.join(ids)})
        AND t.user_id = ${userId}
    `;

    const map = new Map<
      string,
      Array<{ id: string; trip: { id: string; name: string } }>
    >();
    rows.forEach((row) => {
      const existing = map.get(row.transactionId) || [];
      existing.push({
        id: row.id,
        trip: { id: row.tripId, name: row.tripName },
      });
      map.set(row.transactionId, existing);
    });

    return transactions.map((tx) => ({
      ...tx,
      tripFundings: map.get(tx.id) || [],
    }));
  }

  private static async attachLinkedReimbursementSummary<
    T extends { id: string; linkage?: unknown },
  >(userId: string, transactions: T[]) {
    if (transactions.length === 0) {
      return transactions.map((tx) => ({
        ...tx,
        linkedTransactions: { reimburses: [], reimbursedBy: [] },
      }));
    }

    const linkedIdSet = new Set<string>();
    const allocationsByTransactionId = new Map<
      string,
      {
        reimburses: Array<{ transactionId: string; amount: number }>;
        reimbursedBy: Array<{ transactionId: string; amount: number }>;
      }
    >();

    for (const tx of transactions) {
      const linkage = (tx.linkage || null) as any;
      const reimburses = Array.isArray(linkage?.reimbursesAllocations)
        ? linkage.reimbursesAllocations
        : [];
      const reimbursedBy = Array.isArray(linkage?.reimbursedByAllocations)
        ? linkage.reimbursedByAllocations
        : [];

      const mappedReimburses: Array<{ transactionId: string; amount: number }> =
        reimburses
        .filter(
          (item: any) =>
            typeof item?.transactionId === "string" &&
            item.transactionId.length > 0 &&
            item.transactionId !== tx.id,
        )
        .map((item: any) => ({
          transactionId: item.transactionId as string,
          amount: Number(item.amount || 0),
        }));

      const mappedReimbursedBy: Array<{ transactionId: string; amount: number }> =
        reimbursedBy
        .filter(
          (item: any) =>
            typeof item?.transactionId === "string" &&
            item.transactionId.length > 0 &&
            item.transactionId !== tx.id,
        )
        .map((item: any) => ({
          transactionId: item.transactionId as string,
          amount: Number(item.amount || 0),
        }));

      mappedReimburses.forEach((item) => linkedIdSet.add(item.transactionId));
      mappedReimbursedBy.forEach((item) => linkedIdSet.add(item.transactionId));

      allocationsByTransactionId.set(tx.id, {
        reimburses: mappedReimburses,
        reimbursedBy: mappedReimbursedBy,
      });
    }

    if (linkedIdSet.size === 0) {
      return transactions.map((tx) => ({
        ...tx,
        linkedTransactions: { reimburses: [], reimbursedBy: [] },
      }));
    }

    const linkedTransactions = await prisma.transaction.findMany({
      where: {
        userId,
        id: { in: Array.from(linkedIdSet) },
      },
      select: {
        id: true,
        date: true,
        label: true,
        description: true,
        amountIn: true,
        amountOut: true,
      },
    });

    const linkedMap = new Map(linkedTransactions.map((row) => [row.id, row]));

    return transactions.map((tx) => {
      const allocations = allocationsByTransactionId.get(tx.id) || {
        reimburses: [],
        reimbursedBy: [],
      };

      const reimburses = allocations.reimburses
        .map((item) => {
          const linked = linkedMap.get(item.transactionId);
          if (!linked) return null;
          return {
            id: linked.id,
            date: linked.date,
            label: linked.label,
            description: linked.description,
            amountIn: linked.amountIn,
            amountOut: linked.amountOut,
            reimbursementAmount: item.amount,
          };
        })
        .filter(Boolean);

      const reimbursedBy = allocations.reimbursedBy
        .map((item) => {
          const linked = linkedMap.get(item.transactionId);
          if (!linked) return null;
          return {
            id: linked.id,
            date: linked.date,
            label: linked.label,
            description: linked.description,
            amountIn: linked.amountIn,
            amountOut: linked.amountOut,
            reimbursementAmount: item.amount,
          };
        })
        .filter(Boolean);

      return {
        ...tx,
        linkedTransactions: { reimburses, reimbursedBy },
      };
    });
  }

  private static buildWhere(
    userId: string,
    filters?: {
      dateFrom?: Date;
      dateTo?: Date;
      categoryIds?: string[];
      search?: string;
      transactionType?: "income" | "expense";
      minAmount?: number;
      maxAmount?: number;
      accountIdentifier?: string;
    },
    excludeIds?: string[],
    ids?: string[],
  ) {
    const where: Prisma.TransactionWhereInput = { userId };

    if (ids && ids.length > 0) {
      where.id = { in: ids };
    }

    if (filters?.dateFrom || filters?.dateTo) {
      where.date = {};
      if (filters.dateFrom) where.date.gte = filters.dateFrom;
      if (filters.dateTo) where.date.lte = filters.dateTo;
    }

    if (filters?.categoryIds && filters.categoryIds.length > 0) {
      where.categoryId = { in: filters.categoryIds };
    }

    if (filters?.accountIdentifier) {
      where.accountIdentifier = filters.accountIdentifier;
    }

    if (filters?.search) {
      where.OR = [
        { description: { contains: filters.search, mode: "insensitive" } },
        { label: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    if (filters?.transactionType) {
      if (filters.transactionType === "income") {
        where.amountIn = { not: null };
      } else if (filters.transactionType === "expense") {
        where.amountOut = { not: null };
      }
    }

    if (filters?.minAmount !== undefined || filters?.maxAmount !== undefined) {
      where.OR = where.OR || [];
      if (filters.minAmount !== undefined && filters.maxAmount !== undefined) {
        where.OR.push(
          {
            AND: [
              { amountIn: { gte: filters.minAmount, lte: filters.maxAmount } },
            ],
          },
          {
            AND: [
              { amountOut: { gte: filters.minAmount, lte: filters.maxAmount } },
            ],
          },
        );
      } else if (filters.minAmount !== undefined) {
        where.OR.push(
          { amountIn: { gte: filters.minAmount } },
          { amountOut: { gte: filters.minAmount } },
        );
      } else if (filters.maxAmount !== undefined) {
        where.OR.push(
          { amountIn: { lte: filters.maxAmount } },
          { amountOut: { lte: filters.maxAmount } },
        );
      }
    }

    if (excludeIds && excludeIds.length > 0) {
      where.NOT = { id: { in: excludeIds } };
    }

    return where;
  }
  /**
   * Create multiple transactions in a single batch
   */
  static async createMany(
    userId: string,
    transactions: ImportTransactionInput[],
    importBatchId?: string,
  ) {
    return prisma.transaction.createManyAndReturn({
      select: { id: true, metadata: true },
      data: transactions.map((t) => ({
        userId,
        date: t.date,
        description: t.description,
        label: t.label,
        categoryId: t.categoryId,
        amountIn: t.amountIn,
        amountOut: t.amountOut,
        balance: t.balance,
        ...({ currency: t.currency || "SGD" } as any),
        accountIdentifier: t.accountIdentifier,
        source: t.source,
        metadata: t.metadata
          ? (t.metadata as Prisma.InputJsonValue)
          : Prisma.DbNull,
        linkage: t.linkage
          ? (t.linkage as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
        importBatchId,
      })),
    });
  }

  /**
   * Get transactions with filters
   */
  static async findMany(
    userId: string,
    filters?: {
      dateFrom?: Date;
      dateTo?: Date;
      categoryIds?: string[];
      search?: string;
      transactionType?: "income" | "expense";
      dateOrder?: "asc" | "desc";
      minAmount?: number;
      maxAmount?: number;
      accountIdentifier?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    const where = TransactionRepository.buildWhere(userId, filters);

    const orderBy =
      filters?.dateOrder === "asc"
        ? { date: "asc" as const }
        : { date: "desc" as const };

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: {
          category: true,
          importBatch: true,
        },
        orderBy,
        take: filters?.limit || 50,
        skip: filters?.offset || 0,
      }),
      prisma.transaction.count({ where }),
    ]);

    const tripDecorated = await TransactionRepository.attachTripFundingSummary(
      userId,
      transactions,
    );
    const decoratedTransactions =
      await TransactionRepository.attachLinkedReimbursementSummary(
        userId,
        tripDecorated,
      );
    return { transactions: decoratedTransactions, total };
  }

  static async findManyByIds(userId: string, ids: string[]) {
    const where = TransactionRepository.buildWhere(
      userId,
      undefined,
      undefined,
      ids,
    );
    const transactions = await prisma.transaction.findMany({
      where,
      include: {
        category: true,
        importBatch: true,
      },
      orderBy: { date: "desc" },
    });
    return TransactionRepository.attachTripFundingSummary(userId, transactions);
  }

  static async findManyByFilter(
    userId: string,
    filters?: {
      dateFrom?: Date;
      dateTo?: Date;
      categoryIds?: string[];
      search?: string;
      transactionType?: "income" | "expense";
      minAmount?: number;
      maxAmount?: number;
      dateOrder?: "asc" | "desc";
      accountIdentifier?: string;
    },
    excludeIds?: string[],
  ) {
    const where = TransactionRepository.buildWhere(userId, filters, excludeIds);
    const orderBy =
      filters?.dateOrder === "asc"
        ? { date: "asc" as const }
        : { date: "desc" as const };
    const transactions = await prisma.transaction.findMany({
      where,
      include: {
        category: true,
        importBatch: true,
      },
      orderBy,
    });
    return TransactionRepository.attachTripFundingSummary(userId, transactions);
  }

  static async updateManyByIds(
    userId: string,
    ids: string[],
    updates: Partial<ImportTransactionInput>,
  ) {
    const where = TransactionRepository.buildWhere(
      userId,
      undefined,
      undefined,
      ids,
    );
    return prisma.transaction.updateMany({
      where,
      data: {
        ...(updates.description !== undefined && { description: updates.description }),
        ...(updates.label !== undefined && { label: updates.label }),
        ...(updates.categoryId !== undefined && { categoryId: updates.categoryId }),
        ...(updates.amountIn !== undefined && { amountIn: updates.amountIn }),
        ...(updates.amountOut !== undefined && { amountOut: updates.amountOut }),
        ...(updates.balance !== undefined && { balance: updates.balance }),
        ...(updates.currency !== undefined
          ? ({ currency: updates.currency } as any)
          : {}),
        ...(updates.date !== undefined && { date: updates.date }),
        ...(updates.accountIdentifier !== undefined && { accountIdentifier: updates.accountIdentifier }),
      },
    });
  }

  static async updateManyByFilter(
    userId: string,
    filters: {
      dateFrom?: Date;
      dateTo?: Date;
      categoryIds?: string[];
      search?: string;
      transactionType?: "income" | "expense";
      minAmount?: number;
      maxAmount?: number;
      accountIdentifier?: string;
    },
    excludeIds: string[] | undefined,
    updates: Partial<ImportTransactionInput>,
  ) {
    const where = TransactionRepository.buildWhere(userId, filters, excludeIds);
    return prisma.transaction.updateMany({
      where,
      data: {
        ...(updates.description !== undefined && { description: updates.description }),
        ...(updates.label !== undefined && { label: updates.label }),
        ...(updates.categoryId !== undefined && { categoryId: updates.categoryId }),
        ...(updates.amountIn !== undefined && { amountIn: updates.amountIn }),
        ...(updates.amountOut !== undefined && { amountOut: updates.amountOut }),
        ...(updates.balance !== undefined && { balance: updates.balance }),
        ...(updates.currency !== undefined
          ? ({ currency: updates.currency } as any)
          : {}),
        ...(updates.date !== undefined && { date: updates.date }),
        ...(updates.accountIdentifier !== undefined && { accountIdentifier: updates.accountIdentifier }),
      },
    });
  }

  static async findIdsByFilter(
    userId: string,
    filters: {
      dateFrom?: Date;
      dateTo?: Date;
      categoryIds?: string[];
      search?: string;
      transactionType?: "income" | "expense";
      minAmount?: number;
      maxAmount?: number;
      accountIdentifier?: string;
    },
    excludeIds?: string[],
  ) {
    const where = TransactionRepository.buildWhere(userId, filters, excludeIds);
    const rows = await prisma.transaction.findMany({ where, select: { id: true } });
    return rows.map((row) => row.id);
  }

  static async deleteManyByFilter(
    userId: string,
    filters: {
      dateFrom?: Date;
      dateTo?: Date;
      categoryIds?: string[];
      search?: string;
      transactionType?: "income" | "expense";
      minAmount?: number;
      maxAmount?: number;
      accountIdentifier?: string;
    },
    excludeIds?: string[],
  ) {
    const where = TransactionRepository.buildWhere(userId, filters, excludeIds);
    return prisma.transaction.deleteMany({
      where,
    });
  }

  static async getYears(userId: string) {
    const transactions = await prisma.transaction.findMany({
      where: { userId },
      select: { date: true },
    });

    const years = Array.from(
      new Set(transactions.map((t) => t.date.getFullYear())),
    ).sort((a, b) => b - a);

    return years;
  }

  /**
   * Get a single transaction by ID
   */
  static async findById(id: string, userId: string) {
    const transaction = await prisma.transaction.findFirst({
      where: { id, userId },
      include: {
        category: true,
        importBatch: true,
      },
    });
    if (!transaction) return null;
    const [decorated] = await TransactionRepository.attachTripFundingSummary(
      userId,
      [transaction],
    );
    return decorated;
  }

  /**
   * Update a transaction
   */
  static async update(
    id: string,
    userId: string,
    data: Partial<ImportTransactionInput>,
  ) {
    const linkageData =
      data.linkage === undefined
        ? undefined
        : data.linkage === null
          ? Prisma.DbNull
          : (data.linkage as unknown as Prisma.InputJsonValue);

    return prisma.transaction.update({
      where: { id, userId },
      data: {
        description: data.description,
        label: data.label,
        categoryId: data.categoryId,
        amountIn: data.amountIn,
        amountOut: data.amountOut,
        balance: data.balance,
        ...(data.currency !== undefined
          ? ({ currency: data.currency || undefined } as any)
          : {}),
        date: data.date,
        accountIdentifier: data.accountIdentifier,
        linkage: linkageData,
      },
    });
  }

  /**
   * Delete a transaction
   */
  static async delete(id: string, userId: string) {
    return prisma.transaction.delete({
      where: { id, userId },
    });
  }

  /**
   * Delete multiple transactions
   */
  static async deleteMany(ids: string[], userId: string) {
    return prisma.transaction.deleteMany({
      where: {
        id: { in: ids },
        userId,
      },
    });
  }

  /**
   * Search transactions for reimbursement linking
   */
  static async searchForReimbursement(
    userId: string,
    query: string | undefined,
    limit: number = 20,
    offset: number = 0,
    filters?: {
      transactionType?: "in" | "out";
      categoryId?: string;
      dateFrom?: Date;
      dateTo?: Date;
      amountEquals?: number;
    },
  ) {
    const trimmed = query?.trim();
    const where: Prisma.TransactionWhereInput = {
      userId,
      ...(filters?.categoryId
        ? {
            categoryId:
              filters.categoryId === "__uncategorized__"
                ? null
                : filters.categoryId,
          }
        : {}),
      ...(filters?.transactionType === "in"
        ? { amountIn: { gt: 0 } }
        : filters?.transactionType === "out"
          ? { amountOut: { gt: 0 } }
          : {}),
      ...(filters?.dateFrom || filters?.dateTo
        ? {
            date: {
              ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
              ...(filters.dateTo ? { lte: filters.dateTo } : {}),
            },
          }
        : {}),
      ...(typeof filters?.amountEquals === "number" &&
      Number.isFinite(filters.amountEquals)
        ? (() => {
            const normalizedAmount = Number(filters.amountEquals.toFixed(2));
            if (filters.transactionType === "out") {
              return { amountOut: { equals: normalizedAmount } };
            }
            if (filters.transactionType === "in") {
              return { amountIn: { equals: normalizedAmount } };
            }
            return {
              OR: [
                { amountOut: { equals: normalizedAmount } },
                { amountIn: { equals: normalizedAmount } },
              ],
            };
          })()
        : {}),
      ...(trimmed
        ? {
            AND: [
              {
                OR: [
                  { description: { contains: trimmed, mode: "insensitive" } },
                  { label: { contains: trimmed, mode: "insensitive" } },
                ],
              },
            ],
          }
        : {}),
    };

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        select: {
          id: true,
          userId: true,
          date: true,
          description: true,
          label: true,
          categoryId: true,
          amountIn: true,
          amountOut: true,
          balance: true,
          accountIdentifier: true,
          source: true,
          currency: true,
          metadata: true,
          category: true,
          linkage: true,
        },
        take: limit,
        skip: offset,
        orderBy: { date: "desc" },
      }),
      prisma.transaction.count({ where }),
    ]);

    return { transactions, total };
  }

  /**
   * Update linkage for a transaction
   */
  static async updateLinkage(
    id: string,
    userId: string,
    linkage: TransactionLinkage | Prisma.InputJsonValue | null,
  ) {
    const linkageData =
      linkage === null
        ? Prisma.DbNull
        : (linkage as Prisma.InputJsonValue);
    return prisma.transaction.update({
      where: { id, userId },
      data: { linkage: linkageData },
      include: { category: true },
    });
  }

  /**
   * Update linkage and category for a transaction
   */
  static async updateLinkageAndCategory(
    id: string,
    userId: string,
    linkage: TransactionLinkage | Prisma.InputJsonValue | null,
    categoryId: string,
  ) {
    const linkageData =
      linkage === null
        ? Prisma.DbNull
        : (linkage as Prisma.InputJsonValue);
    return prisma.transaction.update({
      where: { id, userId },
      data: { linkage: linkageData, categoryId },
      include: { category: true },
    });
  }

  /**
   * Get linked transactions by IDs
   */
  static async getLinkedTransactions(userId: string, ids: string[]) {
    return prisma.transaction.findMany({
      where: {
        userId,
        id: { in: ids },
      },
      include: {
        category: true,
      },
    });
  }
}
