import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatMoney,
  linkChangeView,
  previewHasChanges,
  proposalSummary,
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
