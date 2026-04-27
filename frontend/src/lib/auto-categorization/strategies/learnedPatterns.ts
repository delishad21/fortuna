import {
  AutoCategorizationContext,
  AutoCategorizationStrategy,
  AutoSuggestion,
} from "../types";
import { directionOf, normalizeDescription, toMerchantStem } from "../normalization";

export interface LearnedClassificationPattern {
  id: string;
  patternType: "description_exact" | "merchant_stem" | "label_alias" | "unresolved";
  patternValue: string;
  parserId?: string | null;
  direction?: "in" | "out" | string | null;
  label?: string | null;
  categoryId?: string | null;
  markInternal?: boolean;
  confidence: number;
  supportCount: number;
  status: "auto_apply" | "suggest" | "disabled" | "unresolved" | string;
}

type PatternLoader = (
  context: AutoCategorizationContext,
) => Promise<LearnedClassificationPattern[]>;

function normalizedParserId(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function patternAppliesToScope(
  pattern: LearnedClassificationPattern,
  context: AutoCategorizationContext,
  direction: "in" | "out" | "none",
) {
  if (pattern.status === "disabled" || pattern.status === "unresolved") return false;
  const parserId = normalizedParserId(pattern.parserId);
  if (parserId && parserId !== normalizedParserId(context.parserId)) return false;
  if (pattern.direction && pattern.direction !== direction) return false;
  return direction !== "none";
}

function labelAliasMatches(patternValue: string, normalizedDescription: string) {
  const aliasTokens = normalizeDescription(patternValue).split(" ").filter(Boolean);
  const descriptionTokens = normalizedDescription.split(" ").filter(Boolean);
  if (aliasTokens.length === 0 || descriptionTokens.length === 0) return false;

  return aliasTokens.every((aliasToken) =>
    descriptionTokens.some(
      (descriptionToken) =>
        descriptionToken === aliasToken ||
        (aliasToken.length >= 4 && descriptionToken.includes(aliasToken)),
    ),
  );
}

function patternMatches(
  pattern: LearnedClassificationPattern,
  normalized: string,
  stem: string,
) {
  if (pattern.patternType === "description_exact") {
    return normalized === pattern.patternValue;
  }
  if (pattern.patternType === "merchant_stem") {
    return stem === pattern.patternValue;
  }
  if (pattern.patternType === "label_alias") {
    return labelAliasMatches(pattern.patternValue, normalized);
  }
  return false;
}

async function defaultPatternLoader(context: AutoCategorizationContext) {
  const { prisma } = await import("@/lib/db/client");
  const rows = await prisma.classificationPattern.findMany({
    where: {
      userId: context.userId,
      status: { in: ["auto_apply", "suggest"] },
    },
    select: {
      id: true,
      patternType: true,
      patternValue: true,
      parserId: true,
      direction: true,
      label: true,
      categoryId: true,
      markInternal: true,
      confidence: true,
      supportCount: true,
      status: true,
    },
  });

  return rows.map((row) => ({
    ...row,
    confidence: Number(row.confidence),
  })) as LearnedClassificationPattern[];
}

export class LearnedPatternStrategy implements AutoCategorizationStrategy {
  readonly id = "learned_pattern";

  constructor(private readonly loadPatterns: PatternLoader = defaultPatternLoader) {}

  async suggest(
    context: AutoCategorizationContext,
  ): Promise<Array<AutoSuggestion | null>> {
    const patterns = await this.loadPatterns(context);
    if (patterns.length === 0) return context.transactions.map(() => null);

    return context.transactions.map((transaction) => {
      const direction = directionOf(transaction);
      const normalized = normalizeDescription(transaction.description || "");
      const stem = toMerchantStem(transaction.description || "");

      const candidates = patterns
        .filter((pattern) => patternAppliesToScope(pattern, context, direction))
        .filter((pattern) => patternMatches(pattern, normalized, stem))
        .sort((a, b) => {
          if (b.confidence !== a.confidence) return b.confidence - a.confidence;
          return b.supportCount - a.supportCount;
        });

      const pattern = candidates[0];
      if (!pattern) return null;

      return {
        source: "learned_pattern",
        confidence: Number(pattern.confidence.toFixed(3)),
        reason: `Learned ${pattern.patternType.replace(/_/g, " ")} "${pattern.patternValue}" matched ${pattern.supportCount} prior transaction${pattern.supportCount === 1 ? "" : "s"}`,
        categoryId: pattern.categoryId || undefined,
        label: pattern.label || undefined,
        markInternal: pattern.markInternal || undefined,
        patternId: pattern.id,
        patternType: pattern.patternType,
        patternValue: pattern.patternValue,
        supportCount: pattern.supportCount,
        autoApply: pattern.status === "auto_apply",
      } satisfies AutoSuggestion;
    });
  }
}
