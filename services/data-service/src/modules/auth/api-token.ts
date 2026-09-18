import { createHash, timingSafeEqual } from "node:crypto";

export const API_TOKEN_PREFIX = "pfa_";

export interface ApiTokenRecord {
  id: string;
  userId: string;
  secretHash: string;
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export interface ApiAuthContext {
  userId: string;
  tokenId: string;
  scopes: string[];
  actorType: "api_token" | "trusted_service";
}

export type ApiTokenLookup = (id: string) => Promise<ApiTokenRecord | null>;

export function hashApiTokenSecret(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function parseApiToken(rawToken: string) {
  if (!rawToken.startsWith(API_TOKEN_PREFIX)) return null;
  const separatorIndex = rawToken.indexOf(".");
  if (separatorIndex <= API_TOKEN_PREFIX.length || separatorIndex === rawToken.length - 1) {
    return null;
  }
  return {
    id: rawToken.slice(API_TOKEN_PREFIX.length, separatorIndex),
    secret: rawToken.slice(separatorIndex + 1),
  };
}

function hashesEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return (
    actualBuffer.length === expectedBuffer.length &&
    actualBuffer.length > 0 &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export async function authenticateApiToken(
  rawToken: string,
  lookup: ApiTokenLookup,
  now = new Date(),
): Promise<ApiAuthContext | null> {
  const parsed = parseApiToken(rawToken);
  if (!parsed) return null;

  const record = await lookup(parsed.id);
  if (!record || record.revokedAt || (record.expiresAt && record.expiresAt <= now)) {
    return null;
  }

  if (!hashesEqual(hashApiTokenSecret(parsed.secret), record.secretHash)) return null;

  return {
    userId: record.userId,
    tokenId: record.id,
    scopes: record.scopes,
    actorType: "api_token",
  };
}

export function hasRequiredScopes(context: ApiAuthContext, requiredScopes: string[]) {
  const granted = new Set(context.scopes);
  return granted.has("*") || requiredScopes.every((scope) => granted.has(scope));
}
