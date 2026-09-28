import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { withDatabase } from "../../../lib/database-context";
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
      kind: z.literal("retain_fixture"),
      statementFileIds: z.array(idSchema).min(1).max(10),
    })
    .strict(),
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
    if (input.kind === "retain_fixture") {
      const files = await tx.statementFile.findMany({
        where: { id: { in: input.statementFileIds }, userId, deletedAt: null },
        orderBy: { id: "asc" },
        select: {
          id: true,
          filename: true,
          sha256: true,
          expiresAt: true,
          retained: true,
        },
      });
      if (
        files.length !== new Set(input.statementFileIds).size ||
        files.some((f) => !f.retained && f.expiresAt <= new Date())
      )
        throw new ChatError(404, "Statement is unavailable or expired");
      return files;
    }
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
          input.kind === "retain_fixture"
            ? "Retain statements as parser fixtures"
            : input.kind === "approve_parser"
              ? "Approve tested parser"
              : input.kind === "rollback_parser"
                ? "Restore previous parser version"
                : "Activate parser version",
        details: state,
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
    if (input.kind === "retain_fixture")
      await tx.$queryRaw`SELECT id FROM statement_files WHERE user_id=${userId} AND id IN (${Prisma.join(input.statementFileIds)}) ORDER BY id FOR UPDATE`;
    else if (input.kind === "approve_parser")
      await tx.$queryRaw`SELECT id FROM parser_candidates WHERE id=${input.candidateId} FOR UPDATE`;
    else
      await tx.$queryRaw`SELECT id FROM dynamic_parser_definitions WHERE id=${input.definitionId} AND user_id=${userId} FOR UPDATE`;
    if (stateHash(await this.state(tx, userId, input)) !== hash)
      throw new StaleAction("Parser or fixture changed after preview");
    if (input.kind === "retain_fixture")
      return json(
        await factory.createWorkspace(userId, input.statementFileIds),
      );
    if (input.kind === "approve_parser")
      return json(
        await factory.approve(userId, input.workspaceId, input.candidateId),
      );
    return json(
      await factory.activate(userId, input.definitionId, input.versionId),
    );
  }
}
