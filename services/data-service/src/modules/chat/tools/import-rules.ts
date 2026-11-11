import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  TransactionService,
  compatibleImportRuleParserIds,
} from "../../transactions/transactions.service";
import { ChatContext, ChatError, idSchema } from "../contracts";
import { ToolDefinition } from "../providers/provider";

const str = { type: "string" };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const ruleDefinitions: ToolDefinition[] = [
  {
    name: "list_import_rules",
    description:
      "List the user's import rules (fixed rules applied to staged imports: match on description text or always, optionally for one parser or account; set a label, a category or mark internal), in the order they apply. Visible only to you. Change them with propose_action update_import_rule.",
    inputSchema: obj({
      parserId: { ...str, description: "Only rules that apply to this parser (rules for any parser included)" },
      enabledOnly: { type: "boolean" },
    }),
  },
  {
    name: "test_import_rule",
    description:
      "Show which staged rows and saved transactions a rule would match, without changing anything: an existing rule (ruleId) or a draft one (rule) before proposing it. By default it checks every open staged import and the past year of saved transactions; narrow with draftIds or savedFrom/savedTo. Returns counts and up to `limit` example rows each, with their current label, category and type. Visible only to you.",
    inputSchema: obj({
      ruleId: str,
      rule: obj(
        {
          matchType: { enum: ["description_contains", "always"] },
          matchValue: str,
          caseSensitive: { type: "boolean" },
          parserId: { type: ["string", "null"] },
          accountIdentifier: { type: ["string", "null"] },
        },
        ["matchType"],
      ),
      draftIds: { type: "array", items: str, maxItems: 20 },
      savedFrom: { ...str, description: "YYYY-MM-DD, inclusive" },
      savedTo: { ...str, description: "YYYY-MM-DD, inclusive" },
      limit: { type: "integer", minimum: 1, maximum: 50, description: "Example rows per source (default 20)" },
    }),
  },
];
export const ruleToolNames = ruleDefinitions.map((d) => d.name);

const testSchema = z
  .object({
    ruleId: idSchema.optional(),
    rule: z
      .object({
        matchType: z.enum(["description_contains", "always"]),
        matchValue: z.string().max(200).nullable().optional(),
        caseSensitive: z.boolean().default(false),
        parserId: z.string().max(64).nullable().optional(),
        accountIdentifier: z.string().max(120).nullable().optional(),
      })
      .strict()
      .optional(),
    draftIds: z.array(idSchema).min(1).max(20).optional(),
    savedFrom: day.optional(),
    savedTo: day.optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict()
  .refine((v) => !!v.ruleId !== !!v.rule, "Pass ruleId or rule, not both")
  .refine(
    (v) => v.rule?.matchType !== "description_contains" || !!v.rule.matchValue?.trim(),
    "description_contains needs matchValue",
  );

type Rule = {
  parserId: string | null;
  accountIdentifier: string | null;
  matchType: string;
  matchValue: string | null;
  caseSensitive: boolean;
};
/** A rule applies to rows from its own parser (or a compatible one), or any parser when it has none. */
const appliesToParser = (rule: Rule, parserId: string | null | undefined) =>
  !rule.parserId || compatibleImportRuleParserIds(parserId || undefined).includes(rule.parserId);
const linkageType = (linkage: unknown) =>
  (linkage && typeof linkage === "object" && (linkage as { type?: string }).type) || null;

export class RuleTools {
  constructor(private db: PrismaClient) {}

  async list(userId: string, raw: unknown) {
    const input = z
      .object({ parserId: z.string().max(64).optional(), enabledOnly: z.boolean().optional() })
      .strict()
      .parse(raw);
    await TransactionService.bootstrapDefaultImportRules(userId);
    const rules = await this.db.importRule.findMany({
      where: {
        userId,
        ...(input.enabledOnly ? { enabled: true } : {}),
        ...(input.parserId
          ? {
              OR: [
                { parserId: null },
                { parserId: { in: compatibleImportRuleParserIds(input.parserId) } },
              ],
            }
          : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        enabled: true,
        parserId: true,
        accountIdentifier: true,
        matchType: true,
        matchValue: true,
        caseSensitive: true,
        setLabel: true,
        setCategoryName: true,
        markInternal: true,
        sortOrder: true,
      },
    });
    return {
      rules,
      note: "Rules apply in this order to every staged import (re-applied whenever it is read) and to future imports; the first rule that sets a field wins, and values the user set are kept.",
    };
  }

  async test(userId: string, raw: unknown) {
    const input = testSchema.parse(raw);
    let rule: Rule & { id?: string; name?: string };
    if (input.ruleId) {
      const found = await this.db.importRule.findFirst({ where: { id: input.ruleId, userId } });
      if (!found) throw new ChatError(404, "Import rule not found; use IDs from list_import_rules");
      rule = found;
    } else {
      const r = input.rule!;
      rule = {
        parserId: r.parserId ?? null,
        accountIdentifier: r.accountIdentifier ?? null,
        matchType: r.matchType,
        matchValue: r.matchValue ?? null,
        caseSensitive: r.caseSensitive,
      };
    }

    const drafts = await this.db.importDraft.findMany({
      where: {
        userId,
        mode: "main",
        ...(input.draftIds
          ? { id: { in: input.draftIds } }
          : { status: { notIn: ["committed", "discarded", "expired", "failed"] } }),
      },
      select: {
        id: true,
        sourceFilename: true,
        parserId: true,
        rows: {
          orderBy: { rowIndex: "asc" },
          select: { id: true, rowIndex: true, currentPayload: true },
        },
      },
      take: 50,
    });
    const stagedMatches = drafts.flatMap((draft) =>
      appliesToParser(rule, draft.parserId)
        ? draft.rows
            .filter((row) =>
              TransactionService.ruleMatches(rule, row.currentPayload as never),
            )
            .map((row) => ({ draft, row }))
        : [],
    );

    const testSaved = !input.draftIds || input.savedFrom || input.savedTo;
    const to = input.savedTo ? new Date(`${input.savedTo}T23:59:59.999Z`) : new Date();
    const from = input.savedFrom
      ? new Date(`${input.savedFrom}T00:00:00.000Z`)
      : new Date(to.getTime() - 365 * 86400000);
    const saved = testSaved
      ? await this.db.transaction.findMany({
          where: { userId, date: { gte: from, lte: to } },
          select: {
            id: true,
            date: true,
            description: true,
            label: true,
            categoryId: true,
            accountIdentifier: true,
            metadata: true,
            linkage: true,
            importBatch: { select: { parserId: true } },
          },
          orderBy: { date: "desc" },
          take: 5000,
        })
      : [];
    const savedMatches = saved.filter(
      (t) =>
        (!rule.parserId || (t.importBatch && appliesToParser(rule, t.importBatch.parserId))) &&
        TransactionService.ruleMatches(rule, t),
    );

    return {
      rule,
      staged: {
        draftsChecked: drafts.length,
        matched: stagedMatches.length,
        byDraft: drafts
          .map((d) => ({
            draftId: d.id,
            filename: d.sourceFilename,
            matched: stagedMatches.filter((m) => m.draft.id === d.id).length,
          }))
          .filter((d) => d.matched),
        examples: stagedMatches.slice(0, input.limit).map(({ draft, row }) => {
          const p = (row.currentPayload || {}) as Record<string, any>;
          return {
            draftId: draft.id,
            rowId: row.id,
            date: p.date ? String(p.date).slice(0, 10) : null,
            description: p.description ?? null,
            amountIn: p.amountIn ?? null,
            amountOut: p.amountOut ?? null,
            label: p.label ?? null,
            categoryId: p.categoryId ?? null,
            linkage: linkageType(p.linkage),
          };
        }),
      },
      ...(testSaved
        ? {
            saved: {
              from: from.toISOString().slice(0, 10),
              to: to.toISOString().slice(0, 10),
              checked: saved.length,
              matched: savedMatches.length,
              examples: savedMatches.slice(0, input.limit).map((t) => ({
                id: t.id,
                date: t.date.toISOString().slice(0, 10),
                description: t.description,
                label: t.label,
                categoryId: t.categoryId,
                linkage: linkageType(t.linkage),
              })),
            },
          }
        : {}),
      note: "Saved transactions only show what the rule would have matched; rules never change saved transactions.",
    };
  }
}

export async function executeRuleTool(
  db: PrismaClient,
  context: ChatContext,
  name: string,
  input: unknown,
) {
  const tools = new RuleTools(db);
  if (name === "list_import_rules") return tools.list(context.userId, input);
  if (name === "test_import_rule") return tools.test(context.userId, input);
  throw new ChatError(400, "Tool is unavailable");
}
