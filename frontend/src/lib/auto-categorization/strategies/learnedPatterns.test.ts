import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LearnedPatternStrategy } from "./learnedPatterns";

describe("LearnedPatternStrategy", () => {
  it("matches auto-apply merchant patterns scoped by parser and direction", async () => {
    const strategy = new LearnedPatternStrategy(async () => [
      {
        id: "pattern-1",
        patternType: "merchant_stem",
        patternValue: "grab rides",
        parserId: "dbs",
        direction: "out",
        label: "Grab",
        categoryId: "transport",
        markInternal: false,
        confidence: 0.72,
        supportCount: 2,
        status: "auto_apply",
      },
    ]);

    const suggestions = await strategy.suggest({
      userId: "user-1",
      parserId: "dbs",
      categoryByName: new Map(),
      transactions: [
        {
          date: "2026-04-01",
          description: "GRAB* RIDES SINGAPORE 123456",
          amountOut: 12.3,
        },
      ],
    });

    assert.equal(suggestions[0]?.source, "learned_pattern");
    assert.equal(suggestions[0]?.patternId, "pattern-1");
    assert.equal(suggestions[0]?.label, "Grab");
    assert.equal(suggestions[0]?.categoryId, "transport");
    assert.equal(suggestions[0]?.confidence, 0.72);
  });

  it("ignores disabled patterns and patterns scoped to the wrong direction", async () => {
    const strategy = new LearnedPatternStrategy(async () => [
      {
        id: "disabled",
        patternType: "label_alias",
        patternValue: "openai",
        parserId: null,
        direction: "out",
        label: "OpenAI",
        categoryId: "subscriptions",
        markInternal: false,
        confidence: 0.9,
        supportCount: 5,
        status: "disabled",
      },
      {
        id: "wrong-direction",
        patternType: "label_alias",
        patternValue: "openai",
        parserId: null,
        direction: "in",
        label: "OpenAI",
        categoryId: "subscriptions",
        markInternal: false,
        confidence: 0.9,
        supportCount: 5,
        status: "auto_apply",
      },
    ]);

    const suggestions = await strategy.suggest({
      userId: "user-1",
      parserId: "dbs",
      categoryByName: new Map(),
      transactions: [
        {
          date: "2026-04-01",
          description: "OPENAI CHATGPT SUBSCRIPTION",
          amountOut: 20,
        },
      ],
    });

    assert.equal(suggestions[0], null);
  });
});
