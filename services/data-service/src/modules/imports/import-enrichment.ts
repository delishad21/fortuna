import prisma from "../../lib/prisma";
import { TransactionService } from "../transactions/transactions.service";
import { applyAutoCategorization } from "./auto-categorization";
import type { ParsedImportTransaction } from "./auto-categorization";

/** Trip-only categories never apply to main-ledger imports. */
const TRIP_CATEGORY_NAMES = ["Flights", "Accommodation", "Attractions", "Fees"];

type Row = Record<string, any>;

function positiveAmount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Tag each row with its statement and account, as the review table and learned patterns expect. */
export function withSourceMetadata(
  rows: Row[],
  source: { filename: string; parserId?: string },
): Row[] {
  return rows.map((row) => {
    const accountIdentifier =
      row.accountIdentifier ||
      row.accountNumber ||
      row.metadata?.accountIdentifier ||
      row.metadata?.accountNumber ||
      "";
    return {
      ...row,
      accountIdentifier: accountIdentifier || undefined,
      metadata: {
        ...(row.metadata || {}),
        sourceFilename: source.filename,
        ...(source.parserId ? { parserId: source.parserId } : {}),
        ...(accountIdentifier ? { accountIdentifier } : {}),
      },
    };
  });
}

/** Keep reserved categories and linkage consistent, so review shows what commit will store. */
export function alignReservedLinkage(
  rows: Row[],
  reserved: { internalId?: string; reimbursementId?: string },
): Row[] {
  return rows.map((row) => {
    const amountIn = positiveAmount(row.amountIn);
    const linkage =
      row.linkage && typeof row.linkage.type === "string" ? row.linkage : null;
    if (!linkage && reserved.internalId && row.categoryId === reserved.internalId) {
      return {
        ...row,
        linkage: {
          type: "internal",
          autoDetected: true,
          detectionReason: "Reserved category mapped to internal linkage",
        },
      };
    }
    if (
      !linkage &&
      reserved.reimbursementId &&
      row.categoryId === reserved.reimbursementId &&
      amountIn > 0
    ) {
      return {
        ...row,
        linkage: {
          type: "reimbursement",
          reimbursesAllocations: [],
          leftoverAmount: amountIn,
          leftoverCategoryId: null,
          autoDetected: true,
          detectionReason: "Reserved category mapped to reimbursement linkage",
        },
      };
    }
    if (linkage?.type === "reimbursement") {
      return {
        ...row,
        linkage: {
          ...linkage,
          reimbursesAllocations: Array.isArray(linkage.reimbursesAllocations)
            ? linkage.reimbursesAllocations
            : [],
          leftoverAmount:
            linkage.leftoverAmount !== undefined
              ? Number(linkage.leftoverAmount)
              : amountIn,
          leftoverCategoryId:
            linkage.leftoverCategoryId !== undefined
              ? linkage.leftoverCategoryId
              : null,
        },
      };
    }
    return row;
  });
}

/**
 * Prepare parsed main-ledger rows for review: import rules, then auto-categorization
 * (learned patterns, history, heuristics), then reserved-category linkage.
 */
export async function enrichImportRows(
  userId: string,
  source: { filename: string; parserId?: string },
  rows: Row[],
): Promise<Row[]> {
  if (rows.length === 0) return rows;
  await TransactionService.bootstrapDefaultImportRules(userId);
  const ruled = (await TransactionService.applyImportRules(
    userId,
    source.parserId,
    withSourceMetadata(rows, source) as never[],
  )) as unknown as Row[];

  const [categories, settings] = await Promise.all([
    prisma.category.findMany({
      where: {
        userId,
        NOT: TRIP_CATEGORY_NAMES.map((name) => ({
          name: { equals: name, mode: "insensitive" as const },
        })),
      },
      select: { id: true, name: true },
    }),
    prisma.userSettings.findUnique({
      where: { userId },
      select: { autoLabelEnabled: true, autoLabelThreshold: true },
    }),
  ]);
  const categoryByName = new Map(
    categories.map((category) => [category.name.toLowerCase(), category.id]),
  );

  let categorized = ruled;
  try {
    categorized = (await applyAutoCategorization(
      {
        userId,
        parserId: source.parserId || "",
        transactions: ruled as ParsedImportTransaction[],
        categoryByName,
      },
      {
        enabled: settings?.autoLabelEnabled ?? false,
        threshold: Number(settings?.autoLabelThreshold ?? 0.5),
      },
    )) as Row[];
  } catch (error) {
    console.error("Auto-categorization failed; staging rows without it:", error);
  }

  return alignReservedLinkage(categorized, {
    internalId: categoryByName.get("internal"),
    reimbursementId: categoryByName.get("reimbursement"),
  });
}
