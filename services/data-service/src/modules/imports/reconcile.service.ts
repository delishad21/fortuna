/**
 * Reconcile mode for staged statements, against the database: loads the
 * logged entries a draft's plan is worked out from (reconcile-plan.ts), saves
 * the user's overrides, and applies the plan when the draft is committed.
 *
 * Committing a match confirms the logged entry rather than saving the
 * statement row: the entry keeps its id, category, label, image, review state,
 * reimbursement links and trip records, and gains the bank's data. Links the
 * staged row had move to the entry through the links service (the caller maps
 * the row to the entry for swapCommittedRows).
 */
import { Prisma } from "@prisma/client";
import {
  RECONCILE_LAG_DAYS,
  RECONCILE_LEAD_DAYS,
  scoreReconcilePair,
} from "../duplicates/reconcile-scoring";
import {
  assertSavedLinksFit,
  counterpartsOf,
  lockEnds,
  refreshAfterDelete,
  syncTransactionCaches,
  type Db,
} from "../reimbursements/links.service";
import { transactionKey } from "../reimbursements/links.core";
import { TripRepository } from "../trips/trips.repository";
import {
  buildReconcilePlan,
  matchingWindow,
  statementPeriods,
  type ElsewhereHint,
  type LeftoverAction,
  type ReconcileEntry,
  type ReconcileOverrides,
  type ReconcilePlan,
  type ReconcileRow,
} from "./reconcile-plan";

type DraftLike = {
  id: string;
  mode: string;
  status: string;
  sourceFilename: string;
  parserId: string | null;
  reconcileOverrides?: unknown;
  rows: Array<{ id: string; rowIndex: number; selected: boolean; currentPayload: unknown }>;
};

const CLOSED = ["committed", "discarded", "expired"];

export class ReconcileError extends Error {
  constructor(message: string, public status = 409) {
    super(message);
  }
}

const record = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
const amount = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : Number(value);
const day = (value: unknown) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value || "").slice(0, 10);

export function readOverrides(value: unknown): ReconcileOverrides {
  const stored = record(value);
  return { rows: record(stored.rows), entries: record(stored.entries) } as ReconcileOverrides;
}

/** The last 4 card digits a statement row names, when its parser gave them. */
function rowCardLast4(payload: Record<string, any>) {
  const value = payload.cardLast4 ?? payload.metadata?.cardLast4 ?? payload.metadata?.cardNumber;
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

const entrySelect = {
  id: true,
  accountId: true,
  date: true,
  description: true,
  label: true,
  amountIn: true,
  amountOut: true,
  currency: true,
  entrySource: true,
  categoryId: true,
  reviewStatus: true,
  imageId: true,
  metadata: true,
  reconciled: true,
  card: { select: { last4: true } },
  account: { select: { name: true } },
} satisfies Prisma.TransactionSelect;

function toEntry(row: Prisma.TransactionGetPayload<{ select: typeof entrySelect }>): ReconcileEntry {
  return {
    id: row.id,
    accountId: row.accountId,
    accountName: row.account?.name ?? null,
    cardLast4: row.card?.last4 ?? null,
    date: day(row.date),
    description: row.description,
    label: row.label,
    amountIn: amount(row.amountIn),
    amountOut: amount(row.amountOut),
    currency: row.currency,
    entrySource: row.entrySource,
    categoryId: row.categoryId,
    reviewStatus: row.reviewStatus,
    imageId: row.imageId,
    metadata: row.metadata,
    available: !row.reconciled,
  };
}

/** The draft's rows with the account each one belongs to. */
export async function reconcileRows(db: Db, userId: string, draft: DraftLike): Promise<ReconcileRow[]> {
  const payloads = draft.rows.map((row) => record(row.currentPayload));
  const identifiers = [
    ...new Set(payloads.map((payload) => String(payload.accountIdentifier || "").trim()).filter(Boolean)),
  ];
  const mapped = identifiers.length
    ? await db.accountIdentifier.findMany({
        where: { userId, accountIdentifier: { in: identifiers } },
        select: { accountIdentifier: true, accountId: true },
      })
    : [];
  const accountOf = new Map(mapped.map((item) => [item.accountIdentifier, item.accountId]));
  return draft.rows.map((row, index) => {
    const payload = payloads[index];
    return {
      rowId: row.id,
      rowIndex: row.rowIndex,
      selected: row.selected,
      accountId: accountOf.get(String(payload.accountIdentifier || "").trim()) || null,
      date: day(payload.date),
      description: String(payload.description || ""),
      amountIn: amount(payload.amountIn),
      amountOut: amount(payload.amountOut),
      currency: payload.currency ? String(payload.currency) : null,
      cardLast4: rowCardLast4(payload),
      metadata: payload.metadata,
    };
  });
}

/**
 * The plan for a staged main-ledger draft, or null when it has nothing to
 * reconcile (nothing logged for its accounts and period) or is closed.
 */
export async function loadReconcilePlan(
  db: Db,
  userId: string,
  draft: DraftLike,
): Promise<ReconcilePlan | null> {
  if (draft.mode !== "main" || CLOSED.includes(draft.status) || !draft.rows.length) return null;
  const rows = await reconcileRows(db, userId, draft);
  const overrides = readOverrides(draft.reconcileOverrides);
  const periods = statementPeriods(rows);
  const manualIds = [
    ...new Set(Object.values(overrides.rows || {}).filter((id): id is string => typeof id === "string")),
  ];
  if (!periods.size && !manualIds.length) return null;

  const windows = [...periods.entries()].map(([accountId, period]) => ({
    accountId,
    ...matchingWindow(period),
  }));
  const [scoped, manual] = await Promise.all([
    windows.length
      ? db.transaction.findMany({
          where: {
            userId,
            reconciled: false,
            OR: windows.map((window) => ({
              accountId: window.accountId,
              date: { gte: new Date(`${window.from}T00:00:00Z`), lt: new Date(`${window.to}T00:00:00Z`) },
            })),
          },
          select: entrySelect,
          orderBy: [{ date: "asc" }, { id: "asc" }],
        })
      : [],
    manualIds.length
      ? db.transaction.findMany({ where: { userId, id: { in: manualIds } }, select: entrySelect })
      : [],
  ]);
  const byId = new Map([...scoped, ...manual].map((row) => [row.id, toEntry(row)]));
  const entries = [...byId.values()];
  if (!entries.length && !manualIds.length) return null;

  const accountIds = [
    ...new Set([...periods.keys(), ...entries.map((entry) => entry.accountId).filter(Boolean) as string[]]),
  ];
  const accounts = await db.financialAccount.findMany({
    where: { userId, id: { in: accountIds } },
    select: { id: true, name: true },
  });
  const accountNames = Object.fromEntries(accounts.map((account) => [account.id, account.name]));
  const elsewhere = await findElsewhere(db, userId, entries, periods);
  return buildReconcilePlan({ rows, entries, overrides, elsewhere, accountNames });
}

/**
 * Entries a statement of another account already shows: saved, confirmed rows
 * on another account with the same amount, a date the bank could have posted
 * it on and a matching description. Such an entry was logged on the wrong account.
 */
async function findElsewhere(
  db: Db,
  userId: string,
  entries: ReconcileEntry[],
  periods: Map<string, { from: string; to: string }>,
): Promise<ElsewhereHint[]> {
  const inPeriod = entries.filter((entry) => {
    const period = entry.accountId ? periods.get(entry.accountId) : undefined;
    return entry.available !== false && period && entry.date >= period.from && entry.date <= period.to;
  });
  if (!inPeriod.length) return [];
  const dates = inPeriod.map((entry) => entry.date).sort();
  // The other statement may date it a day earlier or post it up to the lag later.
  const from = new Date(Date.parse(`${dates[0]}T00:00:00Z`) - RECONCILE_LEAD_DAYS * 86_400_000);
  const to = new Date(Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) + (RECONCILE_LAG_DAYS + 1) * 86_400_000);
  const amountsOut = [...new Set(inPeriod.map((entry) => entry.amountOut).filter((v): v is number => !!v && v > 0))];
  const amountsIn = [...new Set(inPeriod.map((entry) => entry.amountIn).filter((v): v is number => !!v && v > 0))];
  const saved = await db.transaction.findMany({
    where: {
      userId,
      reconciled: true,
      accountId: { not: null, notIn: [...periods.keys()] },
      date: { gte: from, lt: to },
      OR: [
        ...(amountsOut.length ? [{ amountOut: { in: amountsOut } }] : []),
        ...(amountsIn.length ? [{ amountIn: { in: amountsIn } }] : []),
      ],
    },
    select: entrySelect,
    take: 500,
  });
  const hints: ElsewhereHint[] = [];
  for (const entry of inPeriod) {
    for (const row of saved) {
      const statement = toEntry(row);
      const score = scoreReconcilePair(
        statement,
        { date: entry.date, description: entry.description, label: entry.label, amountIn: entry.amountIn, amountOut: entry.amountOut, metadata: entry.metadata },
      );
      if (!score?.exactAmount || !score.reasons.some((reason) => /merchant|description/i.test(reason))) continue;
      hints.push({
        entryId: entry.id,
        accountId: row.accountId as string,
        accountName: row.account?.name || "another account",
        transactionId: row.id,
        date: day(row.date),
        description: row.description,
      });
      break;
    }
  }
  return hints;
}

export type OverrideInput = {
  rows?: Array<{ rowId: string; transactionId: string | null | "auto" }>;
  entries?: Array<{ transactionId: string; action: LeftoverAction; accountId?: string | null }>;
};

/**
 * Save the user's choices: a row's match (an entry, null for none, "auto" to
 * let Fortuna pick again) and what happens to entries the statement lacks.
 * Matching by hand works across accounts: on commit the entry moves to the
 * statement's account. Returns the next overrides; the caller bumps the draft.
 */
export async function nextOverrides(
  db: Db,
  userId: string,
  draft: DraftLike,
  input: OverrideInput,
): Promise<ReconcileOverrides> {
  if (draft.mode !== "main")
    throw new ReconcileError("Only bank statement imports reconcile against logged entries", 409);
  const current = readOverrides(draft.reconcileOverrides);
  const rows = { ...(current.rows || {}) };
  const entries = { ...(current.entries || {}) };
  const rowIds = new Set(draft.rows.map((row) => row.id));
  const wanted = [
    ...(input.rows || []).flatMap((item) =>
      item.transactionId && item.transactionId !== "auto" ? [item.transactionId] : [],
    ),
    ...(input.entries || []).map((item) => item.transactionId),
  ];
  const found = wanted.length
    ? await db.transaction.findMany({
        where: { userId, id: { in: [...new Set(wanted)] } },
        select: { id: true, reconciled: true },
      })
    : [];
  const known = new Map(found.map((item) => [item.id, item]));
  for (const item of input.rows || []) {
    if (!rowIds.has(item.rowId)) throw new ReconcileError(`Row ${item.rowId} isn't in this draft`, 404);
    if (item.transactionId === "auto") {
      delete rows[item.rowId];
      continue;
    }
    if (item.transactionId) {
      const entry = known.get(item.transactionId);
      if (!entry) throw new ReconcileError("Transaction not found", 404);
      if (entry.reconciled)
        throw new ReconcileError("That transaction is already confirmed by a statement", 409);
      // An entry belongs to one row: matching it here unmatches it elsewhere.
      for (const [rowId, transactionId] of Object.entries(rows))
        if (transactionId === item.transactionId && rowId !== item.rowId) rows[rowId] = null;
      delete entries[item.transactionId];
    }
    rows[item.rowId] = item.transactionId;
  }
  const accountIds = [
    ...new Set((input.entries || []).flatMap((item) => (item.action === "move" && item.accountId ? [item.accountId] : []))),
  ];
  const accounts = accountIds.length
    ? await db.financialAccount.findMany({ where: { userId, id: { in: accountIds } }, select: { id: true } })
    : [];
  for (const item of input.entries || []) {
    if (!known.has(item.transactionId)) throw new ReconcileError("Transaction not found", 404);
    if (item.action === "move") {
      if (!item.accountId) throw new ReconcileError("Choose the account to move it to", 400);
      if (!accounts.some((account) => account.id === item.accountId))
        throw new ReconcileError("Account not found", 404);
      entries[item.transactionId] = { action: "move", accountId: item.accountId };
    } else if (item.action === "delete") entries[item.transactionId] = { action: "delete" };
    else delete entries[item.transactionId];
  }
  return { rows, entries };
}

export type ReconcileCommitResult = {
  matched: number;
  amountsCorrected: number;
  deleted: number;
  moved: number;
  kept: number;
  matchedTransactionIds: string[];
};

/**
 * Apply a draft's plan in the commit's database transaction: confirm matched
 * entries with the bank's data, then delete or move leftovers as chosen.
 * `payloadOf` gives a row's stored payload; `batchId` is the import's batch.
 */
export async function applyReconcilePlan(
  db: Db,
  userId: string,
  plan: ReconcilePlan,
  input: {
    batchId: string | null;
    draft: { id: string; sourceFilename: string; parserId: string | null };
    payloadOf: (rowId: string) => Record<string, any>;
    accountOf: (rowId: string) => string | null;
  },
): Promise<ReconcileCommitResult> {
  const ids = [
    ...plan.matched.map((match) => match.transactionId),
    ...plan.leftovers.filter((item) => item.action !== "keep").map((item) => item.entry.id),
  ];
  if (ids.length) await lockEnds(db, userId, ids.map(transactionKey));
  const current = ids.length
    ? await db.transaction.findMany({
        where: { userId, id: { in: ids } },
        select: { id: true, reconciled: true, accountId: true, amountIn: true, amountOut: true, currency: true, metadata: true, balance: true },
      })
    : [];
  const byId = new Map(current.map((row) => [row.id, row]));
  const now = new Date();
  const amountChanged: string[] = [];

  for (const match of plan.matched) {
    if (match.errors.length) throw new ReconcileError(match.errors[0]);
    const entry = byId.get(match.transactionId);
    if (!entry || entry.reconciled)
      throw new ReconcileError(
        `${input.draft.sourceFilename}: the entry matched to row ${match.rowIndex + 1} was confirmed or removed in the meantime. Review the import again.`,
      );
    const payload = input.payloadOf(match.rowId);
    const statementIn = amount(payload.amountIn);
    const statementOut = amount(payload.amountOut);
    const loggedIn = amount(entry.amountIn);
    const loggedOut = amount(entry.amountOut);
    const sameAmount =
      Math.round((statementIn || 0) * 100) === Math.round((loggedIn || 0) * 100) &&
      Math.round((statementOut || 0) * 100) === Math.round((loggedOut || 0) * 100);
    const statementCurrency = String(payload.currency || payload.metadata?.currency || entry.currency).toUpperCase();
    const sameCurrency = statementCurrency === String(entry.currency).toUpperCase();
    const rowMetadata = record(payload.metadata);
    const existing = record(entry.metadata);
    // The parser's own fields fill gaps; the entry's metadata wins on conflicts.
    const metadata: Record<string, any> = {
      ...Object.fromEntries(
        Object.entries(rowMetadata).filter(([key]) => !(key in existing) && !key.startsWith("_")),
      ),
      ...existing,
      postedDate: day(payload.date),
      statementDescription: String(payload.description || ""),
      sourceFilename: input.draft.sourceFilename,
      ...(input.draft.parserId ? { parserId: input.draft.parserId } : {}),
      reconciledFrom: {
        draftId: input.draft.id,
        rowIndex: match.rowIndex,
        mode: match.mode,
        ...(match.score !== null ? { score: match.score } : {}),
      },
      ...(!sameAmount || !sameCurrency
        ? { loggedAmount: { amountIn: loggedIn, amountOut: loggedOut, currency: entry.currency } }
        : {}),
    };
    const accountId = input.accountOf(match.rowId);
    await db.transaction.update({
      where: { id: entry.id },
      data: {
        reconciled: true,
        reconciledAt: now,
        importBatchId: input.batchId,
        ...(payload.balance !== undefined && payload.balance !== null && payload.balance !== ""
          ? { balance: Number(payload.balance) }
          : {}),
        ...(sameAmount ? {} : { amountIn: statementIn, amountOut: statementOut }),
        ...(sameCurrency ? {} : { currency: statementCurrency }),
        ...(accountId && accountId !== entry.accountId
          ? { accountId, accountIdentifier: String(payload.accountIdentifier || "").trim() || undefined }
          : {}),
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
    if (!sameAmount) amountChanged.push(entry.id);
  }
  if (amountChanged.length) {
    // The statement amount must still cover what links already allocate.
    for (const id of amountChanged) await assertSavedLinksFit(db, userId, id);
    await syncTransactionCaches(db, userId, amountChanged);
    await TripRepository.syncBankTransactionAmountsTx(db, userId, amountChanged);
  }

  const toDelete: string[] = [];
  let moved = 0;
  for (const leftover of plan.leftovers) {
    if (leftover.action === "keep") continue;
    if (leftover.errors.length) throw new ReconcileError(leftover.errors[0]);
    const entry = byId.get(leftover.entry.id);
    if (!entry || entry.reconciled)
      throw new ReconcileError(
        `${input.draft.sourceFilename}: "${leftover.entry.label || leftover.entry.description}" changed in the meantime. Review the import again.`,
      );
    if (leftover.action === "delete") toDelete.push(entry.id);
    else if (leftover.accountId) {
      await db.transaction.update({ where: { id: entry.id }, data: { accountId: leftover.accountId } });
      moved += 1;
    }
  }
  if (toDelete.length) {
    // Same path as deleting a transaction: trip records let go of it and links are cleaned up.
    await TripRepository.detachBankTransactionsTx(db, userId, toDelete, "deleted");
    const counterparts = await counterpartsOf(db, userId, toDelete);
    await db.transaction.deleteMany({ where: { userId, id: { in: toDelete } } });
    await refreshAfterDelete(db, userId, counterparts);
  }
  return {
    matched: plan.matched.length,
    amountsCorrected: amountChanged.length,
    deleted: toDelete.length,
    moved,
    kept: plan.leftovers.filter((item) => item.action === "keep").length,
    matchedTransactionIds: plan.matched.map((match) => match.transactionId),
  };
}
