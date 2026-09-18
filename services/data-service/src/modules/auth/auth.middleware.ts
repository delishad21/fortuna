import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import prisma from "../../lib/prisma";
import {
  authenticateApiToken,
  hasRequiredScopes,
  type ApiAuthContext,
} from "./api-token";

declare global {
  namespace Express {
    interface Request {
      apiAuth?: ApiAuthContext;
    }
  }
}

function bearerToken(request: Request) {
  const header = request.header("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

async function lookupToken(id: string) {
  return prisma.apiToken.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      secretHash: true,
      scopes: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
}

export function requireApiToken(requiredScopes: string[] = []) {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const token = bearerToken(request);
      if (!token) return response.status(401).json({ error: "API token required" });

      const context = await authenticateApiToken(token, lookupToken);
      if (!context) return response.status(401).json({ error: "Invalid or expired API token" });
      if (!hasRequiredScopes(context, requiredScopes)) {
        return response.status(403).json({
          error: "API token does not grant the required scope",
          requiredScopes,
        });
      }

      request.apiAuth = context;
      const cutoff = new Date(Date.now() - 5 * 60 * 1000);
      void prisma.apiToken.updateMany({
        where: {
          id: context.tokenId,
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: cutoff } }],
        },
        data: { lastUsedAt: new Date() },
      }).catch((error) => console.error("Failed to update API token usage:", error));
      next();
    } catch (error) {
      next(error);
    }
  };
}

function trustedServiceMatches(request: Request) {
  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  const supplied = request.header("x-internal-service-token");
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function requireAccountAuth(requiredScopes: string[] = []) {
  const tokenMiddleware = requireApiToken(requiredScopes);
  return async (request: Request, response: Response, next: NextFunction) => {
    if (trustedServiceMatches(request)) {
      const userId = request.header("x-authenticated-user-id")?.trim();
      if (!userId) return response.status(401).json({ error: "Authenticated user assertion is required" });
      request.apiAuth = {
        userId,
        tokenId: "internal-frontend",
        scopes: ["*"],
        actorType: "trusted_service",
      };
      next();
      return;
    }
    return tokenMiddleware(request, response, next);
  };
}

export function authenticatedUserId(request: Request) {
  if (!request.apiAuth) throw new Error("API authentication context is missing");
  return request.apiAuth.userId;
}
