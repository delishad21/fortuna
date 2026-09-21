import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewDraftRow, summarizeDraftReview } from "./draft-review";
const ready = {
  reviewStatus: "auto_applied",
  selected: true,
  currentPayload: { label: "Coffee", categoryId: "food" },
  proposals: [],
};
test("flags incomplete classification even on edited rows", () => {
  assert.equal(
    reviewDraftRow({
      ...ready,
      reviewStatus: "edited",
      currentPayload: { label: " " },
    }).labelling,
    true,
  );
});
test("treats deterministic internal linkage as a completed category assignment", () => {
  const review = reviewDraftRow({
    ...ready,
    currentPayload: { label: "PayLah transfer", linkage: { type: "internal" } },
  });
  assert.equal(review.labelling, false);
});
test("separates pending reconciliation and pending classification", () => {
  const review = reviewDraftRow({
    ...ready,
    proposals: [
      {
        status: "proposed",
        proposedLinkage: { type: "internal" },
        reason: "Check transfer",
      },
    ],
  });
  assert.equal(review.reconciliation, true);
  assert.equal(review.labelling, false);
  assert.ok(review.reasons.includes("Check transfer"));
  assert.equal(
    reviewDraftRow({
      ...ready,
      proposals: [{ status: "proposed", proposedLabel: "New merchant" }],
    }).labelling,
    true,
  );
});
test("accepted and stale proposals no longer flag rows; rejected rows still need review", () => {
  assert.equal(
    reviewDraftRow({
      ...ready,
      proposals: [
        { status: "accepted", proposedLinkage: { type: "internal" } },
      ],
    }).needsReview,
    false,
  );
  assert.equal(
    reviewDraftRow({ ...ready, reviewStatus: "rejected" }).needsReview,
    true,
  );
});
test("summary includes unselected flagged rows without counting them as selected", () => {
  assert.deepEqual(
    summarizeDraftReview([
      ready,
      { ...ready, selected: false, reviewStatus: "unresolved" },
    ]),
    {
      total: 2,
      selected: 1,
      needsReview: 1,
      labelling: 0,
      reconciliation: 0,
      ready: 1,
    },
  );
});
