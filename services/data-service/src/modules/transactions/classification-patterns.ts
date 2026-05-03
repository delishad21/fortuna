export type ClassificationPatternType =
  | "description_exact"
  | "merchant_stem"
  | "label_alias"
  | "unresolved";

export type ClassificationPatternStatus =
  | "auto_apply"
  | "disabled"
  | "unresolved";

export interface ClassificationPatternTransaction {
  description?: string | null;
  label?: string | null;
  categoryId?: string | null;
  amountIn?: number | null;
  amountOut?: number | null;
  metadata?: Record<string, any> | null;
  linkage?: { type?: string } | null;
  date?: Date | string | null;
}

export interface BuiltClassificationPattern {
  patternType: ClassificationPatternType;
  patternValue: string;
  parserId: string | null;
  direction: "in" | "out" | null;
  label: string | null;
  categoryId: string | null;
  markInternal: boolean;
  confidence: number;
  supportCount: number;
  matchCount: number;
  conflictCount: number;
  status: ClassificationPatternStatus;
  lastSeenAt: Date | null;
  metadata: Record<string, any>;
}

export interface BuildClassificationPatternsInput {
  transactions: ClassificationPatternTransaction[];
  ignoredCategoryIds?: Set<string>;
}

type Outcome = {
  label: string | null;
  categoryId: string | null;
  markInternal: boolean;
};

type Evidence = {
  patternType: ClassificationPatternType;
  patternValue: string;
  parserId: string | null;
  direction: "in" | "out" | null;
  outcome: Outcome | null;
  lastSeenAt: Date | null;
};

const NOISE_PATTERNS = [
  /\b\d{6,}\b/g,
  /\b\d{4}-\d{4}-\d{4}-\d{4}\b/g,
  /\*{2,}\d{2,}/g,
  /\b\d{1,2}(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/gi,
  /\bsi\s+ng\b/gi,
  /\b(?:visa|mastercard|debit card transaction|card transaction)\b/gi,
  /\b(?:sgp|singapore|sg)\b/gi,
];

const GENERIC_ALIAS_TOKENS = new Set([
  "atm",
  "bank",
  "card",
  "cash",
  "food",
  "fund",
  "giro",
  "pay",
  "payment",
  "shopping",
  "transfer",
  "visa",
]);

export function normalizeClassificationText(input: string): string {
  let normalized = (input || "").toLowerCase();
  for (const pattern of NOISE_PATTERNS) {
    normalized = normalized.replace(pattern, " ");
  }
  return normalized
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function toClassificationMerchantStem(input: string): string {
  return normalizeClassificationText(input)
    .split(" ")
    .filter((token) => token.length >= 3)
    .slice(0, 5)
    .join(" ");
}

function directionOf(transaction: ClassificationPatternTransaction) {
  const amountIn = Number(transaction.amountIn || 0);
  const amountOut = Number(transaction.amountOut || 0);
  if (amountIn > 0) return "in" as const;
  if (amountOut > 0) return "out" as const;
  return null;
}

function parserIdOf(transaction: ClassificationPatternTransaction) {
  const parserId = String(transaction.metadata?.parserId || "").trim().toLowerCase();
  return parserId || null;
}

function dateOf(transaction: ClassificationPatternTransaction) {
  if (!transaction.date) return null;
  const date = transaction.date instanceof Date ? transaction.date : new Date(transaction.date);
  return Number.isNaN(date.getTime()) ? null : date;
}

function outcomeKey(outcome: Outcome) {
  return JSON.stringify(outcome);
}

function parseOutcome(key: string): Outcome {
  return JSON.parse(key) as Outcome;
}

function hasUsableOutcome(outcome: Outcome) {
  return !!outcome.label || !!outcome.categoryId || outcome.markInternal;
}

function outcomeOf(
  transaction: ClassificationPatternTransaction,
  ignoredCategoryIds: Set<string>,
): Outcome | null {
  const label = String(transaction.label || "").trim() || null;
  const rawCategoryId = String(transaction.categoryId || "").trim() || null;
  const categoryId = rawCategoryId && !ignoredCategoryIds.has(rawCategoryId)
    ? rawCategoryId
    : null;
  const markInternal = transaction.linkage?.type === "internal";
  const outcome = { label, categoryId, markInternal };
  return hasUsableOutcome(outcome) ? outcome : null;
}

function labelAliasFor(label: string | null, normalizedDescription: string) {
  if (!label) return null;
  const alias = normalizeClassificationText(label);
  if (alias.length < 3 || GENERIC_ALIAS_TOKENS.has(alias)) return null;
  const descriptionTokens = normalizedDescription.split(" ").filter(Boolean);
  const aliasTokens = alias.split(" ").filter(Boolean);
  const matches = aliasTokens.every((aliasToken) =>
    descriptionTokens.some(
      (descriptionToken) =>
        descriptionToken === aliasToken ||
        (aliasToken.length >= 4 && descriptionToken.includes(aliasToken)),
    ),
  );
  return matches ? alias : null;
}

function addEvidence(
  evidence: Evidence[],
  patternType: ClassificationPatternType,
  patternValue: string,
  transaction: ClassificationPatternTransaction,
  outcome: Outcome | null,
) {
  if (!patternValue) return;
  evidence.push({
    patternType,
    patternValue,
    parserId: parserIdOf(transaction),
    direction: directionOf(transaction),
    outcome,
    lastSeenAt: dateOf(transaction),
  });
}

function evidenceKey(evidence: Evidence) {
  return [
    evidence.patternType,
    evidence.patternValue,
    evidence.parserId || "__all__",
    evidence.direction || "none",
  ].join("::");
}

function confidenceFor(matchCount: number, supportCount: number) {
  const consistency = supportCount > 0 ? matchCount / supportCount : 0;
  const supportWeight = Math.min(
    1,
    0.55 + (Math.log1p(supportCount) / Math.log1p(10)) * 0.45,
  );
  return Number((consistency * supportWeight).toFixed(3));
}

function maxDate(a: Date | null, b: Date | null) {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

export function buildClassificationPatternsFromTransactions({
  transactions,
  ignoredCategoryIds = new Set(),
}: BuildClassificationPatternsInput): BuiltClassificationPattern[] {
  const evidence: Evidence[] = [];

  for (const transaction of transactions) {
    const normalized = normalizeClassificationText(transaction.description || "");
    const stem = toClassificationMerchantStem(transaction.description || "");
    if (!normalized || !stem) continue;

    const outcome = outcomeOf(transaction, ignoredCategoryIds);
    if (outcome) {
      addEvidence(evidence, "description_exact", normalized, transaction, outcome);
      addEvidence(evidence, "merchant_stem", stem, transaction, outcome);
    } else {
      addEvidence(evidence, "unresolved", stem, transaction, outcome);
    }

    const alias = labelAliasFor(outcome?.label || null, normalized);
    if (alias && outcome) {
      addEvidence(evidence, "label_alias", alias, transaction, outcome);
    }
  }

  const groups = new Map<string, Evidence[]>();
  for (const item of evidence) {
    const key = evidenceKey(item);
    groups.set(key, [...(groups.get(key) || []), item]);
  }

  return Array.from(groups.values())
    .map((items) => {
      const first = items[0];
      const outcomeCounts = new Map<string, number>();
      let unresolvedCount = 0;
      let lastSeenAt: Date | null = null;

      for (const item of items) {
        lastSeenAt = maxDate(lastSeenAt, item.lastSeenAt);
        if (!item.outcome) {
          unresolvedCount += 1;
          continue;
        }
        const key = outcomeKey(item.outcome);
        outcomeCounts.set(key, (outcomeCounts.get(key) || 0) + 1);
      }

      const rankedOutcomes = Array.from(outcomeCounts.entries()).sort(
        (a, b) => b[1] - a[1],
      );
      const supportCount = items.length;

      if (rankedOutcomes.length === 0) {
        return {
          patternType: "unresolved" as const,
          patternValue: first.patternValue,
          parserId: first.parserId,
          direction: first.direction,
          label: null,
          categoryId: null,
          markInternal: false,
          confidence: 0,
          supportCount,
          matchCount: 0,
          conflictCount: 0,
          status: "unresolved" as const,
          lastSeenAt,
          metadata: { unresolvedCount },
        };
      }

      const [topKey, matchCount] = rankedOutcomes[0];
      const outcome = parseOutcome(topKey);
      const conflictCount = Math.max(0, rankedOutcomes.length - 1);
      const confidence = confidenceFor(matchCount, supportCount);
      const status: ClassificationPatternStatus =
        conflictCount === 0 && confidence >= 0.5 ? "auto_apply" : "disabled";

      return {
        patternType: first.patternType,
        patternValue: first.patternValue,
        parserId: first.parserId,
        direction: first.direction,
        label: outcome.label,
        categoryId: outcome.categoryId,
        markInternal: outcome.markInternal,
        confidence,
        supportCount,
        matchCount,
        conflictCount,
        status,
        lastSeenAt,
        metadata: {
          outcomes: rankedOutcomes.map(([key, count]) => ({
            ...parseOutcome(key),
            count,
          })),
        },
      };
    })
    .sort((a, b) => {
      if (a.status !== b.status) return a.status.localeCompare(b.status);
      if (a.patternType !== b.patternType) return a.patternType.localeCompare(b.patternType);
      return a.patternValue.localeCompare(b.patternValue);
    });
}
