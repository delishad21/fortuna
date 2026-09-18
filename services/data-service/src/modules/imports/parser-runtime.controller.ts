import { Router } from "express";
import prisma from "../../lib/prisma";
import { authenticatedUserId, requireAccountAuth } from "../auth/auth.middleware";

export const parserRuntimeRouter = Router();

parserRuntimeRouter.get("/definitions", requireAccountAuth(["statements:write"]), async (request, response, next) => {
  try {
    const userId = authenticatedUserId(request);
    const mode = String(request.query.mode || "bank").toLowerCase();
    const definitions = await prisma.dynamicParserDefinition.findMany({
      where: { userId, mode, activeVersionId: { not: null } },
      include: { activeVersion: { select: { version: true, parserType: true } } },
      orderBy: { name: "asc" },
    });
    return response.json({
      parsers: definitions.map((definition) => ({
        id: definition.parserId,
        name: definition.name,
        description: definition.description || `Approved account parser v${definition.activeVersion?.version}`,
        fileType: definition.fileType,
        mode: definition.mode,
        parserType: definition.activeVersion?.parserType,
        version: definition.activeVersion?.version,
        dynamic: true,
      })),
    });
  } catch (error) {
    next(error);
  }
});

parserRuntimeRouter.get("/definitions/:parserId", requireAccountAuth(["statements:write"]), async (request, response, next) => {
  try {
    const definition = await prisma.dynamicParserDefinition.findUnique({
      where: {
        userId_parserId: {
          userId: authenticatedUserId(request),
          parserId: request.params.parserId,
        },
      },
      include: { activeVersion: true },
    });
    if (!definition?.activeVersion) return response.status(404).json({ error: "Active dynamic parser not found" });
    return response.json({
      parser: {
        id: definition.parserId,
        name: definition.name,
        description: definition.description,
        fileType: definition.fileType,
        mode: definition.mode,
        activeVersion: {
          id: definition.activeVersion.id,
          version: definition.activeVersion.version,
          parserType: definition.activeVersion.parserType,
          specification: definition.activeVersion.specification,
          sourceCode: definition.activeVersion.sourceCode,
          sourceSha256: definition.activeVersion.sourceSha256,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});
