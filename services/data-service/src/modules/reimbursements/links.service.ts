import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import {
  databaseContext,
  withTransactionClient,
} from "../../lib/database-context";
import {
  CLOSED_DRAFT_STATUSES,
  EPSILON,
  EndInfo,
  EndRef,
  LinkError,
  LinkRow,
  Role,
  canonicalLinkage,
  capacityOf,
  classifyEndLinks,
  describeEnd,
  draftRowKey,
  endKeyFor,
  expenseKeyOf,
  formatMoney,
  keyOf,
  money,
  normalizeDesired,
  otherRole,
  overLimitMessage,
  pendingWarning,
  refOf,
  reimbursementKeyOf,
  roleProblem,
  sameJson,
  stripLinkFields,
  toNumber,
  transactionKey,
} from "./links.core";

export type Db = Prisma.TransactionClient;

/**
 * Runs `work` in a database transaction. Joins the ambient transaction when
 * one is open (chat approvals), otherwise opens one with room for large imports.
 */
export async function runInTransaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const context = databaseContext.getStore();
  if (context?.transaction) return work(context.client as Db);
  const effects: Array<() => Promise<void>> = [];
  const result = await prisma.$transaction(
    (tx) => withTransactionClient(tx, () => work(tx), effects),
    { timeout: 120_000, maxWait: 15_000 },
  );
  for (const effect of effects) await effect();
  return result;
}

const toLinkRow = (link: {
  id: string;
  amount: unknown;
  reimbursementTransactionId: string | null;
  reimbursementDraftRowId: string | null;
  expenseTransactionId: string | null;
  expenseDraftRowId: string | null;
}): LinkRow => ({
  id: link.id,
  amount: money(toNumber(link.amount)),
  reimbursementTransactionId: link.reimbursementTransactionId,
  reimbursementDraftRowId: link.reimbursementDraftRowId,
  expenseTransactionId: link.expenseTransactionId,
  expenseDraftRowId: link.expenseDraftRowId,
});

const splitKeys = (keys: Iterable<string>) => {
  const transactionIds: string[] = [];
  const rowIds: string[] = [];
  for (const key of new Set(keys)) {
    if (key.startsWith("t:")) transactionIds.push(key.slice(2));
    else rowIds.push(key.slice(2));
  }
  return { transactionIds, rowIds };
};

const payloadRecord = (payload: unknown) =>
  payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};

const linkageTypeOf = (linkage: unknown) => {
  if (!linkage || typeof linkage !== "object") return null;
  const type = (linkage as Record<string, unknown>).type;
  return typeof type === "string" && type !== "reimbursed" ? type : null;
};

export async function loadEnds(db: Db, userId: string, keys: Iterable<string>) {
  const { transactionIds, rowIds } = splitKeys(keys);
  const ends = new Map<string, EndInfo>();
  if (transactionIds.length) {
    const rows = await db.transaction.findMany({
      where: { userId, id: { in: transactionIds } },
      select: {
        id: true,
        amountIn: true,
        amountOut: true,
        linkage: true,
        description: true,
        label: true,
        date: true,
      },
    });
    for (const row of rows) {
      ends.set(transactionKey(row.id), {
        key: transactionKey(row.id),
        kind: "transaction",
        id: row.id,
        amountIn: money(toNumber(row.amountIn)),
        amountOut: money(toNumber(row.amountOut)),
        linkageType: linkageTypeOf(row.linkage),
        linkage: payloadRecord(row.linkage),
        description: row.description,
        label: row.label,
        date: row.date.toISOString(),
      });
    }
  }
  if (rowIds.length) {
    const rows = await db.importDraftRow.findMany({
      where: { id: { in: rowIds }, draft: { userId } },
      select: {
        id: true,
        rowIndex: true,
        selected: true,
        currentPayload: true,
        draft: {
          select: {
            id: true,
            status: true,
            mode: true,
            sourceFilename: true,
            createdAt: true,
          },
        },
      },
    });
    for (const row of rows) {
      const payload = payloadRecord(row.currentPayload);
      ends.set(draftRowKey(row.id), {
        key: draftRowKey(row.id),
        kind: "draftRow",
        id: row.id,
        amountIn: money(toNumber(payload.amountIn)),
        amountOut: money(toNumber(payload.amountOut)),
        linkageType: linkageTypeOf(payload.linkage),
        linkage: payloadRecord(payload.linkage),
        description: String(payload.description || ""),
        label: typeof payload.label === "string" ? payload.label : null,
        date: payload.date ? String(payload.date) : null,
        draftId: row.draft.id,
        draftStatus: row.draft.status,
        draftMode: row.draft.mode,
        draftFilename: row.draft.sourceFilename,
        draftCreatedAt: row.draft.createdAt,
        selected: row.selected,
        rowIndex: row.rowIndex,
      });
    }
  }
  return ends;
}

export async function linksTouching(db: Db, userId: string, keys: Iterable<string>) {
  const { transactionIds, rowIds } = splitKeys(keys);
  if (!transactionIds.length && !rowIds.length) return [];
  const or: Prisma.ReimbursementLinkWhereInput[] = [];
  if (transactionIds.length)
    or.push(
      { reimbursementTransactionId: { in: transactionIds } },
      { expenseTransactionId: { in: transactionIds } },
    );
  if (rowIds.length)
    or.push(
      { reimbursementDraftRowId: { in: rowIds } },
      { expenseDraftRowId: { in: rowIds } },
    );
  const links = await db.reimbursementLink.findMany({
    where: { userId, OR: or },
    orderBy: { createdAt: "asc" },
  });
  return links.map(toLinkRow);
}

/** Row locks so concurrent link writes on the same ends serialize. */
export async function lockEnds(db: Db, userId: string, keys: Iterable<string>) {
  const { transactionIds, rowIds } = splitKeys(keys);
  if (transactionIds.length)
    await db.$queryRaw`SELECT id FROM transactions WHERE user_id=${userId} AND id IN (${Prisma.join(transactionIds.sort())}) ORDER BY id FOR UPDATE`;
  if (rowIds.length)
    await db.$queryRaw`SELECT r.id FROM import_draft_rows r JOIN import_drafts d ON d.id=r.draft_id WHERE d.user_id=${userId} AND r.id IN (${Prisma.join(rowIds.sort())}) ORDER BY r.id FOR UPDATE OF r`;
}

const linkCounterparts = (links: LinkRow[]) =>
  links.flatMap((link) => [reimbursementKeyOf(link), expenseKeyOf(link)]);

/** Rebuild the cached `linkage` JSON on saved transactions from the links table. */
export async function syncTransactionCaches(
  db: Db,
  userId: string,
  transactionIds: Iterable<string>,
) {
  const ids = [...new Set(transactionIds)];
  if (!ids.length) return 0;
  const [rows, links] = await Promise.all([
    db.transaction.findMany({
      where: { userId, id: { in: ids } },
      select: { id: true, amountIn: true, linkage: true },
    }),
    db.reimbursementLink.findMany({
      where: {
        userId,
        reimbursementTransactionId: { not: null },
        expenseTransactionId: { not: null },
        OR: [
          { reimbursementTransactionId: { in: ids } },
          { expenseTransactionId: { in: ids } },
        ],
      },
    }),
  ]);
  let changed = 0;
  for (const row of rows) {
    const asReimbursement = links
      .filter((link) => link.reimbursementTransactionId === row.id)
      .map((link) => ({
        transactionId: link.expenseTransactionId as string,
        amount: toNumber(link.amount),
      }));
    const asExpense = links
      .filter((link) => link.expenseTransactionId === row.id)
      .map((link) => ({
        transactionId: link.reimbursementTransactionId as string,
        amount: toNumber(link.amount),
      }));
    const next = canonicalLinkage(
      row.linkage,
      toNumber(row.amountIn),
      asReimbursement,
      asExpense,
    );
    if (sameJson(next, row.linkage)) continue;
    await db.transaction.update({
      where: { id: row.id },
      data: {
        linkage: next === null ? Prisma.DbNull : (next as Prisma.InputJsonValue),
      },
    });
    changed += 1;
  }
  return changed;
}

/**
 * Staged rows whose links changed get a new version, and their drafts lose
 * any validation, so stale clients and commit tokens are rejected.
 */
export async function touchDraftRows(
  db: Db,
  userId: string,
  rowIds: Iterable<string>,
  except: Iterable<string> = [],
) {
  const skip = new Set(except);
  const ids = [...new Set(rowIds)].filter((id) => !skip.has(id));
  if (!ids.length) return;
  const rows = await db.importDraftRow.findMany({
    where: { id: { in: ids }, draft: { userId } },
    select: { id: true, draftId: true, draft: { select: { status: true } } },
  });
  const open = rows.filter(
    (row) => !CLOSED_DRAFT_STATUSES.includes(row.draft.status),
  );
  if (!open.length) return;
  await db.importDraftRow.updateMany({
    where: { id: { in: open.map((row) => row.id) } },
    data: { version: { increment: 1 } },
  });
  await db.importDraft.updateMany({
    where: { id: { in: [...new Set(open.map((row) => row.draftId))] } },
    data: {
      version: { increment: 1 },
      status: "review",
      validationHash: null,
      commitTokenHash: null,
      commitTokenExpiresAt: null,
    },
  });
}

async function afterLinkChange(
  db: Db,
  userId: string,
  keys: Iterable<string>,
  exceptRowIds: Iterable<string> = [],
) {
  const { transactionIds, rowIds } = splitKeys(keys);
  await syncTransactionCaches(db, userId, transactionIds);
  await touchDraftRows(db, userId, rowIds, exceptRowIds);
}

export type ReplaceLinksInput = {
  subject: EndRef;
  role: Role;
  links: Array<{ other: EndRef; amount: number }>;
  /** Draft ids reviewed together with the subject; their claims count as hard. */
  contextDraftIds?: string[];
  /** Draft rows the caller versions itself (e.g. the row being saved). */
  skipTouchRowIds?: string[];
};

/** True when `links` matches what the subject already holds in `role`. */
export async function isSameLinkSet(
  db: Db,
  userId: string,
  subject: EndRef,
  role: Role,
  links: Array<{ other: EndRef; amount: number }>,
) {
  const subjectKey = keyOf(subject);
  const desired = normalizeDesired(links);
  const desiredKeySet = new Set(desired.map((item) => item.key));
  const existing = (await linksTouching(db, userId, [subjectKey])).filter(
    (link) =>
      endKeyFor(link, role) === subjectKey &&
      (subject.draftRowId ||
        endKeyFor(link, otherRole(role)).startsWith("t:") ||
        desiredKeySet.has(endKeyFor(link, otherRole(role)))),
  );
  if (existing.length !== desired.length) return false;
  const byOther = new Map(
    existing.map((link) => [endKeyFor(link, otherRole(role)), link.amount]),
  );
  return desired.every(
    (item) =>
      byOther.has(item.key) &&
      Math.abs((byOther.get(item.key) as number) - item.amount) < EPSILON,
  );
}

/**
 * Replace every link the subject holds in `role` with `links`. Checks both
 * ends can play their roles and that no limit is exceeded. Must run inside a
 * transaction; a thrown LinkError rolls the change back.
 */
export async function replaceLinks(db: Db, userId: string, input: ReplaceLinksInput) {
  const subjectKey = keyOf(input.subject);
  const desired = normalizeDesired(input.links);
  if (desired.some((item) => item.key === subjectKey))
    throw new LinkError("A transaction cannot reimburse itself");
  const desiredKeySet = new Set(desired.map((item) => item.key));

  // A staged link belongs to its staged row: replacing a saved transaction's
  // links only removes saved links (staged ones it lists are added or updated).
  const existing = (await linksTouching(db, userId, [subjectKey])).filter(
    (link) =>
      endKeyFor(link, input.role) === subjectKey &&
      (input.subject.draftRowId ||
        endKeyFor(link, otherRole(input.role)).startsWith("t:") ||
        desiredKeySet.has(endKeyFor(link, otherRole(input.role)))),
  );
  const otherRoleName = otherRole(input.role);
  const lockKeys = new Set([
    subjectKey,
    ...desired.map((item) => item.key),
    ...existing.map((link) => endKeyFor(link, otherRoleName)),
  ]);
  await lockEnds(db, userId, lockKeys);
  const ends = await loadEnds(db, userId, lockKeys);
  const subject = ends.get(subjectKey);
  if (!subject) throw new LinkError("Transaction not found", 404);

  if (desired.length > 0) {
    const problem = roleProblem(subject, input.role);
    if (problem) throw new LinkError(problem);
  }
  for (const item of desired) {
    const other = ends.get(item.key);
    if (!other)
      throw new LinkError(
        item.key.startsWith("r:")
          ? "A staged row in this link no longer exists"
          : "A linked transaction no longer exists",
        404,
      );
    const problem = roleProblem(other, otherRoleName);
    if (problem) throw new LinkError(problem);
  }

  const existingByOther = new Map(
    existing.map((link) => [endKeyFor(link, otherRoleName), link]),
  );
  const desiredKeys = new Set(desired.map((item) => item.key));
  const changedKeys = new Set<string>();
  const removed = existing.filter(
    (link) => !desiredKeys.has(endKeyFor(link, otherRoleName)),
  );
  if (removed.length) {
    await db.reimbursementLink.deleteMany({
      where: { id: { in: removed.map((link) => link.id) } },
    });
    removed.forEach((link) => changedKeys.add(endKeyFor(link, otherRoleName)));
  }
  for (const item of desired) {
    const current = existingByOther.get(item.key);
    if (current) {
      if (Math.abs(current.amount - item.amount) < EPSILON) continue;
      await db.reimbursementLink.update({
        where: { id: current.id },
        data: { amount: item.amount },
      });
    } else {
      const reimbursement = input.role === "reimbursement" ? subjectKey : item.key;
      const expense = input.role === "reimbursement" ? item.key : subjectKey;
      const r = refOf(reimbursement);
      const e = refOf(expense);
      await db.reimbursementLink.create({
        data: {
          userId,
          amount: item.amount,
          reimbursementTransactionId: r.transactionId ?? null,
          reimbursementDraftRowId: r.draftRowId ?? null,
          expenseTransactionId: e.transactionId ?? null,
          expenseDraftRowId: e.draftRowId ?? null,
        },
      });
    }
    changedKeys.add(item.key);
  }
  if (changedKeys.size) changedKeys.add(subjectKey);

  const checkKeys = [subjectKey, ...desired.map((item) => item.key)];
  const warnings = await checkLimits(db, userId, checkKeys, {
    relatedDraftIds: new Set([
      ...(input.contextDraftIds || []),
      ...checkKeys
        .map((key) => ends.get(key)?.draftId)
        .filter((id): id is string => !!id),
    ]),
    roles: new Map([
      [subjectKey, input.role],
      ...desired.map((item) => [item.key, otherRoleName] as const),
    ]),
  });

  await afterLinkChange(db, userId, changedKeys, input.skipTouchRowIds || []);
  return { warnings, changed: changedKeys.size > 0 };
}

/**
 * Throws when any of `keys` holds more than it can in the given role, and
 * returns warnings for claims from unrelated staged imports.
 */
export async function checkLimits(
  db: Db,
  userId: string,
  keys: string[],
  options: { relatedDraftIds: Set<string>; roles?: Map<string, Role> },
) {
  const links = await linksTouching(db, userId, keys);
  const ends = await loadEnds(db, userId, [...keys, ...linkCounterparts(links)]);
  const warnings: string[] = [];
  for (const key of new Set(keys)) {
    const end = ends.get(key);
    if (!end) continue;
    const roles: Role[] = options.roles?.get(key)
      ? [options.roles.get(key) as Role]
      : ["reimbursement", "expense"];
    for (const role of roles) {
      const { hard, pending } = classifyEndLinks(
        end,
        role,
        links,
        ends,
        options.relatedDraftIds,
      );
      if (hard - capacityOf(end, role) > EPSILON)
        throw new LinkError(overLimitMessage(end, role, hard));
      if (pending.length) warnings.push(...pendingWarning(end, pending));
    }
  }
  return warnings;
}

/** Remove every link where `ref` plays `role`. Returns the keys that changed. */
export async function deleteRoleLinks(
  db: Db,
  userId: string,
  ref: EndRef,
  role: Role,
  options: { skipTouchRowIds?: string[] } = {},
) {
  const key = keyOf(ref);
  const links = (await linksTouching(db, userId, [key])).filter(
    (link) => endKeyFor(link, role) === key,
  );
  if (!links.length) return;
  await db.reimbursementLink.deleteMany({
    where: { id: { in: links.map((link) => link.id) } },
  });
  await afterLinkChange(
    db,
    userId,
    [key, ...links.map((link) => endKeyFor(link, otherRole(role)))],
    options.skipTouchRowIds,
  );
}

/**
 * Saved links must still fit after a transaction's amounts change. Called after
 * the update is written; throws (rolling it back) when they do not.
 */
export async function assertSavedLinksFit(db: Db, userId: string, transactionId: string) {
  const key = transactionKey(transactionId);
  const links = (await linksTouching(db, userId, [key])).filter((link) =>
    !!link.reimbursementTransactionId && !!link.expenseTransactionId,
  );
  if (!links.length) return;
  const ends = await loadEnds(db, userId, [key, ...linkCounterparts(links)]);
  const end = ends.get(key);
  if (!end) return;
  for (const role of ["reimbursement", "expense"] as Role[]) {
    const held = links.filter((link) => endKeyFor(link, role) === key);
    if (!held.length) continue;
    const total = money(held.reduce((sum, link) => sum + link.amount, 0));
    const problem = roleProblem(end, role);
    if (!problem && total - capacityOf(end, role) <= EPSILON) continue;
    const list = held
      .map((link) => {
        const other = ends.get(endKeyFor(link, otherRole(role)));
        return `${other ? describeEnd(other) : "a transaction"} (${formatMoney(link.amount)})`;
      })
      .join(", ");
    throw new LinkError(
      problem
        ? `${problem}, but it is linked to ${list}. Remove those links first.`
        : `${describeEnd(end)} is linked to ${formatMoney(total)} of reimbursements: ${list}. Reduce or remove those links first.`,
    );
  }
}

/** Before deleting saved transactions: the ends whose links will cascade away. */
export async function counterpartsOf(db: Db, userId: string, transactionIds: string[]) {
  if (!transactionIds.length) return [] as string[];
  const deleting = new Set(transactionIds.map(transactionKey));
  const links = await linksTouching(db, userId, deleting);
  return [...new Set(linkCounterparts(links))].filter((key) => !deleting.has(key));
}

export async function refreshAfterDelete(db: Db, userId: string, counterpartKeys: string[]) {
  await afterLinkChange(db, userId, counterpartKeys);
}

/** Drop every link touching a draft's rows (discard or re-parse). */
export async function removeDraftLinks(db: Db, userId: string, draftId: string) {
  const rows = await db.importDraftRow.findMany({
    where: { draftId, draft: { userId } },
    select: { id: true },
  });
  if (!rows.length) return;
  const ownKeys = new Set(rows.map((row) => draftRowKey(row.id)));
  const links = await linksTouching(db, userId, ownKeys);
  if (!links.length) return;
  await db.reimbursementLink.deleteMany({
    where: { id: { in: links.map((link) => link.id) } },
  });
  await afterLinkChange(
    db,
    userId,
    linkCounterparts(links).filter((key) => !ownKeys.has(key)),
  );
}

/** Link data for one staged row, in the shape the review screens read. */
export type DraftRowLinks = {
  asReimbursement: LinkView[];
  asExpense: LinkView[];
  linkedAmount: number;
  capacity: number;
  remaining: number;
  partnerDrafts: Array<{ draftId: string; filename: string }>;
};

export type LinkView = {
  linkId: string;
  amount: number;
  transactionId?: string;
  stagedDraftId?: string;
  stagedRowId?: string;
  rowIndex?: number;
  description: string;
  label: string | null;
  date: string | null;
  filename?: string;
};

const linkView = (link: LinkRow, other: EndInfo | undefined): LinkView => ({
  linkId: link.id,
  amount: link.amount,
  ...(other?.kind === "transaction"
    ? { transactionId: other.id }
    : other
      ? {
          stagedDraftId: other.draftId,
          stagedRowId: other.id,
          rowIndex: other.rowIndex,
          filename: other.draftFilename,
        }
      : {}),
  description: other?.description || "",
  label: other?.label ?? null,
  date: other?.date ?? null,
});

/**
 * Attach link data to staged rows: `links` on the row, and the legacy
 * `linkage.reimbursesAllocations` / `reimbursedByAllocations` on the payload
 * so existing screens keep reading what they did.
 */
export async function decorateDraftRows<
  T extends { id: string; draftId: string; rowIndex: number; currentPayload: unknown },
>(db: Db | typeof prisma, userId: string, rows: T[]) {
  if (!rows.length) return rows.map((row) => ({ ...row, links: emptyLinks(row) }));
  const keys = rows.map((row) => draftRowKey(row.id));
  const links = await linksTouching(db as Db, userId, keys);
  const ends = links.length
    ? await loadEnds(db as Db, userId, linkCounterparts(links))
    : new Map<string, EndInfo>();
  return rows.map((row) => {
    const key = draftRowKey(row.id);
    const payload = payloadRecord(row.currentPayload);
    const asReimbursement = links
      .filter((link) => reimbursementKeyOf(link) === key)
      .map((link) => linkView(link, ends.get(expenseKeyOf(link))));
    const asExpense = links
      .filter((link) => expenseKeyOf(link) === key)
      .map((link) => linkView(link, ends.get(reimbursementKeyOf(link))));
    const linkage = stripLinkFields(payload.linkage);
    const type = linkage?.type;
    const amountIn = money(toNumber(payload.amountIn));
    const amountOut = money(toNumber(payload.amountOut));
    const allocation = (view: LinkView) =>
      view.transactionId
        ? {
            transactionId: view.transactionId,
            amount: view.amount,
            targetDescription: view.label || view.description,
            targetDate: view.date,
          }
        : {
            stagedDraftId: view.stagedDraftId,
            stagedRowId: view.stagedRowId,
            ...(view.stagedDraftId === row.draftId
              ? { pendingBatchIndex: view.rowIndex }
              : {}),
            amount: view.amount,
            targetDescription: view.label || view.description,
            targetDate: view.date,
          };
    let nextLinkage: Record<string, unknown> | null = linkage;
    if (type === "reimbursement") {
      const total = asReimbursement.reduce((sum, view) => sum + view.amount, 0);
      nextLinkage = {
        ...linkage,
        reimbursesAllocations: asReimbursement.map(allocation),
        leftoverAmount: money(Math.max(amountIn - total, 0)),
        leftoverCategoryId: linkage?.leftoverCategoryId ?? null,
      };
    } else if (!type && asExpense.length) {
      nextLinkage = {
        type: "reimbursed",
        reimbursedByAllocations: asExpense.map(allocation),
      };
    }
    const role: Role = type === "reimbursement" ? "reimbursement" : "expense";
    const held = role === "reimbursement" ? asReimbursement : asExpense;
    const linkedAmount = money(held.reduce((sum, view) => sum + view.amount, 0));
    const capacity = role === "reimbursement" ? amountIn : amountOut;
    const partnerDrafts = new Map<string, string>();
    for (const view of [...asReimbursement, ...asExpense])
      if (view.stagedDraftId && view.stagedDraftId !== row.draftId)
        partnerDrafts.set(view.stagedDraftId, view.filename || "another import");
    return {
      ...row,
      currentPayload: { ...payload, linkage: nextLinkage },
      links: {
        asReimbursement,
        asExpense,
        linkedAmount,
        capacity,
        remaining: money(Math.max(capacity - linkedAmount, 0)),
        partnerDrafts: [...partnerDrafts.entries()].map(([draftId, filename]) => ({
          draftId,
          filename,
        })),
      } satisfies DraftRowLinks,
    };
  });
}

const emptyLinks = (row: { currentPayload: unknown }): DraftRowLinks => {
  const payload = payloadRecord(row.currentPayload);
  const capacity =
    linkageTypeOf(payload.linkage) === "reimbursement"
      ? money(toNumber(payload.amountIn))
      : money(toNumber(payload.amountOut));
  return {
    asReimbursement: [],
    asExpense: [],
    linkedAmount: 0,
    capacity,
    remaining: capacity,
    partnerDrafts: [],
  };
};

/**
 * Turn legacy `reimbursesAllocations` on a staged row into link targets.
 * Same-draft rows may be addressed by position (rowIndex), as mobile does.
 */
export async function resolveAllocationTargets(
  db: Db,
  userId: string,
  draftId: string,
  allocations: unknown[],
) {
  const targets: Array<{ other: EndRef; amount: number }> = [];
  const byIndex = new Map<number, string>();
  if (allocations.some((item: any) => typeof item?.pendingBatchIndex === "number" && !item?.stagedRowId && !item?.transactionId)) {
    const rows = await db.importDraftRow.findMany({
      where: { draftId, draft: { userId } },
      select: { id: true, rowIndex: true },
    });
    rows.forEach((row) => byIndex.set(row.rowIndex, row.id));
  }
  for (const raw of allocations) {
    const item = payloadRecord(raw);
    const amount = toNumber(item.amount);
    if (typeof item.stagedRowId === "string" && item.stagedRowId) {
      targets.push({ other: { draftRowId: item.stagedRowId }, amount });
    } else if (typeof item.transactionId === "string" && item.transactionId) {
      targets.push({ other: { transactionId: item.transactionId }, amount });
    } else if (typeof item.pendingBatchIndex === "number") {
      const rowId = byIndex.get(item.pendingBatchIndex);
      if (!rowId)
        throw new LinkError(
          `Row ${item.pendingBatchIndex + 1} of this import does not exist`,
        );
      targets.push({ other: { draftRowId: rowId }, amount });
    } else if (amount > 0) {
      throw new LinkError("A reimbursement link has no target");
    }
  }
  return targets;
}

/**
 * Apply a staged row's new payload to its links: unmarking a reimbursement or
 * marking a row internal drops links it can no longer hold, and an explicit
 * `linkage.reimbursesAllocations` list replaces the row's reimbursement links.
 * Call after the payload is stored. Returns warnings.
 */
export async function applyDraftRowLinkage(
  db: Db,
  userId: string,
  row: { id: string; draftId: string; previousPayload: unknown },
  nextPayload: Record<string, unknown>,
) {
  const previousType = linkageTypeOf(payloadRecord(row.previousPayload).linkage);
  const rawLinkage = payloadRecord(nextPayload.linkage);
  const nextType = linkageTypeOf(nextPayload.linkage);
  const ref = { draftRowId: row.id };
  const skip = { skipTouchRowIds: [row.id] };
  if (previousType === "reimbursement" && nextType !== "reimbursement")
    await deleteRoleLinks(db, userId, ref, "reimbursement", skip);
  if (
    (nextType === "internal" || nextType === "reimbursement") &&
    previousType !== nextType
  )
    await deleteRoleLinks(db, userId, ref, "expense", skip);
  if (nextType === "reimbursement" && Array.isArray(rawLinkage.reimbursesAllocations)) {
    const targets = await resolveAllocationTargets(
      db,
      userId,
      row.draftId,
      rawLinkage.reimbursesAllocations,
    );
    // Clients echo the links they were shown; only an actual change is re-checked.
    if (await isSameLinkSet(db, userId, ref, "reimbursement", targets)) return [];
    const result = await replaceLinks(db, userId, {
      subject: ref,
      role: "reimbursement",
      links: targets,
      skipTouchRowIds: [row.id],
    });
    return result.warnings;
  }
  return [] as string[];
}

/** Payload as stored for a staged row: link data lives in the links table. */
export function storedDraftPayload(payload: Record<string, unknown>) {
  if (!("linkage" in payload)) return payload;
  return { ...payload, linkage: stripLinkFields(payload.linkage) };
}

export type DraftLinkIssue = {
  draftId: string;
  rowId: string;
  rowIndex: number;
  message: string;
};

/**
 * Link checks for drafts about to be committed together (`selection`).
 * Errors block the commit; warnings are claims from other staged imports.
 */
export async function validateDraftLinks(
  db: Db | typeof prisma,
  userId: string,
  draftIds: string[],
  selection: string[] = draftIds,
) {
  const rows = await (db as Db).importDraftRow.findMany({
    where: { draftId: { in: draftIds }, draft: { userId } },
    select: { id: true },
  });
  const errors: DraftLinkIssue[] = [];
  const warnings: DraftLinkIssue[] = [];
  const partnerDraftIds = new Set<string>();
  if (!rows.length) return { errors, warnings, partnerDraftIds: [] as string[] };
  const ownKeys = rows.map((row) => draftRowKey(row.id));
  const links = await linksTouching(db as Db, userId, ownKeys);
  if (!links.length) return { errors, warnings, partnerDraftIds: [] as string[] };
  const ends = await loadEnds(db as Db, userId, [...ownKeys, ...linkCounterparts(links)]);
  const savedKeys = linkCounterparts(links).filter((key) => key.startsWith("t:"));
  const savedLinks = savedKeys.length ? await linksTouching(db as Db, userId, savedKeys) : [];
  const allLinks = new Map([...links, ...savedLinks].map((link) => [link.id, link]));
  const extraEnds = await loadEnds(
    db as Db,
    userId,
    linkCounterparts(savedLinks).filter((key) => !ends.has(key)),
  );
  extraEnds.forEach((end, key) => ends.set(key, end));
  const selectionSet = new Set(selection);
  const ownSet = new Set(draftIds);
  const issue = (end: EndInfo, message: string): DraftLinkIssue => ({
    draftId: end.draftId as string,
    rowId: end.id,
    rowIndex: end.rowIndex ?? 0,
    message,
  });

  for (const link of links) {
    for (const role of ["reimbursement", "expense"] as Role[]) {
      const end = ends.get(endKeyFor(link, role));
      const other = ends.get(endKeyFor(link, otherRole(role)));
      if (!end || end.kind !== "draftRow" || !ownSet.has(end.draftId as string)) continue;
      const problem = roleProblem(end, role);
      if (problem) {
        errors.push(issue(end, `${problem}, but it has reimbursement links. Remove them first.`));
        continue;
      }
      if (!end.selected) {
        errors.push(
          issue(end, `This row is linked to ${other ? describeEnd(other) : "another transaction"} but isn't selected. Select it or remove the link.`),
        );
        continue;
      }
      if (!other) {
        errors.push(issue(end, "This row is linked to a transaction that no longer exists. Remove the link."));
        continue;
      }
      if (other.kind === "draftRow") {
        if (other.draftId && !selectionSet.has(other.draftId)) {
          partnerDraftIds.add(other.draftId);
          errors.push(
            issue(end, `This row is linked to row ${(other.rowIndex ?? 0) + 1} of ${other.draftFilename}. Commit them together or remove the link.`),
          );
        } else if (!other.selected) {
          errors.push(
            issue(end, `This row is linked to ${describeEnd(other)}, which isn't selected. Select it or remove the link.`),
          );
        } else {
          const otherProblem = roleProblem(other, otherRole(role));
          if (otherProblem) errors.push(issue(end, `${otherProblem}, so the link to this row can't be saved.`));
        }
      } else {
        const otherProblem = roleProblem(other, otherRole(role));
        if (otherProblem) errors.push(issue(end, `${otherProblem}, so the link to this row can't be saved.`));
      }
    }
  }

  const related = selectionSet;
  const checked = new Set<string>();
  for (const link of links) {
    for (const role of ["reimbursement", "expense"] as Role[]) {
      const key = endKeyFor(link, role);
      if (checked.has(`${key}:${role}`)) continue;
      checked.add(`${key}:${role}`);
      const end = ends.get(key);
      if (!end) continue;
      const { hard, pending } = classifyEndLinks(end, role, [...allLinks.values()], ends, related);
      if (hard - capacityOf(end, role) > EPSILON) {
        const anchor =
          end.kind === "draftRow" && ownSet.has(end.draftId as string)
            ? end
            : ends.get(endKeyFor(link, otherRole(role)));
        if (anchor && anchor.kind === "draftRow")
          errors.push(issue(anchor, overLimitMessage(end, role, hard)));
      } else if (pending.length && end.kind === "transaction") {
        const anchor = ends.get(endKeyFor(link, otherRole(role)));
        if (anchor && anchor.kind === "draftRow")
          pendingWarning(end, pending).forEach((message) =>
            warnings.push(issue(anchor, message)),
          );
      }
    }
  }
  const unique = (items: DraftLinkIssue[]) => {
    const seen = new Set<string>();
    return items.filter((item) => {
      const id = `${item.rowId}:${item.message}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };
  return {
    errors: unique(errors),
    warnings: unique(warnings),
    partnerDraftIds: [...partnerDraftIds],
  };
}

/**
 * After committed rows became transactions: point their links at the new
 * transactions, re-check limits under lock, and refresh the caches.
 */
export async function swapCommittedRows(
  db: Db,
  userId: string,
  rowToTransaction: Map<string, string>,
) {
  if (!rowToTransaction.size) return;
  const rowKeys = [...rowToTransaction.keys()].map(draftRowKey);
  const links = await linksTouching(db, userId, rowKeys);
  if (!links.length) return;
  const savedKeys = linkCounterparts(links).filter((key) => key.startsWith("t:"));
  await lockEnds(db, userId, savedKeys);
  for (const link of links) {
    const reimbursementTx = link.reimbursementDraftRowId
      ? rowToTransaction.get(link.reimbursementDraftRowId)
      : undefined;
    const expenseTx = link.expenseDraftRowId
      ? rowToTransaction.get(link.expenseDraftRowId)
      : undefined;
    const reimbursementSaved = reimbursementTx || link.reimbursementTransactionId;
    const expenseSaved = expenseTx || link.expenseTransactionId;
    if (!reimbursementSaved || !expenseSaved)
      throw new LinkError(
        "A reimbursement link points at a staged import that is not part of this commit. Commit them together or remove the link.",
        409,
      );
    await db.reimbursementLink.update({
      where: { id: link.id },
      data: {
        reimbursementTransactionId: reimbursementSaved,
        reimbursementDraftRowId: null,
        expenseTransactionId: expenseSaved,
        expenseDraftRowId: null,
      },
    });
  }
  const touched = new Set<string>();
  for (const link of links) {
    touched.add(
      transactionKey(
        (link.reimbursementDraftRowId
          ? rowToTransaction.get(link.reimbursementDraftRowId)
          : link.reimbursementTransactionId) as string,
      ),
    );
    touched.add(
      transactionKey(
        (link.expenseDraftRowId
          ? rowToTransaction.get(link.expenseDraftRowId)
          : link.expenseTransactionId) as string,
      ),
    );
  }
  const savedLinks = (await linksTouching(db, userId, touched)).filter(
    (link) => !!link.reimbursementTransactionId && !!link.expenseTransactionId,
  );
  const ends = await loadEnds(db, userId, [...touched, ...linkCounterparts(savedLinks)]);
  for (const key of touched) {
    const end = ends.get(key);
    if (!end) continue;
    for (const role of ["reimbursement", "expense"] as Role[]) {
      const held = savedLinks.filter((link) => endKeyFor(link, role) === key);
      if (!held.length) continue;
      const problem = roleProblem(end, role);
      if (problem) throw new LinkError(`${problem}, so its reimbursement links can't be saved.`, 409);
      const total = money(held.reduce((sum, link) => sum + link.amount, 0));
      if (total - capacityOf(end, role) > EPSILON)
        throw new LinkError(
          `${overLimitMessage(end, role, total)}. Another import or edit used part of it after this one was staged.`,
          409,
        );
    }
  }
  await syncTransactionCaches(db, userId, splitKeys(touched).transactionIds);
}
