import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { withDatabase } from "../../../lib/database-context";
import { HermesWorkflowService as workflow } from "../../imports/hermes-workflow.service";
import {
  applyRestage,
  loadRestageDraft,
  previewRestage,
  RestageDraft,
  RestagePreview,
} from "../../imports/restage";
import { linksTouching } from "../../reimbursements/links.service";
import { draftRowKey } from "../../reimbursements/links.core";
import { ChatError, idSchema } from "../contracts";
import { ActionHandler, PreparedAction, StaleAction, json, stateHash } from "./transactions";

/** Lists in a preview stay short; the rest is counted. */
const LIST_ITEMS = 20;
const capped = (items: string[]) =>
  items.length > LIST_ITEMS
    ? [...items.slice(0, LIST_ITEMS), `…and ${items.length - LIST_ITEMS} more`]
    : items;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const restageSchema = z
  .object({ kind: z.literal("restage_draft"), draftId: idSchema })
  .strict();
export const discardSchema = z
  .object({
    kind: z.literal("discard_draft"),
    draftIds: z.array(idSchema).min(1).max(20),
  })
  .strict()
  .refine((v) => new Set(v.draftIds).size === v.draftIds.length, "Drafts must be unique");

const restageHash = (draft: RestageDraft, preview: RestagePreview) =>
  stateHash({
    draft: { id: draft.id, version: draft.version, parserVersion: draft.parserVersion },
    rows: draft.rows.map((row) => [row.id, row.version]),
    parserVersion: preview.parserVersion,
    parsed: preview.raw,
  });

/** Re-run an open import with the current version of its parser; see imports/restage.ts. */
export class RestageAction implements ActionHandler {
  constructor(private db: PrismaClient) {}
  async prepare(userId: string, raw: unknown): Promise<PreparedAction> {
    const input = restageSchema.parse(raw);
    return withDatabase(this.db, async () => {
      const draft = await loadRestageDraft(userId, input.draftId);
      const preview = await previewRestage(userId, draft);
      const { plan, lines, carriedCounts } = preview;
      const carried = Object.entries(carriedCounts)
        .map(([field, n]) => `${n} ${field}`)
        .join(" · ");
      const sameVersion = draft.parserVersion === preview.parserVersion;
      return {
        kind: input.kind,
        arguments: json(input),
        stateHash: restageHash(draft, preview),
        preview: json({
          title: `Re-stage ${draft.sourceFilename}`,
          detail: `${plural(plan.matches.length, "row")} kept · ${plan.added.length} added · ${plan.removed.length} removed`,
          facts: {
            statement: draft.sourceFilename,
            parser: `${draft.parserId} ${draft.parserVersion || "unrecorded"} → ${preview.parserVersion}${sameVersion ? " (same version)" : ""}`,
            rowsKept: plan.matches.length,
            rowsAdded: plan.added.length,
            rowsRemoved: plan.removed.length,
            ...(plan.keptAdded.length ? { rowsAddedByHandKept: plan.keptAdded.length } : {}),
            carriedOver: carried || "Nothing to carry over",
            reimbursementLinksKept: preview.keptLinks,
            ...(preview.lostLinks ? { reimbursementLinksRemoved: preview.lostLinks } : {}),
          },
          lists: [
            { heading: "New rows from the parser", items: capped(lines.added) },
            { heading: "Rows the parser no longer produces (removed)", items: capped(lines.removed) },
            {
              heading: "Removed rows that had a label, category or edits (these are lost)",
              items: capped(lines.editedRemoved),
            },
            { heading: "Rows added by hand, kept", items: capped(lines.keptAdded) },
          ].filter((list) => list.items.length),
          note: "Rows that still match (same date, amounts and description) keep their labels, categories, edited descriptions, metadata and reimbursement links. Nothing is committed.",
        }),
      };
    });
  }
  async execute(tx: Prisma.TransactionClient, userId: string, raw: unknown, expectedHash: string) {
    const input = restageSchema.parse(raw);
    await tx.$queryRaw`SELECT id FROM import_drafts WHERE id = ${input.draftId} AND user_id = ${userId} FOR UPDATE`;
    const draft = await loadRestageDraft(userId, input.draftId);
    const preview = await previewRestage(userId, draft);
    if (restageHash(draft, preview) !== expectedHash)
      throw new StaleAction("The import or its parser changed since the preview");
    return json(
      await applyRestage(userId, draft, preview, { actorType: "user", actorId: userId }),
    );
  }
}

/** Discard open imports; their statement files stay in the Statements list. */
export class DiscardAction implements ActionHandler {
  constructor(private db: PrismaClient) {}
  private async load(db: Prisma.TransactionClient | PrismaClient, userId: string, draftIds: string[]) {
    const drafts = await db.importDraft.findMany({
      where: { id: { in: draftIds }, userId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        version: true,
        status: true,
        sourceFilename: true,
        rows: { select: { id: true, currentPayload: true, reviewStatus: true } },
      },
    });
    if (drafts.length !== draftIds.length) throw new ChatError(404, "Import draft not found");
    const closed = drafts.find((d) => ["committed", "discarded"].includes(d.status));
    if (closed)
      throw new ChatError(409, `${closed.sourceFilename} is already ${closed.status}`);
    return drafts;
  }
  async prepare(userId: string, raw: unknown): Promise<PreparedAction> {
    const input = discardSchema.parse(raw);
    const drafts = await this.load(this.db, userId, input.draftIds);
    const lines = [];
    let linkCount = 0;
    for (const draft of drafts) {
      const edited = draft.rows.filter((row) => {
        const p = (row.currentPayload || {}) as Record<string, any>;
        return String(p.label || "").trim() || p.categoryId || row.reviewStatus === "edited";
      }).length;
      const links = await linksTouching(
        this.db as never,
        userId,
        draft.rows.map((row) => draftRowKey(row.id)),
      );
      linkCount += links.length;
      lines.push(
        `${draft.sourceFilename}: ${plural(draft.rows.length, "row")}${edited ? `, ${edited} labelled or edited` : ""}${links.length ? `, ${plural(links.length, "reimbursement link")}` : ""}`,
      );
    }
    return {
      kind: "discard_draft",
      arguments: json(input),
      stateHash: stateHash(drafts.map((d) => [d.id, d.version, d.status])),
      preview: json({
        title:
          drafts.length === 1
            ? `Discard ${drafts[0].sourceFilename}`
            : `Discard ${drafts.length} staged imports`,
        detail: `${plural(drafts.reduce((n, d) => n + d.rows.length, 0), "row")} not imported`,
        facts: {
          imports: drafts.length,
          rows: drafts.reduce((n, d) => n + d.rows.length, 0),
          ...(linkCount ? { reimbursementLinksRemoved: linkCount } : {}),
        },
        lists: [{ heading: "Discarded", items: lines }],
        note: "Nothing is saved from these imports; their labels and links are lost. Their statement files are kept, so a discarded statement can be staged again.",
      }),
    };
  }
  async execute(tx: Prisma.TransactionClient, userId: string, raw: unknown, expectedHash: string) {
    const input = discardSchema.parse(raw);
    await tx.$queryRaw`SELECT id FROM import_drafts WHERE user_id = ${userId} AND id IN (${Prisma.join(input.draftIds)}) ORDER BY id FOR UPDATE`;
    let drafts;
    try {
      drafts = await this.load(tx, userId, input.draftIds);
    } catch (error) {
      if (error instanceof ChatError && error.status === 409)
        throw new StaleAction(error.message);
      throw error;
    }
    if (stateHash(drafts.map((d) => [d.id, d.version, d.status])) !== expectedHash)
      throw new StaleAction("The staged imports changed since the preview");
    const discarded = [];
    for (const draft of drafts) {
      await workflow.discardDraft(userId, draft.id, { actorType: "user", actorId: userId });
      discarded.push({ draftId: draft.id, filename: draft.sourceFilename });
    }
    return json({ discarded });
  }
}
