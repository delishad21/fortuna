import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyProposalPayload,
  hashValue,
  materializeDraftTransaction,
  proposalCanAutoApply,
  sanitizeStatementFilename,
  validateDraftAccountAssignment,
  validateDraftTransaction,
} from "./hermes-workflow.utils";

describe("Hermes import workflow helpers", () => {
  it("hashes object keys deterministically and distinguishes changed content", () => {
    assert.equal(hashValue({ a: 1, b: [2, 3] }), hashValue({ b: [2, 3], a: 1 }));
    assert.notEqual(hashValue({ a: 1 }), hashValue({ a: 2 }));
  });

  it("removes paths and unsafe filename characters", () => {
    assert.equal(sanitizeStatementFilename("../../DBS:<July>.pdf"), "DBS__July_.pdf");
    assert.equal(sanitizeStatementFilename(""), "statement");
  });

  it("only auto-applies low-risk proposals above their thresholds", () => {
    assert.equal(proposalCanAutoApply({ confidence: 0.85, proposedLabel: "Grab" }), true);
    assert.equal(proposalCanAutoApply({ confidence: 0.84, proposedLabel: "Grab" }), false);
    assert.equal(proposalCanAutoApply({ confidence: 0.9, proposedCategoryId: "transport" }), true);
    assert.equal(proposalCanAutoApply({ confidence: 0.94, proposedTripId: "trip" }), false);
    assert.equal(proposalCanAutoApply({ confidence: 1, proposedLinkage: { type: "internal" } }), false);
    assert.equal(proposalCanAutoApply({ confidence: 1, proposedTripEntryType: "funding_in" }), false);
  });

  it("applies only fields supplied by a proposal", () => {
    assert.deepEqual(
      applyProposalPayload(
        { description: "GRAB", amountOut: 12 },
        { proposedLabel: "Grab", proposedCategoryId: "transport" },
      ),
      { description: "GRAB", amountOut: 12, label: "Grab", categoryId: "transport" },
    );
  });

  it("validates required transaction invariants", () => {
    assert.deepEqual(
      validateDraftTransaction({ date: "2026-08-01", description: "Coffee", amountOut: 4.5 }),
      [],
    );
    assert.deepEqual(
      validateDraftTransaction({ date: "bad", description: "", amountIn: 1, amountOut: 2 }),
      ["invalid date", "missing description", "both amountIn and amountOut are positive"],
    );
  });

  it("requires an existing account for every main-ledger row", () => {
    const known = new Set(["532392****2124"]);
    assert.deepEqual(validateDraftAccountAssignment("trip", {}, known), []);
    assert.match(validateDraftAccountAssignment("main", {}, known)[0], /missing accountIdentifier/);
    assert.match(
      validateDraftAccountAssignment("main", { accountIdentifier: "unknown" }, known)[0],
      /unknown accountIdentifier/,
    );
    assert.deepEqual(
      validateDraftAccountAssignment("main", { accountIdentifier: "532392****2124" }, known),
      [],
    );
  });

  it("materializes JSON draft dates before duplicate checks and commit", () => {
    const transaction = materializeDraftTransaction({ date: "2026-08-21", description: "Cashback" });
    assert.ok(transaction.date instanceof Date);
    assert.equal(transaction.date.toISOString(), "2026-08-21T00:00:00.000Z");
  });
});
