import { HeuristicStrategy } from "./strategies/heuristics";
import { HistoricalMatcherStrategy } from "./strategies/historicalMatcher";
import { LearnedPatternStrategy } from "./strategies/learnedPatterns";
import { runAutoCategorization } from "./engine";
import { AutoCategorizationContext, AutoLabelSettings } from "./types";

export async function applyAutoCategorization(
  context: AutoCategorizationContext,
  settings: AutoLabelSettings,
) {
  const strategies = [
    new LearnedPatternStrategy(),
    new HistoricalMatcherStrategy(),
    new HeuristicStrategy(),
  ];
  return runAutoCategorization(context, strategies, settings);
}

export type { ParsedImportTransaction, AutoSuggestion } from "./types";
