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
import { afterCommit } from "../../lib/database-context";
import { EndRef, stripLinkFields } from "../reimbursements/links.core";
import { transactionKey } from "../reimbursements/links.core";
import {
  assertSavedLinksFit,
  counterpartsOf,
  deleteRoleLinks,
  isSameLinkSet,
  lockEnds,
  refreshAfterDelete,
  replaceLinks,
  runInTransaction,
  syncTransactionCaches,
} from "../reimbursements/links.service";
import { auditLinks } from "../reimbursements/links.queries";
import { TripRepository } from "../trips/trips.repository";

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
  /** Created transaction ids, in ascending order of the selected indices. */
  transactionIds?: string[];
  error?: string;
}

export function compatibleImportRuleParserIds(parserId?: string) {
  if (!parserId) return [];
  if (["dbs_paylah_statement", "dbs_paylah_statement_new"].includes(parserId)) {
    return ["dbs_paylah_statement", "dbs_paylah_statement_new"];
  }
  return [parserId];
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
  accountIdentifier?: string | null;
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
    "DBS/POSB PayLah max-out is Internal",
    "DBS/POSB legacy PayLah max-out is Internal",
    "PayLah send back to bank is Internal",
    "DBS/POSB receive back from PayLah is Internal",
    "DBS/POSB legacy receive back from PayLah is Internal",
  ] as const;

  private static readonly DBS_PAYLAH_INTERNAL_PATTERNS = [
    "TOP-UP TO PAYLAH!",
    "MAXED OUT FROM PAYLAH!",
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
      name: "DBS/POSB PayLah max-out is Internal",
      parserId: "dbs_posb_consolidated",
      matchType: "description_contains",
      matchValue: "MAXED OUT FROM PAYLAH!",
      caseSensitive: false,
      enabled: false,
      setLabel: null,
      setCategoryName: null,
      markInternal: true,
      sortOrder: 25,
    },
    {
      name: "DBS/POSB legacy PayLah max-out is Internal",
      parserId: "dbs_posb_consolidated_legacy",
      matchType: "description_contains",
      matchValue: "MAXED OUT FROM PAYLAH!",
      caseSensitive: false,
      enabled: false,
      setLabel: null,
      setCategoryName: null,
      markInternal: true,
      sortOrder: 26,
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
      accountIdentifier: payload.accountIdentifier?.trim() || null,
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
      accountIdentifier?: string | null;
      matchType: string;
      matchValue: string | null;
      caseSensitive: boolean;
    },
    tx: {
      description?: string | null;
      accountIdentifier?: string | null;
      metadata?: unknown;
    },
  ) {
    if (rule.accountIdentifier) {
      const account =
        tx.accountIdentifier ||
        (tx.metadata as { accountIdentifier?: string } | null)
          ?.accountIdentifier;
      if (account !== rule.accountIdentifier) return false;
    }
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

  /** A rule may only be scoped to one of the user's own accounts. */
  private static async assertRuleAccount(
    userId: string,
    accountIdentifier: string | null,
  ) {
    if (
      accountIdentifier &&
      !(await prisma.accountIdentifier.findFirst({
        where: { userId, accountIdentifier },
        select: { id: true },
      }))
    )
      throw new Error(`Account ${accountIdentifier} not found`);
  }

  static async createImportRule(userId: string, payload: ImportRulePayload) {
    const normalized = this.normalizeImportRulePayload(payload);
    await this.assertRuleAccount(userId, normalized.accountIdentifier);
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
      accountIdentifier:
        payload.accountIdentifier !== undefined
          ? payload.accountIdentifier
          : existing.accountIdentifier,
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

    await this.assertRuleAccount(userId, normalized.accountIdentifier);
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
    options: {
      /** Staged drafts keep links in the links table; direct imports send them in the payload. */
      linksFromPayload?: boolean;
    } = {},
  ): Promise<ImportResult> {
    try {
      // One database transaction: rows and links are saved together or not at all.
      return await runInTransaction((db) =>
        this.commitImportInTransaction(
          db,
          userId,
          transactions,
          selectedIndices,
          batchInfo,
          options.linksFromPayload !== false,
        ),
      );
    } catch (error: unknown) {
      console.error("Error committing import:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private static async commitImportInTransaction(
    db: Prisma.TransactionClient,
    userId: string,
    transactions: ImportTransactionInput[],
    selectedIndices: number[],
    batchInfo:
      | {
          filename: string;
          fileType: string;
          parserId: string;
        }
      | undefined,
    linksFromPayload: boolean,
  ): Promise<ImportResult> {
    const userSettings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { currency: true },
    });
    const userBaseCurrency = (userSettings?.currency || "SGD").toUpperCase();

    // Ensure reserved categories exist
    const { uncategorized, internal, reimbursement } =
      await this.ensureReservedCategories(userId);

    const sortedSelected = [...new Set(selectedIndices)].sort((a, b) => a - b);
    if (linksFromPayload)
      validatePendingReimbursementLinks(transactions, sortedSelected);

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

    const rawSelectedTransactions = sortedSelected.map(
      (index) => transactions[index],
    );
    const ruleAppliedTransactions = await this.applyImportRules(
      userId,
      batchInfo?.parserId,
      rawSelectedTransactions,
    );

    // Assign categories based on linkage; link data itself goes to the links table.
    const selectedTransactions = ruleAppliedTransactions.map(
      (transaction, index) => {
        let linkage = stripLinkFields(transaction.linkage) as TransactionLinkage | null;
        let categoryId = transaction.categoryId;
        const amountIn =
          transaction.amountIn !== undefined && transaction.amountIn !== null
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
          linkage = {
            ...linkage,
            leftoverCategoryId: linkage.leftoverCategoryId ?? null,
          };
        } else if (!categoryId || categoryId.trim().length === 0) {
          categoryId = uncategorized.id;
        }

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
            ...(importSource ? { sourceFilename: importSource.filename } : {}),
            [IMPORT_ORIGINAL_INDEX_KEY]: sortedSelected[index],
          },
          linkage,
        };
      },
    );

    const createdRaw = await TransactionRepository.createMany(
      userId,
      selectedTransactions,
      importBatchId,
    );
    const createdTransactions = orderCreatedTransactionsForImport(
      createdRaw,
      sortedSelected,
    );
    for (const transaction of createdTransactions) {
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          metadata: stripImportOrderMetadata(
            transaction.metadata,
          ) as Prisma.InputJsonValue,
        },
      });
    }
    const createdIdByIndex = new Map(
      sortedSelected.map((index, position) => [
        index,
        createdTransactions[position].id,
      ]),
    );

    // Direct imports carry links in the payload: other rows by position,
    // saved transactions and staged rows by id.
    if (linksFromPayload) {
      for (const index of sortedSelected) {
        const linkage = transactions[index].linkage as TransactionLinkage | null;
        if (
          linkage?.type !== "reimbursement" ||
          !Array.isArray(linkage.reimbursesAllocations) ||
          linkage.reimbursesAllocations.length === 0
        )
          continue;
        const targets = linkage.reimbursesAllocations.flatMap((allocation): Array<{ other: EndRef; amount: number }> => {
          const amount = Number(allocation.amount || 0);
          if (!(amount > 0)) return [];
          if (allocation.stagedRowId)
            return [{ other: { draftRowId: allocation.stagedRowId }, amount }];
          if (allocation.transactionId)
            return [{ other: { transactionId: allocation.transactionId }, amount }];
          if (typeof allocation.pendingBatchIndex === "number") {
            const targetId = createdIdByIndex.get(allocation.pendingBatchIndex);
            if (!targetId)
              throw new Error(
                `Row ${index + 1} reimburses row ${allocation.pendingBatchIndex + 1}; the target transaction must also be selected`,
              );
            return [{ other: { transactionId: targetId }, amount }];
          }
          return [];
        });
        await replaceLinks(db, userId, {
          subject: { transactionId: createdIdByIndex.get(index) as string },
          role: "reimbursement",
          links: targets,
        });
      }
    }
    await syncTransactionCaches(
      db,
      userId,
      createdTransactions
        .filter((transaction, position) =>
          (selectedTransactions[position].linkage as TransactionLinkage | null)?.type === "reimbursement",
        )
        .map((transaction) => transaction.id),
    );

    const appliedPatternIds = selectedTransactions
      .map((transaction) => {
        const metadata = transaction.metadata as Record<string, any> | undefined;
        return String(metadata?.classificationPatternId || "");
      })
      .filter(Boolean);
    // Pattern learning is best effort and must not abort the import's transaction.
    await afterCommit(async () => {
      try {
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
    });

    return {
      success: true,
      importedCount: createdTransactions.length,
      batchId: importBatchId,
      transactionIds: createdTransactions.map((transaction) => transaction.id),
    };
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
    return runInTransaction(async (db) => {
      await lockEnds(db, userId, [transactionKey(id)]);
      const existing = await TransactionRepository.findById(id, userId);
      if (!existing) {
        throw new Error("Transaction not found");
      }

      const next: Partial<ImportTransactionInput> = { ...data };
      const linkageInput = data.linkage as TransactionLinkage | null | undefined;
      const existingLinkage = stripLinkFields(existing.linkage);
      const existingType = (existingLinkage?.type as string | undefined) ?? null;
      const nextAmountIn =
        data.amountIn !== undefined
          ? data.amountIn
          : existing.amountIn !== null
            ? Number(existing.amountIn)
            : null;
      let nextType = existingType;

      if (linkageInput === undefined) {
        delete next.linkage;
      } else {
        const stripped = stripLinkFields(linkageInput);
        nextType = (stripped?.type as string | undefined) ?? null;
        if (nextType === "internal") {
          const { internal } = await this.ensureReservedCategories(userId);
          next.categoryId = internal.id;
          next.linkage = stripped as unknown as TransactionLinkage;
        } else if (nextType === "reimbursement") {
          if (!nextAmountIn || nextAmountIn <= 0) {
            throw new Error(
              "Only positive inflow transactions can be marked as reimbursement",
            );
          }
          const { reimbursement } = await this.ensureReservedCategories(userId);
          next.categoryId = reimbursement.id;
          next.linkage = {
            ...(existingType === "reimbursement" ? existingLinkage : {}),
            ...stripped,
            type: "reimbursement",
            leftoverCategoryId:
              linkageInput?.leftoverCategoryId !== undefined
                ? linkageInput.leftoverCategoryId
                : ((existingLinkage?.leftoverCategoryId as string | null | undefined) ?? null),
          } as TransactionLinkage;
        } else {
          next.linkage = null;
          const currentCategoryName = existing.category?.name ?? "";
          const reservedCategory =
            currentCategoryName === RESERVED_CATEGORIES.INTERNAL.name ||
            currentCategoryName === RESERVED_CATEGORIES.REIMBURSEMENT.name;
          if (
            reservedCategory &&
            (data.categoryId === undefined || data.categoryId === existing.categoryId)
          ) {
            next.categoryId = null;
          }
        }
      }

      await TransactionRepository.update(id, userId, next);

      const ref = { transactionId: id };
      if (existingType === "reimbursement" && nextType !== "reimbursement")
        await deleteRoleLinks(db, userId, ref, "reimbursement");
      if (
        (nextType === "internal" || nextType === "reimbursement") &&
        existingType !== nextType
      )
        await deleteRoleLinks(db, userId, ref, "expense");

      let warnings: string[] = [];
      if (
        nextType === "reimbursement" &&
        linkageInput &&
        Array.isArray(linkageInput.reimbursesAllocations)
      ) {
        const targets = linkageInput.reimbursesAllocations.flatMap(
          (allocation): Array<{ other: EndRef; amount: number }> => {
            const amount = Number(allocation.amount || 0);
            if (!(amount > 0)) return [];
            if (allocation.stagedRowId)
              return [{ other: { draftRowId: allocation.stagedRowId }, amount }];
            if (allocation.transactionId)
              return [{ other: { transactionId: allocation.transactionId }, amount }];
            throw new Error("A reimbursement link has no target transaction");
          },
        );
        if (!(await isSameLinkSet(db, userId, ref, "reimbursement", targets)))
          warnings = (
            await replaceLinks(db, userId, {
              subject: ref,
              role: "reimbursement",
              links: targets,
            })
          ).warnings;
      }

      await assertSavedLinksFit(db, userId, id);
      await syncTransactionCaches(db, userId, [id]);
      if (data.amountIn !== undefined || data.amountOut !== undefined)
        await TripRepository.syncBankTransactionAmountsTx(db, userId, [id]);
      const updated = await prisma.transaction.findFirst({ where: { id, userId } });
      return { ...updated, ...(warnings.length ? { warnings } : {}) };
    });
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
    const linkCount = await prisma.reimbursementLink.count({
      where: {
        userId,
        OR: [{ reimbursementTransactionId: id }, { expenseTransactionId: id }],
      },
    });
    if (existingLinkage?.type === "reimbursement" || linkCount > 0) {
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

      await TripRepository.detachBankTransactionsTx(tx, userId, [id], "split");
      await tx.transaction.delete({ where: { id, userId } });
      return created;
    });
  }

  /**
   * Delete transaction. Its links cascade away; the other ends' caches are rebuilt.
   */
  static async deleteTransaction(id: string, userId: string) {
    return runInTransaction(async (db) => {
      await TripRepository.detachBankTransactionsTx(db, userId, [id], "deleted");
      const counterparts = await counterpartsOf(db, userId, [id]);
      const result = await TransactionRepository.delete(id, userId);
      await refreshAfterDelete(db, userId, counterparts);
      return result;
    });
  }

  /**
   * Delete multiple transactions
   */
  static async deleteTransactions(ids: string[], userId: string) {
    return runInTransaction(async (db) => {
      await TripRepository.detachBankTransactionsTx(db, userId, ids, "deleted");
      const counterparts = await counterpartsOf(db, userId, ids);
      const result = await TransactionRepository.deleteMany(ids, userId);
      await refreshAfterDelete(db, userId, counterparts);
      return result;
    });
  }

  /** Amount edits must keep saved links within the new amounts. */
  private static async checkLinksAfterBulkUpdate(
    db: Prisma.TransactionClient,
    userId: string,
    ids: string[],
    updates: Partial<ImportTransactionInput>,
  ) {
    if (updates.amountIn === undefined && updates.amountOut === undefined) return;
    if (!ids.length) return;
    const idSet = new Set(ids);
    const links = await db.reimbursementLink.findMany({
      where: {
        userId,
        OR: [
          { reimbursementTransactionId: { in: ids } },
          { expenseTransactionId: { in: ids } },
        ],
      },
      select: { reimbursementTransactionId: true, expenseTransactionId: true },
    });
    const affected = [
      ...new Set(
        links
          .flatMap((link) => [link.reimbursementTransactionId, link.expenseTransactionId])
          .filter((value): value is string => !!value && idSet.has(value)),
      ),
    ];
    for (const id of affected) await assertSavedLinksFit(db, userId, id);
    await syncTransactionCaches(db, userId, affected);
    await TripRepository.syncBankTransactionAmountsTx(db, userId, ids);
  }

  static async bulkUpdateByIds(
    userId: string,
    ids: string[],
    updates: Partial<ImportTransactionInput>,
  ) {
    return runInTransaction(async (db) => {
      const result = await TransactionRepository.updateManyByIds(userId, ids, updates);
      await this.checkLinksAfterBulkUpdate(db, userId, ids, updates);
      return result;
    });
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
    return runInTransaction(async (db) => {
      const ids =
        updates.amountIn !== undefined || updates.amountOut !== undefined
          ? await TransactionRepository.findIdsByFilter(userId, filters, excludeIds)
          : [];
      const result = await TransactionRepository.updateManyByFilter(
        userId,
        filters,
        excludeIds,
        updates,
      );
      await this.checkLinksAfterBulkUpdate(db, userId, ids, updates);
      return result;
    });
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
    return runInTransaction(async (db) => {
      const ids = await TransactionRepository.findIdsByFilter(userId, filters, excludeIds);
      await TripRepository.detachBankTransactionsTx(db, userId, ids, "deleted");
      const counterparts = await counterpartsOf(db, userId, ids);
      const result = await TransactionRepository.deleteManyByFilter(
        userId,
        filters,
        excludeIds,
      );
      await refreshAfterDelete(db, userId, counterparts);
      return result;
    });
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
   * Mark a transaction as internal. Internal transfers hold no reimbursement links.
   */
  static async markAsInternal(
    id: string,
    userId: string,
    autoDetected: boolean = false,
    detectionReason?: string,
  ) {
    return runInTransaction(async (db) => {
      const { internal } = await this.ensureReservedCategories(userId);
      const ref = { transactionId: id };
      await deleteRoleLinks(db, userId, ref, "reimbursement");
      await deleteRoleLinks(db, userId, ref, "expense");
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
    });
  }

  /**
   * Mark a transaction as a reimbursement and set the expenses it pays back.
   */
  static async createReimbursementLink(
    reimbursementId: string,
    reimbursedAllocations: Array<{ transactionId: string; amount: number }>,
    userId: string,
    leftoverCategoryId?: string | null,
  ) {
    return runInTransaction(async (db) => {
      await lockEnds(db, userId, [transactionKey(reimbursementId)]);
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
      const current = stripLinkFields(reimbursingTransaction.linkage);
      if (current?.type === "internal") {
        throw new Error(
          "Internal transactions cannot be marked as reimbursements",
        );
      }
      const { reimbursement } = await this.ensureReservedCategories(userId);
      await TransactionRepository.updateLinkageAndCategory(
        reimbursementId,
        userId,
        {
          ...(current?.type === "reimbursement" ? current : {}),
          type: "reimbursement",
          leftoverCategoryId: leftoverCategoryId ?? null,
        } as TransactionLinkage,
        reimbursement.id,
      );
      if (current?.type !== "reimbursement")
        await deleteRoleLinks(db, userId, { transactionId: reimbursementId }, "expense");
      const { warnings } = await replaceLinks(db, userId, {
        subject: { transactionId: reimbursementId },
        role: "reimbursement",
        links: reimbursedAllocations.map((allocation) => ({
          other: { transactionId: allocation.transactionId },
          amount: allocation.amount,
        })),
      });
      await syncTransactionCaches(db, userId, [reimbursementId]);
      return { success: true, warnings };
    });
  }

  /**
   * Clear linkage from a transaction: unmark it and remove all its reimbursement links.
   */
  static async clearLinkage(id: string, userId: string) {
    return runInTransaction(async (db) => {
      const existing = await prisma.transaction.findFirst({
        where: { id, userId },
        include: { category: true },
      });
      if (!existing) throw new Error("Transaction not found");
      const ref = { transactionId: id };
      await deleteRoleLinks(db, userId, ref, "reimbursement");
      await deleteRoleLinks(db, userId, ref, "expense");
      const categoryName = existing.category?.name ?? "";
      const reservedCategory =
        categoryName === RESERVED_CATEGORIES.INTERNAL.name ||
        categoryName === RESERVED_CATEGORIES.REIMBURSEMENT.name;
      return prisma.transaction.update({
        where: { id, userId },
        data: {
          linkage: Prisma.DbNull,
          ...(reservedCategory ? { categoryId: null } : {}),
        },
        include: { category: true },
      });
    });
  }

  /**
   * Get linked transactions for display, plus claims from staged imports.
   */
  static async getLinkedTransactions(id: string, userId: string) {
    const transaction = await prisma.transaction.findFirst({
      where: { id, userId },
      select: { linkage: true, amountIn: true },
    });
    if (!transaction) return { reimburses: [], reimbursedBy: [], pending: [] };

    const links = await prisma.reimbursementLink.findMany({
      where: {
        userId,
        OR: [{ reimbursementTransactionId: id }, { expenseTransactionId: id }],
      },
      include: {
        reimbursementDraftRow: {
          select: { currentPayload: true, draft: { select: { sourceFilename: true, status: true } } },
        },
        expenseDraftRow: {
          select: { currentPayload: true, draft: { select: { sourceFilename: true, status: true } } },
        },
      },
    });
    const saved = links.filter(
      (link) => link.reimbursementTransactionId && link.expenseTransactionId,
    );
    const reimbursesAmounts = new Map(
      saved
        .filter((link) => link.reimbursementTransactionId === id)
        .map((link) => [link.expenseTransactionId as string, Number(link.amount)]),
    );
    const reimbursedByAmounts = new Map(
      saved
        .filter((link) => link.expenseTransactionId === id)
        .map((link) => [link.reimbursementTransactionId as string, Number(link.amount)]),
    );

    const [reimbursesRaw, reimbursedByRaw] = await Promise.all([
      reimbursesAmounts.size
        ? TransactionRepository.getLinkedTransactions(userId, [...reimbursesAmounts.keys()])
        : [],
      reimbursedByAmounts.size
        ? TransactionRepository.getLinkedTransactions(userId, [...reimbursedByAmounts.keys()])
        : [],
    ]);
    const reimburses = reimbursesRaw.map((row: any) => ({
      ...row,
      reimbursementAmount: reimbursesAmounts.get(row.id) ?? null,
    }));
    const reimbursedBy = reimbursedByRaw.map((row: any) => ({
      ...row,
      reimbursementAmount: reimbursedByAmounts.get(row.id) ?? null,
    }));

    const pending = links
      .filter((link) => !(link.reimbursementTransactionId && link.expenseTransactionId))
      .flatMap((link) => {
        const row =
          link.reimbursementTransactionId === id ? link.expenseDraftRow : link.reimbursementDraftRow;
        if (!row || ["committed", "discarded", "expired"].includes(row.draft.status)) return [];
        const payload = (row.currentPayload || {}) as Record<string, unknown>;
        return [
          {
            direction: link.reimbursementTransactionId === id ? "reimburses" : "reimbursedBy",
            amount: Number(link.amount),
            description: String(payload.label || payload.description || ""),
            date: payload.date ? String(payload.date) : null,
            filename: row.draft.sourceFilename,
          },
        ];
      });

    const linkage = stripLinkFields(transaction.linkage);
    const allocated = [...reimbursesAmounts.values()].reduce((sum, amount) => sum + amount, 0);
    return {
      reimburses,
      reimbursedBy,
      pending,
      leftoverAmount:
        linkage?.type === "reimbursement"
          ? Number(Math.max(Number(transaction.amountIn || 0) - allocated, 0).toFixed(2))
          : null,
      leftoverCategoryId: (linkage?.leftoverCategoryId as string | null | undefined) ?? null,
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

  /** Repair link drift for one user (invalid links, over-allocations, stale caches). */
  static async repairInvalidLinkages(userId: string) {
    const result = await auditLinks({ userId, fix: true });
    return {
      fixedCount: result.findings.filter((finding) => finding.fixed).length,
      counts: result.counts,
      findings: result.findings,
    };
  }
}
