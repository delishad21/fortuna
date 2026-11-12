import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import prisma from "../../lib/prisma";
import { requireStatementFiles } from "./statement-files";
const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};
const builtin = new Set([
  "generic_csv",
  "dbs_paylah_statement",
  "dbs_paylah_statement_new",
  "dbs_posb_consolidated",
  "dbs_posb_consolidated_legacy",
  "mari_credit_card_pdf",
  "ocbc_frank_statement",
  "revolut_statement",
  "simplygo_transit_statement",
  "uob_one_credit_card_pdf",
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
/** The parser service's own error message, safe to show the model: one line, no paths, at most 500 characters. */
export function parserServiceError(body: unknown) {
  const raw =
    body && typeof body === "object" && typeof (body as any).error === "string"
      ? (body as any).error
      : typeof body === "string"
        ? body
        : "";
  return raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/(?:\/[\w.@-]+){2,}\/?/g, "<path>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}
/** The candidate's fields as the chat tool declares them; keep in step with parserCandidateSchema. */
export const parserCandidateJsonSchema = {
  type: "object",
  properties: {
    parserId: {
      type: "string",
      pattern: "^[a-z][a-z0-9_]{2,63}$",
      description:
        "Stable lowercase ID, e.g. 'citi_rewards_card_pdf'; the same ID on every save",
    },
    parserType: {
      enum: ["python", "config"],
      description: "'python' for PDFs; 'config' for CSV column mappings",
    },
    sourceCode: {
      type: "string",
      maxLength: 100000,
      description:
        "Python only: the whole module, defining parse(content: bytes, specification: dict) -> list[dict]",
    },
    specification: {
      type: "object",
      description:
        "Settings passed to parse() and used on approval, not code: name, description, documentType ('pdf'|'csv'), mode ('bank'|'trip'), and validation { expectedCount, expectedTotalIn, expectedTotalOut, amountTolerance, expectedAccountIdentifiers } checked by the test",
    },
  },
  required: ["parserId", "parserType", "specification"],
  additionalProperties: false,
};
export const PARSER_CANDIDATE_FIELDS =
  "A candidate has exactly these fields: parserId (string, e.g. 'citi_rewards_card_pdf'), parserType ('python' or 'config'), sourceCode (string, the Python module with parse(content, specification); required for python), specification (object of settings: name, description, documentType, mode, validation). Code never goes in specification.";
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
  const text = await response.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {}
  if (response.ok && body && typeof body === "object") return body;
  const reason = parserServiceError(body);
  // 4xx means the parser service rejected what it was given (the candidate, its source or the file).
  if (response.status >= 400 && response.status < 500)
    return fail(
      422,
      `The parser service rejected ${endpoint} (HTTP ${response.status})${reason ? `: ${reason}` : ""}`,
    );
  return fail(
    502,
    `Parser sandbox could not complete this request (HTTP ${response.status})`,
  );
}
async function fileForm(userId: string, fileId: string) {
  const [file] = await requireStatementFiles(prisma, userId, [fileId]);
  const bytes = await readFile(file.storagePath);
  const form = new FormData();
  form.append(
    "file",
    new Blob([Uint8Array.from(bytes).buffer], { type: file.contentType }),
    file.filename,
  );
  return form;
}
const fileName = (form: FormData) =>
  (form.get("file") as File | null)?.name || "statement";
/** The candidate's own exception, without the HTTP wrapping, with a hint for the usual cause. */
function candidateError(message: string) {
  const reason = message.replace(
    /^The parser service rejected \S+ \(HTTP \d+\): ?/,
    "",
  );
  return `The candidate raised an error on this fixture: ${reason || "no message"}. Every statement in the workspace is tested; if this one has another layout, propose retain_fixture with only the statement IDs this parser is for: statements already kept get such a workspace at once, without re-uploading them.`;
}
export class ParserFactoryService {
  static async createWorkspace(userId: string, fileIds: string[]) {
    return prisma.$transaction(async (tx) => {
      if (!fileIds.length || fileIds.length > 10)
        return fail(400, "A workspace takes 1 to 10 statement files");
      await requireStatementFiles(tx, userId, fileIds);
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
    const fileIds = workspace.statementFileIds as string[];
    if (!fileIds.includes(fileId))
      return fail(
        404,
        `not found: ${fileId} is not a statement of this workspace; its statement file IDs are ${fileIds.join(", ")}`,
      );
    const body = await parserRequest(
      userId,
      "/candidate/inspect",
      await fileForm(userId, fileId),
    );
    if (!body.fixture) return fail(502, "Fixture inspection failed");
    return { fixture: body.fixture };
  }
  static async inspectStatement(
    userId: string,
    fileId: string,
    startPage = 1,
    endPage?: number,
  ) {
    const form = await fileForm(userId, fileId);
    form.append("startPage", String(startPage));
    if (endPage) form.append("endPage", String(endPage));
    const body = await parserRequest(userId, "/candidate/inspect", form);
    if (!body.fixture) return fail(502, "Statement inspection failed");
    return { fixture: body.fixture };
  }
  static async save(userId: string, workspaceId: string, raw: unknown) {
    await this.workspace(userId, workspaceId);
    const parsed = parserCandidateSchema.safeParse(raw);
    if (!parsed.success)
      return fail(
        400,
        `candidate is invalid: ${parsed.error.issues
          .slice(0, 6)
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ")}. ${PARSER_CANDIDATE_FIELDS}`,
      );
    const input = parsed.data;
    if (input.parserType === "python" && !input.sourceCode)
      return fail(
        400,
        `candidate.sourceCode is required for a python parser. ${PARSER_CANDIDATE_FIELDS}`,
      );
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
      try {
        const body = await parserRequest(
          userId,
          candidate.parserType === "python"
            ? "/candidate/python/test"
            : "/candidate/test",
          form,
        );
        fixtures.push({
          fileRef: fileId,
          filename: fileName(form),
          ...(body.report || { passed: false }),
        });
      } catch (error) {
        // A candidate that raises on one fixture fails that fixture, not the whole test.
        if ((error as { status?: number }).status !== 422) throw error;
        fixtures.push({
          fileRef: fileId,
          filename: fileName(form),
          passed: false,
          errors: [candidateError((error as Error).message)],
        });
      }
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
