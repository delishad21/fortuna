import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { prisma } from "@/lib/db/client";
import type { Session } from "next-auth";

const hash = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");
export async function createMobileSession(userId: string) {
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 86400000);
  await prisma.apiToken.create({
    data: {
      id,
      userId,
      name: "Fortuna mobile",
      secretHash: hash(secret),
      scopes: ["mobile:session"],
      expiresAt,
    },
  });
  return { token: `fm_${id}.${secret}`, expiresAt: expiresAt.toISOString() };
}
export async function authenticateMobile(
  request: Request,
): Promise<{ session: Session; tokenId: string } | null> {
  const match = /^Bearer fm_([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/.exec(
    request.headers.get("authorization") || "",
  );
  if (!match) return null;
  const token = await prisma.apiToken.findUnique({
    where: { id: match[1] },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (
    !token ||
    token.revokedAt ||
    !token.expiresAt ||
    token.expiresAt <= new Date() ||
    !token.scopes.includes("mobile:session")
  )
    return null;
  const actual = Buffer.from(hash(match[2]), "hex");
  const expected = Buffer.from(token.secretHash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return null;
  return {
    tokenId: token.id,
    session: {
      user: { ...token.user, email: token.user.email || "" },
      expires: token.expiresAt.toISOString(),
    },
  };
}
export function mobileJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
