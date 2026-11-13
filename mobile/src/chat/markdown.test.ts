import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseMarkdown } from "./markdown.ts";

test("bold and code drop their markers", () => {
  assert.deepEqual(parseInline("Total **S$144.27 SGD** for `card_1`"), [
    { type: "text", text: "Total " },
    { type: "bold", text: "S$144.27 SGD" },
    { type: "text", text: " for " },
    { type: "code", text: "card_1" },
  ]);
  assert.deepEqual(parseInline("**October 1–31, 2026**"), [
    { type: "bold", text: "October 1–31, 2026" },
  ]);
});

test("masked card numbers and snake_case ids stay literal", () => {
  for (const text of [
    "Card 4265-****-****-4591 was charged",
    "****-****-****-1234 and ****-****-****-5678",
    "use snake_case_id here",
  ])
    assert.deepEqual(parseInline(text), [{ type: "text", text }]);
});

test("headings, lists and paragraphs", () => {
  assert.deepEqual(
    parseMarkdown(
      "## Summary\nFirst line\nsecond line\n\n- one\n* **two**\n\n1. a\n2) b",
    ),
    [
      { type: "heading", spans: [{ type: "text", text: "Summary" }] },
      {
        type: "paragraph",
        lines: [
          [{ type: "text", text: "First line" }],
          [{ type: "text", text: "second line" }],
        ],
      },
      {
        type: "list",
        ordered: false,
        items: [
          [{ type: "text", text: "one" }],
          [{ type: "bold", text: "two" }],
        ],
      },
      {
        type: "list",
        ordered: true,
        items: [[{ type: "text", text: "a" }], [{ type: "text", text: "b" }]],
      },
    ],
  );
});
