import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ParserFactoryService as factory } from "../../imports/parser-factory.service";
import { ChatError, idSchema } from "../contracts";
import {
  ActionHandler,
  PreparedAction,
  StaleAction,
  stateHash,
  json,
} from "./transactions";
export const parserActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("approve_parser"),
      workspaceId: idSchema,
      candidateId: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("activate_parser"),
      definitionId: idSchema,
      versionId: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("rollback_parser"),
      definitionId: idSchema,
      versionId: idSchema,
    })
    .strict(),
]);
export class ParserActions implements ActionHandler {
  constructor(private db: PrismaClient) {}
  private async state(
    tx: Prisma.TransactionClient,
    userId: string,
    input: z.infer<typeof parserActionSchema>,
  ) {
    if (input.kind === "approve_parser") {
      const candidate = await tx.parserCandidate.findFirst({
        where: {
          id: input.candidateId,
          workspaceId: input.workspaceId,
          workspace: { userId },
        },
      });
      if (!candidate) throw new ChatError(404, "Parser candidate not found");
      return candidate;
    }
    const definition = await tx.dynamicParserDefinition.findFirst({
      where: { id: input.definitionId, userId },
      include: { versions: { where: { id: input.versionId } } },
    });
    if (!definition?.versions.length)
      throw new ChatError(404, "Parser version not found");
    return definition;
  }
  async prepare(userId: string, raw: unknown): Promise<PreparedAction> {
    const input = parserActionSchema.parse(raw),
      state = await this.state(this.db, userId, input);
    return {
      kind: input.kind,
      arguments: json(input),
      stateHash: stateHash(state),
      preview: json({
        title:
          input.kind === "approve_parser"
            ? "Approve tested parser"
            : input.kind === "rollback_parser"
              ? "Restore previous parser version"
              : "Activate parser version",
        details: parserPreview(input.kind, state),
      }),
    };
  }
  async execute(
    tx: Prisma.TransactionClient,
    userId: string,
    raw: unknown,
    hash: string,
  ) {
    const input = parserActionSchema.parse(raw);
    if (input.kind === "approve_parser")
      await tx.$queryRaw`SELECT id FROM parser_candidates WHERE id=${input.candidateId} FOR UPDATE`;
    else
      await tx.$queryRaw`SELECT id FROM dynamic_parser_definitions WHERE id=${input.definitionId} AND user_id=${userId} FOR UPDATE`;
    if (stateHash(await this.state(tx, userId, input)) !== hash)
      throw new StaleAction("Parser or fixture changed after preview");
    if (input.kind === "approve_parser")
      return json(
        await factory.approve(userId, input.workspaceId, input.candidateId),
      );
    return json(
      await factory.activate(userId, input.definitionId, input.versionId),
    );
  }
}

const reportSummary = (report: unknown) =>
  report && typeof report === "object"
    ? Object.fromEntries(
        Object.entries(report as Record<string, unknown>).filter(
          ([, v]) =>
            v === null || ["string", "number", "boolean"].includes(typeof v),
        ),
      )
    : null;
/** What a person needs to decide on a parser action; never source code or specifications. */
function parserPreview(kind: string, state: any) {
  if (kind === "approve_parser")
    return {
      parserId: state.parserId,
      parserType: state.parserType,
      status: state.status,
      testReport: reportSummary(state.testReport),
    };
  const version = state.versions[0];
  return {
    name: state.name,
    parserId: state.parserId,
    fileType: state.fileType,
    version: version.version,
    versionStatus: version.status,
    currentlyActive: state.activeVersionId === version.id,
    testReport: reportSummary(version.testReport),
  };
}
