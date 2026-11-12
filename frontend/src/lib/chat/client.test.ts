import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeEvents,
  emptyStream,
  changedFields,
  applyRunEvents,
  QUEUED_TEXT,
  workingOn,
  queueItems,
  queuedCount,
  queuedFiles,
  changedWhileQueued,
  REVIEW_STATES,
  Conversation,
} from "../../../shared/chat";
test("replayed and unordered events render once in sequence; reset discards interrupted text", () => {
  const events = [
    { sequence: 2, payload: { type: "text_delta", text: "world" } },
    { sequence: 1, payload: { type: "text_delta", text: "Hello " } },
    { sequence: 2, payload: { type: "text_delta", text: "world" } },
  ];
  const first = mergeEvents(emptyStream(), events);
  assert.equal(first.text, "Hello world");
  assert.equal(first.cursor, 2);
  assert.equal(mergeEvents(first, events).text, "Hello world");
  assert.equal(
    mergeEvents(first, [
      { sequence: 3, payload: { type: "reset" } },
      { sequence: 4, payload: { type: "text_delta", text: "Resumed" } },
    ]).text,
    "Resumed",
  );
});
test("approval diff includes removals and changes without hiding null values", () => {
  assert.deepEqual(
    changedFields(
      { label: "Old", amountIn: "10", amountOut: null },
      { label: "New", amountIn: null, amountOut: "10" },
    ),
    ["label", "amountIn", "amountOut"],
  );
});
test("a poll says when a run waits behind another conversation, and clears it once it starts", () => {
  const waiting = applyRunEvents(emptyStream(), { events: [], queued: true });
  assert.equal(waiting.queued, true);
  assert.equal(QUEUED_TEXT, "Queued: waiting for another chat to finish");
  const started = applyRunEvents(waiting, {
    events: [{ sequence: 1, payload: { type: "text_delta", text: "Hi" } }],
    queued: false,
  });
  assert.equal(started.queued, false);
  assert.equal(started.text, "Hi");
  assert.equal(workingOn(started), "Writing a reply");
});
test("queued messages are numbered in order; failed ones say they weren't sent", () => {
  const item = (id: string, extra: object = {}) => ({
    id,
    kind: "message",
    text: id,
    attachmentIds: [] as string[],
    reviewId: null,
    reviewTitle: null,
    status: "queued",
    error: null,
    ...extra,
  });
  const conversation: Conversation = {
    id: "c1",
    title: "Chat",
    messages: [],
    runs: [],
    attachments: [
      {
        id: "att1",
        statementFile: {
          filename: "DBS Oct.pdf",
          expiresAt: "2099-01-01",
          deletedAt: null,
        },
      },
    ],
    queue: [
      item("a"),
      item("b", { status: "failed", error: "Not sent: DBS Oct.pdf expired" }),
      item("c", { attachmentIds: ["att1"] }),
      item("d", { kind: "continuation", text: "" }),
    ],
  };
  assert.deepEqual(
    queueItems(conversation).map((q) => [q.marker, q.editable]),
    [
      ["Queued (1)", true],
      ["Not sent", true],
      ["Queued (2)", true],
      ["Queued (3) · Fortuna continues after your approval", false],
    ],
  );
  assert.equal(queuedCount(conversation), 3);
  assert.deepEqual(queuedFiles(conversation, conversation.queue![2]), [
    { id: "att1", filename: "DBS Oct.pdf" },
  ]);
  assert.equal(REVIEW_STATES.queued, "Queued: sends after the current reply");
});
test("a sent review lists the rows that changed while it waited", () => {
  assert.deepEqual(changedWhileQueued({ rows: [] }), []);
  assert.deepEqual(
    changedWhileQueued({
      changedSinceQueued: [
        { rowId: "r1", description: "Kopi", reason: "no longer staged" },
      ],
    }).map((c) => c.description),
    ["Kopi"],
  );
});
