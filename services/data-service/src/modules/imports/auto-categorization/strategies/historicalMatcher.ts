import prisma from "../../../../lib/prisma";
import {
  amountBucket,
  directionOf,
  normalizeDescription,
  toMerchantStem,
} from "../normalization";
import {
  AutoCategorizationContext,
  AutoCategorizationStrategy,
  AutoSuggestion,
} from "../types";

type Outcome = {
  categoryId?: string;
  label?: string;
  markInternal?: boolean;
};

type OutcomeCounter = Map<string, number>;

type EvidenceMaps = {
  exact: Map<string, OutcomeCounter>;
  stem: Map<string, OutcomeCounter>;
  amount: Map<string, OutcomeCounter>;
};

function outcomeKey(outcome: Outcome): string {
  return JSON.stringify({
    categoryId: outcome.categoryId || null,
    label: outcome.label || null,
    markInternal: !!outcome.markInternal,
  });
}

function parseOutcome(key: string): Outcome {
  const parsed = JSON.parse(key) as {
    categoryId: string | null;
    label: string | null;
    markInternal: boolean;
  };
  return {
    categoryId: parsed.categoryId || undefined,
    label: parsed.label || undefined,
    markInternal: parsed.markInternal || undefined,
  };
}

function txParserScope(metadata: Record<string, any> | null | undefined): string {
  const parserId = String(metadata?.parserId || "").trim().toLowerCase();
  return parserId || "__unknown__";
}

function mapKey(parserScope: string, direction: "in" | "out", key: string): string {
  return `${parserScope}::${direction}::${key}`;
}

function incrementCounter(store: Map<string, OutcomeCounter>, key: string, outcome: Outcome) {
  if (!key) return;
  const counter = store.get(key) || new Map<string, number>();
  const oKey = outcomeKey(outcome);
  counter.set(oKey, (counter.get(oKey) || 0) + 1);
  store.set(key, counter);
}

function addEvidence(
  aggregate: Map<string, { score: number; support: number; reasons: Set<string> }>,
  counters: OutcomeCounter | undefined,
  weight: number,
  reason: string,
) {
  if (!counters) return;
  for (const [oKey, count] of counters.entries()) {
    const current = aggregate.get(oKey) || {
      score: 0,
      support: 0,
      reasons: new Set<string>(),
    };
    current.score += weight * Math.log1p(count);
    current.support += count;
    current.reasons.add(reason);
    aggregate.set(oKey, current);
  }
}

export class HistoricalMatcherStrategy implements AutoCategorizationStrategy {
  readonly id = "history";

  private async loadEvidenceMaps(userId: string): Promise<EvidenceMaps> {
    const history = await prisma.transaction.findMany({
      where: {
        userId,
        OR: [{ amountIn: { gt: 0 } }, { amountOut: { gt: 0 } }],
      },
      select: {
        description: true,
        label: true,
        categoryId: true,
        amountIn: true,
        amountOut: true,
        metadata: true,
        linkage: true,
      },
      orderBy: { date: "desc" },
      take: 6000,
    });

    const maps: EvidenceMaps = {
      exact: new Map(),
      stem: new Map(),
      amount: new Map(),
    };

    for (const row of history) {
      const direction = directionOf({
        amountIn: Number(row.amountIn || 0),
        amountOut: Number(row.amountOut || 0),
      });
      if (direction === "none") continue;

      const linkage = row.linkage as { type?: string } | null;
      const markInternal = linkage?.type === "internal";
      const label = String(row.label || "").trim() || undefined;
      const categoryId = row.categoryId || undefined;
      if (!markInternal && !label && !categoryId) continue;

      const parserScope = txParserScope((row.metadata as Record<string, any>) || {});
      const normalized = normalizeDescription(row.description || "");
      const stem = toMerchantStem(row.description || "");
      const bucket = amountBucket({
        amountIn: Number(row.amountIn || 0),
        amountOut: Number(row.amountOut || 0),
      });

      const outcome: Outcome = {
        categoryId,
        label,
        markInternal: markInternal || undefined,
      };

      incrementCounter(maps.exact, mapKey(parserScope, direction, normalized), outcome);
      incrementCounter(maps.stem, mapKey(parserScope, direction, stem), outcome);
      incrementCounter(maps.amount, mapKey(parserScope, direction, String(bucket)), outcome);

      incrementCounter(maps.exact, mapKey("__any__", direction, normalized), outcome);
      incrementCounter(maps.stem, mapKey("__any__", direction, stem), outcome);
      incrementCounter(maps.amount, mapKey("__any__", direction, String(bucket)), outcome);
    }

    return maps;
  }

  async suggest(
    context: AutoCategorizationContext,
  ): Promise<Array<AutoSuggestion | null>> {
    const maps = await this.loadEvidenceMaps(context.userId);
    const parserScope = String(context.parserId || "").trim().toLowerCase() || "__unknown__";

    return context.transactions.map((transaction) => {
      const direction = directionOf(transaction);
      if (direction === "none") return null;

      const normalized = normalizeDescription(transaction.description || "");
      const stem = toMerchantStem(transaction.description || "");
      const bucket = amountBucket(transaction);

      const aggregate = new Map<
        string,
        { score: number; support: number; reasons: Set<string> }
      >();

      addEvidence(
        aggregate,
        maps.exact.get(mapKey(parserScope, direction, normalized)),
        1.0,
        "exact description + parser",
      );
      addEvidence(
        aggregate,
        maps.exact.get(mapKey("__any__", direction, normalized)),
        0.92,
        "exact description",
      );
      addEvidence(
        aggregate,
        maps.stem.get(mapKey(parserScope, direction, stem)),
        0.72,
        "merchant stem + parser",
      );
      addEvidence(
        aggregate,
        maps.stem.get(mapKey("__any__", direction, stem)),
        0.64,
        "merchant stem",
      );
      addEvidence(
        aggregate,
        maps.amount.get(mapKey(parserScope, direction, String(bucket))),
        0.15,
        "amount bucket + parser",
      );
      addEvidence(
        aggregate,
        maps.amount.get(mapKey("__any__", direction, String(bucket))),
        0.1,
        "amount bucket",
      );

      if (aggregate.size === 0) return null;

      const ranked = Array.from(aggregate.entries())
        .map(([key, value]) => ({ key, ...value }))
        .sort((a, b) => b.score - a.score);

      const top = ranked[0];
      const second = ranked[1];
      const confidence = Math.min(
        0.99,
        top.score / (top.score + (second?.score || 0) + 0.5),
      );

      const outcome = parseOutcome(top.key);
      return {
        source: "history",
        confidence: Number(confidence.toFixed(3)),
        reason: Array.from(top.reasons).join("; "),
        categoryId: outcome.categoryId,
        label: outcome.label,
        markInternal: outcome.markInternal,
      } as AutoSuggestion;
    });
  }
}
