import {
  AutoCategorizationContext,
  AutoCategorizationStrategy,
  AutoSuggestion,
} from "../types";
import { directionOf } from "../normalization";

function makeSuggestion(
  source: AutoSuggestion["source"],
  confidence: number,
  reason: string,
  data: Partial<AutoSuggestion>,
): AutoSuggestion {
  return {
    source,
    confidence,
    reason,
    categoryId: data.categoryId,
    label: data.label,
    markInternal: data.markInternal,
  };
}

export class HeuristicStrategy implements AutoCategorizationStrategy {
  readonly id = "heuristic";

  async suggest(
    context: AutoCategorizationContext,
  ): Promise<Array<AutoSuggestion | null>> {
    return context.transactions.map((transaction) => {
      const description = (transaction.description || "").toLowerCase();
      const direction = directionOf(transaction);

      if (direction === "out" && description.includes("bus/mrt")) {
        return makeSuggestion("heuristic", 0.72, "Matched BUS/MRT keyword", {
          categoryId:
            context.categoryByName.get("transportation") || undefined,
          label: "BUS/MRT",
        });
      }

      if (
        direction === "in" &&
        (description.includes("salary") || description.includes("payroll"))
      ) {
        return makeSuggestion("heuristic", 0.74, "Matched salary/payroll keyword", {
          categoryId: context.categoryByName.get("income") || undefined,
          label: transaction.label || "Salary",
        });
      }

      return null;
    });
  }
}
