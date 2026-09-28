import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeEvents, emptyStream, changedFields } from "../../../shared/chat";
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
