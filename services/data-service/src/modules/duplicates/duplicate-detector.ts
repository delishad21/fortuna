import prisma from "../../lib/prisma";

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
 * Detects potential duplicate transactions
 * Matching criteria:
 * - Same date (or within 2 days)
 * - Similar description (fuzzy match)
 * - Same amount
 * - Same user
 */
export class DuplicateDetector {
  private static SIMILARITY_THRESHOLD = 0.8;
  private static DATE_THRESHOLD_DAYS = 2;

  /**
   * Find potential duplicates for a single transaction
   */
  static async findDuplicates(
    userId: string,
    transaction: ImportTransactionInput,
  ): Promise<DuplicateMatch[]> {
    const { date, description, amountIn, amountOut } = transaction;

    // Calculate date range for search
    const dateFrom = new Date(date);
    dateFrom.setDate(dateFrom.getDate() - this.DATE_THRESHOLD_DAYS);

    const dateTo = new Date(date);
    dateTo.setDate(dateTo.getDate() + this.DATE_THRESHOLD_DAYS);

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

    const matches: DuplicateMatch[] = [];

    for (const candidate of candidates) {
      const matchReasons: string[] = [];
      let score = 0;

      // Check date match
      const daysDiff = Math.abs(
        (candidate.date.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysDiff === 0) {
        score += 0.3;
        matchReasons.push("Same date");
      } else if (daysDiff <= this.DATE_THRESHOLD_DAYS) {
        score += 0.15;
        matchReasons.push(`Date within ${Math.ceil(daysDiff)} days`);
      }

      // Check amount match
      const amountMatch =
        (amountIn && candidate.amountIn?.equals(amountIn)) ||
        (amountOut && candidate.amountOut?.equals(amountOut));

      if (amountMatch) {
        score += 0.3;
        matchReasons.push("Exact amount match");
      }

      // Check description similarity
      const similarity = this.calculateStringSimilarity(
        description.toLowerCase(),
        candidate.description.toLowerCase(),
      );

      if (similarity === 1.0) {
        score += 0.4;
        matchReasons.push("Exact description match");
      } else if (similarity >= 0.9) {
        score += 0.3;
        matchReasons.push("Very similar description");
      } else if (similarity >= 0.7) {
        score += 0.2;
        matchReasons.push("Similar description");
      } else if (similarity >= 0.5) {
        score += 0.1;
        matchReasons.push("Somewhat similar description");
      }

      // If score is above threshold, add to matches
      if (score >= this.SIMILARITY_THRESHOLD) {
        matches.push({
          transaction: candidate,
          matchScore: score, // Don't cap - let it be what it is
          matchReasons,
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

  /**
   * Simple string similarity calculation (Dice's coefficient)
   */
  private static calculateStringSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (str1.length < 2 || str2.length < 2) return 0.0;

    const bigrams1 = this.getBigrams(str1);
    const bigrams2 = this.getBigrams(str2);

    const intersection = bigrams1.filter((bigram) => bigrams2.includes(bigram));

    return (2.0 * intersection.length) / (bigrams1.length + bigrams2.length);
  }

  /**
   * Get bigrams from a string
   */
  private static getBigrams(str: string): string[] {
    const bigrams: string[] = [];
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.push(str.substring(i, i + 2));
    }
    return bigrams;
  }
}
