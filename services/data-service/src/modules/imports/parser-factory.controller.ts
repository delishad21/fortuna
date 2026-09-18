import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Router, type Response } from "express";
import { z } from "zod";
import prisma from "../../lib/prisma";
import { authenticatedUserId, requireAccountAuth } from "../auth/auth.middleware";

export const parserFactoryRouter = Router();
const PARSER_SERVICE_URL = process.env.PARSER_SERVICE_URL || "http://file-parser:4000";
const BUILTIN_PARSER_IDS = new Set([
  "generic_csv",
  "dbs_paylah_statement",
  "dbs_paylah_statement_new",
  "dbs_posb_consolidated",
  "dbs_posb_consolidated_legacy",
  "ocbc_frank_statement",
  "revolut_statement",
  "youtrip_statement",
]);

function sourceHash(parserType: string, sourceCode: string | null, specification: unknown) {
  return createHash("sha256")
    .update(parserType === "python" ? sourceCode || "" : JSON.stringify(specification))
    .digest("hex");
}

function internalHeaders(userId: string) {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!token) throw new Error("INTERNAL_SERVICE_TOKEN is required for parser sandbox calls");
  return { "X-Internal-Service-Token": token, "X-Authenticated-User-Id": userId };
}

async function recordAudit(userId: string, request: Parameters<typeof authenticatedUserId>[0], input: {
  toolName: string;
  targetType: string;
  targetId: string;
  beforeValue?: Prisma.InputJsonValue;
  afterValue?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
}) {
  await prisma.agentAuditEvent.create({
    data: {
      userId,
      actorType: request.apiAuth?.actorType || "api_token",
      actorId: request.apiAuth?.tokenId,
      ...input,
    },
  });
}

function failure(response: Response, error: unknown) {
  return response.status((error as { status?: number }).status || 400).json({ error: error instanceof Error ? error.message : "Parser factory request failed" });
}

parserFactoryRouter.post("/workspaces", requireAccountAuth(["parser:develop"]), async (request, response) => {
  try {
    const input = z.object({ statementFileIds: z.array(z.string()).min(1).max(10), fixtureConsent: z.literal(true) }).strict().parse(request.body);
    const userId = authenticatedUserId(request);
    const files = await prisma.statementFile.findMany({ where: { id: { in: input.statementFileIds }, userId, deletedAt: null } });
    if (files.length !== new Set(input.statementFileIds).size) return response.status(400).json({ error: "One or more statement files are invalid" });
    const workspace = await prisma.$transaction(async (tx) => {
      await tx.statementFile.updateMany({
        where: { id: { in: input.statementFileIds }, userId },
        data: { retained: true },
      });
      return tx.parserWorkspace.create({
        data: { userId, statementFileIds: input.statementFileIds, fixtureConsentAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      });
    });
    return response.status(201).json({ workspace });
  } catch (error) {
    return failure(response, error);
  }
});

parserFactoryRouter.get("/workspaces/:workspaceId", requireAccountAuth(["parser:develop"]), async (request, response) => {
  try {
    const workspace = await prisma.parserWorkspace.findFirst({ where: { id: request.params.workspaceId, userId: authenticatedUserId(request) }, include: { candidates: true } });
    if (!workspace) return response.status(404).json({ error: "Parser workspace not found" });
    return response.json({ workspace });
  } catch (error) {
    return failure(response, error);
  }
});

parserFactoryRouter.get("/workspaces/:workspaceId/fixtures/:fileId/inspect", requireAccountAuth(["parser:develop"]), async (request, response) => {
  try {
    const userId = authenticatedUserId(request);
    const workspace = await prisma.parserWorkspace.findFirst({
      where: { id: request.params.workspaceId, userId, fixtureConsentAt: { not: null } },
      select: { statementFileIds: true },
    });
    if (!workspace || !(workspace.statementFileIds as string[]).includes(request.params.fileId)) {
      return response.status(404).json({ error: "Consented parser fixture not found" });
    }
    const file = await prisma.statementFile.findFirst({
      where: { id: request.params.fileId, userId, deletedAt: null },
    });
    if (!file) return response.status(404).json({ error: "Parser fixture file is unavailable" });
    const bytes = await readFile(file.storagePath);
    const form = new FormData();
    form.append("file", new Blob([Uint8Array.from(bytes).buffer], { type: file.contentType }), file.filename);
    const parserResponse = await fetch(new URL("/candidate/inspect", PARSER_SERVICE_URL), {
      method: "POST",
      body: form,
      headers: internalHeaders(userId),
    });
    const body = await parserResponse.json() as { fixture?: Record<string, unknown>; error?: string };
    if (!parserResponse.ok || !body.fixture) {
      return response.status(parserResponse.status).json({ error: body.error || "Fixture inspection failed" });
    }
    return response.json({ fixture: body.fixture });
  } catch (error) {
    return failure(response, error);
  }
});

parserFactoryRouter.post("/workspaces/:workspaceId/candidates", requireAccountAuth(["parser:develop"]), async (request, response) => {
  try {
    const input = z.object({ parserId: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/), parserType: z.enum(["config", "python"]), specification: z.record(z.unknown()), sourceCode: z.string().max(100000).optional() }).strict().parse(request.body);
    const userId = authenticatedUserId(request);
    const workspace = await prisma.parserWorkspace.findFirst({ where: { id: request.params.workspaceId, userId, fixtureConsentAt: { not: null } } });
    if (!workspace) return response.status(404).json({ error: "Consented parser workspace not found" });
    if (input.parserType === "python" && !input.sourceCode) return response.status(400).json({ error: "Python candidates require sourceCode" });
    const candidate = await prisma.parserCandidate.upsert({
      where: { workspaceId_parserId: { workspaceId: workspace.id, parserId: input.parserId } },
      update: {
        parserType: input.parserType,
        specification: input.specification as any,
        sourceCode: input.sourceCode,
        status: "draft",
        testReport: Prisma.JsonNull,
        submittedAt: null,
        approvedAt: null,
        approvedByUserId: null,
      },
      create: { workspaceId: workspace.id, parserId: input.parserId, parserType: input.parserType, specification: input.specification as any, sourceCode: input.sourceCode },
    });
    return response.status(201).json({ candidate, note: input.parserType === "python" ? "Python is staged until it passes the isolated no-network sandbox and explicit approval." : undefined });
  } catch (error) {
    return failure(response, error);
  }
});

parserFactoryRouter.post("/workspaces/:workspaceId/candidates/:candidateId/test", requireAccountAuth(["parser:develop"]), async (request, response) => {
  try {
    const userId = authenticatedUserId(request);
    const workspace = await prisma.parserWorkspace.findFirst({
      where: { id: request.params.workspaceId, userId },
      include: { candidates: { where: { id: request.params.candidateId } } },
    });
    const candidate = workspace?.candidates[0];
    if (!workspace || !candidate) return response.status(404).json({ error: "Parser candidate not found" });
    const fileIds = workspace.statementFileIds as string[];
    const files = await prisma.statementFile.findMany({ where: { id: { in: fileIds }, userId, deletedAt: null } });
    const fixtureReports: Array<Record<string, unknown> & { passed?: boolean }> = [];
    for (const file of files) {
      const bytes = await readFile(file.storagePath);
      const form = new FormData();
      form.append("file", new Blob([Uint8Array.from(bytes).buffer], { type: file.contentType }), file.filename);
      form.append("specification", JSON.stringify(candidate.specification));
      if (candidate.parserType === "python") form.append("sourceCode", candidate.sourceCode || "");
      const endpoint = candidate.parserType === "python" ? "/candidate/python/test" : "/candidate/test";
      const parserResponse = await fetch(new URL(endpoint, PARSER_SERVICE_URL), {
        method: "POST",
        body: form,
        headers: internalHeaders(userId),
      });
      const body = await parserResponse.json() as { report?: Record<string, unknown>; error?: string };
      fixtureReports.push({ fileRef: file.id, ...(body.report || { passed: false }), ...(body.error ? { error: body.error } : {}) });
    }
    const report: Record<string, unknown> = {
      passed: fixtureReports.length > 0 && fixtureReports.every((item) => item.passed === true),
      sandboxed: candidate.parserType === "python",
      networkAccess: candidate.parserType === "python" ? "none" : "not_applicable",
      sourceSha256: sourceHash(candidate.parserType, candidate.sourceCode, candidate.specification),
      fixtures: fixtureReports,
    };
    const updated = await prisma.parserCandidate.update({ where: { id: candidate.id }, data: { testReport: report as any, status: report.passed ? "tested" : "test_failed" } });
    return response.json({ candidate: updated, report });
  } catch (error) {
    return failure(response, error);
  }
});

parserFactoryRouter.post("/workspaces/:workspaceId/candidates/:candidateId/submit", requireAccountAuth(["parser:develop"]), async (request, response) => {
  try {
    const candidate = await prisma.parserCandidate.findFirst({ where: { id: request.params.candidateId, workspaceId: request.params.workspaceId, workspace: { userId: authenticatedUserId(request) } } });
    if (!candidate) return response.status(404).json({ error: "Parser candidate not found" });
    if ((candidate.testReport as Record<string, unknown> | null)?.passed !== true) return response.status(409).json({ error: "Candidate must pass its configured validation suite before submission" });
    return response.json({ candidate: await prisma.parserCandidate.update({ where: { id: candidate.id }, data: { status: "submitted", submittedAt: new Date() } }) });
  } catch (error) {
    return failure(response, error);
  }
});

parserFactoryRouter.post("/workspaces/:workspaceId/candidates/:candidateId/approve", requireAccountAuth(["parser:approve"]), async (request, response) => {
  try {
    z.object({ confirmed: z.literal(true) }).strict().parse(request.body);
    const userId = authenticatedUserId(request);
    const existingVersion = await prisma.dynamicParserVersion.findUnique({ where: { candidateId: request.params.candidateId }, include: { definition: true } });
    if (existingVersion?.definition.userId === userId) return response.json({ definition: existingVersion.definition, version: existingVersion, activationRequired: existingVersion.definition.activeVersionId !== existingVersion.id });
    const candidate = await prisma.parserCandidate.findFirst({ where: { id: request.params.candidateId, workspaceId: request.params.workspaceId, workspace: { userId } } });
    if (!candidate || candidate.status !== "submitted") return response.status(409).json({ error: "Submitted parser candidate not found" });
    if (BUILTIN_PARSER_IDS.has(candidate.parserId)) return response.status(409).json({ error: "Dynamic parsers cannot replace a built-in parser ID" });
    if ((candidate.testReport as Record<string, unknown> | null)?.passed !== true) return response.status(409).json({ error: "Candidate test report is not passing" });
    const specification = candidate.specification as Record<string, unknown>;
    const result = await prisma.$transaction(async (tx) => {
      const definition = await tx.dynamicParserDefinition.upsert({
        where: { userId_parserId: { userId, parserId: candidate.parserId } },
        update: {
          name: String(specification.name || candidate.parserId),
          description: String(specification.description || "Hermes-generated statement parser"),
          fileType: String(specification.documentType || "pdf"),
          mode: String(specification.mode || "bank"),
        },
        create: {
          userId,
          parserId: candidate.parserId,
          name: String(specification.name || candidate.parserId),
          description: String(specification.description || "Hermes-generated statement parser"),
          fileType: String(specification.documentType || "pdf"),
          mode: String(specification.mode || "bank"),
        },
      });
      const latest = await tx.dynamicParserVersion.aggregate({ where: { definitionId: definition.id }, _max: { version: true } });
      const version = await tx.dynamicParserVersion.create({
        data: {
          definitionId: definition.id,
          version: (latest._max.version || 0) + 1,
          parserType: candidate.parserType,
          specification: candidate.specification as Prisma.InputJsonValue,
          sourceCode: candidate.sourceCode,
          sourceSha256: sourceHash(candidate.parserType, candidate.sourceCode, candidate.specification),
          testReport: candidate.testReport as Prisma.InputJsonValue,
          candidateId: candidate.id,
          approvedByUserId: userId,
        },
      });
      const approved = await tx.parserCandidate.update({ where: { id: candidate.id }, data: { status: "approved_inactive", approvedAt: new Date(), approvedByUserId: userId } });
      await tx.parserWorkspace.update({ where: { id: candidate.workspaceId }, data: { status: "approved" } });
      return { candidate: approved, definition, version };
    });
    await recordAudit(userId, request, {
      toolName: "approve_parser_candidate",
      targetType: "dynamic_parser_version",
      targetId: result.version.id,
      afterValue: { parserId: candidate.parserId, version: result.version.version, status: "approved_inactive", sourceSha256: result.version.sourceSha256 },
    });
    return response.json({ ...result, deploymentRequired: false, activationRequired: true });
  } catch (error) {
    return failure(response, error);
  }
});

parserFactoryRouter.get("/definitions", requireAccountAuth(["parser:develop"]), async (request, response) => {
  try {
    const definitions = await prisma.dynamicParserDefinition.findMany({
      where: { userId: authenticatedUserId(request) },
      include: { versions: { orderBy: { version: "desc" }, select: { id: true, version: true, parserType: true, sourceSha256: true, status: true, testReport: true, approvedAt: true, activatedAt: true, retiredAt: true } } },
      orderBy: { updatedAt: "desc" },
    });
    return response.json({ definitions });
  } catch (error) {
    return failure(response, error);
  }
});

parserFactoryRouter.post("/definitions/:definitionId/versions/:versionId/activate", requireAccountAuth(["parser:approve"]), async (request, response) => {
  try {
    z.object({ confirmed: z.literal(true) }).strict().parse(request.body);
    const userId = authenticatedUserId(request);
    const definition = await prisma.dynamicParserDefinition.findFirst({ where: { id: request.params.definitionId, userId }, include: { activeVersion: true, versions: { where: { id: request.params.versionId } } } });
    const target = definition?.versions[0];
    if (!definition || !target) return response.status(404).json({ error: "Parser version not found" });
    if (!(["approved", "inactive", "active"] as string[]).includes(target.status)) return response.status(409).json({ error: "Parser version is not eligible for activation" });
    const previous = definition.activeVersion;
    const activated = await prisma.$transaction(async (tx) => {
      if (previous && previous.id !== target.id) {
        await tx.dynamicParserVersion.update({ where: { id: previous.id }, data: { status: "inactive", retiredAt: new Date() } });
      }
      const version = await tx.dynamicParserVersion.update({ where: { id: target.id }, data: { status: "active", activatedAt: new Date(), retiredAt: null } });
      const next = await tx.dynamicParserDefinition.update({ where: { id: definition.id }, data: { activeVersionId: version.id }, include: { activeVersion: true } });
      if (version.candidateId) await tx.parserCandidate.updateMany({ where: { id: version.candidateId }, data: { status: "active" } });
      return next;
    });
    await recordAudit(userId, request, {
      toolName: previous ? "rollback_or_activate_parser_version" : "activate_parser_version",
      targetType: "dynamic_parser_definition",
      targetId: definition.id,
      ...(previous ? { beforeValue: { activeVersionId: previous.id, version: previous.version } } : {}),
      afterValue: { activeVersionId: target.id, version: target.version, sourceSha256: target.sourceSha256 },
    });
    return response.json({ definition: activated, previousVersion: previous ? { id: previous.id, version: previous.version } : null, activatedVersion: { id: target.id, version: target.version }, rollback: Boolean(previous && previous.id !== target.id) });
  } catch (error) {
    return failure(response, error);
  }
});
