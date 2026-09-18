"use server";

import { auth } from "@/lib/actionAuth";
import { getCategories } from "@/app/actions/categories";
import { getImportRules, bootstrapDefaultImportRules } from "@/app/actions/importRules";
import { prisma } from "@/lib/db/client";
import { applyAutoCategorization } from "@/lib/auto-categorization";

const PARSER_SERVICE_URL =
  process.env.PARSER_SERVICE_URL || "http://file-parser:4000";

const TRIP_PARSER_IDS = new Set(["revolut_statement", "youtrip_statement"]);

interface TransactionLinkage {
  type: "internal" | "reimbursement" | "reimbursed";
  reimbursesAllocations?: Array<{
    transactionId?: string;
    pendingBatchIndex?: number;
    amount: number;
  }>;
  reimbursedByAllocations?: Array<{
    transactionId: string;
    amount: number;
  }>;
  leftoverAmount?: number;
  leftoverCategoryId?: string | null;
  autoDetected?: boolean;
  detectionReason?: string;
}

const toPositiveNumber = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

interface ParseResult {
  success: boolean;
  filename: string;
  parserId: string;
  transactions: Array<{
    date: string;
    description: string;
    label?: string;
    categoryId?: string;
    amountIn?: number;
    amountOut?: number;
    balance?: number;
    accountIdentifier?: string;
    accountNumber?: string;
    metadata: Record<string, any>;
    linkage?: TransactionLinkage | null;
    suggestedCategoryId?: string;
    suggestedLabel?: string;
    suggestedInternal?: boolean;
    suggestionSource?: "rule" | "history" | "heuristic";
    suggestionConfidence?: number;
    suggestionApplied?: boolean;
  }>;
  count: number;
}

function ruleMatches(
  rule: {
    matchType: "always" | "description_contains";
    matchValue?: string | null;
    caseSensitive?: boolean;
  },
  description: string,
) {
  if (rule.matchType === "always") return true;
  if (rule.matchType === "description_contains") {
    const needle = (rule.matchValue || "").trim();
    if (!needle) return false;
    if (rule.caseSensitive) return description.includes(needle);
    return description.toLowerCase().includes(needle.toLowerCase());
  }
  return false;
}

export async function parseFile(formData: FormData): Promise<ParseResult> {
  try {
    const session = await auth();
    const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
    const response = await fetch(`${PARSER_SERVICE_URL}/parse`, {
      method: "POST",
      body: formData,
      headers:
        session?.user?.id && internalToken
          ? {
              "X-Internal-Service-Token": internalToken,
              "X-Authenticated-User-Id": session.user.id,
            }
          : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = "Failed to parse file";
      try {
        const error = JSON.parse(errorText);
        errorMessage = error.error || error.message || errorMessage;
      } catch {
        errorMessage = errorText || errorMessage;
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();

    if (!result.transactions) {
      throw new Error("Invalid response from parser service");
    }

    const normalizedParserId = String(result.parserId || "")
      .trim()
      .toLowerCase();
    const shouldApplyImportRules = !TRIP_PARSER_IDS.has(normalizedParserId);

    if (session?.user?.id && shouldApplyImportRules) {
      try {
        await bootstrapDefaultImportRules();
        const rules = await getImportRules();
        const categories = await getCategories({ scope: "main" });
        const categoryMap = new Map<string, string>(
          categories.map((category) => [category.name.toLowerCase(), category.id]),
        );

        result.transactions = result.transactions.map((tx: any) => {
          const next = { ...tx };
          for (const rule of rules) {
            if (!rule.enabled) continue;
            const ruleParserId = rule.parserId?.trim();
            if (ruleParserId && ruleParserId !== result.parserId) continue;
            if (!ruleMatches(rule, next.description || "")) continue;
            let applied = false;

            if (rule.markInternal && !next.linkage) {
              next.linkage = {
                type: "internal",
                autoDetected: true,
                detectionReason: `Matched import rule: ${rule.name}`,
              };
              applied = true;
            }

            if (rule.setLabel && (!next.label || !next.label.trim())) {
              next.label = rule.setLabel;
              applied = true;
            }

            if (
              rule.setCategoryName &&
              !next.categoryId &&
              (!next.linkage || next.linkage.type === "reimbursed")
            ) {
              const categoryId = categoryMap.get(
                rule.setCategoryName.toLowerCase(),
              );
              if (categoryId) {
                next.categoryId = categoryId;
                applied = true;
              }
            }

            if (applied) {
              next.metadata = {
                ...(next.metadata || {}),
                fixedRuleId: rule.id,
                fixedRuleName: rule.name,
                classificationAppliedAt: new Date().toISOString(),
              };
            }
          }
          return next;
        });

        const userSettings = await prisma.userSettings.findUnique({
          where: { userId: session.user.id },
          select: { autoLabelEnabled: true, autoLabelThreshold: true },
        });

        result.transactions = await applyAutoCategorization(
          {
            userId: session.user.id,
            parserId: String(result.parserId || ""),
            transactions: result.transactions,
            categoryByName: new Map(
              categories.map((category) => [category.name.toLowerCase(), category.id]),
            ),
          },
          {
            enabled: userSettings?.autoLabelEnabled ?? false,
            threshold: Number(userSettings?.autoLabelThreshold ?? 0.5),
          },
        );

        const internalCategoryId = categoryMap.get("internal");
        const reimbursementCategoryId = categoryMap.get("reimbursement");

        // Keep category/linkage consistent so reimbursement/internal rows behave
        // exactly like explicit linkage selections in review/commit flows.
        result.transactions = result.transactions.map((transaction: any) => {
          const next = { ...transaction };
          const amountIn = toPositiveNumber(next.amountIn);
          const currentLinkage =
            next.linkage &&
            typeof next.linkage === "object" &&
            typeof (next.linkage as Record<string, unknown>).type === "string"
              ? ({ ...(next.linkage as TransactionLinkage) } as TransactionLinkage)
              : null;

          if (!currentLinkage && internalCategoryId && next.categoryId === internalCategoryId) {
            next.linkage = {
              type: "internal",
              autoDetected: true,
              detectionReason: "Reserved category mapped to internal linkage",
            } satisfies TransactionLinkage;
            return next;
          }

          if (
            !currentLinkage &&
            reimbursementCategoryId &&
            next.categoryId === reimbursementCategoryId &&
            amountIn > 0
          ) {
            next.linkage = {
              type: "reimbursement",
              reimbursesAllocations: [],
              leftoverAmount: amountIn,
              leftoverCategoryId: null,
              autoDetected: true,
              detectionReason: "Reserved category mapped to reimbursement linkage",
            } satisfies TransactionLinkage;
            return next;
          }

          if (currentLinkage?.type === "reimbursement") {
            const allocations = Array.isArray(currentLinkage.reimbursesAllocations)
              ? currentLinkage.reimbursesAllocations
              : [];
            next.linkage = {
              ...currentLinkage,
              reimbursesAllocations: allocations,
              leftoverAmount:
                currentLinkage.leftoverAmount !== undefined
                  ? Number(currentLinkage.leftoverAmount)
                  : amountIn,
              leftoverCategoryId:
                currentLinkage.leftoverCategoryId !== undefined
                  ? currentLinkage.leftoverCategoryId
                  : null,
            } satisfies TransactionLinkage;
          }

          return next;
        });
      } catch (rulesError) {
        console.error("Failed to apply import rules in parse stage:", rulesError);
      }
    }

    return result;
  } catch (error) {
    console.error("Parse file error:", error);
    throw error;
  }
}

export async function getAvailableParsers(mode?: "bank" | "trip") {
  try {
    const session = await auth();
    const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
    const query = mode ? `?mode=${mode}` : "";
    const response = await fetch(`${PARSER_SERVICE_URL}/parsers${query}`, {
      headers:
        session?.user?.id && internalToken
          ? {
              "X-Internal-Service-Token": internalToken,
              "X-Authenticated-User-Id": session.user.id,
            }
          : undefined,
    });

    if (!response.ok) {
      throw new Error("Failed to fetch parsers");
    }

    const result = await response.json();
    return result.parsers;
  } catch (error) {
    console.error("Get parsers error:", error);
    throw error;
  }
}

export async function checkParserServiceHealth() {
  try {
    const response = await fetch(`${PARSER_SERVICE_URL}/health`);
    const result = await response.json();
    return result.status === "ok";
  } catch (error) {
    return false;
  }
}

export interface MultiFileParseResult {
  filename: string;
  success: boolean;
  parserId: string;
  transactions: ParseResult["transactions"];
  count: number;
  error?: string;
  accountIdentifier?: string;
}

export async function parseMultipleFiles(
  files: File[],
  parserId: string,
): Promise<MultiFileParseResult[]> {
  return parseFilesWithParsers(files.map((file) => ({ file, parserId })));
}

export async function parseFilesWithParsers(
  items: Array<{ file: File; parserId: string }>,
): Promise<MultiFileParseResult[]> {
  const results: MultiFileParseResult[] = [];

  for (const { file, parserId } of items) {
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("parserId", parserId);

      const parseResult = await parseFile(formData);

      const detectedAccount =
        (parseResult as any)?.accountIdentifier ||
        parseResult.transactions[0]?.accountIdentifier ||
        parseResult.transactions[0]?.accountNumber ||
        parseResult.transactions[0]?.metadata?.accountIdentifier ||
        parseResult.transactions[0]?.metadata?.accountNumber;

      results.push({
        filename: file.name,
        success: true,
        parserId: parseResult.parserId,
        transactions: parseResult.transactions,
        count: parseResult.count,
        accountIdentifier: detectedAccount,
      });
    } catch (error) {
      results.push({
        filename: file.name,
        success: false,
        parserId,
        transactions: [],
        count: 0,
        error: error instanceof Error ? error.message : "Failed to parse file",
      });
    }
  }

  return results;
}
