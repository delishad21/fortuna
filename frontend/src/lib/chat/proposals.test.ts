import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatMoney,
  linkChangeView,
  previewHasChanges,
  proposalState,
  proposalSummary,
  timeLeft,
  waitingText,
  reviewStateLabel,
  approvalsBarDismissed,
  approvalsDismissedKey,
  waitingForUser,
  waitingIds,
} from "../../../shared/chat";

const stagedLink = {
  change: "added" as const,
  amount: "1486.16",
  leftover: "13.84",
  reimbursement: {
    kind: "transaction" as const,
    id: "t1",
    date: "2026-09-27T00:00:00.000Z",
    description: "PAYNOW CAR INSURANCE",
    amountIn: "1500",
    currency: "SGD",
  },
  expense: {
    kind: "staged" as const,
    id: "r1",
    date: "2026-09-27",
    description: "SINGLIFE",
    amountOut: 1486.16,
    currency: "SGD",
    draft: { id: "d1", filename: "uob-oct.pdf" },
  },
};

test("a link to a staged row reads as both ends with the allocation and leftover", () => {
  const view = linkChangeView(stagedLink, formatMoney);
  assert.equal(view.heading, "New reimbursement link");
  assert.match(view.amount, /^SGD\s1,486\.16$/);
  assert.equal(view.verb, "pays back");
  assert.equal(view.from.title, "PAYNOW CAR INSURANCE");
  assert.match(view.from.detail, /SGD\s1,500\.00 · saved/);
  assert.equal(view.to.title, "SINGLIFE");
  assert.match(view.to.detail, /staged in uob-oct\.pdf, not imported yet/);
  assert.match(view.leftover || "", /^SGD\s13\.84 left over$/);
});

test("link-only previews count links and empty previews are not confirmable", () => {
  const linkOnly = {
    kind: "edit_transactions",
    status: "pending",
    preview: { changes: [], linkChanges: [stagedLink] },
  };
  assert.equal(previewHasChanges(linkOnly), true);
  assert.equal(proposalSummary(linkOnly).detail, "1 reimbursement link");
  const empty = {
    kind: "edit_transactions",
    status: "pending",
    preview: { changes: [], linkChanges: [] },
  };
  assert.equal(previewHasChanges(empty), false);
  assert.equal(proposalSummary(empty).detail, "Nothing to change");
  assert.equal(
    previewHasChanges({ kind: "create_category", preview: { after: {} } }),
    true,
  );
});

test("closed proposals say why and only a user rejection reads as rejected", () => {
  const now = new Date("2026-11-12T06:00:00Z");
  const soon = "2026-11-12T11:30:00Z";
  assert.deepEqual(proposalState({ status: "pending", expiresAt: soon }, now), {
    status: "pending",
    pending: true,
    label: "Needs your approval",
  });
  assert.equal(
    proposalState({ status: "pending", expiresAt: "2026-11-12T05:00:00Z" }, now)
      .label,
    "Expired",
  );
  assert.equal(proposalState({ status: "rejected" }).label, "Rejected by you");
  assert.equal(
    proposalState({ status: "superseded" }).label,
    "Replaced by a newer proposal",
  );
  assert.equal(
    proposalState({ status: "stale" }).label,
    "Records changed: ask for a fresh preview",
  );
  for (const status of [
    "cancelled",
    "closed",
    "expired",
    "stale",
    "superseded",
  ])
    assert.doesNotMatch(proposalState({ status }).label, /reject/i);
  assert.equal(timeLeft(soon, now), "5h left");
  assert.equal(timeLeft("2026-11-12T06:40:00Z", now), "40m left");
  assert.equal(timeLeft("2026-11-12T05:00:00Z", now), "");
  assert.equal(waitingText(2, 0), "2 changes waiting for your approval");
  assert.equal(
    waitingText(1, 1),
    "1 change and 1 review waiting for your approval",
  );
  assert.equal(waitingText(0, 1), "1 review waiting for you");
  assert.equal(waitingText(0, 0), "");
});
test("a review the user cancelled reads as cancelled by them; one closed by Stop doesn't", () => {
  assert.equal(
    reviewStateLabel({ status: "cancelled", decidedAt: "2026-11-12T08:00:00Z" }),
    "Cancelled by you",
  );
  assert.equal(
    reviewStateLabel({ status: "cancelled", decidedAt: null }),
    "Closed when you stopped the reply",
  );
  assert.equal(reviewStateLabel({ status: "submitted" }), "Sent to Fortuna");
  assert.equal(reviewStateLabel({ status: "unknown" }), "Closed");
});
test("the approvals bar stays hidden after ✕ until something new is waiting", () => {
  const proposal = (id: string) => ({
    id,
    kind: "edit_transactions",
    status: "pending",
    preview: {},
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  const conversation = (proposals: string[], reviews: string[]) => ({
    id: "c1",
    title: "Chat",
    messages: [],
    attachments: [],
    runs: [
      {
        id: "run",
        status: "completed",
        proposals: proposals.map(proposal),
        reviews: reviews.map((id) => ({ id, title: id, status: "pending" })),
      },
    ],
  });
  const ids = (p: string[], r: string[]) =>
    waitingIds(waitingForUser(conversation(p, r)));
  assert.deepEqual(ids(["p1"], ["r1"]), ["p1", "r1"]);
  // Never closed: shown.
  assert.equal(approvalsBarDismissed(null, ids(["p1"], ["r1"])), false);
  const dismissed = ids(["p1"], ["r1"]);
  assert.equal(approvalsBarDismissed(dismissed, ids(["p1"], ["r1"])), true);
  // Closing one of them doesn't bring it back.
  assert.equal(approvalsBarDismissed(dismissed, ids([], ["r1"])), true);
  // A new proposal or review does.
  assert.equal(approvalsBarDismissed(dismissed, ids(["p1", "p2"], ["r1"])), false);
  assert.equal(approvalsBarDismissed(dismissed, ids(["p1"], ["r1", "r2"])), false);
  assert.notEqual(approvalsDismissedKey("c1"), approvalsDismissedKey("c2"));
});
