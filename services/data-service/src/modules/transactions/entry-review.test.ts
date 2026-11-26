import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classificationDecision,
  CorrectionSchema,
  parseReviewFilter,
  ReviewQueueQuerySchema,
  reviewReasonsFor,
} from "./entry-review";

const now = new Date("2026-11-26T04:00:00.000Z");

describe("classification decision", () => {
  it("names the import rule that chose the category", () => {
    const decision = classificationDecision(
      { label: null },
      { categoryId: "food", label: "Kopitiam", metadata: { fixedRuleId: "rule-1", fixedRuleName: "Kopitiam is Food" } },
      { suggestedCategory: "Shopping", usedSuggestion: false },
      now,
    );
    assert.deepEqual(decision, {
      decidedBy: "rule",
      ruleId: "rule-1",
      ruleName: "Kopitiam is Food",
      suggestedCategory: "Shopping",
      labelFromRule: true,
      at: now.toISOString(),
    });
  });

  it("names a learned pattern applied by auto-categorization", () => {
    const decision = classificationDecision(
      { label: "Lunch" },
      {
        categoryId: "food",
        label: "Lunch",
        suggestionApplied: true,
        suggestionSource: "learned_pattern",
        metadata: { classificationPatternId: "p-1" },
      },
      { usedSuggestion: false },
      now,
    );
    assert.equal(decision.decidedBy, "learned_pattern");
    assert.equal(decision.patternId, "p-1");
    assert.equal(decision.labelFromRule, undefined);
  });

  it("falls back to the assistant, then to nobody", () => {
    assert.equal(
      classificationDecision({}, { metadata: {} }, { suggestedCategory: "Food", usedSuggestion: true }, now).decidedBy,
      "assistant",
    );
    assert.equal(classificationDecision({}, { metadata: {} }, { usedSuggestion: false }, now).decidedBy, "none");
    // A rule that only set a label didn't choose the category.
    assert.equal(
      classificationDecision({}, { label: "Grab", metadata: { fixedRuleId: "r" } }, { usedSuggestion: false }, now)
        .decidedBy,
      "none",
    );
  });
});

describe("review reasons", () => {
  it("lists every reason that applies", () => {
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

  it("needs something to correct, and confirmation and a value for a rule", () => {
    assert.equal(CorrectionSchema.safeParse({ ids: ["a"] }).success, false);
    assert.equal(CorrectionSchema.safeParse({ ids: ["a"], category: "Food" }).data?.markReviewed, true);
    assert.equal(
      CorrectionSchema.safeParse({ ids: ["a"], category: "Food", createRule: { matchValue: "KOPI" } }).success,
      false,
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
