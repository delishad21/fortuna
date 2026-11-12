import prisma from "../../lib/prisma";
import { DATE_THRESHOLD_DAYS, scoreDuplicatePair } from "./duplicate-scoring";

export interface DuplicateMatch {
  transaction: any; // Prisma Transaction type
  matchScore: number;
  matchReasons: string[];
}

export interface TransactionLinkage {
  type: "internal" | "reimbursement" | "reimbursed";
  reimbursesAllocations?: Array<{
    transactionId?: string;
    pendingBatchIndex?: number;
    stagedDraftId?: string;
    stagedRowId?: string;
    targetDescription?: string;
    targetDate?: string;
    amount: number;
  }>;
  reimbursedByAllocations?: Array<{
    transactionId: string;
    amount: number;
  }>;
  leftoverAmount?: number;
  leftoverCategoryId?: string | null;
  autoDetected?: boolean; // True if parser detected
  detectionReason?: string; // Why it was detected
}

export interface ImportTransactionInput {
  date: Date;
  description: string;
  label?: string;
  categoryId?: string | null;
  amountIn?: number | null;
  amountOut?: number | null;
  balance?: number | null;
  currency?: string | null;
  accountIdentifier?: string | null;
  source?: string | null;
  metadata?: any;
  linkage?: TransactionLinkage | null;
}

/**
 * Detects potential duplicate transactions among the user's saved ones.
 * Candidates share the amount and fall within a few days; the scoring in
 * duplicate-scoring.ts decides which of them are the same transaction.
 */
export class DuplicateDetector {
  /**
   * Find potential duplicates for a single transaction
   */
  static async findDuplicates(
    userId: string,
    transaction: ImportTransactionInput,
  ): Promise<DuplicateMatch[]> {
    const { date, amountIn, amountOut } = transaction;

    // Calculate date range for search
    const dateFrom = new Date(date);
    dateFrom.setDate(dateFrom.getDate() - DATE_THRESHOLD_DAYS);

    const dateTo = new Date(date);
    dateTo.setDate(dateTo.getDate() + DATE_THRESHOLD_DAYS);

    // Find transactions in date range with similar amounts
    const candidates = await prisma.transaction.findMany({
      where: {
        userId,
        date: {
          gte: dateFrom,
          lte: dateTo,
        },
        OR: [
          amountIn ? { amountIn: { equals: amountIn } } : {},
          amountOut ? { amountOut: { equals: amountOut } } : {},
        ],
      },
      include: {
        category: true,
      },
    });

    const incoming = {
      date,
      description: transaction.description,
      amountIn: amountIn == null ? null : Number(amountIn),
      amountOut: amountOut == null ? null : Number(amountOut),
      accountIdentifier: transaction.accountIdentifier,
      source: transaction.source,
      metadata: transaction.metadata,
    };
    const matches: DuplicateMatch[] = [];
    for (const candidate of candidates) {
      const result = scoreDuplicatePair(incoming, {
        date: candidate.date,
        description: candidate.description,
        amountIn: candidate.amountIn == null ? null : Number(candidate.amountIn),
        amountOut: candidate.amountOut == null ? null : Number(candidate.amountOut),
        accountIdentifier: candidate.accountIdentifier,
        source: candidate.source,
        metadata: candidate.metadata,
      });
      if (result) {
        matches.push({
          transaction: candidate,
          matchScore: result.score,
          matchReasons: result.reasons,
        });
      }
    }

    // Sort by match score descending
    return matches.sort((a, b) => b.matchScore - a.matchScore);
  }

  /**
   * Check multiple transactions for duplicates
   */
  static async checkBulkDuplicates(
    userId: string,
    transactions: ImportTransactionInput[],
  ): Promise<Map<number, DuplicateMatch[]>> {
    const results = new Map<number, DuplicateMatch[]>();

    for (let i = 0; i < transactions.length; i++) {
      const duplicates = await this.findDuplicates(userId, transactions[i]);
      if (duplicates.length > 0) {
        results.set(i, duplicates);
      }
    }

    return results;
  }
}
