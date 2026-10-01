import { IMAGE_NOT_STATEMENT, isImageType } from "../media";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ChatContext, ChatError, idSchema } from "../contracts";
import { ParserFactoryService as factory } from "../../imports/parser-factory.service";
import { ToolDefinition } from "../providers/provider";
import { ImportTools } from "./imports";
import { json } from "./transactions";
const str = { type: "string" },
  obj = (properties: Record<string, unknown>, required: string[] = []) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false,
  });
export const workflowDefinitions: ToolDefinition[] = [
  {
    name: "list_staged_imports",
    description:
      "List existing staged statements needing review; do not recreate them.",
    inputSchema: obj({}),
  },
  {
    name: "inspect_staged_import",
    description:
      "Read the draft rows, suggestions and rationale. Rows include their version for labelling proposals.",
    inputSchema: obj({ draftId: str }, ["draftId"]),
  },
  {
    name: "inspect_statement",
    description:
      "Read uploaded statement text without retaining it as a parser fixture.",
    inputSchema: obj({ attachmentId: str }, ["attachmentId"]),
  },
  {
    name: "list_parsers",
    description: "List available built-in and active user parsers.",
    inputSchema: obj({}),
  },
  {
    name: "stage_statement",
    description:
      "Parse an uploaded statement using an existing parser, apply fixed rules, and create a persisted draft. Existing drafts are reused.",
    inputSchema: obj(
      {
        attachmentId: str,
        parserId: str,
        mode: { enum: ["main", "trip"] },
        targetTripId: str,
      },
      ["attachmentId", "parserId"],
    ),
  },
  {
    name: "assign_draft_account",
    description:
      "Assign a known bank account to staged rows using the current draft version.",
    inputSchema: obj(
      {
        draftId: str,
        expectedVersion: { type: "integer" },
        accountIdentifier: str,
        selectedOnly: { type: "boolean" },
      },
      ["draftId", "expectedVersion", "accountIdentifier"],
    ),
  },
  {
    name: "suggest_draft_labels",
    description:
      "Propose labels and categories with confidence and a reason. Fixed rules remain authoritative. Never approve high-impact proposals yourself.",
    inputSchema: obj(
      {
        draftId: str,
        inputVersion: { type: "integer" },
        proposals: {
          type: "array",
          maxItems: 100,
          items: obj(
            {
              draftRowId: str,
              inputRowVersion: { type: "integer" },
              proposedLabel: { type: ["string", "null"] },
              proposedCategoryId: { type: ["string", "null"] },
              confidence: { type: "number" },
              reason: str,
              idempotencyKey: str,
            },
            [
              "draftRowId",
              "inputRowVersion",
              "confidence",
              "reason",
              "idempotencyKey",
            ],
          ),
        },
      },
      ["draftId", "inputVersion", "proposals"],
    ),
  },
  {
    name: "parser_step",
    description:
      "Develop a parser in an approved fixture workspace. Operations: guide, inspect, save, test, submit, definitions. Source entrypoint parse(content: bytes, specification: dict) returns a transaction list. Retaining fixtures and approval/activation require propose_action.",
    inputSchema: obj(
      {
        operation: {
          enum: ["guide", "inspect", "save", "test", "submit", "definitions"],
        },
        workspaceId: str,
        candidateId: str,
        fileId: str,
        candidate: { type: "object" },
      },
      ["operation"],
    ),
  },
  {
    name: "propose_action",
    description:
      "Create a human approval preview. Allowed kinds: commit_drafts (draftIds); retain_fixture (statementFileIds); approve_parser (workspaceId,candidateId); activate_parser or rollback_parser (definitionId,versionId); create_account (accountIdentifier,color); create_category (name,color,icon); update_import_rule (optional ruleId, name, parserId, matchType, matchValue, markInternal, setLabel, setCategoryName). This never approves or executes the change.",
    inputSchema: obj(
      {
        action: {
          type: "object",
          properties: {
            kind: {
              enum: [
                "commit_drafts",
                "retain_fixture",
                "approve_parser",
                "activate_parser",
                "rollback_parser",
                "create_account",
                "create_category",
                "update_import_rule",
              ],
            },
          },
          required: ["kind"],
        },
      },
      ["action"],
    ),
  },
];
export async function executeWorkflowTool(
  db: PrismaClient,
  context: ChatContext,
  name: string,
  raw: unknown,
) {
  const imports = new ImportTools(db);
  if (name === "list_staged_imports") {
    z.object({}).strict().parse(raw);
    return await imports.list(context.userId);
  }
  if (name === "inspect_staged_import")
    return imports.inspect(context.userId, raw);
  if (name === "stage_statement") return imports.stage(context, raw);
  if (name === "assign_draft_account") return imports.assign(context, raw);
  if (name === "suggest_draft_labels") return imports.labels(context, raw);
  if (name === "inspect_statement") {
    const { attachmentId } = z
      .object({ attachmentId: idSchema })
      .strict()
      .parse(raw);
    const file = await db.chatAttachment.findFirst({
      where: {
        id: attachmentId,
        userId: context.userId,
        conversationId: context.conversationId,
      },
      include: { statementFile: { select: { contentType: true } } },
    });
    if (!file) throw new ChatError(404, "Attachment not found");
    if (isImageType(file.statementFile.contentType))
      throw new ChatError(400, IMAGE_NOT_STATEMENT);
    return {
      statementFileId: file.statementFileId,
      ...(await factory.inspectStatement(context.userId, file.statementFileId)),
    };
  }
  if (name === "list_parsers") {
    z.object({}).strict().parse(raw);
    const response = await fetch(
      new URL(
        "/parsers",
        process.env.PARSER_SERVICE_URL || "http://file-parser:4000",
      ),
      {
        headers: {
          "X-Internal-Service-Token": process.env.INTERNAL_SERVICE_TOKEN || "",
          "X-Authenticated-User-Id": context.userId,
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new ChatError(502, "Parsers are unavailable");
    return response.json();
  }
  if (name === "parser_step") {
    const input = z
      .object({
        operation: z.enum([
          "guide",
          "inspect",
          "save",
          "test",
          "submit",
          "definitions",
        ]),
        workspaceId: idSchema.optional(),
        candidateId: idSchema.optional(),
        fileId: idSchema.optional(),
        candidate: z.unknown().optional(),
      })
      .strict()
      .parse(raw);
    if (input.operation === "guide")
      return {
        entrypoint: "parse(content: bytes, specification: dict) -> list[dict]",
        required: [
          "date (YYYY-MM-DD)",
          "description",
          "exactly one positive amountIn or amountOut",
          "accountIdentifier for bank statements",
        ],
        allowedImports: [
          "io",
          "csv",
          "datetime",
          "decimal",
          "re",
          "pdfplumber",
          "pandas",
          "json",
        ],
        rules: [
          "Inspect consented fixture first",
          "Use one stable parserId",
          "No network/filesystem outside sandbox",
          "Validate counts, credits, debits and account identifiers",
          "Source hash must match passing tests",
        ],
      };
    if (input.operation === "definitions")
      return factory.definitions(context.userId);
    const workspaceId = idSchema.parse(input.workspaceId);
    if (input.operation === "inspect")
      return factory.inspect(
        context.userId,
        workspaceId,
        idSchema.parse(input.fileId),
      );
    if (input.operation === "save")
      return factory.save(context.userId, workspaceId, input.candidate);
    if (input.operation === "test")
      return factory.test(
        context.userId,
        workspaceId,
        idSchema.parse(input.candidateId),
      );
    return factory.submit(
      context.userId,
      workspaceId,
      idSchema.parse(input.candidateId),
    );
  }
  throw new ChatError(400, "Tool is unavailable");
}
