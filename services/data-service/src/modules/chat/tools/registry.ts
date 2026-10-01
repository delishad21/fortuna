import { ReviewService } from "../reviews.service";
import { sanitizeToolResult } from "./sanitize";
import { ChatActions } from "./actions";
import { workflowDefinitions, executeWorkflowTool } from "./workflow-tools";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  ChatContext,
  ChatError,
  ComponentBlock,
  ToolResult,
} from "../contracts";
import { ToolDefinition } from "../providers/provider";
import { ApprovalService } from "../approvals.service";
import { TransactionActions, json } from "./transactions";
import { ReadTools } from "./read";
import {
  ComponentTools,
  componentForModel,
  showComponentDefinition,
} from "./components";
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
/** A proposal shows the user one review link; the model gets the full preview to describe it. */
function proposalResult(proposal: {
  id: string;
  kind: string;
  preview: unknown;
}): ToolResult {
  const preview = (proposal.preview || {}) as {
    title?: string;
    changes?: unknown[];
  };
  const count = preview.changes?.length;
  return {
    blocks: [
      {
        type: "link",
        kind: "proposal",
        id: proposal.id,
        label:
          count !== undefined
            ? `Review ${count} transaction ${count === 1 ? "change" : "changes"}`
            : `Review: ${preview.title || "proposed change"}`,
      },
    ],
    model: {
      proposalId: proposal.id,
      status: "awaiting the user's approval in the interface",
      preview: proposal.preview,
    },
  };
}
export function createToolRegistry(db: PrismaClient) {
  const read = new ReadTools(db);
  const components = new ComponentTools(db, read);
  const approvals = new ApprovalService(db, new ChatActions(db));
  const definitions: ToolDefinition[] = [
    {
      name: "get_context",
      description:
        "Get the signed-in user’s categories, accounts and current date. Visible only to you.",
      inputSchema: objectSchema({}),
    },
    {
      name: "spending_summary",
      description:
        "Calculate exact server-side spending, income and unallocated reimbursement totals grouped by category, merchant, account, UTC day or currency; currencies always remain separate. Use explicit date boundaries; no currency conversion. Visible only to you; use show_component to display results.",
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
        "Find a bounded page of saved transactions with IDs for review or edit proposals. Visible only to you; use show_component with transaction_list to display transactions.",
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
  definitions.push(showComponentDefinition);
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
      return { blocks: [], model: json(await read.context(context.userId)) };
    }
    if (name === "spending_summary")
      return {
        blocks: [],
        model: json(await read.summary(context.userId, input)),
      };
    if (name === "find_transactions")
      return {
        blocks: [],
        model: json(await read.transactions(context.userId, input)),
      };
    if (name === "show_component") {
      const block = json(
        await components.show(context.userId, input),
      ) as unknown as ComponentBlock;
      return { blocks: [block], model: componentForModel(block, true) };
    }
    if (name === "propose_transaction_edits") {
      const raw = z
        .object({ edits: z.array(z.unknown()).min(1).max(100) })
        .strict()
        .parse(input);
      const proposal = await approvals.proposeAction(context, {
        kind: "edit_transactions",
        ...raw,
      });
      return proposalResult(proposal);
    }
    if (name === "propose_action") {
      const { action } = z
        .object({ action: z.unknown() })
        .strict()
        .parse(input);
      const proposal = await approvals.proposeAction(context, action);
      return proposalResult(proposal);
    }
    if (workflowDefinitions.some((d) => d.name === name)) {
      const data = await executeWorkflowTool(db, context, name, input);
      // Workflow results inform the model; the user only sees links and components.
      const blocks: ToolResult["blocks"] = [];
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
      return { blocks, model: json(data) };
    }
    throw new ChatError(400, "Tool is unavailable");
  }
  return {
    definitions,
    execute: async (context: ChatContext, name: string, input: unknown) =>
      sanitizeToolResult(await execute(context, name, input)) as ToolResult,
    approvals,
    components,
    isReadOnly: (name: string) =>
      [
        "get_context",
        "spending_summary",
        "find_transactions",
        "show_component",
        "list_parsers",
        "list_staged_imports",
        "inspect_staged_import",
        "inspect_statement",
      ].includes(name),
  };
}
