import { Router, Request, Response } from "express";
import { z } from "zod";
import prisma from "../../lib/prisma";
import {
  authenticatedUserId,
  requireAccountAuth,
} from "../auth/auth.middleware";
import { ParserFactoryService as factory } from "./parser-factory.service";
export const parserFactoryRouter = Router();
const route =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (error) {
      res
        .status((error as { status?: number }).status || 400)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "Parser factory request failed",
        });
    }
  };
parserFactoryRouter.post(
  "/workspaces",
  requireAccountAuth(["parser:develop"]),
  route(async (req, res) => {
    const input = z
      .object({
        statementFileIds: z.array(z.string()).min(1).max(10),
        fixtureConsent: z.literal(true),
      })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json({
        workspace: await factory.createWorkspace(
          authenticatedUserId(req),
          input.statementFileIds,
        ),
      });
  }),
);
parserFactoryRouter.get(
  "/workspaces/:workspaceId",
  requireAccountAuth(["parser:develop"]),
  route(async (req, res) =>
    res.json({
      workspace: await factory.workspace(
        authenticatedUserId(req),
        req.params.workspaceId,
      ),
    }),
  ),
);
parserFactoryRouter.get(
  "/workspaces/:workspaceId/fixtures/:fileId/inspect",
  requireAccountAuth(["parser:develop"]),
  route(async (req, res) =>
    res.json(
      await factory.inspect(
        authenticatedUserId(req),
        req.params.workspaceId,
        req.params.fileId,
      ),
    ),
  ),
);
parserFactoryRouter.post(
  "/workspaces/:workspaceId/candidates",
  requireAccountAuth(["parser:develop"]),
  route(async (req, res) =>
    res
      .status(201)
      .json({
        candidate: await factory.save(
          authenticatedUserId(req),
          req.params.workspaceId,
          req.body,
        ),
      }),
  ),
);
parserFactoryRouter.post(
  "/workspaces/:workspaceId/candidates/:candidateId/test",
  requireAccountAuth(["parser:develop"]),
  route(async (req, res) =>
    res.json(
      await factory.test(
        authenticatedUserId(req),
        req.params.workspaceId,
        req.params.candidateId,
      ),
    ),
  ),
);
parserFactoryRouter.post(
  "/workspaces/:workspaceId/candidates/:candidateId/submit",
  requireAccountAuth(["parser:develop"]),
  route(async (req, res) =>
    res.json({
      candidate: await factory.submit(
        authenticatedUserId(req),
        req.params.workspaceId,
        req.params.candidateId,
      ),
    }),
  ),
);
parserFactoryRouter.post(
  "/workspaces/:workspaceId/candidates/:candidateId/approve",
  requireAccountAuth(["parser:approve"]),
  route(async (req, res) => {
    z.object({ confirmed: z.literal(true) })
      .strict()
      .parse(req.body);
    const userId = authenticatedUserId(req),
      result = await factory.approve(
        userId,
        req.params.workspaceId,
        req.params.candidateId,
      );
    await prisma.agentAuditEvent.create({
      data: {
        userId,
        actorType: req.apiAuth?.actorType || "api_token",
        actorId: req.apiAuth?.tokenId,
        toolName: "approve_parser_candidate",
        targetType: "dynamic_parser_version",
        targetId: result.version.id,
        afterValue: {
          version: result.version.version,
          sourceSha256: result.version.sourceSha256,
        },
      },
    });
    res.json({ ...result, deploymentRequired: false });
  }),
);
parserFactoryRouter.get(
  "/definitions",
  requireAccountAuth(["parser:develop"]),
  route(async (req, res) =>
    res.json({
      definitions: await factory.definitions(authenticatedUserId(req)),
    }),
  ),
);
parserFactoryRouter.post(
  "/definitions/:definitionId/versions/:versionId/activate",
  requireAccountAuth(["parser:approve"]),
  route(async (req, res) => {
    z.object({ confirmed: z.literal(true) })
      .strict()
      .parse(req.body);
    const userId = authenticatedUserId(req),
      result = await factory.activate(
        userId,
        req.params.definitionId,
        req.params.versionId,
      );
    await prisma.agentAuditEvent.create({
      data: {
        userId,
        actorType: req.apiAuth?.actorType || "api_token",
        actorId: req.apiAuth?.tokenId,
        toolName: "activate_parser_version",
        targetType: "dynamic_parser_definition",
        targetId: req.params.definitionId,
        afterValue: { activeVersionId: result.activatedVersion.id },
        beforeValue: { activeVersionId: result.previousVersion?.id || null },
      },
    });
    res.json(result);
  }),
);
