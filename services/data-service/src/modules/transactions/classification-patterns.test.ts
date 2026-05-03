import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildClassificationPatternsFromTransactions } from "./classification-patterns";

describe("buildClassificationPatternsFromTransactions", () => {
  it("promotes consistent merchant stems to auto-apply learned patterns", () => {
    const patterns = buildClassificationPatternsFromTransactions({
      ignoredCategoryIds: new Set(["uncategorized"]),
      transactions: [
        {
          description: "GRAB* RIDES SINGAPORE 123456",
          label: "Grab",
          categoryId: "transport",
          amountOut: 12.3,
          metadata: { parserId: "dbs" },
        },
        {
          description: "GRAB* RIDES SINGAPORE 987654",
          label: "Grab",
          categoryId: "transport",
          amountOut: 9.1,
          metadata: { parserId: "dbs" },
        },
      ],
    });

    const merchant = patterns.find(
      (pattern) =>
        pattern.patternType === "merchant_stem" &&
        pattern.patternValue === "grab rides",
    );

    assert.ok(merchant);
    assert.equal(merchant.label, "Grab");
    assert.equal(merchant.categoryId, "transport");
    assert.equal(merchant.direction, "out");
    assert.equal(merchant.parserId, "dbs");
    assert.equal(merchant.status, "auto_apply");
    assert.equal(merchant.supportCount, 2);
    assert.equal(merchant.conflictCount, 0);
    assert.ok(merchant.confidence >= 0.5);
  });

  it("keeps ambiguous learned patterns disabled until they are safe to auto-apply", () => {
    const patterns = buildClassificationPatternsFromTransactions({
      ignoredCategoryIds: new Set(["uncategorized"]),
      transactions: [
        {
          description: "AMAZON MARKETPLACE SG",
          label: "Amazon",
          categoryId: "shopping",
          amountOut: 40,
        },
        {
          description: "AMAZON MARKETPLACE SG",
          label: "Amazon Prime",
          categoryId: "subscriptions",
          amountOut: 14,
        },
      ],
    });

    const exact = patterns.find(
      (pattern) =>
        pattern.patternType === "description_exact" &&
        pattern.patternValue === "amazon marketplace",
    );

    assert.ok(exact);
    assert.equal(exact.status, "disabled");
    assert.equal(exact.supportCount, 2);
    assert.equal(exact.conflictCount, 1);
    assert.ok(exact.confidence < 0.75);
  });

  it("tracks repeated unclassified stems as unresolved patterns", () => {
    const patterns = buildClassificationPatternsFromTransactions({
      ignoredCategoryIds: new Set(["uncategorized"]),
      transactions: [
        {
          description: "PAYNOW TRANSFER 111111",
          categoryId: "uncategorized",
          amountOut: 25,
        },
        {
          description: "PAYNOW TRANSFER 222222",
          categoryId: "uncategorized",
          amountOut: 30,
        },
      ],
    });

    const unresolved = patterns.find(
      (pattern) =>
        pattern.patternType === "unresolved" &&
        pattern.patternValue === "paynow transfer",
    );

    assert.ok(unresolved);
    assert.equal(unresolved.status, "unresolved");
    assert.equal(unresolved.supportCount, 2);
    assert.equal(unresolved.label, null);
    assert.equal(unresolved.categoryId, null);
  });

  it("creates label aliases when labels appear inside descriptions", () => {
    const patterns = buildClassificationPatternsFromTransactions({
      ignoredCategoryIds: new Set(["uncategorized"]),
      transactions: [
        {
          description: "OPENAI CHATGPT SUBSCRIPTION",
          label: "OpenAI",
          categoryId: "subscriptions",
          amountOut: 20,
        },
      ],
    });

    const alias = patterns.find(
      (pattern) =>
        pattern.patternType === "label_alias" &&
        pattern.patternValue === "openai",
    );

    assert.ok(alias);
    assert.equal(alias.status, "auto_apply");
    assert.equal(alias.label, "OpenAI");
    assert.equal(alias.categoryId, "subscriptions");
  });
});
