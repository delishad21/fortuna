import { ReviewService } from "../reviews.service";
import { sanitizeToolResult } from "./sanitize";
import { ChatActions } from "./actions";
import { workflowDefinitions, executeWorkflowTool } from "./workflow-tools";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ChatContext, ChatError, ToolResult } from "../contracts";
import { ToolDefinition } from "../providers/provider";
import { ApprovalService } from "../approvals.service";
import { TransactionActions, json } from "./transactions";
import { ReadTools } from "./read";
export const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: "object", properties, required, additionalProperties: false });
const str = { type: "string" };
const range = {
  dateFrom: {
    type: "string",
    description: "Inclusive ISO timestamp with offset",
  },
  dateTo: {
    type: "string",
    description: "Exclusive ISO timestamp with offset",
  },
  currency: str,
  accountIdentifier: str,
  categoryId: str,
  search: str,
  includeInternal: { type: "boolean" },
};
export function createToolRegistry(db: PrismaClient) {
  const read = new ReadTools(db);
  const approvals = new ApprovalService(db, new ChatActions(db));
  const definitions: ToolDefinition[] = [
    {
      name: "get_context",
      description:
        "Get the signed-in user’s categories, accounts and current date.",
      inputSchema: objectSchema({}),
    },
    {
      name: "spending_summary",
      description:
        "Calculate exact server-side spending, income and unallocated reimbursement totals grouped by category, merchant, account, UTC day or currency; currencies always remain separate. Use explicit date boundaries; no currency conversion.",
      inputSchema: objectSchema(
        {
          ...range,
          groupBy: {
            enum: ["currency", "category", "merchant", "account", "day"],
          },
        },
        ["dateFrom", "dateTo"],
      ),
    },
    {
      name: "find_transactions",
      description:
        "Find a bounded page of saved transactions with IDs for review or edit proposals.",
      inputSchema: objectSchema(
        {
          ...range,
          limit: { type: "integer", minimum: 1, maximum: 100 },
          offset: { type: "integer", minimum: 0 },
        },
        ["dateFrom", "dateTo"],
      ),
    },
    {
      name: "propose_transaction_edits",
      description:
        "Preview changes to saved transactions. Returns a proposal that ONLY the user can approve in the interface. Never assume approval.",
      inputSchema: objectSchema(
        {
          edits: {
            type: "array",
            minItems: 1,
            maxItems: 100,
            items: objectSchema(
              {
                id: str,
                patch: objectSchema({
                  label: { type: ["string", "null"] },
                  description: str,
                  date: str,
                  amountIn: { type: ["string", "null"] },
                  amountOut: { type: ["string", "null"] },
                  balance: { type: ["string", "null"] },
                  currency: str,
                  accountIdentifier: str,
                  categoryId: { type: ["string", "null"] },
                  linkage: {
                    type: ["object", "null"],
                    properties: {
                      type: { enum: ["internal", "reimbursement"] },
                      reimbursesAllocations: {
                        type: "array",
                        items: objectSchema(
                          {
                            transactionId: str,
                            stagedDraftId: str,
                            stagedRowId: str,
                            amount: { type: "number" },
                          },
                          ["amount"],
                        ),
                      },
                      leftoverCategoryId: { type: ["string", "null"] },
                    },
                    required: ["type"],
                    additionalProperties: false,
                  },
                }),
              },
              ["id", "patch"],
            ),
          },
        },
        ["edits"],
      ),
    },
  ];
  definitions.push({
    name: "request_transaction_review",
    description:
      "Show an editable transaction review to the user: spreadsheet on web, cards on phone. Use whenever the user needs to analyse or supply edits. Draft edits sync across devices without changing finance records. Wait for a submitted review before proposing consequential changes. A new user task supersedes pending reviews.",
    inputSchema: objectSchema(
      {
        title: str,
        instructions: str,
        transactionIds: { type: "array", items: str, maxItems: 100 },
        stagedRowIds: { type: "array", items: str, maxItems: 100 },
      },
      ["title"],
    ),
  });
  definitions.push(...workflowDefinitions);
  async function execute(
    context: ChatContext,
    name: string,
    input: unknown,
  ): Promise<ToolResult> {
    if (name === "request_transaction_review") {
      const review = await new ReviewService(db).create(context, input);
      return {
        blocks: [{ type: "review", id: review.id, title: review.title }],
      };
    }
    if (name === "get_context") {
      z.object({}).strict().parse(input);
      return {
        blocks: [
          {
            type: "data",
            title: "Accounts and categories",
            data: json(await read.context(context.userId)),
          },
        ],
      };
    }
    if (name === "spending_summary")
      return {
        blocks: [
          {
            type: "data",
            title: "Spending summary",
            data: json(await read.summary(context.userId, input)),
          },
        ],
      };
    if (name === "find_transactions")
      return {
        blocks: [
          {
            type: "data",
            title: "Transactions",
            data: json(await read.transactions(context.userId, input)),
          },
        ],
      };
    if (name === "propose_transaction_edits") {
      const raw = z
        .object({ edits: z.array(z.unknown()).min(1).max(100) })
        .strict()
        .parse(input);
      const proposal = await approvals.proposeAction(context, {
        kind: "edit_transactions",
        ...raw,
      });
      return {
        blocks: [
          {
            type: "link",
            kind: "proposal",
            id: proposal.id,
            label: "Review changes",
          },
          {
            type: "data",
            title: "Changes awaiting your approval",
            data: proposal.preview,
          },
        ],
      };
    }
    if (name === "propose_action") {
      const { action } = z
        .object({ action: z.unknown() })
        .strict()
        .parse(input);
      const proposal = await approvals.proposeAction(context, action);
      return {
        blocks: [
          {
            type: "link",
            kind: "proposal",
            id: proposal.id,
            label: "Review changes",
          },
          {
            type: "data",
            title: "Awaiting your approval",
            data: proposal.preview,
          },
        ],
      };
    }
    if (workflowDefinitions.some((d) => d.name === name)) {
      const data = await executeWorkflowTool(db, context, name, input);
      const blocks: ToolResult["blocks"] = [
        { type: "data", title: name.replaceAll("_", " "), data: json(data) },
      ];
      if (
        name === "stage_statement" &&
        data &&
        typeof data === "object" &&
        "id" in data
      )
        blocks.unshift({
          type: "link",
          kind: "draft",
          id: String(data.id),
          label: "Review staged import",
        });
      return { blocks };
    }
    throw new ChatError(400, "Tool is unavailable");
  }
  return {
    definitions,
    execute: async (context: ChatContext, name: string, input: unknown) =>
      sanitizeToolResult(await execute(context, name, input)) as ToolResult,
    approvals,
    isReadOnly: (name: string) =>
      [
        "get_context",
        "spending_summary",
        "find_transactions",
        "list_parsers",
        "list_staged_imports",
        "inspect_staged_import",
        "inspect_statement",
      ].includes(name),
  };
}
