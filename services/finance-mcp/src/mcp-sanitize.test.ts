import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeForMcp } from "./sanitize.js";

describe("MCP response minimization", () => {
  it("removes private fields recursively while preserving confirmation tokens", () => {
    assert.deepEqual(
      sanitizeForMcp({ userId: "user", nested: { storagePath: "/secret", commitTokenHash: "hash", confirmationToken: "needed" } }),
      { nested: { confirmationToken: "needed" } },
    );
  });
});
