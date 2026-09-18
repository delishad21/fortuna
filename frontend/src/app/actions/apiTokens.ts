"use server";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { auth } from "@/lib/actionAuth";
import { prisma } from "@/lib/db/client";
import {
  API_TOKEN_SCOPES,
  type ApiTokenScope,
  type ApiTokenSummary,
  type CreatedApiToken,
} from "@/lib/apiTokens";

function hashSecret(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function toSummary(token: {
  id: string;
  name: string;
  scopes: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}): ApiTokenSummary {
  return {
    ...token,
    expiresAt: token.expiresAt?.toISOString() ?? null,
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
    createdAt: token.createdAt.toISOString(),
  };
}

async function requireUserId() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

function normalizeScopes(scopes: string[]): ApiTokenScope[] {
  const allowed = new Set<string>(API_TOKEN_SCOPES);
  const normalized = Array.from(
    new Set(scopes.map((scope) => scope.trim()).filter((scope) => allowed.has(scope))),
  ) as ApiTokenScope[];
  if (normalized.length === 0) throw new Error("Select at least one API scope");
  if (normalized.length !== new Set(scopes.map((scope) => scope.trim()).filter(Boolean)).size) {
    throw new Error("One or more API scopes are invalid");
  }
  return normalized;
}

function expirationFromDays(expiresInDays?: number | null) {
  if (expiresInDays === null || expiresInDays === undefined) return null;
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 3650) {
    throw new Error("Token expiry must be between 1 and 3650 days");
  }
  return new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
}

export async function getApiTokens(): Promise<ApiTokenSummary[]> {
  const userId = await requireUserId();
  const tokens = await prisma.apiToken.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      scopes: true,
      expiresAt: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
  return tokens.map(toSummary);
}

export async function createApiToken(input: {
  name: string;
  scopes: string[];
  expiresInDays?: number | null;
}): Promise<CreatedApiToken> {
  const userId = await requireUserId();
  const name = input.name.trim();
  if (!name || name.length > 100) throw new Error("Token name is required and must be at most 100 characters");

  const scopes = normalizeScopes(input.scopes);
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const created = await prisma.apiToken.create({
    data: {
      id,
      userId,
      name,
      secretHash: hashSecret(secret),
      scopes,
      expiresAt: expirationFromDays(input.expiresInDays),
    },
    select: {
      id: true,
      name: true,
      scopes: true,
      expiresAt: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });

  return {
    ...toSummary(created),
    token: `pfa_${id}.${secret}`,
  };
}

export async function revokeApiToken(tokenId: string): Promise<ApiTokenSummary> {
  const userId = await requireUserId();
  const existing = await prisma.apiToken.findFirst({ where: { id: tokenId, userId } });
  if (!existing) throw new Error("API token not found");
  const updated = await prisma.apiToken.update({
    where: { id: tokenId },
    data: { revokedAt: existing.revokedAt ?? new Date() },
    select: {
      id: true,
      name: true,
      scopes: true,
      expiresAt: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
  return toSummary(updated);
}

export async function rotateApiToken(tokenId: string): Promise<CreatedApiToken> {
  const userId = await requireUserId();
  const existing = await prisma.apiToken.findFirst({ where: { id: tokenId, userId } });
  if (!existing) throw new Error("API token not found");

  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const created = await prisma.$transaction(async (tx) => {
    await tx.apiToken.update({
      where: { id: existing.id },
      data: { revokedAt: existing.revokedAt ?? new Date() },
    });
    return tx.apiToken.create({
      data: {
        id,
        userId,
        name: existing.name,
        secretHash: hashSecret(secret),
        scopes: existing.scopes,
        expiresAt: existing.expiresAt,
      },
      select: {
        id: true,
        name: true,
        scopes: true,
        expiresAt: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
  });

  return {
    ...toSummary(created),
    token: `pfa_${id}.${secret}`,
  };
}
