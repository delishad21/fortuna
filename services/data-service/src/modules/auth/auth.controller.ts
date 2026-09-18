import { Router } from "express";
import prisma from "../../lib/prisma";
import { authenticatedUserId, requireApiToken } from "./auth.middleware";

export const apiAuthRouter = Router();

apiAuthRouter.get("/whoami", requireApiToken(), async (request, response) => {
  try {
    const userId = authenticatedUserId(request);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, name: true },
    });
    if (!user) return response.status(401).json({ error: "Token account no longer exists" });
    return response.json({
      user,
      token: {
        id: request.apiAuth!.tokenId,
        scopes: request.apiAuth!.scopes,
      },
    });
  } catch (error) {
    console.error("Failed to resolve API token identity:", error);
    return response.status(500).json({ error: "Failed to resolve API token identity" });
  }
});
