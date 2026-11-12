import { IMAGE_NOT_STATEMENT, isImageType } from "../media";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ChatContext, ChatError, idSchema } from "../contracts";
import { ParserFactoryService as factory } from "../../imports/parser-factory.service";
import { ToolDefinition } from "../providers/provider";
import { ImportTools, STAGED_EDIT_LIMIT } from "./imports";
import { inspectJsonSchema } from "./draft-inspect";
import { checkStatementTotals, totalsDefinition } from "./statement-totals";
import { rowItemSchema } from "./documents";
import { json } from "./transactions";
import {
  requireConversationAttachment,
  toStatementFileIds,
} from "../../imports/statement-files";
import {
  PARSER_CANDIDATE_FIELDS,
  parserCandidateJsonSchema,
} from "../../imports/parser-factory.service";
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
      "Read a staged import. With only draftId it returns a summary, not rows: counts by review status, unlabelled and needing-review counts, money in/out per account, the statement period, amount problems, PayLah rows still to name (and whether Gmail is connected), the parser and its version, and the first rows needing review. Start there. To read rows, add filters (rowIds, needsReview, unlabelled, direction 'in' for credits, dateFrom/dateTo, search) and page with offset/limit (at most 100 rows per call; nextOffset says where the next page starts); fields picks what each row returns. Every row comes with its id and current version, which update_staged_rows and suggest_draft_labels need. Ask only for the rows and fields you need; don't re-read the whole import after each edit (write tools return the new row versions).",
    inputSchema: inspectJsonSchema,
  },
  {
    name: "inspect_statement",
    description:
      "Read uploaded statement text without retaining it as a parser fixture, up to 12 pages per call: startPage/endPage pick the pages, and nextPage says where to continue. Returns the statementFileId (upload_…) that parser tools and retain_fixture use.",
    inputSchema: obj(
      {
        attachmentId: {
          type: "string",
          description:
            "The attachment ID from this conversation (its statementFileId also works)",
        },
        startPage: { type: "integer", minimum: 1, description: "First page to read (default 1)" },
        endPage: { type: "integer", minimum: 1, description: "Last page to read (default: 12 pages from startPage)" },
      },
      ["attachmentId"],
    ),
  },
  totalsDefinition,
  {
    name: "restage_draft",
    description:
      "Propose re-running an uncommitted staged import with the current version of its parser, for example after a parser fix or when inspect_staged_import's parserVersionNote says it was staged with an older version. The user approves it in the interface; the preview shows rows kept, added and removed. Rows that still match (same date, amounts and description) keep their labels, categories, edited descriptions, metadata and reimbursement links; rows the parser no longer produces are removed, rows added with add_staged_rows stay. Use this instead of discarding and staging the statement again. Nothing is committed.",
    inputSchema: obj({ draftId: str }, ["draftId"]),
  },
  {
    name: "discard_draft",
    description:
      "Propose discarding uncommitted staged imports (up to 20). The user approves it in the interface; the preview lists their rows, labels and links that would be lost. To re-parse an import with a fixed parser use restage_draft instead.",
    inputSchema: obj(
      { draftIds: { type: "array", items: str, minItems: 1, maxItems: 20 } },
      ["draftIds"],
    ),
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
        attachmentId: {
          type: "string",
          description:
            "The attachment ID from this conversation (its statementFileId also works)",
        },
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
    name: "update_staged_rows",
    description:
      `Edit rows of a staged import directly: description, label, categoryId and metadata only (metadata keys are merged into the row's). Dates, amounts, accounts, balances and reimbursement links never change this way. For links, use propose_transaction_edits when the reimbursement is a saved transaction (it may pay back staged rows), or request_transaction_review when the reimbursement is a staged row. Each row needs its current version from inspect_staged_import. Send up to ${STAGED_EDIT_LIMIT} rows in one call (a whole statement); each row is saved on its own, and failed lists rows that weren't. A row that failed as stale changed since you read it (perhaps in another conversation): read it again before retrying, never retry with the old values blindly. Nothing is committed: the user still reviews and commits the import. Use it when the source of the change is clear (for example PayLah emails matched by get_paylah_email_guide); use suggest_draft_labels for label guesses the user should confirm.`,
    inputSchema: obj(
      {
        draftId: str,
        rows: {
          type: "array",
          minItems: 1,
          maxItems: STAGED_EDIT_LIMIT,
          items: obj(
            {
              rowId: str,
              version: { type: "integer" },
              description: str,
              label: { type: ["string", "null"] },
              categoryId: { type: ["string", "null"] },
              metadata: {
                type: "object",
                additionalProperties: {
                  type: ["string", "number", "boolean", "null"],
                },
              },
            },
            ["rowId", "version"],
          ),
        },
      },
      ["draftId", "rows"],
    ),
  },
  {
    name: "add_staged_rows",
    description:
      "Add transactions to an existing staged import when its source shows them but the parser left them out (for example a cashback credit or a card repayment). Check the import first with inspect_staged_import and add only rows that are really missing; expectedVersion is the import's current version. Rows without an accountIdentifier get the account the import's rows share. The added rows are marked as added, with your reason, and the user reviews and commits them with the rest of the import; nothing is committed. Use stage_rows instead for a source that has no staged import.",
    inputSchema: obj(
      {
        draftId: str,
        expectedVersion: { type: "integer" },
        reason: {
          type: "string",
          maxLength: 300,
          description:
            "Why these rows are missing, e.g. 'Statement lists a 21 Sep cashback credit the parser skipped'",
        },
        rows: { type: "array", minItems: 1, maxItems: 50, items: rowItemSchema },
      },
      ["draftId", "expectedVersion", "reason", "rows"],
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
      "Develop a parser in an approved fixture workspace. Check list_parsers first: a built-in parser for the statement makes this unnecessary, and built-in IDs can't be replaced. Operations: guide and definitions need nothing else; inspect needs workspaceId and fileId (a statement file ID, upload_…, from the workspace); save needs workspaceId and candidate; test and submit need workspaceId and candidateId (the id that save returns). A workspace only exists after the user approves a retain_fixture proposal for the statement (propose_action); until then, stop and ask the user to approve it. test runs the candidate on every statement in the workspace, so a workspace must hold only statements of the one layout the parser is for; to get one, propose retain_fixture with only those statement IDs. A statement that is already kept needs no new approval, upload or re-saved file: retain_fixture with its ID returns a workspace with exactly the statements asked for. " +
      PARSER_CANDIDATE_FIELDS +
      " Approval and activation require propose_action.",
    inputSchema: obj(
      {
        operation: {
          enum: ["guide", "inspect", "save", "test", "submit", "definitions"],
        },
        workspaceId: str,
        candidateId: str,
        fileId: {
          type: "string",
          description: "Statement file ID (upload_…) of a workspace statement",
        },
        candidate: parserCandidateJsonSchema,
      },
      ["operation"],
    ),
  },
  {
    name: "propose_action",
    description:
      "Create a human approval preview. This never approves or executes the change. A pending proposal stays open while the conversation goes on; a new proposal for the same records replaces it. Fields per kind (no others are accepted): " +
      "commit_drafts: draftIds (string[], staged import IDs). " +
      "retain_fixture: statementFileIds (string[]: statement file IDs, upload_…, as inspect_statement returns them; this conversation's attachment IDs are accepted too; list only the statements of one layout, since the workspace holds exactly these; when every statement is already kept, no proposal is made and the result gives the workspaceId of a workspace with exactly these statements, to use right away). " +
      "approve_parser: workspaceId, candidateId. " +
      "activate_parser | rollback_parser: definitionId, versionId. " +
      "create_account: accountIdentifier (string, what statements show), label (optional friendly name, e.g. 'UOB One credit card'), color (optional '#RRGGBB'). " +
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
  if (name === "update_staged_rows") return imports.editRows(context, raw);
  if (name === "add_staged_rows") return imports.addRows(context, raw);
  if (name === "check_statement_totals")
    return checkStatementTotals(db, context, raw);
  if (name === "inspect_statement") {
    const { attachmentId, startPage, endPage, fromPage } = z
      .object({
        attachmentId: idSchema,
        startPage: z.number().int().min(1).optional(),
        endPage: z.number().int().min(1).optional(),
        // read_attachment's name for it; the model reaches for it here too.
        fromPage: z.number().int().min(1).optional(),
      })
      .strict()
      .refine(
        (v) => !v.endPage || v.endPage >= (v.startPage || v.fromPage || 1),
        "endPage must not be before startPage",
      )
      .parse(raw);
    const file = await requireConversationAttachment(db, context, attachmentId);
    if (isImageType(file.statementFile.contentType))
      throw new ChatError(400, IMAGE_NOT_STATEMENT);
    return {
      statementFileId: file.statementFileId,
      ...(await factory.inspectStatement(
        context.userId,
        file.statementFileId,
        startPage || fromPage || 1,
        endPage,
      )),
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
        candidate: PARSER_CANDIDATE_FIELDS,
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
          "A workspace's statements must share one layout: test runs the candidate on each",
          "For a workspace with only some statements, propose retain_fixture with just their IDs; statements already kept get that workspace at once, with no approval",
          "Never ask the user to re-upload, re-attach or re-save a statement that is already kept: uploads of the same file reuse the same statement",
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
    if (input.operation === "inspect") {
      const [fileId] = await toStatementFileIds(db, context, [
        need(input.fileId, "fileId"),
      ]);
      return factory.inspect(context.userId, workspaceId, fileId);
    }
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
