import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCommitToken, verifyCommitToken } from "./commit-token";

const secret = "a-development-secret-that-is-at-least-32-characters";
const payload = {
  userId: "user-1",
  draftId: "draft-1",
  draftVersion: 4,
  validationHash: "hash",
  expiresAt: "2026-08-28T00:10:00.000Z",
  nonce: "nonce",
};

describe("commit confirmation tokens", () => {
  it("round-trips signed payloads", () => {
    const token = createCommitToken(payload, secret);
    assert.deepEqual(verifyCommitToken(token, secret, new Date("2026-08-28T00:00:00Z")), payload);
  });

  it("rejects tampering, expiry, and weak secrets", () => {
    const token = createCommitToken(payload, secret);
    assert.equal(verifyCommitToken(`${token}x`, secret, new Date("2026-08-28T00:00:00Z")), null);
    assert.equal(verifyCommitToken(token, secret, new Date(payload.expiresAt)), null);
    assert.throws(() => createCommitToken(payload, "weak"));
  });
});
