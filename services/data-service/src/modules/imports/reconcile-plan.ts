/**
 * Reconciling a staged statement against entries already logged for its
 * account (assistant, manual or phone entries that no statement has confirmed
 * yet). Splits the statement into three groups:
 * - matched: a statement row pairs with a logged entry; committing confirms the
 *   entry with the bank's data instead of saving a second row;
 * - gaps: statement rows nothing was logged for; committed as new rows, as a
 *   plain import does;
 * - leftovers: entries logged in the statement's period that it doesn't show,
 *   each with the likely reason and what to do with it.
 * The plan is worked out on every read from the rows, the entries and the
 * user's overrides (stored on the draft), so it follows edits by itself. With
 * nothing logged for the statement's accounts there is no plan and the import
 * is the plain one.
 */
import {
  RECONCILE_LAG_DAYS,
  daysBetween,
  merchantSimilarity,
  scoreReconcilePair,
  withinAmountTolerance,
} from "../duplicates/reconcile-scoring";

export type ReconcileRow = {
  rowId: string;
  rowIndex: number;
  selected: boolean;
  /** The account the row's accountIdentifier belongs to; rows without one aren't reconciled. */
  accountId: string | null;
  date: string;
  description: string;
  amountIn: number | null;
  amountOut: number | null;
  currency?: string | null;
  cardLast4?: string | null;
  metadata?: unknown;
};

export type ReconcileEntry = {
  id: string;
  accountId: string | null;
  accountName?: string | null;
  cardLast4?: string | null;
  date: string;
  description: string;
  label?: string | null;
  amountIn: number | null;
  amountOut: number | null;
  currency?: string | null;
  entrySource: string;
  categoryId?: string | null;
  reviewStatus?: string | null;
  imageId?: string | null;
  metadata?: unknown;
  /** False when a statement has confirmed it since it was picked: it can't be matched any more. */
  available?: boolean;
};

export type LeftoverAction = "keep" | "delete" | "move";

export type ReconcileOverrides = {
  /** A row's match chosen by hand: an entry id, or null for "no match". Rows not listed are matched automatically. */
  rows?: Record<string, string | null>;
  /** What to do with entries the statement doesn't show. Entries not listed are kept. */
  entries?: Record<string, { action: LeftoverAction; accountId?: string | null }>;
};

/** An entry the statement seems to show on another account (a saved statement row there). */
export type ElsewhereHint = {
  entryId: string;
  accountId: string;
  accountName: string;
  transactionId: string;
  date: string;
  description: string;
};

export type LeftoverReasonCode = "pending" | "possible_duplicate" | "wrong_amount" | "wrong_account" | "not_found";

export type LeftoverReason = {
  code: LeftoverReasonCode;
  message: string;
  /** wrong_amount: the statement row it probably is. */
  rowId?: string;
  /** wrong_account: the account the bank shows it on. */
  accountId?: string;
  /** possible_duplicate: the entry it repeats. */
  transactionId?: string;
};

export type EntrySummary = {
  id: string;
  accountId: string | null;
  accountName: string | null;
  date: string;
  description: string;
  label: string | null;
  amountIn: number | null;
  amountOut: number | null;
  currency: string | null;
  entrySource: string;
  categoryId: string | null;
  reviewStatus: string | null;
  imageId: string | null;
};

export type ReconcileMatch = {
  rowId: string;
  rowIndex: number;
  transactionId: string;
  entry: EntrySummary;
  /** auto: proposed by Fortuna; manual: chosen by the user. */
  mode: "auto" | "manual";
  score: number | null;
  reasons: string[];
  /** Days from the logged date to the statement date. */
  days: number;
  /** Statement amount minus the logged amount; the statement amount is saved. */
  amountDifference: number;
  warnings: string[];
  /** Blocks the commit (e.g. a manual match to an entry going the other way). */
  errors: string[];
};

export type ReconcileGap = {
  rowId: string;
  rowIndex: number;
  /** The user chose "no match" for this row. */
  unmatched: boolean;
  /** Unmatched entries this row could be, best first, for matching by hand. */
  candidates: Array<{ transactionId: string; score: number; reasons: string[] }>;
};

export type ReconcileLeftover = {
  entry: EntrySummary;
  reasons: LeftoverReason[];
  action: LeftoverAction;
  /** move: the account it goes to. */
  accountId: string | null;
  /** What Fortuna would do with it; the user decides. */
  suggestedAction: LeftoverAction | "link";
  /** link: the statement row it probably is. */
  suggestedRowId: string | null;
  errors: string[];
};

export type ReconcilePlan = {
  accounts: Array<{ accountId: string; from: string; to: string; logged: number }>;
  matched: ReconcileMatch[];
  gaps: ReconcileGap[];
  leftovers: ReconcileLeftover[];
  summary: {
    matched: number;
    gaps: number;
    leftovers: number;
    amountWarnings: number;
    toDelete: number;
    toMove: number;
    errors: number;
  };
};

/** A leftover logged this close to the statement's last day may still be pending. */
export const PENDING_DAYS = 3;

const cents = (value: number | null | undefined) => Math.round(Number(value || 0) * 100);
const money = (value: number) => value.toFixed(2);
const day = (value: string) => String(value).slice(0, 10);
const amountText = (side: { amountIn: number | null; amountOut: number | null }) =>
  cents(side.amountIn) > 0 ? `+${money(Number(side.amountIn))}` : money(Number(side.amountOut || 0));
const direction = (side: { amountIn: number | null; amountOut: number | null }) =>
  cents(side.amountIn) > 0 ? "in" : cents(side.amountOut) > 0 ? "out" : null;
const addDays = (value: string, days: number) =>
  new Date(Date.parse(`${day(value)}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function summarizeEntry(entry: ReconcileEntry): EntrySummary {
  return {
    id: entry.id,
    accountId: entry.accountId,
    accountName: entry.accountName ?? null,
    date: day(entry.date),
    description: entry.description,
    label: entry.label ?? null,
    amountIn: entry.amountIn,
    amountOut: entry.amountOut,
    currency: entry.currency ?? null,
    entrySource: entry.entrySource,
    categoryId: entry.categoryId ?? null,
    reviewStatus: entry.reviewStatus ?? null,
    imageId: entry.imageId ?? null,
  };
}

/** The period each account's selected rows cover. */
export function statementPeriods(rows: ReconcileRow[]) {
  const periods = new Map<string, { from: string; to: string }>();
  for (const row of rows) {
    if (!row.selected || !row.accountId || !day(row.date)) continue;
    const current = periods.get(row.accountId);
    const date = day(row.date);
    if (!current) periods.set(row.accountId, { from: date, to: date });
    else {
      if (date < current.from) current.from = date;
      if (date > current.to) current.to = date;
    }
  }
  return periods;
}

/** The dates logged entries are looked up in: a purchase may post on the statement up to the lag later. */
export function matchingWindow(period: { from: string; to: string }) {
  return { from: addDays(period.from, -RECONCILE_LAG_DAYS), to: addDays(period.to, 1) };
}

const rowSide = (row: ReconcileRow) => ({
  date: row.date,
  description: row.description,
  amountIn: row.amountIn,
  amountOut: row.amountOut,
  cardLast4: row.cardLast4,
  metadata: row.metadata,
});
const entrySide = (entry: ReconcileEntry) => ({
  date: entry.date,
  description: entry.description,
  label: entry.label,
  amountIn: entry.amountIn,
  amountOut: entry.amountOut,
  cardLast4: entry.cardLast4,
  metadata: entry.metadata,
});

/**
 * Works out the plan. `entries` are the unconfirmed entries of the statement's
 * accounts in its matching window, plus any entry a row was matched to by hand.
 * Returns null when there is nothing to reconcile, so the import stays plain.
 */
export function buildReconcilePlan(input: {
  rows: ReconcileRow[];
  entries: ReconcileEntry[];
  overrides?: ReconcileOverrides | null;
  elsewhere?: ElsewhereHint[];
  accountNames?: Record<string, string>;
}): ReconcilePlan | null {
  const overrides = input.overrides || {};
  const rowOverrides = overrides.rows || {};
  const entryOverrides = overrides.entries || {};
  const periods = statementPeriods(input.rows);
  const selected = input.rows.filter((row) => row.selected);
  const entriesById = new Map(input.entries.map((entry) => [entry.id, entry]));

  const inWindow = (entry: ReconcileEntry) => {
    const period = entry.accountId ? periods.get(entry.accountId) : undefined;
    if (!period) return false;
    const window = matchingWindow(period);
    return day(entry.date) >= window.from && day(entry.date) < window.to;
  };
  const inPeriod = (entry: ReconcileEntry) => {
    const period = entry.accountId ? periods.get(entry.accountId) : undefined;
    return !!period && day(entry.date) >= period.from && day(entry.date) <= period.to;
  };
  const scoped = input.entries.filter((entry) => entry.available !== false && inWindow(entry));
  const manualIds = new Set(
    selected.flatMap((row) => {
      const id = rowOverrides[row.rowId];
      return id ? [id] : [];
    }),
  );
  if (!scoped.length && !manualIds.size) return null;

  const matched: ReconcileMatch[] = [];
  const claimedEntries = new Set<string>();
  const claimedRows = new Set<string>();
  const accountName = (accountId: string | null | undefined) =>
    (accountId && input.accountNames?.[accountId]) || "another account";

  // Matches made by hand come first and are kept whatever the scores say.
  for (const row of selected) {
    const id = rowOverrides[row.rowId];
    if (!id) continue;
    const entry = entriesById.get(id);
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!entry || entry.available === false) {
      errors.push("The entry matched to this row is gone or was confirmed by another statement. Match it again.");
    } else if (claimedEntries.has(id)) {
      errors.push("Another row is matched to the same entry.");
    }
    if (!entry) {
      claimedRows.add(row.rowId);
      matched.push({
        rowId: row.rowId,
        rowIndex: row.rowIndex,
        transactionId: id,
        entry: {
          id, accountId: null, accountName: null, date: "", description: "", label: null,
          amountIn: null, amountOut: null, currency: null, entrySource: "", categoryId: null,
          reviewStatus: null, imageId: null,
        },
        mode: "manual",
        score: null,
        reasons: ["Matched by hand"],
        days: 0,
        amountDifference: 0,
        warnings,
        errors,
      });
      continue;
    }
    const score = scoreReconcilePair(rowSide(row), entrySide(entry));
    if (direction(row) !== direction(entry))
      errors.push("This row and the entry go in opposite directions (money in vs money out).");
    const difference = (cents(row.amountIn || row.amountOut) - cents(entry.amountIn || entry.amountOut)) / 100;
    if (difference !== 0 && !errors.length)
      warnings.push(
        `The statement shows ${amountText(row)}, the entry ${amountText(entry)}; the statement amount is saved and the logged one kept in its details.`,
      );
    if (entry.accountId !== row.accountId)
      warnings.push(`Logged on ${accountName(entry.accountId)}; it moves to this statement's account.`);
    claimedEntries.add(id);
    claimedRows.add(row.rowId);
    matched.push({
      rowId: row.rowId,
      rowIndex: row.rowIndex,
      transactionId: id,
      entry: summarizeEntry(entry),
      mode: "manual",
      score: score?.score ?? null,
      reasons: ["Matched by hand", ...(score?.reasons || [])],
      days: daysBetween(entry.date, row.date),
      amountDifference: difference,
      warnings,
      errors,
    });
  }

  // The rest pair up best score first, each row and entry once.
  const pairs: Array<{ row: ReconcileRow; entry: ReconcileEntry; score: NonNullable<ReturnType<typeof scoreReconcilePair>> }> = [];
  for (const row of selected) {
    if (claimedRows.has(row.rowId) || row.rowId in rowOverrides || !row.accountId) continue;
    for (const entry of scoped) {
      if (claimedEntries.has(entry.id) || entry.accountId !== row.accountId) continue;
      const score = scoreReconcilePair(rowSide(row), entrySide(entry));
      if (score) pairs.push({ row, entry, score });
    }
  }
  pairs.sort(
    (a, b) =>
      b.score.score - a.score.score ||
      Number(b.score.exactAmount) - Number(a.score.exactAmount) ||
      Math.abs(a.score.days) - Math.abs(b.score.days) ||
      // The bank posts after the purchase, so a statement date after the logged one is likelier.
      Number(a.score.days < 0) - Number(b.score.days < 0) ||
      a.row.rowIndex - b.row.rowIndex ||
      a.entry.id.localeCompare(b.entry.id),
  );
  for (const { row, entry, score } of pairs) {
    if (claimedRows.has(row.rowId) || claimedEntries.has(entry.id)) continue;
    claimedRows.add(row.rowId);
    claimedEntries.add(entry.id);
    matched.push({
      rowId: row.rowId,
      rowIndex: row.rowIndex,
      transactionId: entry.id,
      entry: summarizeEntry(entry),
      mode: "auto",
      score: score.score,
      reasons: score.reasons,
      days: score.days,
      amountDifference: score.amountDifference,
      warnings: score.exactAmount
        ? []
        : [
            `The statement shows ${amountText(row)}, the entry ${amountText(entry)} (FX or a tip?); the statement amount is saved and the logged one kept in its details.`,
          ],
      errors: [],
    });
  }
  matched.sort((a, b) => a.rowIndex - b.rowIndex);

  const unmatchedEntries = scoped.filter((entry) => !claimedEntries.has(entry.id));
  const gapRows = selected.filter((row) => !claimedRows.has(row.rowId));
  const gaps: ReconcileGap[] = gapRows.map((row) => ({
    rowId: row.rowId,
    rowIndex: row.rowIndex,
    unmatched: rowOverrides[row.rowId] === null,
    candidates: unmatchedEntries
      .flatMap((entry) => {
        const score = scoreReconcilePair(rowSide(row), entrySide(entry));
        return score ? [{ transactionId: entry.id, score: score.score, reasons: score.reasons }] : [];
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5),
  }));

  // Entries dated in the days before the statement's first row are only left
  // over with a specific reason: otherwise they belong to the previous statement.
  const leftovers: ReconcileLeftover[] = unmatchedEntries.map((entry) => {
    const reasons: LeftoverReason[] = [];
    const period = periods.get(entry.accountId as string)!;
    let suggestedAction: ReconcileLeftover["suggestedAction"] = "keep";
    let suggestedRowId: string | null = null;

    // A gap row going the same way, close in date and alike, but with another amount.
    const amountCandidates = gapRows
      .filter((row) => row.accountId === entry.accountId && direction(row) === direction(entry))
      .map((row) => ({
        row,
        days: daysBetween(entry.date, row.date),
        similarity: Math.max(
          merchantSimilarity(row.description, entry.description),
          entry.label ? merchantSimilarity(row.description, entry.label) : 0,
        ),
      }))
      .filter((item) => item.days >= -1 && item.days <= RECONCILE_LAG_DAYS && item.similarity >= 0.6)
      .sort((a, b) => b.similarity - a.similarity || Math.abs(a.days) - Math.abs(b.days));
    if (amountCandidates.length) {
      const { row } = amountCandidates[0];
      const close = withinAmountTolerance(cents(row.amountIn || row.amountOut), cents(entry.amountIn || entry.amountOut));
      reasons.push({
        code: "wrong_amount",
        message: `Statement row ${row.rowIndex + 1} (${day(row.date)}, ${row.description}, ${amountText(row)}) looks like this entry with ${close ? "a slightly " : "a "}different amount (${amountText(entry)}).`,
        rowId: row.rowId,
      });
      suggestedAction = "link";
      suggestedRowId = row.rowId;
    }

    // The same purchase logged twice (a notification and an email, say).
    const twin = scoped.find(
      (other) =>
        other.id !== entry.id &&
        direction(other) === direction(entry) &&
        cents(other.amountIn || other.amountOut) === cents(entry.amountIn || entry.amountOut) &&
        Math.abs(daysBetween(other.date, entry.date)) <= 2 &&
        Math.max(
          merchantSimilarity(other.description, entry.description),
          other.label && entry.label ? merchantSimilarity(other.label, entry.label) : 0,
        ) >= 0.6,
    );
    if (twin) {
      const twinMatch = matched.find((match) => match.transactionId === twin.id);
      reasons.push({
        code: "possible_duplicate",
        message: `Looks like a second copy of "${twin.label || twin.description}" (${day(twin.date)}, ${amountText(twin)})${twinMatch ? `, which matches statement row ${twinMatch.rowIndex + 1}` : ""}.`,
        transactionId: twin.id,
      });
      if (suggestedAction === "keep" && twinMatch) suggestedAction = "delete";
    }

    const hint = input.elsewhere?.find((item) => item.entryId === entry.id);
    if (hint) {
      reasons.push({
        code: "wrong_account",
        message: `The ${hint.accountName} statement already shows it (${hint.date}, ${hint.description}).`,
        accountId: hint.accountId,
        transactionId: hint.transactionId,
      });
      if (suggestedAction === "keep") suggestedAction = "move";
    }

    if (inPeriod(entry) && daysBetween(entry.date, period.to) <= PENDING_DAYS) {
      reasons.push({
        code: "pending",
        message: `Logged ${day(entry.date)}, near the end of this statement (${period.to}); it may still be pending and post on the next one.`,
      });
    }

    if (!reasons.length)
      reasons.push({ code: "not_found", message: "This statement doesn't show it." });

    const chosen = entryOverrides[entry.id];
    const action: LeftoverAction = chosen?.action || "keep";
    const accountId =
      action === "move"
        ? chosen?.accountId || null
        : null;
    const errors: string[] = [];
    if (action === "move" && !accountId) errors.push("Choose the account to move it to.");
    if (action === "move" && accountId && accountId === entry.accountId)
      errors.push("It is already on that account.");
    return {
      entry: summarizeEntry(entry),
      reasons,
      action,
      accountId,
      suggestedAction,
      suggestedRowId,
      errors,
    };
  }).filter(
    (leftover) =>
      inPeriod(entriesById.get(leftover.entry.id)!) ||
      leftover.action !== "keep" ||
      leftover.reasons.some((reason) => reason.code === "possible_duplicate" || reason.code === "wrong_amount"),
  );

  // Nothing logged for this statement after all: the import stays the plain one.
  if (!matched.length && !leftovers.length && !Object.keys(rowOverrides).length) return null;

  const loggedByAccount = new Map<string, number>();
  for (const entry of scoped.filter(inPeriod))
    loggedByAccount.set(entry.accountId as string, (loggedByAccount.get(entry.accountId as string) || 0) + 1);

  const errors =
    matched.reduce((n, match) => n + match.errors.length, 0) +
    leftovers.reduce((n, leftover) => n + leftover.errors.length, 0);
  return {
    accounts: [...periods.entries()].map(([accountId, period]) => ({
      accountId,
      ...period,
      logged: loggedByAccount.get(accountId) || 0,
    })),
    matched,
    gaps,
    leftovers,
    summary: {
      matched: matched.length,
      gaps: gaps.length,
      leftovers: leftovers.length,
      amountWarnings: matched.filter((match) => match.amountDifference !== 0).length,
      toDelete: leftovers.filter((leftover) => leftover.action === "delete").length,
      toMove: leftovers.filter((leftover) => leftover.action === "move").length,
      errors,
    },
  };
}

/** What a commit depends on, for the confirmation token: who matches whom and what happens to the rest. */
export function reconcileSignature(plan: ReconcilePlan | null) {
  if (!plan) return null;
  return {
    matched: plan.matched.map((match) => [match.rowId, match.transactionId]),
    leftovers: plan.leftovers.map((leftover) => [leftover.entry.id, leftover.action, leftover.accountId]),
  };
}
