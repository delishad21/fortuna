import { randomUUID } from "node:crypto";
import type { AssistantDecision, ClassificationDecision, EntryQuestion } from "./entry-review";

/**
 * How an assistant entry's category, label and Internal flag are decided,
 * given what each step found. The order is fixed:
 *
 *   (a) structural detection in code (transfer pairs between the user's own
 *       accounts, card bill payments),
 *   (b) enabled rules,
 *   (c) the assistant's decision (from similar past entries and the user's
 *       instructions),
 *   (d) a learned pattern or history match, only when the assistant sent
 *       nothing.
 *
 * When the assistant's decision contradicts a rule's result, the rule's result
 * is kept and a question is added. A rule whose amount range the entry falls
 * outside doesn't apply; a question asks whether it should.
 */

export type StructuralResult = {
  kind: "paylah_transfer" | "card_bill_payment";
  /** This entry is the internal leg (the other side may be the real transaction). */
  internal: boolean;
  reason: string;
  counterpartId: string | null;
};

export type RuleResult = {
  ruleId: string;
  ruleName: string;
  categoryId?: string;
  categoryName?: string;
  label?: string;
  internal: boolean;
};

export type RuleAmountMiss = {
  ruleId: string;
  ruleName: string;
  amountMin: number | null;
  amountMax: number | null;
};

export type AssistantStep = {
  decision: AssistantDecision | null;
  /** The older suggestedCategory field, when sent. */
  suggestedCategory?: string | null;
  /** The category the decision names, resolved; null when it names none or an unknown one. */
  category: { id: string; name: string } | null;
};

export type PatternResult = {
  source: "learned_pattern" | "history" | "heuristic";
  categoryId?: string;
  label?: string;
  internal: boolean;
  patternId?: string;
};

export type DecisionSteps = {
  structural: StructuralResult | null;
  rule: RuleResult | null;
  ruleAmountMisses: RuleAmountMiss[];
  assistant: AssistantStep;
  /** Only looked up when the assistant sent nothing. */
  pattern: PatternResult | null;
};

export type Reserved = {
  internal: { id: string; name: string };
  reimbursement: { id: string; name: string };
  uncategorized: { id: string; name: string };
};

export type DecidedEntry = {
  categoryId: string;
  linkage: Record<string, unknown> | null;
  label: string | null;
  merchant: string | null;
  transactionType: string | null;
  decision: ClassificationDecision;
  questions: EntryQuestion[];
};

/** The assistant sent something to decide with: a category, a type that implies one, or the older suggestion. */
export function assistantSentDecision(step: Pick<AssistantStep, "decision" | "suggestedCategory">) {
  const decision = step.decision;
  return Boolean(
    step.suggestedCategory ||
      decision?.category ||
      decision?.transactionType === "internal" ||
      decision?.transactionType === "reimbursement",
  );
}

const money = (value: number) => `S$${value.toFixed(2)}`;

function rangeText(miss: RuleAmountMiss) {
  if (miss.amountMin != null && miss.amountMax != null)
    return miss.amountMin === miss.amountMax ? money(miss.amountMin) : `${money(miss.amountMin)}–${money(miss.amountMax)}`;
  if (miss.amountMin != null) return `at least ${money(miss.amountMin)}`;
  return `up to ${money(miss.amountMax ?? 0)}`;
}

export function question(
  fields: Omit<EntryQuestion, "id" | "createdAt">,
  now = new Date(),
): EntryQuestion {
  return { id: randomUUID().slice(0, 8), ...fields, createdAt: now.toISOString() };
}

export function decideEntry(
  facts: { amountIn: number | null; amountOut: number | null; label: string | null },
  steps: DecisionSteps,
  reserved: Reserved,
  now = new Date(),
): DecidedEntry {
  const { structural, rule, assistant, pattern } = steps;
  const sent = assistant.decision;
  const amount = facts.amountOut ?? facts.amountIn ?? 0;
  const moneyIn = (facts.amountIn ?? 0) > 0;
  const questions: EntryQuestion[] = [];
  const base = {
    ...(sent ? { assistant: sent } : {}),
    ...(assistant.suggestedCategory ? { suggestedCategory: assistant.suggestedCategory } : {}),
    at: now.toISOString(),
  };
  const merchant = sent?.merchant || null;
  const transactionType = sent?.transactionType || null;

  // The assistant's category: the one it names, else what its type implies.
  const assistantCategory =
    assistant.category ??
    (sent?.transactionType === "internal"
      ? reserved.internal
      : sent?.transactionType === "reimbursement" && moneyIn
        ? reserved.reimbursement
        : null);
  const assistantLabel = sent?.label || facts.label || null;

  for (const miss of steps.ruleAmountMisses)
    questions.push(
      question(
        {
          key: `amount_range:${miss.ruleId}`,
          field: "rule",
          prompt: `The rule “${miss.ruleName}” is for ${rangeText(miss)}, but this is ${money(amount)}. Apply it anyway?`,
          options: [
            { id: "apply", label: `Apply “${miss.ruleName}”` },
            { id: "skip", label: "Not this time" },
          ],
          source: "amount_range",
          ruleId: miss.ruleId,
          context: { amount, amountMin: miss.amountMin, amountMax: miss.amountMax },
        },
        now,
      ),
    );

  const internalLinkage = (reason: string, extra: Record<string, unknown> = {}) => ({
    type: "internal",
    autoDetected: true,
    detectionReason: reason,
    ...extra,
  });

  // (a) Structural detection: this entry is one side of a transfer between the user's own accounts.
  if (structural?.internal) {
    return {
      categoryId: reserved.internal.id,
      linkage: internalLinkage(structural.reason, {
        pair: { kind: structural.kind, counterpartId: structural.counterpartId },
      }),
      label: rule?.label || assistantLabel,
      merchant,
      transactionType: "internal",
      decision: {
        decidedBy: "structural",
        structural: { kind: structural.kind, counterpartId: structural.counterpartId, reason: structural.reason },
        ...base,
      },
      questions,
    };
  }

  // (b) Rules.
  if (rule && (rule.internal || rule.categoryId)) {
    const ruleCategory = rule.internal
      ? reserved.internal
      : { id: rule.categoryId!, name: rule.categoryName ?? "the rule's category" };
    let conflict: ClassificationDecision["conflict"];
    if (assistantCategory && assistantCategory.id !== ruleCategory.id) {
      conflict = { ruleId: rule.ruleId, rule: ruleCategory.name, assistant: assistantCategory.name };
      questions.push(
        question(
          {
            key: `rule_conflict:${rule.ruleId}`,
            field: "category",
            prompt: `The rule “${rule.ruleName}” made this ${ruleCategory.name}, but the assistant thought ${assistantCategory.name}${sent?.reason ? ` (${sent.reason})` : ""}. Which is it?`,
            options: [
              { id: ruleCategory.name, label: ruleCategory.name },
              { id: assistantCategory.name, label: assistantCategory.name },
            ],
            allowOther: true,
            source: "rule_conflict",
            ruleId: rule.ruleId,
          },
          now,
        ),
      );
    }
    return {
      categoryId: ruleCategory.id,
      linkage: rule.internal ? internalLinkage(`Matched import rule: ${rule.ruleName}`) : null,
      label: rule.label || assistantLabel,
      merchant,
      transactionType: rule.internal ? "internal" : transactionType,
      decision: {
        decidedBy: "rule",
        ruleId: rule.ruleId,
        ruleName: rule.ruleName,
        ...(rule.label ? { labelFromRule: true } : {}),
        ...(conflict ? { conflict } : {}),
        ...base,
      },
      questions,
    };
  }
  const ruleLabel = rule?.label;

  // (c) The assistant's decision.
  if (assistantCategory) {
    const linkage =
      assistantCategory.id === reserved.internal.id
        ? { type: "internal", autoDetected: false, detectionReason: "Set by the assistant" }
        : assistantCategory.id === reserved.reimbursement.id
          ? { type: "reimbursement", leftoverCategoryId: null, autoDetected: false }
          : null;
    return {
      categoryId: assistantCategory.id,
      linkage,
      label: ruleLabel || assistantLabel,
      merchant,
      transactionType,
      decision: { decidedBy: "assistant", ...(ruleLabel ? { labelFromRule: true, ruleId: rule!.ruleId, ruleName: rule!.ruleName } : {}), ...base },
      questions,
    };
  }

  // (d) Learned pattern or history, only when the assistant sent nothing.
  if (pattern && !assistantSentDecision(assistant) && (pattern.internal || pattern.categoryId)) {
    const label = ruleLabel || facts.label || pattern.label || null;
    return {
      categoryId: pattern.internal ? reserved.internal.id : pattern.categoryId!,
      linkage: pattern.internal ? internalLinkage(`Auto-labelled from ${pattern.source}`) : null,
      label,
      merchant,
      transactionType: pattern.internal ? "internal" : transactionType,
      decision: {
        decidedBy: pattern.source,
        ...(pattern.patternId ? { patternId: pattern.patternId } : {}),
        ...(label && label !== facts.label ? { labelFromRule: true } : {}),
        ...base,
      },
      questions,
    };
  }

  return {
    categoryId: reserved.uncategorized.id,
    linkage: null,
    label: ruleLabel || assistantLabel || (pattern && !assistantSentDecision(assistant) ? pattern.label || null : null),
    merchant,
    transactionType,
    decision: { decidedBy: "none", ...(ruleLabel ? { labelFromRule: true } : {}), ...base },
    questions,
  };
}

/** Questions the assistant sent, in the stored shape. */
export function assistantQuestions(
  input: Array<{
    field: EntryQuestion["field"];
    prompt: string;
    options: Array<string | { id?: string; label: string }>;
    allowOther?: boolean;
    context?: Record<string, unknown>;
  }>,
  now = new Date(),
): EntryQuestion[] {
  return input.map((item) =>
    question(
      {
        field: item.field,
        prompt: item.prompt,
        options: item.options.map((option) =>
          typeof option === "string" ? { id: option, label: option } : { id: option.id || option.label, label: option.label },
        ),
        ...(item.allowOther !== undefined ? { allowOther: item.allowOther } : { allowOther: item.options.length === 0 }),
        ...(item.context && Object.keys(item.context).length ? { context: item.context } : {}),
        source: "assistant",
      },
      now,
    ),
  );
}

/**
 * The entry's questions after a new classification: questions the
 * classification raises replace the ones it raised before, keyed questions
 * already open keep their id (so an answer in flight still finds them), and
 * the assistant's own questions are replaced only when it sends new ones.
 */
export function mergeQuestions(
  previous: EntryQuestion[],
  next: { system: EntryQuestion[]; assistant?: EntryQuestion[]; account?: EntryQuestion | null },
): EntryQuestion[] {
  const byKey = new Map(previous.filter((item) => item.key).map((item) => [item.key!, item]));
  const keep = (item: EntryQuestion) => (item.key && byKey.get(item.key)) || item;
  const assistant = next.assistant ?? previous.filter((item) => item.source === "assistant");
  const account =
    next.account === undefined
      ? previous.filter((item) => item.source === "unknown_account")
      : next.account
        ? [keep(next.account)]
        : [];
  return [...account, ...next.system.map(keep), ...assistant];
}

export function storedQuestions(value: unknown): EntryQuestion[] {
  return Array.isArray(value)
    ? (value.filter((item) => item && typeof item === "object" && typeof item.id === "string") as EntryQuestion[])
    : [];
}
