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
      "Develop a parser in an approved fixture workspace. Operations: guide and definitions need nothing else; inspect needs workspaceId and fileId; save needs workspaceId and candidate; test and submit need workspaceId and candidateId. A workspace only exists after the user approves a retain_fixture proposal for the statement (propose_action); until then, stop and ask the user to approve it. Source entrypoint parse(content: bytes, specification: dict) returns a transaction list. Approval and activation require propose_action.",
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
      "Create a human approval preview. This never approves or executes the change. Fields per kind (no others are accepted): " +
      "commit_drafts: draftIds (string[], staged import IDs). " +
      "retain_fixture: statementFileIds (string[]). " +
      "approve_parser: workspaceId, candidateId. " +
      "activate_parser | rollback_parser: definitionId, versionId. " +
      "create_account: accountIdentifier (string), color (optional '#RRGGBB'). " +
      "create_category: name, color (optional '#RRGGBB'), icon (optional string). " +
      "update_import_rule: ruleId (optional; omit to create), name (required, unique), " +
      "parserId (optional parser ID from list_parsers; null = any parser), " +
      "accountIdentifier (optional account from get_context; null = any account; use it when the user asks for one account), " +
      "matchType: exactly 'description_contains' (requires matchValue) or 'always', " +
      "matchValue (text the description must contain), caseSensitive (boolean, default false), " +
      "markInternal (boolean), setLabel (string or null), setCategoryName (existing category name or null), " +
      "enabled (boolean), sortOrder (integer). Rules only affect future imports.",
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
    const need = (value: string | undefined, field: string) => {
      if (value) return value;
      throw new ChatError(
        400,
        field === "workspaceId"
          ? `parser_step ${input.operation} needs workspaceId. A workspace is created when the user approves a retain_fixture proposal for the statement; if that is still pending, stop and ask the user to approve it.`
          : `parser_step ${input.operation} needs ${field}.`,
      );
    };
    const workspaceId = need(input.workspaceId, "workspaceId");
    if (input.operation === "inspect")
      return factory.inspect(
        context.userId,
        workspaceId,
        need(input.fileId, "fileId"),
      );
    if (input.operation === "save") {
      if (input.candidate === undefined) need(undefined, "candidate");
      return factory.save(context.userId, workspaceId, input.candidate);
    }
    if (input.operation === "test")
      return factory.test(
        context.userId,
        workspaceId,
        need(input.candidateId, "candidateId"),
      );
    return factory.submit(
      context.userId,
      workspaceId,
      need(input.candidateId, "candidateId"),
    );
  }
  throw new ChatError(400, "Tool is unavailable");
}
