import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { HermesWorkflowService, audit } from "./hermes-workflow.service";
import {
  linksTouching,
  refreshAfterDelete,
  runInTransaction,
  storedDraftPayload,
} from "../reimbursements/links.service";
import {
  draftRowKey,
  expenseKeyOf,
  reimbursementKeyOf,
  stripLinkFields,
} from "../reimbursements/links.core";

/**
 * Re-staging runs an open draft's statement through the current version of its parser
 * and keeps the work done on it: rows that still match (same date, amounts and
 * description) keep their id, so their reimbursement links stay, and their label,
 * category, edited description, account and added metadata carry over. Rows the parser
 * no longer produces are removed with their links; rows added by hand stay.
 */

type Payload = Record<string, any>;
export type OldRow = {
  id: string;
  rowIndex: number;
  version: number;
  selected: boolean;
  reviewStatus: string;
  parsedPayload: unknown;
  currentPayload: unknown;
  provenance: unknown;
};

const record = (value: unknown) =>
  (value && typeof value === "object" ? value : {}) as Payload;
const cents = (value: unknown) => Math.round(Number(value || 0) * 100);
const dateKey = (p: Payload) => String(p.date ?? p.transactionDate ?? "").slice(0, 10);
const textKey = (value: unknown) =>
  String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
export const rowMatchKey = (p: Payload) =>
  `${dateKey(p)}|${cents(p.amountIn)}|${cents(p.amountOut)}|${textKey(p.description)}`;
const isAddedRow = (row: OldRow) => record(row.provenance).source === "added_row";

/** Pair old rows with new parser rows; the parser's own description first, then the edited one. */
export function planRestage(oldRows: OldRow[], newRows: Payload[]) {
  const free = new Map<string, number[]>();
  newRows.forEach((row, index) => {
    const key = rowMatchKey(row);
    free.set(key, [...(free.get(key) || []), index]);
  });
  const take = (key: string) => {
    const queue = free.get(key);
    return queue?.length ? queue.shift()! : undefined;
  };
  const matched = new Map<string, number>();
  for (const pass of ["parsedPayload", "currentPayload"] as const)
    for (const row of oldRows) {
      if (matched.has(row.id)) continue;
      const index = take(rowMatchKey(record(row[pass])));
      if (index !== undefined) matched.set(row.id, index);
    }
  const used = new Set(matched.values());
  const unmatched = oldRows.filter((row) => !matched.has(row.id));
  return {
    matches: oldRows
      .filter((row) => matched.has(row.id))
      .map((row) => ({ old: row, newIndex: matched.get(row.id)! })),
    added: newRows.map((_, index) => index).filter((index) => !used.has(index)),
    removed: unmatched.filter((row) => !isAddedRow(row)),
    keptAdded: unmatched.filter(isAddedRow),
  };
}

// Metadata the parser and import enrichment write; everything else was added on the draft.
const PARSER_METADATA = new Set([
  "sourceFilename",
  "parserId",
  "accountIdentifier",
  "fixedRuleId",
  "classificationPatternId",
  "parseWarning",
  "addedRow",
]);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The new row with what was done on the old one carried over, and what was carried. */
export function carryOver(old: OldRow, fresh: Payload, raw: Payload) {
  const parsed = record(old.parsedPayload);
  const current = record(old.currentPayload);
  const next: Payload = { ...fresh };
  const carried: string[] = [];
  if (current.description && current.description !== parsed.description) {
    next.description = current.description;
    carried.push("description");
  }
  if (String(current.label || "").trim()) {
    if (current.label !== fresh.label) carried.push("label");
    next.label = current.label;
  }
  if (current.categoryId) {
    if (current.categoryId !== fresh.categoryId) carried.push("category");
    next.categoryId = current.categoryId;
  }
  const linkage = stripLinkFields(current.linkage);
  if (linkage) {
    if (!same(linkage, stripLinkFields(fresh.linkage))) carried.push("linkage");
    next.linkage = linkage;
  }
  if (!raw.accountIdentifier && current.accountIdentifier) {
    if (current.accountIdentifier !== fresh.accountIdentifier) carried.push("account");
    next.accountIdentifier = current.accountIdentifier;
  }
  const oldMeta = record(current.metadata);
  const parsedMeta = record(parsed.metadata);
  const extra = Object.fromEntries(
    Object.entries(oldMeta).filter(
      ([key, value]) => !PARSER_METADATA.has(key) && !same(value, parsedMeta[key]),
    ),
  );
  if (Object.keys(extra).length) {
    next.metadata = { ...record(fresh.metadata), ...extra };
    carried.push("metadata");
  }
  return { payload: next, carried };
}

const rowLine = (p: Payload) => {
  const amount = cents(p.amountIn)
    ? `+${(cents(p.amountIn) / 100).toFixed(2)}`
    : `-${(cents(p.amountOut) / 100).toFixed(2)}`;
  return `${dateKey(p)} · ${String(p.description || "").slice(0, 60)} · ${amount}`;
};

export async function loadRestageDraft(userId: string, draftId: string) {
  const draft = await prisma.importDraft.findFirst({
    where: { id: draftId, userId },
    include: {
      sourceFile: true,
      rows: {
        orderBy: { rowIndex: "asc" },
        select: {
          id: true,
          rowIndex: true,
          version: true,
          selected: true,
          reviewStatus: true,
          parsedPayload: true,
          currentPayload: true,
          provenance: true,
        },
      },
    },
  });
  if (!draft) throw Object.assign(new Error("Import draft not found"), { status: 404 });
  if (["committed", "discarded", "expired", "inspecting"].includes(draft.status))
    throw Object.assign(new Error(`A ${draft.status} import can't be re-staged`), { status: 409 });
  if (draft.mode !== "main")
    throw Object.assign(
      new Error("Only main-ledger imports can be re-staged; discard a trip import and stage it again"),
      { status: 400 },
    );
  if (!draft.parserId || draft.parserId === "assistant_rows")
    throw Object.assign(
      new Error("This import wasn't made by a parser, so there is nothing to re-run"),
      { status: 400 },
    );
  if (!draft.sourceFile || draft.sourceFile.deletedAt || draft.sourceFile.status !== "available")
    throw Object.assign(new Error("The import's statement file is no longer available"), {
      status: 409,
    });
  return { ...draft, parserId: draft.parserId, sourceFile: draft.sourceFile };
}
export type RestageDraft = Awaited<ReturnType<typeof loadRestageDraft>>;

/** Parse again and work out what would change; nothing is written. */
export async function previewRestage(userId: string, draft: RestageDraft) {
  const { result, parsedTransactions } = await HermesWorkflowService.runDraftParser(
    userId,
    draft,
    draft.parserId,
  );
  const plan = planRestage(draft.rows, result.transactions);
  const links = await linksTouching(
    prisma as never,
    userId,
    draft.rows.map((row) => draftRowKey(row.id)),
  );
  const removedKeys = new Set(plan.removed.map((row) => draftRowKey(row.id)));
  const lostLinks = links.filter(
    (link) => removedKeys.has(reimbursementKeyOf(link)) || removedKeys.has(expenseKeyOf(link)),
  );
  const carriedCounts: Record<string, number> = {};
  for (const { old, newIndex } of plan.matches)
    for (const field of carryOver(old, parsedTransactions[newIndex], result.transactions[newIndex]).carried)
      carriedCounts[field] = (carriedCounts[field] || 0) + 1;
  const editedRemoved = plan.removed.filter((row) => {
    const p = record(row.currentPayload);
    return String(p.label || "").trim() || p.categoryId || row.reviewStatus === "edited";
  });
  return {
    parserVersion: result.parserVersion || "registry-current",
    raw: result.transactions,
    enriched: parsedTransactions,
    plan,
    lostLinks: lostLinks.length,
    keptLinks: links.length - lostLinks.length,
    carriedCounts,
    lines: {
      added: plan.added.map((index) => rowLine(result.transactions[index])),
      removed: plan.removed.map((row) => rowLine(record(row.currentPayload))),
      editedRemoved: editedRemoved.map((row) => rowLine(record(row.currentPayload))),
      keptAdded: plan.keptAdded.map((row) => rowLine(record(row.currentPayload))),
    },
  };
}
export type RestagePreview = Awaited<ReturnType<typeof previewRestage>>;

/** Write a previewed re-stage. Runs in the ambient transaction (a chat approval) when there is one. */
export async function applyRestage(
  userId: string,
  draft: RestageDraft,
  preview: RestagePreview,
  actor: { actorType: "user" | "system"; actorId?: string },
) {
  const { plan, raw, enriched } = preview;
  return runInTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM import_drafts WHERE id = ${draft.id} AND user_id = ${userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM import_draft_rows WHERE draft_id = ${draft.id} ORDER BY id FOR UPDATE`;
    if (plan.removed.length) {
      const keys = plan.removed.map((row) => draftRowKey(row.id));
      const own = new Set(keys);
      const links = await linksTouching(tx, userId, keys);
      if (links.length) {
        await tx.reimbursementLink.deleteMany({ where: { id: { in: links.map((l) => l.id) } } });
        await refreshAfterDelete(
          tx,
          userId,
          links
            .flatMap((l) => [reimbursementKeyOf(l), expenseKeyOf(l)])
            .filter((key) => !own.has(key)),
        );
      }
      await tx.importDraftRow.deleteMany({
        where: { id: { in: plan.removed.map((row) => row.id) }, draftId: draft.id },
      });
    }
    // Free every row index first: rows move to the new parser order.
    await tx.$executeRaw`UPDATE import_draft_rows SET row_index = -row_index - 1 WHERE draft_id = ${draft.id}`;
    for (const { old, newIndex } of plan.matches) {
      const { payload } = carryOver(old, enriched[newIndex], raw[newIndex]);
      const fixedRuleId = String(record(enriched[newIndex].metadata).fixedRuleId || "");
      await tx.importDraftRow.update({
        where: { id: old.id },
        data: {
          rowIndex: newIndex,
          parsedPayload: raw[newIndex] as Prisma.InputJsonValue,
          currentPayload: storedDraftPayload(payload) as Prisma.InputJsonValue,
          reviewStatus:
            old.reviewStatus === "unresolved" && fixedRuleId ? "auto_applied" : old.reviewStatus,
          provenance: {
            parserId: draft.parserId,
            fields: { parser: Object.keys(raw[newIndex]) },
            restagedFrom: draft.parserVersion,
            ...(fixedRuleId ? { source: "fixed_rule", fixedRuleId } : {}),
          } as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      // Pending suggestions still apply: the carried label and category didn't change.
      await tx.classificationProposal.updateMany({
        where: { draftRowId: old.id, status: "proposed", inputRowVersion: old.version },
        data: { inputRowVersion: old.version + 1 },
      });
    }
    if (plan.added.length)
      await tx.importDraftRow.createMany({
        data: plan.added.map((index) => {
          const fixedRuleId = String(record(enriched[index].metadata).fixedRuleId || "");
          return {
            draftId: draft.id,
            rowIndex: index,
            parsedPayload: raw[index] as Prisma.InputJsonValue,
            currentPayload: storedDraftPayload(enriched[index]) as Prisma.InputJsonValue,
            reviewStatus: fixedRuleId ? "auto_applied" : "unresolved",
            provenance: {
              parserId: draft.parserId,
              fields: { parser: Object.keys(raw[index]) },
              ...(fixedRuleId ? { source: "fixed_rule", fixedRuleId } : {}),
            } as Prisma.InputJsonValue,
          };
        }),
      });
    // Rows added by hand that the parser still doesn't produce go after the parser's rows.
    for (const [offset, row] of plan.keptAdded.entries())
      await tx.importDraftRow.update({
        where: { id: row.id },
        data: { rowIndex: raw.length + offset },
      });
    const next = await tx.importDraft.update({
      where: { id: draft.id },
      data: {
        parserVersion: preview.parserVersion,
        status: "review",
        error: null,
        version: { increment: 1 },
        validationHash: null,
        commitTokenHash: null,
        commitTokenExpiresAt: null,
      },
    });
    await audit(tx, userId, actor, {
      toolName: "restage_import_draft",
      targetType: "import_draft",
      targetId: draft.id,
      metadata: {
        parserId: draft.parserId,
        fromVersion: draft.parserVersion,
        toVersion: preview.parserVersion,
        kept: plan.matches.length,
        added: plan.added.length,
        removed: plan.removed.length,
        keptAdded: plan.keptAdded.length,
      },
    });
    return {
      draftId: next.id,
      version: next.version,
      parserVersion: next.parserVersion,
      kept: plan.matches.length,
      added: plan.added.length,
      removed: plan.removed.length,
      keptAddedRows: plan.keptAdded.length,
      linksRemoved: preview.lostLinks,
    };
  });
}
