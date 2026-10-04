import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runAutoCategorization } from "./engine";
import type { AutoCategorizationStrategy } from "./types";

describe("runAutoCategorization", () => {
  it("records learned pattern metadata when a suggestion is auto-applied", async () => {
    const strategy: AutoCategorizationStrategy = {
      id: "learned_pattern",
      async suggest() {
        return [
          {
            source: "learned_pattern",
            confidence: 0.8,
            reason: "learned merchant pattern",
            label: "Grab",
            categoryId: "transport",
            patternId: "pattern-1",
            patternType: "merchant_stem",
            patternValue: "grab rides",
            supportCount: 3,
          },
        ];
      },
    };

    const [transaction] = await runAutoCategorization(
      {
        userId: "user-1",
        parserId: "dbs",
        categoryByName: new Map(),
        transactions: [
          {
            date: "2026-04-01",
            description: "GRAB* RIDES SINGAPORE",
            amountOut: 12,
          },
        ],
      },
      [strategy],
      { enabled: true, threshold: 0.5 },
    );

    assert.equal(transaction.label, "Grab");
    assert.equal(transaction.categoryId, "transport");
    assert.equal(transaction.suggestionApplied, true);
    assert.equal(transaction.metadata?.classificationPatternId, "pattern-1");
    assert.equal(transaction.metadata?.classificationPatternType, "merchant_stem");
    assert.equal(transaction.metadata?.classificationPatternValue, "grab rides");
    assert.equal(typeof transaction.metadata?.classificationAppliedAt, "string");
  });

  it("ignores disabled learned patterns instead of surfacing suggestions", async () => {
    const strategy: AutoCategorizationStrategy = {
      id: "learned_pattern",
      async suggest() {
        return [
          {
            source: "learned_pattern",
            confidence: 0.9,
            reason: "ambiguous learned merchant pattern",
            label: "Amazon",
            categoryId: "shopping",
            patternId: "pattern-2",
            patternType: "merchant_stem",
            patternValue: "amazon marketplace",
            supportCount: 4,
            autoApply: false,
          },
        ];
      },
    };

    const [transaction] = await runAutoCategorization(
      {
        userId: "user-1",
        parserId: "dbs",
        categoryByName: new Map(),
        transactions: [
          {
            date: "2026-04-01",
            description: "AMAZON MARKETPLACE SG",
            amountOut: 40,
          },
        ],
      },
      [strategy],
      { enabled: true, threshold: 0.5 },
    );

    assert.equal(transaction.label, undefined);
    assert.equal(transaction.categoryId, undefined);
    assert.equal(transaction.suggestionApplied, undefined);
    assert.equal(transaction.suggestedLabel, undefined);
    assert.equal(transaction.suggestedCategoryId, undefined);
  });

  it("does not surface below-threshold suggestions without applying them", async () => {
    const strategy: AutoCategorizationStrategy = {
      id: "history",
      async suggest() {
        return [
          {
            source: "history",
            confidence: 0.4,
            reason: "weak historical match",
            label: "Coffee",
            categoryId: "dining",
          },
        ];
      },
    };

    const [transaction] = await runAutoCategorization(
      {
        userId: "user-1",
        parserId: "dbs",
        categoryByName: new Map(),
        transactions: [
          {
            date: "2026-04-01",
            description: "CAFE RANDOM",
            amountOut: 5,
          },
        ],
      },
      [strategy],
      { enabled: true, threshold: 0.5 },
    );

    assert.equal(transaction.label, undefined);
    assert.equal(transaction.categoryId, undefined);
    assert.equal(transaction.suggestionSource, undefined);
    assert.equal(transaction.suggestionApplied, undefined);
    assert.equal(transaction.suggestedLabel, undefined);
    assert.equal(transaction.suggestedCategoryId, undefined);
  });
});
