import { TransactionRepository } from "./transactions.repository";
import {
  DuplicateDetector,
  ImportTransactionInput,
  DuplicateMatch,
  TransactionLinkage,
} from "../duplicates/duplicate-detector";
import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import {
  buildClassificationPatternsFromTransactions,
  ClassificationPatternStatus,
  ClassificationPatternType,
} from "./classification-patterns";
import { inferImportSourceFilename } from "../imports/import-source";
import { validatePendingReimbursementLinks } from "./transactions.import-validation";

// Reserved category names and colors
const RESERVED_CATEGORIES = {
  INTERNAL: { name: "Internal", color: "#9ca3af", icon: "arrow-left-right" },
  REIMBURSEMENT: { name: "Reimbursement", color: "#22c55e", icon: "receipt" },
  UNCATEGORIZED: { name: "Uncategorized", color: "#9ca3af", icon: "label" },
} as const;

export interface ImportResult {
  success: boolean;
  importedCount?: number;
  duplicatesDetected?: Map<number, DuplicateMatch[]>;
  batchId?: string;
  error?: string;
}

export function compatibleImportRuleParserIds(parserId?: string) {
  if (!parserId) return [];
  if (["dbs_paylah_statement", "dbs_paylah_statement_new"].includes(parserId)) {
    return ["dbs_paylah_statement", "dbs_paylah_statement_new"];
  }
  return [parserId];
}

export function detachStagedReimbursementAllocations<
  T extends {
    stagedDraftId?: string;
    stagedRowId?: string;
    amount: number;
  },
>(allocations: T[], leftoverAmount = 0) {
  const stagedAmount = allocations
    .filter(
      (allocation) =>
        typeof allocation.stagedDraftId === "string" &&
        typeof allocation.stagedRowId === "string",
    )
    .reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
  return {
    linkedAllocations: allocations.filter(
      (allocation) =>
        !(
          typeof allocation.stagedDraftId === "string" &&
          typeof allocation.stagedRowId === "string"
        ),
    ),
    leftoverAmount: Number((leftoverAmount + stagedAmount).toFixed(2)),
  };
}

const IMPORT_ORIGINAL_INDEX_KEY = "__importOriginalIndex";

export function stripImportOrderMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return {};
  const { [IMPORT_ORIGINAL_INDEX_KEY]: _marker, ...rest } = metadata as Record<
    string,
    unknown
  >;
  return rest;
}

export function orderCreatedTransactionsForImport<
  T extends { metadata: unknown },
>(createdTransactions: T[], selectedIndices: number[]): T[] {
  const selectedIndexSet = new Set<number>();
  for (const index of selectedIndices) {
    if (selectedIndexSet.has(index)) {
      throw new Error("Duplicate selected import transaction index");
    }
    selectedIndexSet.add(index);
  }

  const byOriginalIndex = new Map<number, T>();
  for (const transaction of createdTransactions) {
    const metadata =
      transaction.metadata && typeof transaction.metadata === "object"
        ? (transaction.metadata as Record<string, unknown>)
        : {};
    const originalIndex = Number(metadata[IMPORT_ORIGINAL_INDEX_KEY]);
    if (Number.isInteger(originalIndex)) {
      if (byOriginalIndex.has(originalIndex)) {
        throw new Error("Duplicate created import transaction marker");
      }
      byOriginalIndex.set(originalIndex, transaction);
    }
  }

  return selectedIndices.map((index) => {
    const transaction = byOriginalIndex.get(index);
    if (!transaction) {
      throw new Error("Created import transaction order could not be resolved");
    }
    return transaction;
  });
}

export interface ImportRulePayload {
  name: string;
  parserId?: string | null;
  matchType?: "always" | "description_contains";
  matchValue?: string | null;
  caseSensitive?: boolean;
  enabled?: boolean;
  setLabel?: string | null;
  setCategoryName?: string | null;
  markInternal?: boolean;
  sortOrder?: number;
}

export interface ClassificationPatternFilters {
  status?: ClassificationPatternStatus;
  patternType?: ClassificationPatternType;
}

export interface ClassificationPatternUpdatePayload {
  status?: ClassificationPatternStatus;
  label?: string | null;
  categoryId?: string | null;
  markInternal?: boolean;
}

export class TransactionService {
  private static readonly PAYLAH_INTERNAL_RULE_NAMES = [
    "PayLah top-up from account is Internal",
    "DBS/POSB top-up to PayLah is Internal",
    "DBS/POSB legacy top-up to PayLah is Internal",
    "PayLah send back to bank is Internal",
    "DBS/POSB receive back from PayLah is Internal",
    "DBS/POSB legacy receive back from PayLah is Internal",
  ] as const;

  private static readonly DBS_PAYLAH_INTERNAL_PATTERNS = [
    "TOP-UP TO PAYLAH!",
    "SEND BACK FROM PAYLAH!",
  ] as const;

  private static readonly DEFAULT_IMPORT_RULES: ImportRulePayload[] = [
    {
      name: "PayLah top-up from account is Internal",
      parserId: "dbs_paylah_statement",
      matchType: "description_contains",
      matchValue: "TOP UP WALLET FROM MY ACCOUNT",
      caseSensitive: false,
      enabled: false,
      setLabel: null,
      setCategoryName: null,
      markInternal: true,
      sortOrder: 10,
    },
    {
      name: "DBS/POSB top-up to PayLah is Internal",
      parserId: "dbs_posb_consolidated",
      matchType: "description_contains",
      matchValue: "TOP-UP TO PAYLAH!",
      caseSensitive: false,
      enabled: false,
      setLabel: null,
      setCategoryName: null,
      markInternal: true,
      sortOrder: 20,
    },
    {
      name: "DBS/POSB legacy top-up to PayLah is Internal",
      parserId: "dbs_posb_consolidated_legacy",
      matchType: "description_contains",
      matchValue: "TOP-UP TO PAYLAH!",
      caseSensitive: false,
      enabled: false,
      setLabel: null,
      setCategoryName: null,
      markInternal: true,
      sortOrder: 21,
    },
    {
      name: "PayLah send back to bank is Internal",
      parserId: "dbs_paylah_statement",
      matchType: "description_contains",
      matchValue: "SEND MONEY TO MY ACCOUNT",
      caseSensitive: false,
      enabled: false,
      setLabel: null,
      setCategoryName: null,
      markInternal: true,
      sortOrder: 30,
    },
    {
      name: "DBS/POSB receive back from PayLah is Internal",
      parserId: "dbs_posb_consolidated",
      matchType: "description_contains",
      matchValue: "SEND BACK FROM PAYLAH!",
      caseSensitive: false,
      enabled: false,
      setLabel: null,
      setCategoryName: null,
      markInternal: true,
      sortOrder: 40,
    },
    {
      name: "DBS/POSB legacy receive back from PayLah is Internal",
      parserId: "dbs_posb_consolidated_legacy",
      matchType: "description_contains",
      matchValue: "SEND BACK FROM PAYLAH!",
      caseSensitive: false,
      enabled: false,
      setLabel: null,
      setCategoryName: null,
      markInternal: true,
      sortOrder: 41,
    },
    {
      name: "BUS/MRT transactions are Transportation",
      parserId: null,
      matchType: "description_contains",
      matchValue: "BUS/MRT",
      caseSensitive: false,
      enabled: true,
      setLabel: null,
      setCategoryName: "Transportation",
      markInternal: false,
      sortOrder: 50,
    },
  ];

  private static normalizeImportRulePayload(payload: ImportRulePayload) {
    return {
      name: payload.name.trim(),
      parserId: payload.parserId?.trim() || null,
      matchType: payload.matchType || "description_contains",
      matchValue: payload.matchValue?.trim() || null,
      caseSensitive: payload.caseSensitive ?? false,
      enabled: payload.enabled ?? true,
      setLabel: payload.setLabel?.trim() || null,
      setCategoryName: payload.setCategoryName?.trim() || null,
      markInternal: payload.markInternal ?? false,
      sortOrder: payload.sortOrder ?? 0,
    };
  }

  private static ruleMatches(
    rule: {
      matchType: string;
      matchValue: string | null;
      caseSensitive: boolean;
    },
    tx: { description?: string | null },
  ) {
    const description = tx.description || "";
    if (rule.matchType === "always") {
      return true;
    }
    if (rule.matchType === "description_contains") {
      const needle = rule.matchValue || "";
      if (!needle) return false;
      if (rule.caseSensitive) {
        return description.includes(needle);
      }
      return description.toLowerCase().includes(needle.toLowerCase());
    }
    return false;
  }

  static async applyImportRules(
    userId: string,
    parserId: string | undefined,
    transactions: ImportTransactionInput[],
  ): Promise<ImportTransactionInput[]> {
    if (transactions.length === 0) return transactions;

    const compatibleParserIds = compatibleImportRuleParserIds(parserId);
    const rules = await prisma.importRule.findMany({
      where: {
        userId,
        enabled: true,
        OR: [
          { parserId: null },
          ...(compatibleParserIds.length
            ? [{ parserId: { in: compatibleParserIds } }]
            : []),
        ],
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    if (rules.length === 0) return transactions;

    const categoryNames = Array.from(
      new Set(
        rules
          .map((rule) => rule.setCategoryName?.trim())
          .filter((value): value is string => !!value),
      ),
    );
    const categoryMap = new Map<string, string>();
    if (categoryNames.length > 0) {
      const categories = await prisma.category.findMany({
        where: {
          userId,
          OR: categoryNames.map((name) => ({
            name: { equals: name, mode: "insensitive" },
          })),
        },
        select: { id: true, name: true },
      });
      categories.forEach((category) => {
        categoryMap.set(category.name.toLowerCase(), category.id);
      });
    }

    return transactions.map((originalTx) => {
      const tx = { ...originalTx };
      for (const rule of rules) {
        if (!this.ruleMatches(rule, tx)) continue;

        const metadata = (tx.metadata || {}) as Record<string, any>;
        const hasLearnedClassification = !!metadata.classificationPatternId;
        const hasExplicitLinkage = !!tx.linkage && !hasLearnedClassification;
        const hasExplicitCategory =
          !!tx.categoryId && !hasLearnedClassification;
        const hasExplicitLabel =
          !!tx.label && tx.label.trim().length > 0 && !hasLearnedClassification;
        let applied = false;

        if (rule.markInternal && !hasExplicitLinkage) {
          tx.linkage = {
            type: "internal",
            autoDetected: true,
            detectionReason: `Matched import rule: ${rule.name}`,
          };
          applied = true;
        }

        if (rule.setLabel && !hasExplicitLabel) {
          tx.label = rule.setLabel;
          applied = true;
        }

        if (
          rule.setCategoryName &&
          !hasExplicitCategory &&
          (!tx.linkage || tx.linkage.type === "reimbursed")
        ) {
          const categoryId = categoryMap.get(
            rule.setCategoryName.toLowerCase(),
          );
          if (categoryId) {
            tx.categoryId = categoryId;
            applied = true;
          }
        }

        if (applied) {
          tx.metadata = {
            ...((tx.metadata || {}) as Record<string, any>),
            fixedRuleId: rule.id,
            fixedRuleName: rule.name,
            classificationAppliedAt: new Date().toISOString(),
          };
        }
      }
      return tx;
    });
  }

  private static classificationPatternKey(pattern: {
    patternType: string;
    patternValue: string;
    parserId?: string | null;
    direction?: string | null;
  }) {
    return [
      pattern.patternType,
      pattern.patternValue,
      pattern.parserId || "__all__",
      pattern.direction || "none",
    ].join("::");
  }

  private static normalizeClassificationPatternStatus(
    status: string | null | undefined,
  ): ClassificationPatternStatus {
    if (
      status === "auto_apply" ||
      status === "disabled" ||
      status === "unresolved"
    ) {
      return status;
    }
    return "disabled";
  }

  static async getClassificationPatterns(
    userId: string,
    filters: ClassificationPatternFilters = {},
  ) {
    const patterns = await prisma.classificationPattern.findMany({
      where: {
        userId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.patternType ? { patternType: filters.patternType } : {}),
      },
      include: {
        category: { select: { id: true, name: true, color: true } },
      },
      orderBy: [
        { status: "asc" },
        { confidence: "desc" },
        { supportCount: "desc" },
        { updatedAt: "desc" },
      ],
    });

    return patterns.map((pattern) => ({
      ...pattern,
      status: this.normalizeClassificationPatternStatus(pattern.status),
    }));
  }

  static async rebuildClassificationPatterns(userId: string) {
    const uncategorized = await prisma.category.findFirst({
      where: { userId, name: { equals: "Uncategorized", mode: "insensitive" } },
      select: { id: true },
    });

    const [transactions, existingPatterns] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId },
        select: {
          description: true,
          label: true,
          categoryId: true,
          amountIn: true,
          amountOut: true,
          metadata: true,
          linkage: true,
          date: true,
        },
        orderBy: { date: "desc" },
        take: 10000,
      }),
      prisma.classificationPattern.findMany({ where: { userId } }),
    ]);

    const existingByKey = new Map(
      existingPatterns.map((pattern) => [
        this.classificationPatternKey(pattern),
        pattern,
      ]),
    );
    const ignoredCategoryIds = new Set<string>();
    if (uncategorized?.id) ignoredCategoryIds.add(uncategorized.id);

    const builtPatterns = buildClassificationPatternsFromTransactions({
      ignoredCategoryIds,
      transactions: transactions.map((transaction) => ({
        ...transaction,
        amountIn: transaction.amountIn ? Number(transaction.amountIn) : null,
        amountOut: transaction.amountOut ? Number(transaction.amountOut) : null,
        metadata: (transaction.metadata as Record<string, any> | null) || null,
        linkage: (transaction.linkage as { type?: string } | null) || null,
      })),
    });

    await prisma.$transaction(async (tx) => {
      await tx.classificationPattern.deleteMany({ where: { userId } });
      if (builtPatterns.length === 0) return;

      await tx.classificationPattern.createMany({
        data: builtPatterns.map((pattern) => {
          const existing = existingByKey.get(
            this.classificationPatternKey(pattern),
          );
          const existingMetadata =
            existing?.metadata && typeof existing.metadata === "object"
              ? (existing.metadata as Record<string, any>)
              : {};
          const userStatusOverride =
            existingMetadata.userStatusOverride === true;
          const existingStatus = this.normalizeClassificationPatternStatus(
            existing?.status,
          );

          return {
            userId,
            patternType: pattern.patternType,
            patternValue: pattern.patternValue,
            parserId: pattern.parserId,
            direction: pattern.direction,
            label: pattern.label,
            categoryId: pattern.categoryId,
            markInternal: pattern.markInternal,
            confidence: pattern.confidence,
            supportCount: pattern.supportCount,
            matchCount: pattern.matchCount,
            conflictCount: pattern.conflictCount,
            appliedCount: existing?.appliedCount || 0,
            status:
              userStatusOverride && existing ? existingStatus : pattern.status,
            lastSeenAt: pattern.lastSeenAt,
            metadata: {
              ...pattern.metadata,
              ...(userStatusOverride ? { userStatusOverride: true } : {}),
            },
          };
        }),
      });
    });

    return {
      success: true,
      rebuiltCount: builtPatterns.length,
      patterns: await this.getClassificationPatterns(userId),
    };
  }

  static async updateClassificationPattern(
    userId: string,
    patternId: string,
    payload: ClassificationPatternUpdatePayload,
  ) {
    const existing = await prisma.classificationPattern.findFirst({
      where: { id: patternId, userId },
    });
    if (!existing) throw new Error("Classification pattern not found");

    const existingMetadata =
      existing.metadata && typeof existing.metadata === "object"
        ? (existing.metadata as Record<string, any>)
        : {};

    return prisma.classificationPattern.update({
      where: { id: patternId },
      data: {
        ...(payload.status !== undefined && { status: payload.status }),
        ...(payload.label !== undefined && {
          label: payload.label?.trim() || null,
        }),
        ...(payload.categoryId !== undefined && {
          categoryId: payload.categoryId || null,
        }),
        ...(payload.markInternal !== undefined && {
          markInternal: payload.markInternal,
        }),
        metadata: {
          ...existingMetadata,
          ...(payload.status !== undefined ? { userStatusOverride: true } : {}),
        },
      },
      include: { category: { select: { id: true, name: true, color: true } } },
    });
  }

  static async deleteClassificationPattern(userId: string, patternId: string) {
    const existing = await prisma.classificationPattern.findFirst({
      where: { id: patternId, userId },
      select: { id: true },
    });
    if (!existing) throw new Error("Classification pattern not found");
    await prisma.classificationPattern.delete({ where: { id: patternId } });
    return { success: true };
  }

  static async incrementClassificationPatternAppliedCounts(
    userId: string,
    patternIds: string[],
  ) {
    const counts = new Map<string, number>();
    for (const patternId of patternIds) {
      if (!patternId) continue;
      counts.set(patternId, (counts.get(patternId) || 0) + 1);
    }

    await Promise.all(
      Array.from(counts.entries()).map(([id, count]) =>
        prisma.classificationPattern.updateMany({
          where: { id, userId },
          data: { appliedCount: { increment: count } },
        }),
      ),
    );
  }

  static async getAppliedClassificationSummary(userId: string) {
    const transactions = await prisma.transaction.findMany({
      where: { userId },
      select: { description: true, date: true, metadata: true },
      orderBy: { date: "desc" },
      take: 10000,
    });

    const summary = new Map<
      string,
      {
        id: string;
        type: "fixed" | "learned";
        name: string;
        patternValue?: string | null;
        appliedCount: number;
        lastAppliedAt: string | null;
        exampleDescription: string;
      }
    >();

    for (const transaction of transactions) {
      const metadata =
        transaction.metadata && typeof transaction.metadata === "object"
          ? (transaction.metadata as Record<string, any>)
          : {};
      const appliedAt = String(
        metadata.classificationAppliedAt || transaction.date.toISOString(),
      );

      const entries = [
        metadata.fixedRuleName
          ? {
              key: `fixed:${metadata.fixedRuleId || metadata.fixedRuleName}`,
              id: String(metadata.fixedRuleId || metadata.fixedRuleName),
              type: "fixed" as const,
              name: String(metadata.fixedRuleName),
              patternValue: null,
            }
          : null,
        metadata.classificationPatternId || metadata.classificationPatternValue
          ? {
              key: `learned:${metadata.classificationPatternId || metadata.classificationPatternValue}`,
              id: String(
                metadata.classificationPatternId ||
                  metadata.classificationPatternValue,
              ),
              type: "learned" as const,
              name: String(
                metadata.classificationPatternType || "Learned pattern",
              ),
              patternValue: String(metadata.classificationPatternValue || ""),
            }
          : null,
      ].filter(Boolean) as Array<{
        key: string;
        id: string;
        type: "fixed" | "learned";
        name: string;
        patternValue?: string | null;
      }>;

      for (const entry of entries) {
        const current = summary.get(entry.key);
        if (!current) {
          summary.set(entry.key, {
            id: entry.id,
            type: entry.type,
            name: entry.name,
            patternValue: entry.patternValue,
            appliedCount: 1,
            lastAppliedAt: appliedAt,
            exampleDescription: transaction.description,
          });
        } else {
          current.appliedCount += 1;
        }
      }
    }

    return Array.from(summary.values()).sort(
      (a, b) => b.appliedCount - a.appliedCount,
    );
  }

  private static sanitizeLinkageForTransaction(
    transactionId: string,
    linkage: TransactionLinkage | null,
    context?: {
      linkageByTransactionId: Map<string, TransactionLinkage | null>;
      targetId?: string;
    },
  ): TransactionLinkage | null {
    if (!linkage) return null;

    if (linkage.type === "reimbursed") {
      const linkageByTransactionId = context?.linkageByTransactionId;
      const targetId = context?.targetId || transactionId;
      const isValidReimburser = (reimburserId: string) => {
        if (!linkageByTransactionId) return true;
        const reimburserLinkage = linkageByTransactionId.get(reimburserId);
        if (!reimburserLinkage || reimburserLinkage.type !== "reimbursement") {
          return false;
        }
        const reimbursesSet = new Set<string>();
        (reimburserLinkage.reimbursesAllocations || []).forEach((item) => {
          if (typeof item.transactionId === "string") {
            reimbursesSet.add(item.transactionId);
          }
        });
        return reimbursesSet.has(targetId);
      };

      const reimbursedByAllocations = (linkage.reimbursedByAllocations || [])
        .filter(
          (item) =>
            item &&
            typeof item.transactionId === "string" &&
            item.transactionId.length > 0 &&
            item.transactionId !== transactionId &&
            Number(item.amount || 0) > 0 &&
            isValidReimburser(item.transactionId),
        )
        .map((item) => ({
          transactionId: item.transactionId,
          amount: Number(item.amount),
        }));

      if (reimbursedByAllocations.length === 0) {
        return null;
      }

      return {
        type: "reimbursed",
        reimbursedByAllocations,
        autoDetected: linkage.autoDetected,
        detectionReason: linkage.detectionReason,
      };
    }

    if (linkage.type === "reimbursement") {
      const linkageByTransactionId = context?.linkageByTransactionId;
      const sourceId = transactionId;
      const isValidTarget = (targetId: string) => {
        if (!linkageByTransactionId) return true;
        const targetLinkage = linkageByTransactionId.get(targetId);
        if (!targetLinkage || targetLinkage.type !== "reimbursed") {
          return false;
        }
        const reimbursedBySet = new Set<string>();
        (targetLinkage.reimbursedByAllocations || []).forEach((item) => {
          if (typeof item.transactionId === "string") {
            reimbursedBySet.add(item.transactionId);
          }
        });
        return reimbursedBySet.has(sourceId);
      };

      const reimbursesAllocations = (linkage.reimbursesAllocations || [])
        .filter(
          (item) =>
            item &&
            ((typeof item.transactionId === "string" &&
              item.transactionId.length > 0 &&
              item.transactionId !== transactionId &&
              isValidTarget(item.transactionId)) ||
              typeof item.pendingBatchIndex === "number") &&
            Number(item.amount || 0) >= 0,
        )
        .map((item) => ({
          transactionId: item.transactionId,
          pendingBatchIndex: item.pendingBatchIndex,
          amount: Number(item.amount),
        }));

      return {
        type: "reimbursement",
        reimbursesAllocations,
        leftoverAmount:
          linkage.leftoverAmount !== undefined
            ? Number(linkage.leftoverAmount)
            : undefined,
        leftoverCategoryId: linkage.leftoverCategoryId ?? null,
        autoDetected: linkage.autoDetected,
        detectionReason: linkage.detectionReason,
      };
    }

    return linkage;
  }

  private static getAbsoluteTransactionAmount(input: {
    amountIn?: number | null;
    amountOut?: number | null;
  }) {
    const amountIn = input.amountIn ?? null;
    const amountOut = input.amountOut ?? null;
    if (amountOut !== null && amountOut !== undefined && amountOut > 0)
      return amountOut;
    if (amountIn !== null && amountIn !== undefined && amountIn > 0)
      return amountIn;
    return 0;
  }

  private static normalizeReimbursementAllocations(
    linkage: TransactionLinkage | null | undefined,
  ) {
    if (!linkage || linkage.type !== "reimbursement") return [];

    return (linkage.reimbursesAllocations || [])
      .map((item) => ({
        transactionId: item.transactionId,
        pendingBatchIndex: item.pendingBatchIndex,
        stagedDraftId: item.stagedDraftId,
        stagedRowId: item.stagedRowId,
        targetDescription: item.targetDescription,
        targetDate: item.targetDate,
        amount: Number(item.amount || 0),
      }))
      .filter(
        (item) =>
          item.amount > 0 &&
          (typeof item.transactionId === "string" ||
            typeof item.pendingBatchIndex === "number" ||
            (typeof item.stagedDraftId === "string" &&
              typeof item.stagedRowId === "string")),
      );
  }

  private static async removeReimbursementBacklinks(
    userId: string,
    reimbursementId: string,
    reimbursedIds: string[],
  ) {
    for (const reimbursedId of reimbursedIds) {
      const reimbursed = await prisma.transaction.findUnique({
        where: { id: reimbursedId },
        select: { linkage: true },
      });

      const reimbursedLinkage =
        reimbursed?.linkage as TransactionLinkage | null;
      if (!reimbursedLinkage) continue;

      const updatedReimbursedByAllocations = (
        reimbursedLinkage.reimbursedByAllocations || []
      ).filter((allocation) => allocation.transactionId !== reimbursementId);

      if (updatedReimbursedByAllocations.length > 0) {
        await TransactionRepository.updateLinkage(reimbursedId, userId, {
          ...reimbursedLinkage,
          type: "reimbursed",
          reimbursedByAllocations: updatedReimbursedByAllocations,
        });
      } else {
        await TransactionRepository.updateLinkage(reimbursedId, userId, null);
      }
    }
  }

  private static async applyReimbursementBacklinks(
    userId: string,
    reimbursementId: string,
    allocations: Array<{ transactionId: string; amount: number }>,
  ) {
    for (const allocation of allocations) {
      const capacity = await this.getTargetReimbursementCapacity(
        userId,
        allocation.transactionId,
        reimbursementId,
      );
      if (allocation.amount - capacity.remaining > 0.01) {
        throw new Error(
          `Allocation exceeds remaining reimbursable amount for transaction ${allocation.transactionId}`,
        );
      }

      const reimbursed = await prisma.transaction.findUnique({
        where: { id: allocation.transactionId },
        select: { linkage: true },
      });

      const existingLinkage = reimbursed?.linkage as TransactionLinkage | null;
      const existingReimbursedByAllocations =
        existingLinkage?.reimbursedByAllocations || [];

      const withoutCurrent = existingReimbursedByAllocations.filter(
        (item) => item.transactionId !== reimbursementId,
      );

      await TransactionRepository.updateLinkage(
        allocation.transactionId,
        userId,
        {
          ...existingLinkage,
          type: "reimbursed",
          reimbursedByAllocations: [
            ...withoutCurrent,
            { transactionId: reimbursementId, amount: allocation.amount },
          ],
        },
      );
    }
  }

  private static async getTargetReimbursementCapacity(
    userId: string,
    targetTransactionId: string,
    currentReimbursementId?: string,
  ) {
    const target = await prisma.transaction.findFirst({
      where: { id: targetTransactionId, userId },
      select: {
        amountIn: true,
        amountOut: true,
        linkage: true,
      },
    });

    if (!target) {
      throw new Error("Reimbursed transaction not found");
    }

    const targetAmount = this.getAbsoluteTransactionAmount({
      amountIn: target.amountIn !== null ? Number(target.amountIn) : undefined,
      amountOut:
        target.amountOut !== null ? Number(target.amountOut) : undefined,
    });

    const targetLinkage = target.linkage as TransactionLinkage | null;
    const alreadyAllocated = (targetLinkage?.reimbursedByAllocations || [])
      .filter((item) => item.transactionId !== currentReimbursementId)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);

    return {
      targetAmount,
      alreadyAllocated,
      remaining: Number(
        Math.max(targetAmount - alreadyAllocated, 0).toFixed(2),
      ),
    };
  }

  private static async rebalanceReimbursementTransaction(
    userId: string,
    reimbursementId: string,
  ) {
    const reimbursementTx = await prisma.transaction.findFirst({
      where: { id: reimbursementId, userId },
      select: {
        amountIn: true,
        linkage: true,
      },
    });
    if (!reimbursementTx) return;

    const linkage = reimbursementTx.linkage as TransactionLinkage | null;
    if (!linkage || linkage.type !== "reimbursement") return;

    const amountIn =
      reimbursementTx.amountIn !== null ? Number(reimbursementTx.amountIn) : 0;
    if (!(amountIn > 0)) {
      throw new Error(
        "Only positive inflow transactions can be marked as reimbursement",
      );
    }

    const normalized = this.normalizeReimbursementAllocations(linkage)
      .map((allocation) =>
        typeof allocation.transactionId === "string"
          ? {
              transactionId: allocation.transactionId,
              amount: Number(allocation.amount || 0),
            }
          : null,
      )
      .filter(
        (allocation): allocation is { transactionId: string; amount: number } =>
          !!allocation,
      );

    const previousReimbursedIds = Array.from(
      new Set(normalized.map((allocation) => allocation.transactionId)),
    );

    if (previousReimbursedIds.length > 0) {
      await this.removeReimbursementBacklinks(
        userId,
        reimbursementId,
        previousReimbursedIds,
      );
    }

    let remainingBudget = Number(amountIn.toFixed(2));
    const nextAllocations: Array<{ transactionId: string; amount: number }> =
      [];
    for (const allocation of normalized) {
      if (!(remainingBudget > 0)) break;
      const capacity = await this.getTargetReimbursementCapacity(
        userId,
        allocation.transactionId,
        reimbursementId,
      );
      const allowed = Number(
        Math.min(
          Math.max(allocation.amount, 0),
          capacity.remaining,
          remainingBudget,
        ).toFixed(2),
      );
      if (!(allowed > 0)) continue;
      nextAllocations.push({
        transactionId: allocation.transactionId,
        amount: allowed,
      });
      remainingBudget = Number(
        Math.max(remainingBudget - allowed, 0).toFixed(2),
      );
    }

    await TransactionRepository.updateLinkage(reimbursementId, userId, {
      type: "reimbursement",
      reimbursesAllocations: nextAllocations,
      leftoverAmount: Number(remainingBudget.toFixed(2)),
      leftoverCategoryId: linkage.leftoverCategoryId ?? null,
      autoDetected: linkage.autoDetected,
      detectionReason: linkage.detectionReason,
    });

    if (nextAllocations.length > 0) {
      await this.applyReimbursementBacklinks(
        userId,
        reimbursementId,
        nextAllocations,
      );
    }
  }

  /**
   * Import transactions with duplicate detection
   * Returns duplicates for user review without committing
   */
  static async checkImport(
    userId: string,
    transactions: ImportTransactionInput[],
  ): Promise<{
    duplicates: Array<{ index: number; matches: DuplicateMatch[] }>;
    cleanCount: number;
  }> {
    const duplicatesMap = await DuplicateDetector.checkBulkDuplicates(
      userId,
      transactions,
    );

    const duplicates = Array.from(duplicatesMap.entries()).map(
      ([index, matches]) => ({
        index,
        matches,
      }),
    );

    return {
      duplicates,
      cleanCount: transactions.length - duplicates.length,
    };
  }

  /**
   * Ensure reserved categories exist for user
   */
  static async ensureReservedCategories(userId: string) {
    const [uncategorized, internal, reimbursement] = await Promise.all([
      prisma.category.upsert({
        where: {
          userId_name: { userId, name: RESERVED_CATEGORIES.UNCATEGORIZED.name },
        },
        update: {},
        create: {
          userId,
          ...RESERVED_CATEGORIES.UNCATEGORIZED,
          isDefault: true,
        },
      }),
      prisma.category.upsert({
        where: {
          userId_name: { userId, name: RESERVED_CATEGORIES.INTERNAL.name },
        },
        update: {},
        create: {
          userId,
          ...RESERVED_CATEGORIES.INTERNAL,
          isDefault: false,
        },
      }),
      prisma.category.upsert({
        where: {
          userId_name: { userId, name: RESERVED_CATEGORIES.REIMBURSEMENT.name },
        },
        update: {},
        create: {
          userId,
          ...RESERVED_CATEGORIES.REIMBURSEMENT,
          isDefault: false,
        },
      }),
    ]);

    return { uncategorized, internal, reimbursement };
  }

  static async bootstrapDefaultImportRules(userId: string) {
    // Remove previously shipped incorrect defaults before re-seeding.
    await prisma.importRule.deleteMany({
      where: {
        userId,
        name: {
          in: [
            "PayLah statement transactions are Internal",
            "PayLah top-up transactions are Internal",
          ],
        },
      },
    });

    await Promise.all(
      this.DEFAULT_IMPORT_RULES.map((rule) => {
        const normalized = this.normalizeImportRulePayload(rule);
        return prisma.importRule.upsert({
          where: {
            userId_name: {
              userId,
              name: normalized.name,
            },
          },
          update: {},
          create: {
            userId,
            ...normalized,
          },
        });
      }),
    );
  }

  static async getPaylahInternalPreferenceState(userId: string) {
    const [settings, paylahRules] = await Promise.all([
      prisma.userSettings.findUnique({
        where: { userId },
        select: {
          paylahInternalPrompted: true,
          paylahAutoInternal: true,
        },
      }),
      prisma.importRule.findMany({
        where: {
          userId,
          name: { in: [...this.PAYLAH_INTERNAL_RULE_NAMES] },
        },
        select: {
          id: true,
          enabled: true,
        },
      }),
    ]);

    const hasEnabledRule = paylahRules.some((rule) => rule.enabled);
    const prompted = Boolean(
      settings?.paylahInternalPrompted || hasEnabledRule,
    );
    const enabled = Boolean(settings?.paylahAutoInternal || hasEnabledRule);

    return {
      shouldPrompt: !prompted,
      enabled,
    };
  }

  private static async backfillDbsPaylahTransactionsAsInternal(userId: string) {
    const { internal } = await this.ensureReservedCategories(userId);

    const candidates = await prisma.transaction.findMany({
      where: {
        userId,
        importBatch: {
          is: {
            parserId: {
              in: ["dbs_posb_consolidated", "dbs_posb_consolidated_legacy"],
            },
          },
        },
        OR: this.DBS_PAYLAH_INTERNAL_PATTERNS.map((pattern) => ({
          description: {
            contains: pattern,
            mode: "insensitive",
          },
        })),
      },
      select: {
        id: true,
        linkage: true,
      },
    });

    const eligibleIds = candidates
      .filter((transaction) => {
        const linkage = transaction.linkage as TransactionLinkage | null;
        return (
          linkage?.type !== "reimbursement" && linkage?.type !== "reimbursed"
        );
      })
      .map((transaction) => transaction.id);

    if (eligibleIds.length === 0) {
      return { updatedCount: 0 };
    }

    await prisma.transaction.updateMany({
      where: {
        userId,
        id: { in: eligibleIds },
      },
      data: {
        linkage: {
          type: "internal",
          autoDetected: true,
          detectionReason: "Enabled PayLah internal auto-marking",
        },
        categoryId: internal.id,
      },
    });

    return { updatedCount: eligibleIds.length };
  }

  static async setPaylahInternalPreference(userId: string, enabled: boolean) {
    await this.bootstrapDefaultImportRules(userId);

    await prisma.$transaction(async (tx) => {
      await tx.userSettings.upsert({
        where: { userId },
        update: {
          paylahInternalPrompted: true,
          paylahAutoInternal: enabled,
        },
        create: {
          userId,
          paylahInternalPrompted: true,
          paylahAutoInternal: enabled,
        },
      });

      await tx.importRule.updateMany({
        where: {
          userId,
          name: { in: [...this.PAYLAH_INTERNAL_RULE_NAMES] },
        },
        data: {
          enabled,
        },
      });
    });

    if (!enabled) {
      return {
        enabled,
        updatedCount: 0,
      };
    }

    const { updatedCount } =
      await this.backfillDbsPaylahTransactionsAsInternal(userId);

    return {
      enabled,
      updatedCount,
    };
  }

  static async getImportRules(userId: string) {
    return prisma.importRule.findMany({
      where: { userId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }

  static async createImportRule(userId: string, payload: ImportRulePayload) {
    const normalized = this.normalizeImportRulePayload(payload);
    if (!normalized.name) {
      throw new Error("Rule name is required");
    }
    if (
      normalized.matchType === "description_contains" &&
      (!normalized.matchValue || normalized.matchValue.length === 0)
    ) {
      throw new Error("Match value is required for description contains rules");
    }
    return prisma.importRule.create({
      data: {
        userId,
        ...normalized,
      },
    });
  }

  static async updateImportRule(
    userId: string,
    ruleId: string,
    payload: Partial<ImportRulePayload>,
  ) {
    const existing = await prisma.importRule.findFirst({
      where: { id: ruleId, userId },
    });
    if (!existing) throw new Error("Import rule not found");

    const normalized = this.normalizeImportRulePayload({
      name: payload.name ?? existing.name,
      parserId:
        payload.parserId !== undefined ? payload.parserId : existing.parserId,
      matchType:
        (payload.matchType as "always" | "description_contains" | undefined) ??
        (existing.matchType as "always" | "description_contains"),
      matchValue:
        payload.matchValue !== undefined
          ? payload.matchValue
          : existing.matchValue,
      caseSensitive:
        payload.caseSensitive !== undefined
          ? payload.caseSensitive
          : existing.caseSensitive,
      enabled:
        payload.enabled !== undefined ? payload.enabled : existing.enabled,
      setLabel:
        payload.setLabel !== undefined ? payload.setLabel : existing.setLabel,
      setCategoryName:
        payload.setCategoryName !== undefined
          ? payload.setCategoryName
          : existing.setCategoryName,
      markInternal:
        payload.markInternal !== undefined
          ? payload.markInternal
          : existing.markInternal,
      sortOrder:
        payload.sortOrder !== undefined
          ? payload.sortOrder
          : existing.sortOrder,
    });

    if (!normalized.name) {
      throw new Error("Rule name is required");
    }
    if (
      normalized.matchType === "description_contains" &&
      (!normalized.matchValue || normalized.matchValue.length === 0)
    ) {
      throw new Error("Match value is required for description contains rules");
    }

    return prisma.importRule.update({
      where: { id: ruleId },
      data: normalized,
    });
  }

  static async deleteImportRule(userId: string, ruleId: string) {
    const existing = await prisma.importRule.findFirst({
      where: { id: ruleId, userId },
      select: { id: true },
    });
    if (!existing) throw new Error("Import rule not found");
    await prisma.importRule.delete({ where: { id: ruleId } });
    return { success: true };
  }

  /**
   * Commit selected transactions to database
   * Only imports transactions at specified indices
   */
  static async commitImport(
    userId: string,
    transactions: ImportTransactionInput[],
    selectedIndices: number[],
    batchInfo?: {
      filename: string;
      fileType: string;
      parserId: string;
    },
  ): Promise<ImportResult> {
    try {
      const userSettings = await prisma.userSettings.findUnique({
        where: { userId },
        select: { currency: true },
      });
      const userBaseCurrency = (userSettings?.currency || "SGD").toUpperCase();

      // Ensure reserved categories exist
      const { uncategorized, internal, reimbursement } =
        await this.ensureReservedCategories(userId);

      validatePendingReimbursementLinks(transactions, selectedIndices);

      let importBatchId: string | undefined;

      // Create import batch if info provided
      if (batchInfo) {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

        const batch = await prisma.importBatch.create({
          data: {
            userId,
            filename: batchInfo.filename,
            fileType: batchInfo.fileType,
            parserId: batchInfo.parserId,
            status: "COMMITTED",
            committedAt: new Date(),
            expiresAt,
          },
        });

        importBatchId = batch.id;
      }

      // Build index mapping for resolving batch indices later
      const indexToNewIndex = new Map<number, number>();
      let newIndex = 0;
      for (const originalIndex of selectedIndices.sort((a, b) => a - b)) {
        indexToNewIndex.set(originalIndex, newIndex++);
      }

      const rawSelectedTransactions = transactions.filter((_, index) =>
        selectedIndices.includes(index),
      );
      const ruleAppliedTransactions = await this.applyImportRules(
        userId,
        batchInfo?.parserId,
        rawSelectedTransactions,
      );

      // Filter transactions by selected indices and assign categories based on linkage
      const selectedTransactions = ruleAppliedTransactions.map(
        (transaction, index) => {
          let linkage = transaction.linkage as TransactionLinkage | null;
          let categoryId = transaction.categoryId;
          const amountIn =
            transaction.amountIn !== undefined
              ? Number(transaction.amountIn)
              : null;

          // Safety: treat reserved categories as reserved linkage semantics.
          if (!linkage && categoryId === internal.id) {
            linkage = {
              type: "internal",
              autoDetected: true,
              detectionReason: "Reserved category mapped to internal linkage",
            };
          } else if (!linkage && categoryId === reimbursement.id) {
            if (!amountIn || amountIn <= 0) {
              throw new Error(
                "Only positive inflow transactions can be marked as reimbursement",
              );
            }
            linkage = {
              type: "reimbursement",
              reimbursesAllocations: [],
              leftoverAmount: Number(amountIn.toFixed(2)),
              leftoverCategoryId: null,
              autoDetected: true,
              detectionReason:
                "Reserved category mapped to reimbursement linkage",
            };
          }

          // Auto-assign category based on linkage type
          if (linkage?.type === "internal") {
            categoryId = internal.id;
          } else if (linkage?.type === "reimbursement") {
            if (!amountIn || amountIn <= 0) {
              throw new Error(
                "Only positive inflow transactions can be marked as reimbursement",
              );
            }
            categoryId = reimbursement.id;
          } else if (!categoryId || categoryId.trim().length === 0) {
            categoryId = uncategorized.id;
          }

          const cleanLinkage = linkage
            ? {
                ...linkage,
                ...(linkage.type === "reimbursement"
                  ? {
                      reimbursesAllocations: Array.isArray(
                        linkage.reimbursesAllocations,
                      )
                        ? linkage.reimbursesAllocations
                        : [],
                      leftoverAmount:
                        linkage.leftoverAmount !== undefined
                          ? Number(linkage.leftoverAmount)
                          : Number(amountIn || 0),
                      leftoverCategoryId:
                        linkage.leftoverCategoryId !== undefined
                          ? linkage.leftoverCategoryId
                          : null,
                    }
                  : {}),
              }
            : null;

          const resolvedCurrency = (
            transaction.currency ||
            transaction.metadata?.currency ||
            userBaseCurrency ||
            "SGD"
          )
            .toString()
            .trim()
            .toUpperCase();
          const metadata = stripImportOrderMetadata(transaction.metadata);
          const importSource = batchInfo
            ? inferImportSourceFilename({
                batchFilename: batchInfo.filename,
                transactionDate: transaction.date,
                metadata,
              })
            : null;

          return {
            ...transaction,
            categoryId,
            currency: resolvedCurrency || "SGD",
            metadata: {
              ...metadata,
              ...(importSource
                ? { sourceFilename: importSource.filename }
                : {}),
              [IMPORT_ORIGINAL_INDEX_KEY]: selectedIndices[index],
            },
            linkage: cleanLinkage,
          };
        },
      );

      // Import selected transactions
      const result = await TransactionRepository.createMany(
        userId,
        selectedTransactions,
        importBatchId,
      );

      // Get the created transactions to resolve batch indices
      if (importBatchId) {
        const createdTransactionsRaw = await prisma.transaction.findMany({
          where: { importBatchId },
          orderBy: { createdAt: "asc" },
        });
        const createdTransactions = orderCreatedTransactionsForImport(
          createdTransactionsRaw,
          selectedIndices,
        );

        await Promise.all(
          createdTransactions.map((transaction) =>
            prisma.transaction.update({
              where: { id: transaction.id },
              data: {
                metadata: stripImportOrderMetadata(
                  transaction.metadata,
                ) as Prisma.InputJsonValue,
              },
            }),
          ),
        );

        // Resolve pending batch indices to actual IDs
        for (let i = 0; i < selectedTransactions.length; i++) {
          const transaction = selectedTransactions[i];
          const linkage = transaction.linkage as TransactionLinkage | null;
          const originalLinkage = transactions[selectedIndices[i]]
            .linkage as TransactionLinkage | null;

          if (
            originalLinkage?.type === "reimbursement" &&
            originalLinkage.reimbursesAllocations?.length
          ) {
            const baseLinkage = (linkage || {
              type: "reimbursement",
            }) as TransactionLinkage;
            const normalizedAllocations =
              this.normalizeReimbursementAllocations(originalLinkage);
            const detached = detachStagedReimbursementAllocations(
              normalizedAllocations,
              Number(baseLinkage.leftoverAmount || 0),
            );

            const resolvedAllocations = detached.linkedAllocations
              .map((allocation) => {
                if (allocation.transactionId) return allocation;
                if (
                  !("pendingBatchIndex" in allocation) ||
                  typeof allocation.pendingBatchIndex !== "number"
                ) {
                  return null;
                }
                const targetNewIndex = indexToNewIndex.get(
                  allocation.pendingBatchIndex,
                );
                if (
                  targetNewIndex === undefined ||
                  !createdTransactions[targetNewIndex]
                ) {
                  return null;
                }
                return {
                  transactionId: createdTransactions[targetNewIndex].id,
                  amount: allocation.amount,
                };
              })
              .filter(
                (
                  allocation,
                ): allocation is { transactionId: string; amount: number } =>
                  !!allocation?.transactionId,
              );

            await prisma.transaction.update({
              where: { id: createdTransactions[i].id },
              data: {
                linkage: {
                  type: "reimbursement",
                  reimbursesAllocations: resolvedAllocations,
                  leftoverAmount:
                    baseLinkage.leftoverAmount !== undefined ||
                    detached.leftoverAmount > 0
                      ? detached.leftoverAmount
                      : undefined,
                  leftoverCategoryId: baseLinkage.leftoverCategoryId ?? null,
                  autoDetected: baseLinkage.autoDetected,
                  detectionReason: baseLinkage.detectionReason,
                },
              },
            });

            await this.applyReimbursementBacklinks(
              userId,
              createdTransactions[i].id,
              resolvedAllocations.filter((item) => item.amount > 0),
            );
          }
        }
      }

      try {
        const appliedPatternIds = selectedTransactions
          .map((transaction) => {
            const metadata = transaction.metadata as
              Record<string, any> | undefined;
            return String(metadata?.classificationPatternId || "");
          })
          .filter(Boolean);
        await this.incrementClassificationPatternAppliedCounts(
          userId,
          appliedPatternIds,
        );
        await this.rebuildClassificationPatterns(userId);
      } catch (classificationError) {
        console.error(
          "Failed to refresh classification patterns after import:",
          classificationError,
        );
      }

      return {
        success: true,
        importedCount: result.count,
        batchId: importBatchId,
      };
    } catch (error: unknown) {
      console.error("Error committing import:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get transactions with filters
   */
  static async getTransactions(
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
    return TransactionRepository.findMany(userId, filters);
  }

  static async getTransactionYears(userId: string) {
    return TransactionRepository.getYears(userId);
  }

  /**
   * Get single transaction
   */
  static async getTransaction(id: string, userId: string) {
    return TransactionRepository.findById(id, userId);
  }

  /**
   * Update transaction
   */
  static async updateTransaction(
    id: string,
    userId: string,
    data: Partial<ImportTransactionInput>,
  ) {
    const existing = await TransactionRepository.findById(id, userId);
    if (!existing) {
      throw new Error("Transaction not found");
    }

    const next: Partial<ImportTransactionInput> = { ...data };
    const linkage = data.linkage as TransactionLinkage | null | undefined;
    const existingLinkage = existing.linkage as TransactionLinkage | null;
    const amountFieldsUpdated =
      data.amountIn !== undefined || data.amountOut !== undefined;
    let normalizedAllocations: Array<{
      transactionId: string;
      amount: number;
    }> = [];
    const previousReimburserIdsFromTarget =
      existingLinkage?.type === "reimbursed" && amountFieldsUpdated
        ? Array.from(
            new Set(
              (existingLinkage.reimbursedByAllocations || [])
                .map((item) => item.transactionId || "")
                .filter(Boolean),
            ),
          )
        : [];
    const shouldRebalanceCurrentReimbursementAfterUpdate =
      linkage === undefined &&
      existingLinkage?.type === "reimbursement" &&
      amountFieldsUpdated;

    if (linkage !== undefined) {
      if (linkage?.type === "internal") {
        const { internal } = await this.ensureReservedCategories(userId);
        next.categoryId = internal.id;
      } else if (linkage?.type === "reimbursement") {
        const amountIn =
          next.amountIn ??
          (existing.amountIn !== null ? Number(existing.amountIn) : null);
        if (!amountIn || amountIn <= 0) {
          throw new Error(
            "Only positive inflow transactions can be marked as reimbursement",
          );
        }
        const allAllocations = this.normalizeReimbursementAllocations(linkage);
        const totalAllocatedIncludingStaged = allAllocations.reduce(
          (sum, allocation) => sum + allocation.amount,
          0,
        );
        normalizedAllocations = allAllocations
          .map((allocation) =>
            typeof allocation.transactionId === "string"
              ? {
                  transactionId: allocation.transactionId,
                  amount: Number(allocation.amount || 0),
                }
              : null,
          )
          .filter(
            (
              allocation,
            ): allocation is { transactionId: string; amount: number } =>
              !!allocation,
          );
        const totalAllocated = normalizedAllocations.reduce(
          (sum, allocation) => sum + allocation.amount,
          0,
        );
        if (totalAllocatedIncludingStaged - amountIn > 0.01) {
          throw new Error(
            "Total reimbursed amount cannot exceed reimbursement amount",
          );
        }
        for (const allocation of normalizedAllocations) {
          if (allocation.transactionId === id) {
            throw new Error("A transaction cannot reimburse itself");
          }
          const target = await TransactionRepository.findById(
            allocation.transactionId,
            userId,
          );
          if (!target) {
            throw new Error(
              "One or more reimbursed transactions were not found",
            );
          }
          const capacity = await this.getTargetReimbursementCapacity(
            userId,
            allocation.transactionId,
            id,
          );
          if (allocation.amount - capacity.remaining > 0.01) {
            throw new Error(
              "Reimbursed amount cannot exceed target transaction amount",
            );
          }
        }
        const { reimbursement } = await this.ensureReservedCategories(userId);
        next.categoryId = reimbursement.id;
        next.linkage = {
          type: "reimbursement",
          reimbursesAllocations: normalizedAllocations,
          leftoverAmount: Number((amountIn - totalAllocated).toFixed(2)),
          leftoverCategoryId: linkage.leftoverCategoryId ?? null,
          autoDetected: linkage.autoDetected,
          detectionReason: linkage.detectionReason,
        };
      } else if (linkage === null) {
        if (existingLinkage?.type === "reimbursed") {
          // Preserve reimbursed state by default when editing transaction fields.
          // Use clearLinkage API for explicit unlinking.
          next.linkage = existingLinkage;
        }
        const currentCategoryName = existing.category?.name ?? "";
        if (
          currentCategoryName === RESERVED_CATEGORIES.INTERNAL.name ||
          currentCategoryName === RESERVED_CATEGORIES.REIMBURSEMENT.name
        ) {
          next.categoryId = null;
        }
      }
    }

    const updated = await TransactionRepository.update(id, userId, next);

    const previousReimbursedIds =
      existingLinkage?.type === "reimbursement"
        ? Array.from(
            new Set(
              this.normalizeReimbursementAllocations(existingLinkage)
                .map((allocation) => allocation.transactionId || "")
                .filter(Boolean),
            ),
          )
        : [];
    if (previousReimbursedIds.length > 0) {
      await this.removeReimbursementBacklinks(
        userId,
        id,
        previousReimbursedIds,
      );
    }
    if (linkage?.type === "reimbursement" && normalizedAllocations.length > 0) {
      await this.applyReimbursementBacklinks(
        userId,
        id,
        normalizedAllocations.filter((allocation) => allocation.amount > 0),
      );
    }
    if (shouldRebalanceCurrentReimbursementAfterUpdate) {
      await this.rebalanceReimbursementTransaction(userId, id);
    }
    if (previousReimburserIdsFromTarget.length > 0) {
      for (const reimburserId of previousReimburserIdsFromTarget) {
        await this.rebalanceReimbursementTransaction(userId, reimburserId);
      }
    }

    return updated;
  }

  static async splitTransaction(
    id: string,
    userId: string,
    children: Array<{
      description: string;
      label?: string | null;
      categoryId?: string | null;
      amountIn?: number | null;
      amountOut?: number | null;
    }>,
  ) {
    const existing = await TransactionRepository.findById(id, userId);
    if (!existing) {
      throw new Error("Transaction not found");
    }

    const existingLinkage = existing.linkage as TransactionLinkage | null;
    if (
      existingLinkage?.type === "reimbursement" ||
      existingLinkage?.type === "reimbursed"
    ) {
      throw new Error(
        "Reimbursement transactions cannot be split. To split this transaction, first remove the reimbursements, then redo the reimbursements on the split transactions.",
      );
    }

    if (children.length !== 2) {
      throw new Error(
        "A transaction must be split into exactly two transactions",
      );
    }

    const originalNet = Number(
      (
        (existing.amountIn !== null ? Number(existing.amountIn) : 0) -
        (existing.amountOut !== null ? Number(existing.amountOut) : 0)
      ).toFixed(2),
    );
    const childNet = Number(
      children
        .reduce(
          (sum, child) =>
            sum + Number(child.amountIn || 0) - Number(child.amountOut || 0),
          0,
        )
        .toFixed(2),
    );
    if (Math.abs(originalNet - childNet) > 0.01) {
      throw new Error(
        "Split transactions must add up to the original net amount",
      );
    }

    for (const child of children) {
      const amountIn = Number(child.amountIn || 0);
      const amountOut = Number(child.amountOut || 0);
      if (!child.description?.trim()) {
        throw new Error("Each split transaction needs a description");
      }
      if (
        (amountIn > 0 && amountOut > 0) ||
        (amountIn <= 0 && amountOut <= 0)
      ) {
        throw new Error(
          "Each split transaction must have either amount in or amount out",
        );
      }
    }

    const isInternal = existingLinkage?.type === "internal";
    const { internal } = isInternal
      ? await this.ensureReservedCategories(userId)
      : { internal: null as any };

    const categoryIds = children
      .map((child) => child.categoryId || existing.categoryId)
      .filter((categoryId): categoryId is string => !!categoryId);
    if (categoryIds.length > 0) {
      const validCategoryCount = await prisma.category.count({
        where: { userId, id: { in: Array.from(new Set(categoryIds)) } },
      });
      if (validCategoryCount !== new Set(categoryIds).size) {
        throw new Error("One or more split categories were not found");
      }
    }

    return prisma.$transaction(async (tx) => {
      const created = [];
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        const metadata = {
          ...((existing.metadata && typeof existing.metadata === "object"
            ? existing.metadata
            : {}) as Record<string, unknown>),
          splitFromTransactionId: existing.id,
          splitFromDescription: existing.description,
          splitChildIndex: index + 1,
        };

        created.push(
          await tx.transaction.create({
            data: {
              userId,
              date: existing.date,
              description: child.description.trim(),
              label: child.label?.trim() || null,
              categoryId: isInternal
                ? internal.id
                : child.categoryId || existing.categoryId,
              amountIn: child.amountIn || null,
              amountOut: child.amountOut || null,
              balance: index === children.length - 1 ? existing.balance : null,
              accountIdentifier: existing.accountIdentifier,
              source: existing.source,
              currency: existing.currency,
              metadata: metadata as Prisma.InputJsonValue,
              linkage: isInternal
                ? ({
                    type: "internal",
                    autoDetected: false,
                    detectionReason: "Inherited from split transaction",
                  } as Prisma.InputJsonValue)
                : Prisma.DbNull,
              importBatchId: existing.importBatchId,
              createdAt: new Date(existing.createdAt.getTime() + index),
            },
            include: { category: true, importBatch: true },
          }),
        );
      }

      await tx.transaction.delete({ where: { id, userId } });
      return created;
    });
  }

  /**
   * Delete transaction
   */
  static async deleteTransaction(id: string, userId: string) {
    return TransactionRepository.delete(id, userId);
  }

  /**
   * Delete multiple transactions
   */
  static async deleteTransactions(ids: string[], userId: string) {
    return TransactionRepository.deleteMany(ids, userId);
  }

  static async bulkUpdateByIds(
    userId: string,
    ids: string[],
    updates: Partial<ImportTransactionInput>,
  ) {
    return TransactionRepository.updateManyByIds(userId, ids, updates);
  }

  static async bulkUpdateByFilter(
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
    return TransactionRepository.updateManyByFilter(
      userId,
      filters,
      excludeIds,
      updates,
    );
  }

  static async bulkDeleteByFilter(
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
    return TransactionRepository.deleteManyByFilter(
      userId,
      filters,
      excludeIds,
    );
  }

  static async exportByIds(userId: string, ids: string[]) {
    return TransactionRepository.findManyByIds(userId, ids);
  }

  static async exportByFilter(
    userId: string,
    filters: {
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
    return TransactionRepository.findManyByFilter(userId, filters, excludeIds);
  }

  /**
   * Mark a transaction as internal
   */
  static async markAsInternal(
    id: string,
    userId: string,
    autoDetected: boolean = false,
    detectionReason?: string,
  ) {
    const { internal } = await this.ensureReservedCategories(userId);

    const linkage: TransactionLinkage = {
      type: "internal",
      autoDetected,
      detectionReason,
    };

    return TransactionRepository.updateLinkageAndCategory(
      id,
      userId,
      linkage,
      internal.id,
    );
  }

  /**
   * Create reimbursement link between transactions
   */
  static async createReimbursementLink(
    reimbursementId: string,
    reimbursedAllocations: Array<{ transactionId: string; amount: number }>,
    userId: string,
    leftoverCategoryId?: string | null,
  ) {
    const { reimbursement } = await this.ensureReservedCategories(userId);

    const reimbursingTransaction = await TransactionRepository.findById(
      reimbursementId,
      userId,
    );
    if (!reimbursingTransaction) {
      throw new Error("Transaction not found");
    }
    const amountIn = reimbursingTransaction.amountIn
      ? Number(reimbursingTransaction.amountIn)
      : null;
    if (!amountIn || amountIn <= 0) {
      throw new Error(
        "Only positive inflow transactions can be marked as reimbursement",
      );
    }

    const existing = await prisma.transaction.findUnique({
      where: { id: reimbursementId },
      select: { linkage: true },
    });

    const existingLinkage = existing?.linkage as TransactionLinkage | null;
    if (existingLinkage?.type === "internal") {
      throw new Error(
        "Internal transactions cannot be marked as reimbursements",
      );
    }
    const previousReimbursedIds =
      existingLinkage?.type === "reimbursement"
        ? Array.from(
            new Set(
              this.normalizeReimbursementAllocations(existingLinkage)
                .map((allocation) => allocation.transactionId || "")
                .filter(Boolean),
            ),
          )
        : [];

    const totalAllocated = reimbursedAllocations.reduce(
      (sum, allocation) => sum + Number(allocation.amount || 0),
      0,
    );
    if (totalAllocated - amountIn > 0.01) {
      throw new Error(
        "Total reimbursed amount cannot exceed reimbursement amount",
      );
    }

    for (const allocation of reimbursedAllocations) {
      if (allocation.transactionId === reimbursementId) {
        throw new Error("A transaction cannot reimburse itself");
      }
      const capacity = await this.getTargetReimbursementCapacity(
        userId,
        allocation.transactionId,
        reimbursementId,
      );
      if (allocation.amount - capacity.remaining > 0.01) {
        throw new Error(
          `Reimbursed amount exceeds remaining amount for transaction ${allocation.transactionId}`,
        );
      }
    }

    // Update the reimbursing transaction
    const linkage: TransactionLinkage = {
      type: "reimbursement",
      reimbursesAllocations: reimbursedAllocations,
      leftoverAmount: Number((amountIn - totalAllocated).toFixed(2)),
      leftoverCategoryId: leftoverCategoryId ?? null,
    };

    await TransactionRepository.updateLinkageAndCategory(
      reimbursementId,
      userId,
      linkage,
      reimbursement.id,
    );

    if (previousReimbursedIds.length > 0) {
      await this.removeReimbursementBacklinks(
        userId,
        reimbursementId,
        previousReimbursedIds,
      );
    }

    await this.applyReimbursementBacklinks(
      userId,
      reimbursementId,
      reimbursedAllocations.filter((allocation) => allocation.amount > 0),
    );

    return { success: true };
  }

  /**
   * Clear linkage from a transaction
   */
  static async clearLinkage(id: string, userId: string) {
    const transaction = await prisma.transaction.findUnique({
      where: { id },
      select: { linkage: true },
    });

    const linkage = transaction?.linkage as TransactionLinkage | null;

    // If this was a reimbursement, clean up backlinks from reimbursed targets
    if (linkage?.type === "reimbursement") {
      const reimbursedIds = Array.from(
        new Set(
          this.normalizeReimbursementAllocations(linkage)
            .map((allocation) => allocation.transactionId || "")
            .filter(Boolean),
        ),
      );
      if (reimbursedIds.length > 0) {
        await this.removeReimbursementBacklinks(userId, id, reimbursedIds);
      }
    }
    // If this was a reimbursed transaction, clean up forward links from reimbursers
    if (linkage?.type === "reimbursed") {
      const reimburserIds = Array.from(
        new Set(
          (linkage.reimbursedByAllocations || [])
            .map((item) => item.transactionId || "")
            .filter(Boolean),
        ),
      );
      const reimbursersToRebalance: string[] = [];

      for (const reimburserId of reimburserIds) {
        const reimburser = await prisma.transaction.findUnique({
          where: { id: reimburserId },
          select: { linkage: true },
        });
        const reimburserLinkage =
          reimburser?.linkage as TransactionLinkage | null;
        if (!reimburserLinkage || reimburserLinkage.type !== "reimbursement") {
          continue;
        }

        const nextAllocations = (
          reimburserLinkage.reimbursesAllocations || []
        ).filter((allocation) => allocation.transactionId !== id);

        if (nextAllocations.length === 0) {
          await TransactionRepository.updateLinkage(reimburserId, userId, {
            ...reimburserLinkage,
            type: "reimbursement",
            reimbursesAllocations: [],
          });
          reimbursersToRebalance.push(reimburserId);
          continue;
        }

        await TransactionRepository.updateLinkage(reimburserId, userId, {
          ...reimburserLinkage,
          type: "reimbursement",
          reimbursesAllocations: nextAllocations,
        });
        reimbursersToRebalance.push(reimburserId);
      }

      for (const reimburserId of reimbursersToRebalance) {
        await this.rebalanceReimbursementTransaction(userId, reimburserId);
      }
    }

    // Clear the transaction's linkage and category
    return prisma.transaction.update({
      where: { id, userId },
      data: { linkage: Prisma.DbNull, categoryId: null },
      include: { category: true },
    });
  }

  /**
   * Get linked transactions for display
   */
  static async getLinkedTransactions(id: string, userId: string) {
    const transaction = await prisma.transaction.findUnique({
      where: { id },
      select: { linkage: true },
    });

    const linkage = transaction?.linkage as TransactionLinkage | null;
    if (!linkage) return { reimburses: [], reimbursedBy: [] };

    const reimbursesIds = Array.from(
      new Set(
        this.normalizeReimbursementAllocations(linkage)
          .map((item) => item.transactionId || "")
          .filter(Boolean),
      ),
    ).filter((transactionId) => transactionId !== id);
    const reimbursedByIds = Array.from(
      new Set(
        (linkage.reimbursedByAllocations || []).map(
          (item) => item.transactionId,
        ),
      ),
    ).filter((transactionId) => transactionId !== id);

    const [reimbursesRaw, reimbursedByRaw] = await Promise.all([
      reimbursesIds.length
        ? TransactionRepository.getLinkedTransactions(userId, reimbursesIds)
        : [],
      reimbursedByIds.length
        ? TransactionRepository.getLinkedTransactions(userId, reimbursedByIds)
        : [],
    ]);

    const reimbursesAmountMap = new Map(
      (linkage.reimbursesAllocations || [])
        .filter((item) => typeof item.transactionId === "string")
        .map((item) => [
          item.transactionId as string,
          Number(item.amount || 0),
        ]),
    );
    const reimbursedByAmountMap = new Map(
      (linkage.reimbursedByAllocations || []).map((item) => [
        item.transactionId,
        Number(item.amount || 0),
      ]),
    );

    const reimburses = reimbursesRaw.map((row: any) => ({
      ...row,
      reimbursementAmount: reimbursesAmountMap.get(row.id) ?? null,
    }));
    const reimbursedBy = reimbursedByRaw.map((row: any) => ({
      ...row,
      reimbursementAmount: reimbursedByAmountMap.get(row.id) ?? null,
    }));

    return {
      reimburses,
      reimbursedBy,
      leftoverAmount: linkage.leftoverAmount ?? null,
      leftoverCategoryId: linkage.leftoverCategoryId ?? null,
    };
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
    return TransactionRepository.searchForReimbursement(
      userId,
      query,
      limit,
      offset,
      filters,
    );
  }

  static async repairInvalidLinkages(userId: string) {
    const transactions = await prisma.transaction.findMany({
      where: { userId },
      select: {
        id: true,
        linkage: true,
      },
    });
    const linkageByTransactionId = new Map<string, TransactionLinkage | null>();
    transactions.forEach((transaction) => {
      linkageByTransactionId.set(
        transaction.id,
        (transaction.linkage as TransactionLinkage | null) || null,
      );
    });

    let fixedCount = 0;

    for (const transaction of transactions) {
      const linkage = transaction.linkage as TransactionLinkage | null;
      const sanitized = this.sanitizeLinkageForTransaction(
        transaction.id,
        linkage,
        { linkageByTransactionId, targetId: transaction.id },
      );

      const before = JSON.stringify(linkage ?? null);
      const after = JSON.stringify(sanitized ?? null);

      if (before !== after) {
        await TransactionRepository.updateLinkage(
          transaction.id,
          userId,
          sanitized,
        );
        linkageByTransactionId.set(transaction.id, sanitized);
        fixedCount += 1;
      }
    }

    return { fixedCount };
  }
}
