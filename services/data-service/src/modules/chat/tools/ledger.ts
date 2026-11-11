import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { withDatabase } from "../../../lib/database-context";
import { listCandidates, type Candidate } from "../../reimbursements/links.queries";
import { ChatContext, ChatError, idSchema } from "../contracts";
import { ToolDefinition } from "../providers/provider";

const str = { type: "string" };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const ledgerDefinitions: ToolDefinition[] = [
  {
    name: "find_similar_transactions",
    description:
      "Past saved transactions whose description or label shares words with each given merchant or description, best matches first, with their labels and categories, plus the label/category pairs they most often had (commonLabels). Past labels for the same merchant are the strongest evidence when labelling staged rows. Pass every merchant you need at once in descriptions (up to 25), not one call each. Visible only to you.",
    inputSchema: obj(
      {
        descriptions: {
          type: "array",
          items: str,
          minItems: 1,
          maxItems: 25,
          description: "Merchants or row descriptions, e.g. ['THE JUICE MAN MAN', 'GRAB SINGAPORE']",
        },
        direction: { enum: ["in", "out"], description: "Only money in, or only money out" },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          description: "Matches per description (default 5)",
        },
      },
      ["descriptions"],
    ),
  },
  {
    name: "get_reimbursement_candidates",
    description:
      "For an incoming payment (a staged row by draftRowId, or a saved transaction by transactionId), list the expenses it could pay back, saved and staged (lookingFor 'expense', the default); or, for an expense, the reimbursements that could have paid it back (lookingFor 'reimbursement'). Closest dates first. Each candidate shows its amount, what is already linked, claims pending in other staged imports, and what is still available; fullyAllocated ones can't take more. Narrow with query (description or label text), amountEquals, dateFrom/dateTo. To link: when the payment is a staged row, use request_transaction_review with a suggestion linkage {type:'reimbursement', reimbursesAllocations:[...]}; when it is saved, use propose_transaction_edits. Visible only to you.",
    inputSchema: obj({
      draftRowId: { ...str, description: "A staged row's id" },
      transactionId: { ...str, description: "A saved transaction's id" },
      lookingFor: { enum: ["expense", "reimbursement"] },
      query: str,
      amountEquals: { type: "number" },
      dateFrom: { ...str, description: "YYYY-MM-DD, inclusive" },
      dateTo: { ...str, description: "YYYY-MM-DD, inclusive" },
      limit: { type: "integer", minimum: 1, maximum: 30 },
      offset: { type: "integer", minimum: 0 },
      contextDraftIds: {
        type: "array",
        items: str,
        maxItems: 20,
        description: "Staged imports that will be committed together with this row",
      },
    }),
  },
];
export const ledgerToolNames = ledgerDefinitions.map((d) => d.name);

// Words that say nothing about the merchant.
const NOISE = new Set([
  "the", "and", "pte", "ltd", "sgp", "sin", "singapore", "com", "www", "inc", "llp", "for",
]);
/** The words two descriptions are compared by; long digit runs are card numbers and refs. */
export function descriptionTerms(text: string) {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length >= 3 && !NOISE.has(term) && !/^\d{5,}$/.test(term)),
    ),
  ].slice(0, 6);
}

const similarSchema = z
  .object({
    descriptions: z.array(z.string().trim().min(2).max(200)).min(1).max(25),
    direction: z.enum(["in", "out"]).optional(),
    limit: z.number().int().min(1).max(10).default(5),
  })
  .strict();

const candidatesSchema = z
  .object({
    draftRowId: idSchema.optional(),
    transactionId: idSchema.optional(),
    lookingFor: z.enum(["expense", "reimbursement"]).default("expense"),
    query: z.string().trim().max(200).optional(),
    amountEquals: z.number().finite().positive().optional(),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: z.number().int().min(1).max(30).default(15),
    offset: z.number().int().min(0).default(0),
    contextDraftIds: z.array(idSchema).max(20).optional(),
  })
  .strict()
  .refine((v) => !!v.draftRowId !== !!v.transactionId, "Pass draftRowId or transactionId, not both");

const day = (value: string | null) => (value ? String(value).slice(0, 10) : null);
const candidateView = (c: Candidate) => ({
  ...(c.transactionId
    ? { transactionId: c.transactionId }
    : { stagedDraftId: c.draftId, stagedRowId: c.rowId, filename: c.filename }),
  date: day(c.date),
  description: c.description,
  label: c.label,
  categoryId: c.categoryId,
  amount: c.amount,
  available: c.available,
  ...(c.linkedToSubject ? { linkedToSubject: c.linkedToSubject } : {}),
  ...(c.pending.length ? { pending: c.pending } : {}),
  ...(c.fullyAllocated ? { fullyAllocated: true } : {}),
});

export class LedgerTools {
  constructor(private db: PrismaClient) {}

  async similar(userId: string, raw: unknown) {
    const input = similarSchema.parse(raw);
    const categories = new Map(
      (
        await this.db.category.findMany({ where: { userId }, select: { id: true, name: true } })
      ).map((c) => [c.id, c.name]),
    );
    const results = [];
    for (const description of input.descriptions) {
      const terms = descriptionTerms(description);
      if (!terms.length) {
        results.push({ description, matchCount: 0, matches: [], commonLabels: [] });
        continue;
      }
      const rows = await this.db.transaction.findMany({
        where: {
          userId,
          OR: terms.flatMap((term) => [
            { description: { contains: term, mode: "insensitive" as const } },
            { label: { contains: term, mode: "insensitive" as const } },
          ]),
          ...(input.direction === "in"
            ? { amountIn: { gt: 0 } }
            : input.direction === "out"
              ? { amountOut: { gt: 0 } }
              : {}),
        },
        select: {
          id: true,
          date: true,
          description: true,
          label: true,
          categoryId: true,
          amountIn: true,
          amountOut: true,
          currency: true,
          linkage: true,
        },
        orderBy: { date: "desc" },
        take: 300,
      });
      const wanted = description.trim().toLowerCase();
      // Half the words in common at least, more words first, then the most recent.
      const scored = rows
        .map((row) => {
          const own = new Set(descriptionTerms(`${row.description} ${row.label || ""}`));
          const shared = terms.filter((term) => own.has(term)).length;
          const exact = row.description.trim().toLowerCase() === wanted;
          return { row, score: exact ? 1 : shared / terms.length };
        })
        .filter((item) => item.score >= 0.5)
        .sort((a, b) => b.score - a.score || b.row.date.getTime() - a.row.date.getTime());
      const tally = new Map<string, { label: string | null; categoryId: string | null; count: number }>();
      for (const { row } of scored.slice(0, 50)) {
        if (!row.label && !row.categoryId) continue;
        const key = `${row.label || ""}|${row.categoryId || ""}`;
        const entry = tally.get(key) || { label: row.label, categoryId: row.categoryId, count: 0 };
        entry.count += 1;
        tally.set(key, entry);
      }
      results.push({
        description,
        matchCount: scored.length,
        matches: scored.slice(0, input.limit).map(({ row, score }) => ({
          id: row.id,
          date: row.date.toISOString().slice(0, 10),
          description: row.description,
          label: row.label,
          categoryId: row.categoryId,
          category: row.categoryId ? categories.get(row.categoryId) || null : null,
          ...(row.amountIn && Number(row.amountIn) > 0 ? { amountIn: row.amountIn.toFixed(2) } : {}),
          ...(row.amountOut && Number(row.amountOut) > 0 ? { amountOut: row.amountOut.toFixed(2) } : {}),
          currency: row.currency,
          linkage: (row.linkage as { type?: string } | null)?.type || null,
          score: Math.round(score * 100) / 100,
        })),
        commonLabels: [...tally.values()]
          .sort((a, b) => b.count - a.count)
          .slice(0, 3)
          .map((entry) => ({
            ...entry,
            category: entry.categoryId ? categories.get(entry.categoryId) || null : null,
          })),
      });
    }
    return { results };
  }

  async reimbursementCandidates(userId: string, raw: unknown) {
    const input = candidatesSchema.parse(raw);
    if (input.draftRowId) {
      const row = await this.db.importDraftRow.findFirst({
        where: { id: input.draftRowId, draft: { userId } },
        select: { draft: { select: { mode: true } } },
      });
      if (!row) throw new ChatError(404, "Staged row not found");
      if (row.draft.mode === "trip")
        throw new ChatError(400, "Trip imports link reimbursements inside the trip, not here");
    }
    const result = await withDatabase(this.db, () =>
      listCandidates({
        userId,
        subject: input.draftRowId
          ? { draftRowId: input.draftRowId }
          : { transactionId: input.transactionId as string },
        lookingFor: input.lookingFor,
        query: input.query,
        limit: input.limit,
        offset: input.offset,
        contextDraftIds: input.contextDraftIds,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        amountEquals: input.amountEquals,
      }),
    );
    // Staged candidates come unpaged: keep the closest dates.
    const subjectDate = await this.subjectDate(userId, input);
    const staged = [...result.staged].sort(
      (a, b) =>
        Math.abs(new Date(a.date || 0).getTime() - subjectDate) -
        Math.abs(new Date(b.date || 0).getTime() - subjectDate),
    );
    const savedShown = input.offset + result.saved.items.length;
    return {
      subject: {
        ...result.subject,
        linked: result.subject.linked.map((l) => ({ ...l, date: day(l.date) })),
      },
      lookingFor: input.lookingFor,
      saved: {
        total: result.saved.total,
        nextOffset: savedShown < result.saved.total ? savedShown : null,
        items: result.saved.items.map(candidateView),
      },
      staged: {
        total: staged.length,
        items: staged.slice(0, input.limit).map(candidateView),
      },
    };
  }

  private async subjectDate(userId: string, input: { draftRowId?: string; transactionId?: string }) {
    if (input.transactionId) {
      const t = await this.db.transaction.findFirst({
        where: { id: input.transactionId, userId },
        select: { date: true },
      });
      return t?.date.getTime() || Date.now();
    }
    const row = await this.db.importDraftRow.findFirst({
      where: { id: input.draftRowId, draft: { userId } },
      select: { currentPayload: true },
    });
    const date = new Date(String((row?.currentPayload as Prisma.JsonObject | null)?.date || ""));
    return Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
  }
}

export async function executeLedgerTool(
  db: PrismaClient,
  context: ChatContext,
  name: string,
  input: unknown,
) {
  const tools = new LedgerTools(db);
  if (name === "find_similar_transactions") return tools.similar(context.userId, input);
  if (name === "get_reimbursement_candidates")
    return tools.reimbursementCandidates(context.userId, input);
  throw new ChatError(400, "Tool is unavailable");
}
