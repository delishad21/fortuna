import { test } from "node:test";
import assert from "node:assert/strict";
import { draftAmountIssues, reviewDraftRow, reviewDraftRows, summarizeDraftReview } from "./draft-review";
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
      amountErrors: 0,
    },
  );
});

const row = (payload: Record<string, unknown>) => ({ ...ready, currentPayload: { ...ready.currentPayload, ...payload } });
const account = { accountIdentifier: "1234567890", currency: "SGD" };

test("flags a row with both money in and money out", () => {
  const review = reviewDraftRow(row({ amountIn: 22455.54, amountOut: 1.5 }));
  assert.equal(review.needsReview, true);
  assert.equal(review.amountErrors.length, 1);
  assert.match(review.reasons[0], /both money in and money out/);
});

test("flags rows that break the running balance", () => {
  const rows = [
    row({ ...account, amountOut: 1.5, balance: 22455.54 }),
    row({ ...account, amountOut: 1.44, balance: 22454.1 }),
    // The parser read the balance as the deposit and lost the 0.93.
    row({ ...account, amountIn: 22455.03, balance: 22455.03 }),
  ];
  const issues = draftAmountIssues(rows.map((r) => r.currentPayload));
  assert.deepEqual(issues.slice(0, 2).map((i) => i.errors), [[], []]);
  assert.equal(
    issues[2].runningBalance,
    "Running balance doesn't match: 22,454.10 + 22,455.03 = 44,909.13, but the statement shows 22,455.03. Check the amounts against the statement.",
  );
  const reviews = reviewDraftRows(rows);
  assert.equal(reviews[2].needsReview, true);
  assert.equal(reviews[1].needsReview, false);
  assert.equal(summarizeDraftReview(rows).amountErrors, 1);
});

test("accepts rows that reconcile to the cent, in either statement order", () => {
  const rows = [
    row({ ...account, amountOut: 0.1, balance: 0.2 }),
    row({ ...account, amountIn: 0.1, balance: 0.3 }),
    row({ ...account, amountOut: 0.3, balance: 0 }),
  ];
  const forward = rows.map((r) => r.currentPayload);
  // Newest first: each row's balance is the one before it, read from the bottom.
  const newestFirst = [
    { ...account, amountOut: 0.3, balance: 0 },
    { ...account, amountIn: 0.1, balance: 0.3 },
    { ...account, amountOut: 0.1, balance: 0.2 },
  ];
  assert.deepEqual(draftAmountIssues(forward).map((i) => i.errors), [[], [], []]);
  assert.deepEqual(draftAmountIssues(newestFirst).map((i) => i.errors), [[], [], []]);
});

test("checks each account's balance on its own and skips rows without one", () => {
  const issues = draftAmountIssues([
    { accountIdentifier: "a", amountOut: 5, balance: 95 },
    { accountIdentifier: "b", amountIn: 10, balance: 10 },
    { accountIdentifier: "a", amountOut: 5 },
    { accountIdentifier: "a", amountOut: 5, balance: 90 },
    { accountIdentifier: "b", amountIn: 10, balance: 20 },
  ]);
  assert.deepEqual(issues.map((i) => i.errors), [[], [], [], [], []]);
});

test("trip drafts skip the running balance", () => {
  const payloads = [
    { amountOut: 5, balance: 95 },
    { amountOut: 5, balance: 50 },
  ];
  assert.equal(draftAmountIssues(payloads)[1].errors.length, 1);
  assert.equal(draftAmountIssues(payloads, { runningBalance: false })[1].errors.length, 0);
});

test("shows the parser's warning on the row", () => {
  const review = reviewDraftRow(
    row({ amountIn: 0.95, metadata: { parseWarning: "Running balance doesn't reconcile" } }),
  );
  assert.equal(review.needsReview, true);
  assert.deepEqual(review.amountErrors, []);
  assert.ok(review.reasons.includes("Running balance doesn't reconcile"));
});
