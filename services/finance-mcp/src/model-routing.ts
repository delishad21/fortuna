export type FinanceTaskType = "classification" | "trip_classification" | "config_parser" | "python_parser";

export function recommendModelRoute(input: {
  taskType: FinanceTaskType;
  ambiguousLayout?: boolean;
  reconciliationFailed?: boolean;
  repeatedTestFailure?: boolean;
}) {
  const difficult = input.ambiguousLayout || input.reconciliationFailed || input.repeatedTestFailure;
  if (input.taskType === "python_parser") {
    return {
      model: difficult ? "gpt-5.6-sol" : "gpt-5.6-terra",
      effort: "xhigh",
      reason: "Generated parser code requires stronger engineering review and external isolated tests.",
    };
  }
  if (input.taskType === "config_parser" && difficult) {
    return { model: "gpt-5.6-terra", effort: "xhigh", reason: "Escalated after layout ambiguity or failed deterministic checks." };
  }
  return {
    model: "gpt-5.6-luna",
    effort: "xhigh",
    reason: "Luna xhigh is the default for bounded classification, orchestration, and declarative parser work.",
  };
}
