import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CorrectionSchema,
  parseReviewFilter,
  ReviewQueueQuerySchema,
  reviewReasonsFor,
} from "./entry-review";
import { decideEntry, mergeQuestions, question, type DecisionSteps } from "./entry-decision";

const now = new Date("2026-11-26T04:00:00.000Z");

const reserved = {
  internal: { id: "internal", name: "Internal" },
  reimbursement: { id: "reimbursement", name: "Reimbursement" },
  uncategorized: { id: "uncategorized", name: "Uncategorized" },
};
const food = { id: "food", name: "Food" };
const transport = { id: "transport", name: "Transportation" };
const out = (amount: number) => ({ amountIn: null, amountOut: amount, label: null });
const steps = (extra: Partial<DecisionSteps>): DecisionSteps => ({
  structural: null,
  rule: null,
  ruleAmountMisses: [],
  assistant: { decision: null, category: null },
  pattern: null,
  ...extra,
});
const aiFood = {
  decision: { category: "Food", transactionType: "purchase" as const, label: "Lunch", merchant: "Kopitiam", reason: "Same as last week", confidence: 0.9, precedentIds: ["t1"] },
  category: food,
};
const kopitiamRule = { ruleId: "r1", ruleName: "Kopitiam is Food", categoryId: "food", categoryName: "Food", label: "Kopitiam", internal: false };
const pattern = { source: "learned_pattern" as const, categoryId: "transport", label: "Bus", internal: false, patternId: "p1" };

describe("decision order for assistant entries", () => {
  it("structural detection comes first, before rules and the assistant", () => {
    const decided = decideEntry(
      out(50),
      steps({
        structural: { kind: "paylah_transfer", internal: true, reason: "PayLah transfer", counterpartId: "t9" },
        rule: kopitiamRule,
        assistant: aiFood,
      }),
      reserved,
      now,
    );
    assert.equal(decided.categoryId, "internal");
    assert.equal(decided.decision.decidedBy, "structural");
    assert.deepEqual(decided.decision.structural, { kind: "paylah_transfer", counterpartId: "t9", reason: "PayLah transfer" });
    assert.equal((decided.linkage as any).type, "internal");
    assert.equal(decided.questions.length, 0);
  });

  it("an enabled rule decides before the assistant; the assistant's decision is kept", () => {
    const decided = decideEntry(out(6.8), steps({ rule: kopitiamRule, assistant: aiFood }), reserved, now);
    assert.equal(decided.categoryId, "food");
    assert.equal(decided.label, "Kopitiam");
    assert.equal(decided.decision.decidedBy, "rule");
    assert.equal(decided.decision.ruleId, "r1");
    assert.equal(decided.decision.assistant?.reason, "Same as last week");
    assert.equal(decided.merchant, "Kopitiam");
    assert.equal(decided.questions.length, 0, "no conflict when they agree");
  });

  it("when the assistant contradicts a rule, the rule wins and a question is added", () => {
    const decided = decideEntry(
      out(2),
      steps({
        rule: { ruleId: "r2", ruleName: "BUS/MRT is Transportation", categoryId: "transport", categoryName: "Transportation", internal: false },
        assistant: aiFood,
      }),
      reserved,
      now,
    );
    assert.equal(decided.categoryId, "transport");
    assert.equal(decided.decision.decidedBy, "rule");
    assert.deepEqual(decided.decision.conflict, { ruleId: "r2", rule: "Transportation", assistant: "Food" });
    assert.equal(decided.questions.length, 1);
    const [asked] = decided.questions;
    assert.equal(asked.field, "category");
    assert.equal(asked.source, "rule_conflict");
    assert.equal(asked.key, "rule_conflict:r2");
    assert.deepEqual(asked.options.map((option) => option.id), ["Transportation", "Food"]);
  });

  it("the assistant decides when no rule does, and patterns aren't used", () => {
    const decided = decideEntry(out(6.8), steps({ assistant: aiFood, pattern }), reserved, now);
    assert.equal(decided.categoryId, "food");
    assert.equal(decided.label, "Lunch");
    assert.equal(decided.decision.decidedBy, "assistant");
    assert.equal(decided.transactionType, "purchase");
    assert.deepEqual(decided.decision.assistant?.precedentIds, ["t1"]);
  });

  it("an internal transaction type books Internal; a reimbursement needs money in", () => {
    const internal = decideEntry(out(20), steps({ assistant: { decision: { transactionType: "internal" }, category: null } }), reserved, now);
    assert.equal(internal.categoryId, "internal");
    assert.equal((internal.linkage as any).type, "internal");
    const repaid = decideEntry(
      { amountIn: 15, amountOut: null, label: null },
      steps({ assistant: { decision: { transactionType: "reimbursement" }, category: null } }),
      reserved,
      now,
    );
    assert.equal(repaid.categoryId, "reimbursement");
    const wrong = decideEntry(out(15), steps({ assistant: { decision: { transactionType: "reimbursement" }, category: null } }), reserved, now);
    assert.equal(wrong.categoryId, "uncategorized");
  });

  it("a learned pattern or history decides only when the assistant sent nothing", () => {
    const decided = decideEntry(out(2), steps({ pattern }), reserved, now);
    assert.equal(decided.categoryId, "transport");
    assert.equal(decided.decision.decidedBy, "learned_pattern");
    assert.equal(decided.decision.patternId, "p1");
    assert.equal(decided.label, "Bus");
    const suggested = decideEntry(out(2), steps({ pattern, assistant: { decision: null, suggestedCategory: "Food", category: food } }), reserved, now);
    assert.equal(suggested.decision.decidedBy, "assistant");
    assert.equal(suggested.decision.suggestedCategory, "Food");
  });

  it("nothing decides: Uncategorized", () => {
    const decided = decideEntry(out(3), steps({}), reserved, now);
    assert.equal(decided.categoryId, "uncategorized");
    assert.equal(decided.decision.decidedBy, "none");
  });

  it("a rule that only sets a label leaves the category to the assistant", () => {
    const decided = decideEntry(
      out(9),
      steps({ rule: { ruleId: "r3", ruleName: "Grab label", label: "Grab", internal: false }, assistant: { decision: { category: "Transportation" }, category: transport } }),
      reserved,
      now,
    );
    assert.equal(decided.categoryId, "transport");
    assert.equal(decided.label, "Grab");
    assert.equal(decided.decision.decidedBy, "assistant");
    assert.equal(decided.decision.labelFromRule, true);
  });

  it("an amount outside a rule's range doesn't apply it and asks instead", () => {
    const decided = decideEntry(
      out(22.98),
      steps({
        ruleAmountMisses: [{ ruleId: "r4", ruleName: "Netflix is Subscriptions", amountMin: 15.98, amountMax: 15.98 }],
        assistant: { decision: { category: "Food" }, category: food },
      }),
      reserved,
      now,
    );
    assert.equal(decided.decision.decidedBy, "assistant");
    assert.equal(decided.questions.length, 1);
    assert.equal(decided.questions[0].field, "rule");
    assert.equal(decided.questions[0].source, "amount_range");
    assert.equal(decided.questions[0].ruleId, "r4");
    assert.match(decided.questions[0].prompt, /S\$15\.98, but this is S\$22\.98/);
    assert.deepEqual(decided.questions[0].options.map((option) => option.id), ["apply", "skip"]);
  });
});

describe("questions on entries", () => {
  it("keeps open keyed questions and the assistant's own across a new classification", () => {
    const conflict = question({ key: "rule_conflict:r1", field: "category", prompt: "?", options: [], source: "rule_conflict" }, now);
    const asked = question({ field: "reimbursable", prompt: "Shared?", options: [], source: "assistant" }, now);
    const card = question({ key: "unknown_card:1234", field: "account", prompt: "?", options: [], source: "unknown_account" }, now);
    const again = question({ key: "rule_conflict:r1", field: "category", prompt: "?", options: [], source: "rule_conflict" }, now);
    const merged = mergeQuestions([conflict, asked, card], { system: [again] });
    assert.deepEqual(merged.map((item) => item.id), [card.id, conflict.id, asked.id]);
    assert.deepEqual(mergeQuestions([conflict, asked, card], { system: [], assistant: [], account: null }), []);
  });
});

describe("review reasons", () => {
  it("lists every reason that applies", () => {
    assert.deepEqual(
      reviewReasonsFor({
        decision: { decidedBy: "assistant", assistant: { confidence: 0.4 } },
        accountAutoCreated: false,
        accountUnknown: true,
        possibleDuplicates: 0,
        questions: 1,
      }),
      ["no_rule_matched", "assistant_category", "low_confidence", "unknown_account", "question"],
    );
    assert.deepEqual(
      reviewReasonsFor({ decision: { decidedBy: "assistant" }, accountAutoCreated: true, possibleDuplicates: 2 }),
      ["no_rule_matched", "assistant_category", "new_account", "possible_duplicate"],
    );
    assert.deepEqual(reviewReasonsFor({ decision: { decidedBy: "none" }, accountAutoCreated: false, possibleDuplicates: 0 }), [
      "no_rule_matched",
    ]);
    assert.deepEqual(reviewReasonsFor({ decision: { decidedBy: "rule" }, accountAutoCreated: false, possibleDuplicates: 0 }), []);
    assert.deepEqual(
      reviewReasonsFor({ decision: { decidedBy: "correction" }, accountAutoCreated: false, possibleDuplicates: 1 }),
      ["possible_duplicate"],
    );
  });
});

describe("review inputs", () => {
  it("parses the queue filters", () => {
    assert.deepEqual(ReviewQueueQuerySchema.parse({}), { status: "to_review", limit: 50, offset: 0 });
    const parsed = ReviewQueueQuerySchema.parse({ reasons: "new_account,possible_duplicate", entrySource: "statement", limit: "10" });
    assert.deepEqual(parsed.reasons, ["new_account", "possible_duplicate"]);
    assert.deepEqual(parsed.entrySource, ["statement"]);
    assert.equal(ReviewQueueQuerySchema.safeParse({ reasons: "bogus" }).success, false);
    assert.equal(ReviewQueueQuerySchema.safeParse({ userId: "x" }).success, false);
  });

  it("needs something to correct, and a value for a rule", () => {
    assert.equal(CorrectionSchema.safeParse({ ids: ["a"] }).success, false);
    assert.equal(CorrectionSchema.safeParse({ ids: ["a"], category: "Food" }).data?.markReviewed, true);
    // Rules from the assistant don't need confirmed: true any more.
    assert.equal(
      CorrectionSchema.safeParse({ ids: ["a"], category: "Food", createRule: { matchValue: "KOPI" } }).data?.createRule?.origin,
      "assistant_on_request",
    );
    assert.equal(
      CorrectionSchema.safeParse({ ids: ["a"], category: "Food", createRule: { matchValue: "KOPI", confirmed: true } })
        .success,
      true,
    );
    assert.equal(
      CorrectionSchema.safeParse({ ids: ["a"], account: "DBS", createRule: { matchValue: "KOPI", confirmed: true } })
        .success,
      false,
    );
  });

  it("parses the list filter", () => {
    assert.deepEqual(parseReviewFilter({ reviewStatus: "to_review" }), { reviewStatus: "to_review" });
    assert.deepEqual(parseReviewFilter({ reviewStatus: "nope" }), {});
    assert.deepEqual(parseReviewFilter({}), {});
  });
});
