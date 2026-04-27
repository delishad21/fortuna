import {
  AutoCategorizationContext,
  AutoCategorizationStrategy,
  AutoSuggestion,
  AutoLabelSettings,
  ParsedImportTransaction,
} from "./types";

function bestSuggestion(candidates: Array<AutoSuggestion | null>) {
  const usable = candidates.filter(Boolean) as AutoSuggestion[];
  if (usable.length === 0) return null;
  usable.sort((a, b) => b.confidence - a.confidence);
  return usable[0];
}

function canApplyInternal(transaction: ParsedImportTransaction) {
  return !transaction.linkage;
}

function canApplyLabel(transaction: ParsedImportTransaction) {
  return (
    (!transaction.label || transaction.label.trim().length === 0) &&
    transaction.linkage?.type !== "internal"
  );
}

function canApplyCategory(transaction: ParsedImportTransaction) {
  return (
    !transaction.categoryId &&
    (!transaction.linkage || transaction.linkage.type === "reimbursed")
  );
}

function isInternalFromRule(transaction: ParsedImportTransaction) {
  if (transaction.linkage?.type !== "internal") return false;
  if (!transaction.linkage.autoDetected) return false;
  const reason = String(transaction.linkage.detectionReason || "").toLowerCase();
  return reason.includes("matched import rule");
}

export async function runAutoCategorization(
  context: AutoCategorizationContext,
  strategies: AutoCategorizationStrategy[],
  settings: AutoLabelSettings,
): Promise<ParsedImportTransaction[]> {
  if (context.transactions.length === 0 || strategies.length === 0) {
    return context.transactions;
  }

  const outputs = await Promise.all(
    strategies.map((strategy) => strategy.suggest(context)),
  );

  return context.transactions.map((transaction, index) => {
    if (isInternalFromRule(transaction)) {
      return transaction;
    }

    const candidate = bestSuggestion(
      outputs.map((output) => output[index] || null),
    );
    if (!candidate) return transaction;

    const next: ParsedImportTransaction = {
      ...transaction,
      suggestedCategoryId: candidate.categoryId,
      suggestedLabel: candidate.label,
      suggestedInternal: candidate.markInternal,
      suggestionSource: candidate.source,
      suggestionConfidence: candidate.confidence,
      metadata: {
        ...(transaction.metadata || {}),
        suggestionReason: candidate.reason,
        ...(candidate.patternId
          ? {
              classificationPatternId: candidate.patternId,
              classificationPatternType: candidate.patternType,
              classificationPatternValue: candidate.patternValue,
            }
          : {}),
      },
      suggestionApplied: false,
    };

    if (
      !settings.enabled ||
      candidate.confidence < settings.threshold ||
      candidate.autoApply === false
    ) {
      return next;
    }

    let applied = false;

    if (candidate.markInternal && canApplyInternal(next)) {
      next.linkage = {
        type: "internal",
        autoDetected: true,
        detectionReason: `Auto-labelled (${candidate.source}): ${candidate.reason}`,
      };
      applied = true;
    }

    if (candidate.label && canApplyLabel(next)) {
      next.label = candidate.label;
      applied = true;
    }

    if (candidate.categoryId && canApplyCategory(next)) {
      next.categoryId = candidate.categoryId;
      applied = true;
    }

    if (applied && candidate.patternId) {
      next.metadata = {
        ...(next.metadata || {}),
        classificationAppliedAt: new Date().toISOString(),
      };
    }

    next.suggestionApplied = applied;
    return next;
  });
}
