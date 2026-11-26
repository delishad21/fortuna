import { Prisma } from "@prisma/client";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import prisma from "../../lib/prisma";
import { authenticatedUserId, requireAccountAuth } from "../auth/auth.middleware";
import { ImageInputSchema, runInTransaction, setImage } from "../accounts/accounts.service";
import { readImage } from "./image-store";

const sendError = (response: Response, next: NextFunction, error: unknown) => {
  if (error instanceof z.ZodError)
    return response.status(400).json({ error: error.issues.map((i) => i.message).join("; ") });
  const status = (error as { status?: number }).status;
  if (typeof status === "number") return response.status(status).json({ error: (error as Error).message });
  next(error);
};

/** GET /api/images/:id: one of the caller's images (transaction, account or card). */
export const imagesRouter = Router();

imagesRouter.get("/:imageId", requireAccountAuth([]), async (request, response, next) => {
  try {
    const found = await readImage(prisma, authenticatedUserId(request), request.params.imageId);
    if (!found) return response.status(404).json({ error: "Image not found" });
    response.set({
      "Content-Type": found.image.contentType,
      "Content-Length": String(found.bytes.length),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    });
    response.end(found.bytes);
  } catch (error) {
    sendError(response, next, error);
  }
});

/**
 * PUT /api/agent/transactions/:id/image { base64 } or { url }: attach a
 * merchant logo or receipt to a transaction. DELETE clears it.
 */
export const transactionImagesRouter = Router();

async function audit(tx: Prisma.TransactionClient, request: Request, userId: string, toolName: string, afterValue?: Prisma.InputJsonValue) {
  await tx.agentAuditEvent.create({
    data: {
      userId,
      actorType: request.apiAuth?.actorType || "api_token",
      actorId: request.apiAuth?.tokenId,
      requestId: request.header("x-request-id") || undefined,
      toolName,
      targetType: "transaction",
      targetId: request.params.id,
      ...(afterValue ? { afterValue } : {}),
    },
  });
}

transactionImagesRouter.put("/:id/image", requireAccountAuth(["transactions:write"]), async (request, response, next) => {
  try {
    const userId = authenticatedUserId(request);
    const input = ImageInputSchema.parse(request.body);
    const result = await runInTransaction(async (tx) => {
      const saved = await setImage(tx, userId, { type: "transaction", id: request.params.id }, input);
      await audit(tx, request, userId, "set_transaction_image", { imageId: saved.imageId, source: input.url ? "url" : "upload" });
      return saved;
    });
    response.json(result);
  } catch (error) {
    sendError(response, next, error);
  }
});

transactionImagesRouter.delete("/:id/image", requireAccountAuth(["transactions:write"]), async (request, response, next) => {
  try {
    const userId = authenticatedUserId(request);
    const result = await runInTransaction(async (tx) => {
      const saved = await setImage(tx, userId, { type: "transaction", id: request.params.id }, null);
      await audit(tx, request, userId, "clear_transaction_image");
      return saved;
    });
    response.json(result);
  } catch (error) {
    sendError(response, next, error);
  }
});
