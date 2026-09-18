import { createHmac, timingSafeEqual } from "node:crypto";

export interface CommitTokenPayload {
  userId: string;
  draftId: string;
  draftVersion: number;
  validationHash: string;
  expiresAt: string;
  nonce: string;
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createCommitToken(payload: CommitTokenPayload, secret: string) {
  if (secret.length < 32) throw new Error("COMMIT_TOKEN_SECRET must contain at least 32 characters");
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifyCommitToken(token: string, secret: string, now = new Date()) {
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra) return null;
  const expected = Buffer.from(signature(encoded, secret));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as CommitTokenPayload;
    if (!payload.userId || !payload.draftId || !payload.validationHash || !payload.nonce) return null;
    if (!Number.isInteger(payload.draftVersion) || new Date(payload.expiresAt) <= now) return null;
    return payload;
  } catch {
    return null;
  }
}
