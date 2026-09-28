import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import prisma from "../../lib/prisma";
const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};
const builtin = new Set([
  "generic_csv",
  "dbs_paylah_statement",
  "dbs_paylah_statement_new",
  "dbs_posb_consolidated",
  "dbs_posb_consolidated_legacy",
  "ocbc_frank_statement",
  "revolut_statement",
  "youtrip_statement",
]);
export const parserSourceHash = (
  type: string,
  source: string | null,
  spec: unknown,
) =>
  createHash("sha256")
    .update(type === "python" ? source || "" : JSON.stringify(spec))
    .digest("hex");
export const parserCandidateSchema = z
  .object({
    parserId: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
    parserType: z.enum(["config", "python"]),
    specification: z.record(z.unknown()),
    sourceCode: z.string().max(100000).optional(),
  })
  .strict();
async function parserRequest(userId: string, endpoint: string, form: FormData) {
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!token) return fail(503, "Parser sandbox is not configured");
  const response = await fetch(
    new URL(
      endpoint,
      process.env.PARSER_SERVICE_URL || "http://file-parser:4000",
    ),
    {
      method: "POST",
      body: form,
      headers: {
        "X-Internal-Service-Token": token,
        "X-Authenticated-User-Id": userId,
      },
      signal: AbortSignal.timeout(180000),
    },
  );
  const body = (await response.json()) as any;
  if (!response.ok)
    return fail(502, "Parser sandbox could not complete this request");
  return body;
}
async function fileForm(userId: string, fileId: string) {
  const file = await prisma.statementFile.findFirst({
    where: { id: fileId, userId, deletedAt: null },
  });
  if (!file || (!file.retained && file.expiresAt <= new Date()))
    return fail(404, "Statement is unavailable or expired. Upload it again.");
  const bytes = await readFile(file.storagePath);
  const form = new FormData();
  form.append(
    "file",
    new Blob([Uint8Array.from(bytes).buffer], { type: file.contentType }),
    file.filename,
  );
  return form;
}
export class ParserFactoryService {
  static async createWorkspace(userId: string, fileIds: string[]) {
    return prisma.$transaction(async (tx) => {
      const files = await tx.statementFile.findMany({
        where: {
          id: { in: fileIds },
          userId,
          deletedAt: null,
          OR: [{ retained: true }, { expiresAt: { gt: new Date() } }],
        },
      });
      if (
        !fileIds.length ||
        fileIds.length > 10 ||
        files.length !== new Set(fileIds).size
      )
        return fail(404, "One or more statements are unavailable or expired");
      await tx.statementFile.updateMany({
        where: { id: { in: fileIds }, userId },
        data: { retained: true },
      });
      return tx.parserWorkspace.create({
        data: {
          userId,
          statementFileIds: fileIds,
          fixtureConsentAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
      });
    });
  }
  static async workspace(userId: string, id: string) {
    const workspace = await prisma.parserWorkspace.findFirst({
      where: {
        id,
        userId,
        fixtureConsentAt: { not: null },
        expiresAt: { gt: new Date() },
      },
      include: { candidates: true },
    });
    if (!workspace)
      return fail(404, "Consented parser workspace is unavailable or expired");
    return workspace;
  }
  static async inspect(userId: string, workspaceId: string, fileId: string) {
    const workspace = await this.workspace(userId, workspaceId);
    if (!(workspace.statementFileIds as string[]).includes(fileId))
      return fail(404, "Fixture not found");
    const body = await parserRequest(
      userId,
      "/candidate/inspect",
      await fileForm(userId, fileId),
    );
    if (!body.fixture) return fail(502, "Fixture inspection failed");
    return { fixture: body.fixture };
  }
  static async inspectStatement(userId: string, fileId: string) {
    const body = await parserRequest(
      userId,
      "/candidate/inspect",
      await fileForm(userId, fileId),
    );
    if (!body.fixture) return fail(502, "Statement inspection failed");
    return { fixture: body.fixture };
  }
  static async save(userId: string, workspaceId: string, raw: unknown) {
    await this.workspace(userId, workspaceId);
    const input = parserCandidateSchema.parse(raw);
    if (input.parserType === "python" && !input.sourceCode)
      return fail(400, "Python source is required");
    const previous = await prisma.parserCandidate.findUnique({
      where: {
        workspaceId_parserId: { workspaceId, parserId: input.parserId },
      },
    });
    if (
      previous &&
      (await prisma.dynamicParserVersion.findUnique({
        where: { candidateId: previous.id },
      }))
    )
      return fail(
        409,
        "This candidate is already versioned. Start a new workspace to create another version.",
      );
    return prisma.parserCandidate.upsert({
      where: {
        workspaceId_parserId: { workspaceId, parserId: input.parserId },
      },
      create: {
        workspaceId,
        ...input,
        specification: input.specification as Prisma.InputJsonValue,
      },
      update: {
        ...input,
        specification: input.specification as Prisma.InputJsonValue,
        status: "draft",
        testReport: Prisma.JsonNull,
        submittedAt: null,
        approvedAt: null,
        approvedByUserId: null,
      },
    });
  }
  static async test(userId: string, workspaceId: string, candidateId: string) {
    const workspace = await this.workspace(userId, workspaceId);
    const candidate = workspace.candidates.find((c) => c.id === candidateId);
    if (!candidate) return fail(404, "Candidate not found");
    const fingerprint = parserSourceHash(
      candidate.parserType,
      candidate.sourceCode,
      candidate.specification,
    );
    const fixtures = [];
    for (const fileId of workspace.statementFileIds as string[]) {
      const form = await fileForm(userId, fileId);
      form.append("specification", JSON.stringify(candidate.specification));
      if (candidate.parserType === "python")
        form.append("sourceCode", candidate.sourceCode || "");
      const body = await parserRequest(
        userId,
        candidate.parserType === "python"
          ? "/candidate/python/test"
          : "/candidate/test",
        form,
      );
      fixtures.push({ fileRef: fileId, ...(body.report || { passed: false }) });
    }
    const report = {
      passed: fixtures.length > 0 && fixtures.every((f) => f.passed === true),
      sandboxed: candidate.parserType === "python",
      networkAccess:
        candidate.parserType === "python" ? "none" : "not_applicable",
      sourceSha256: fingerprint,
      fixtures,
    };
    const changed = await prisma.parserCandidate.updateMany({
      where: { id: candidateId, updatedAt: candidate.updatedAt },
      data: {
        testReport: report,
        status: report.passed ? "tested" : "test_failed",
      },
    });
    if (!changed.count)
      return fail(
        409,
        "Candidate source changed during testing. Run the tests again.",
      );
    return {
      candidate: await prisma.parserCandidate.findUnique({
        where: { id: candidateId },
      }),
      report,
    };
  }
  static async submit(
    userId: string,
    workspaceId: string,
    candidateId: string,
  ) {
    const workspace = await this.workspace(userId, workspaceId);
    const candidate = workspace.candidates.find((c) => c.id === candidateId);
    if (!candidate || (candidate.testReport as any)?.passed !== true)
      return fail(409, "Candidate must pass sandbox testing");
    if (
      (candidate.testReport as any)?.sourceSha256 !==
      parserSourceHash(
        candidate.parserType,
        candidate.sourceCode,
        candidate.specification,
      )
    )
      return fail(409, "Tested source changed");
    return prisma.parserCandidate.update({
      where: { id: candidateId },
      data: { status: "submitted", submittedAt: new Date() },
    });
  }
  static async approve(
    userId: string,
    workspaceId: string,
    candidateId: string,
  ) {
    const workspace = await this.workspace(userId, workspaceId);
    const candidate = workspace.candidates.find((c) => c.id === candidateId);
    if (!candidate) return fail(404, "Candidate not found");
    const hash = parserSourceHash(
      candidate.parserType,
      candidate.sourceCode,
      candidate.specification,
    );
    if (
      (candidate.testReport as any)?.passed !== true ||
      (candidate.testReport as any)?.sourceSha256 !== hash
    )
      return fail(
        409,
        "Candidate source does not match a passing sandbox report",
      );
    const existing = await prisma.dynamicParserVersion.findUnique({
      where: { candidateId },
      include: { definition: true },
    });
    if (existing) {
      if (
        existing.definition.userId !== userId ||
        existing.sourceSha256 !== hash
      )
        return fail(409, "Candidate changed after approval");
      return {
        definition: existing.definition,
        version: existing,
        activationRequired: existing.definition.activeVersionId !== existing.id,
      };
    }
    if (candidate.status !== "submitted")
      return fail(409, "Submit the tested candidate for approval first");
    if (builtin.has(candidate.parserId))
      return fail(409, "Cannot replace a built-in parser");
    const spec = candidate.specification as any;
    return prisma.$transaction(async (tx) => {
      const values = {
        name: String(spec.name || candidate.parserId),
        description: String(spec.description || "Fortuna statement parser"),
        fileType: String(spec.documentType || "pdf"),
        mode: String(spec.mode || "bank"),
      };
      const definition = await tx.dynamicParserDefinition.upsert({
        where: { userId_parserId: { userId, parserId: candidate.parserId } },
        create: { userId, parserId: candidate.parserId, ...values },
        update: values,
      });
      const latest = await tx.dynamicParserVersion.aggregate({
        where: { definitionId: definition.id },
        _max: { version: true },
      });
      const version = await tx.dynamicParserVersion.create({
        data: {
          definitionId: definition.id,
          version: (latest._max.version || 0) + 1,
          parserType: candidate.parserType,
          specification: candidate.specification as Prisma.InputJsonValue,
          sourceCode: candidate.sourceCode,
          sourceSha256: hash,
          testReport: candidate.testReport as Prisma.InputJsonValue,
          candidateId,
          approvedByUserId: userId,
        },
      });
      await tx.parserCandidate.update({
        where: { id: candidateId },
        data: {
          status: "approved_inactive",
          approvedAt: new Date(),
          approvedByUserId: userId,
        },
      });
      await tx.parserWorkspace.update({
        where: { id: workspaceId },
        data: { status: "approved" },
      });
      return { definition, version, activationRequired: true };
    });
  }
  static async activate(
    userId: string,
    definitionId: string,
    versionId: string,
  ) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM dynamic_parser_definitions WHERE id=${definitionId} AND user_id=${userId} FOR UPDATE`;
      const definition = await tx.dynamicParserDefinition.findFirst({
        where: { id: definitionId, userId },
        include: {
          activeVersion: true,
          versions: { where: { id: versionId } },
        },
      });
      const target = definition?.versions[0];
      if (!definition || !target) return fail(404, "Parser version not found");
      if (!["approved", "inactive", "active"].includes(target.status))
        return fail(409, "Version is not approved");
      const previous = definition.activeVersion;
      if (previous && previous.id !== target.id)
        await tx.dynamicParserVersion.update({
          where: { id: previous.id },
          data: { status: "inactive", retiredAt: new Date() },
        });
      await tx.dynamicParserVersion.update({
        where: { id: target.id },
        data: { status: "active", activatedAt: new Date(), retiredAt: null },
      });
      const updated = await tx.dynamicParserDefinition.update({
        where: { id: definition.id },
        data: { activeVersionId: target.id },
        include: { activeVersion: true },
      });
      if (target.candidateId)
        await tx.parserCandidate.updateMany({
          where: { id: target.candidateId },
          data: { status: "active" },
        });
      return {
        definition: updated,
        previousVersion: previous
          ? { id: previous.id, version: previous.version }
          : null,
        activatedVersion: { id: target.id, version: target.version },
        rollback: !!previous && previous.id !== target.id,
      };
    });
  }
  static definitions(userId: string) {
    return prisma.dynamicParserDefinition.findMany({
      where: { userId },
      include: {
        versions: {
          orderBy: { version: "desc" },
          select: {
            id: true,
            version: true,
            status: true,
            sourceSha256: true,
            testReport: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
  }
}
