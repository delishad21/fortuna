import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeToolResult } from "./sanitize";
test("tool results recursively remove storage paths and approval credentials", () => {
  assert.deepEqual(
    sanitizeToolResult({
      id: "draft",
      source: {
        storagePath: "/private/a",
        filename: "statement.pdf",
        userId: "u",
      },
      rows: [
        {
          confirmationToken: "secret",
          commitTokenHash: "hash",
          label: "Lunch",
        },
      ],
    }),
    {
      id: "draft",
      source: { filename: "statement.pdf" },
      rows: [{ label: "Lunch" }],
    },
  );
});
