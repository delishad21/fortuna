import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authenticateApiToken,
  hashApiTokenSecret,
  hasRequiredScopes,
  parseApiToken,
  type ApiTokenRecord,
} from "./api-token";

const now = new Date("2026-08-28T00:00:00Z");
const secret = "a-secure-random-secret";
const activeRecord: ApiTokenRecord = {
  id: "token-id",
  userId: "user-1",
  secretHash: hashApiTokenSecret(secret),
  scopes: ["drafts:read", "classification:write"],
  expiresAt: new Date("2026-09-28T00:00:00Z"),
  revokedAt: null,
};

describe("API token authentication", () => {
  it("parses and authenticates a valid account token", async () => {
    assert.deepEqual(parseApiToken(`pfa_token-id.${secret}`), {
      id: "token-id",
      secret,
    });
    const context = await authenticateApiToken(
      `pfa_token-id.${secret}`,
      async () => activeRecord,
      now,
    );
    assert.deepEqual(context, {
      userId: "user-1",
      tokenId: "token-id",
      scopes: activeRecord.scopes,
      actorType: "api_token",
    });
  });

  it("rejects malformed, incorrect, revoked, and expired tokens", async () => {
    assert.equal(await authenticateApiToken("wrong", async () => activeRecord, now), null);
    assert.equal(
      await authenticateApiToken("pfa_token-id.wrong", async () => activeRecord, now),
      null,
    );
    assert.equal(
      await authenticateApiToken(
        `pfa_token-id.${secret}`,
        async () => ({ ...activeRecord, revokedAt: new Date("2026-08-27T00:00:00Z") }),
        now,
      ),
      null,
    );
    assert.equal(
      await authenticateApiToken(
        `pfa_token-id.${secret}`,
        async () => ({ ...activeRecord, expiresAt: now }),
        now,
      ),
      null,
    );
  });

  it("enforces all required scopes", () => {
    const context = {
      userId: "user-1",
      tokenId: "token-id",
      scopes: activeRecord.scopes,
      actorType: "api_token" as const,
    };
    assert.equal(hasRequiredScopes(context, ["drafts:read"]), true);
    assert.equal(hasRequiredScopes(context, ["drafts:read", "classification:write"]), true);
    assert.equal(hasRequiredScopes(context, ["imports:commit"]), false);
    assert.equal(hasRequiredScopes({ ...context, scopes: ["*"] }, ["imports:commit"]), true);
  });
});
