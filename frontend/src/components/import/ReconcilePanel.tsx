"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Link2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { Account } from "@/lib/accountTypes";
import {
  LEFTOVER_ACTION_LABELS,
  LEFTOVER_REASON_LABELS,
  SUGGESTED_ACTION_LABELS,
  entryTitle,
  reconcileAmount,
  reconcileHeadline,
  type LeftoverAction,
  type ReconcileChange,
  type ReconcilePlan,
} from "@/lib/reconcile";

type DraftRow = Record<string, any>;
type Draft = Record<string, any> & { rows: DraftRow[]; reconcile?: ReconcilePlan | null };

const rowLine = (row: DraftRow | undefined) => {
  const payload = row?.currentPayload || {};
  return `${String(payload.date || "").slice(0, 10)} · ${payload.description || ""} · ${reconcileAmount({
    amountIn: payload.amountIn ?? null,
    amountOut: payload.amountOut ?? null,
  })}`;
};

const entryLine = (entry: { date: string; label: string | null; description: string; amountIn: number | null; amountOut: number | null; accountName?: string | null }) =>
  `${entry.date} · ${entryTitle(entry)} · ${reconcileAmount(entry)}`;

/**
 * The reconcile plan of the drafts being reviewed: statement rows matched to
 * entries already logged, rows that will be added, and logged entries the
 * statement doesn't show. Shown only for drafts that have a plan, so a plain
 * upload looks as it always did.
 */
export function ReconcilePanel({
  drafts,
  accounts,
  busy,
  onChange,
}: {
  drafts: Draft[];
  accounts: Account[];
  busy: boolean;
  onChange: (draftId: string, change: ReconcileChange) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({ matched: true, leftovers: true });
  const plans = drafts.flatMap((draft) => (draft.reconcile ? [{ draft, plan: draft.reconcile }] : []));
  if (!plans.length) return null;

  const toggle = (key: string) => setOpen((current) => ({ ...current, [key]: !current[key] }));
  const total = plans.reduce(
    (sum, { plan }) => ({
      matched: sum.matched + plan.summary.matched,
      gaps: sum.gaps + plan.summary.gaps,
      leftovers: sum.leftovers + plan.summary.leftovers,
      amountWarnings: sum.amountWarnings + plan.summary.amountWarnings,
    }),
    { matched: 0, gaps: 0, leftovers: 0, amountWarnings: 0 },
  );
  const accountName = (accountId: string | null | undefined) =>
    accounts.find((account) => account.id === accountId)?.name || "another account";

  const header = (key: string, title: string, count: number) => (
    <button
      type="button"
      className="flex w-full items-center gap-2 py-1 text-left font-medium text-dark dark:text-white"
      onClick={() => toggle(key)}
      aria-expanded={!!open[key]}
    >
      {open[key] ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
      {title} ({count})
    </button>
  );

  return (
    <section
      className="rounded-lg border border-stroke p-3 text-sm text-dark dark:border-dark-3 dark:text-white"
      aria-label="Reconcile with logged entries"
    >
      <p className="font-medium">Reconcile with logged entries</p>
      <p className="mt-0.5 text-dark-5 dark:text-dark-6">
        {reconcileHeadline({ summary: { ...total, toDelete: 0, toMove: 0, errors: 0 } })}
        {total.amountWarnings > 0 && ` · ${total.amountWarnings} with a different amount`}.
        {" "}Matched rows confirm the logged entry, which keeps its label and category; new rows are added as usual.
      </p>

      <div className="mt-2 space-y-1">
        {header("matched", "Matched", total.matched)}
        {open.matched && (
          <ul className="max-h-64 space-y-1.5 overflow-y-auto">
            {plans.flatMap(({ draft, plan }) =>
              plan.matched.map((match) => {
                const row = draft.rows.find((item) => item.id === match.rowId);
                return (
                  <li key={`${draft.id}:${match.rowId}`} className="rounded-md bg-gray-1 p-2 dark:bg-dark-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p>
                          <span className="text-dark-5 dark:text-dark-6">Row {match.rowIndex + 1}:</span> {rowLine(row)}
                        </p>
                        <p className="text-dark-5 dark:text-dark-6">
                          {match.mode === "manual" ? "Matched by hand to" : "Matches"} {entryLine(match.entry)}
                          {match.entry.accountName ? ` (${match.entry.accountName})` : ""}
                        </p>
                        {[...match.errors, ...match.warnings].map((warning) => (
                          <p key={warning} className="flex items-start gap-1 text-yellow-dark">
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                            {warning}
                          </p>
                        ))}
                      </div>
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          leftIcon={<Unlink className="size-3" />}
                          onClick={() => onChange(draft.id, { rows: [{ rowId: match.rowId, transactionId: null }] })}
                        >
                          Unmatch
                        </Button>
                        {match.mode === "manual" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => onChange(draft.id, { rows: [{ rowId: match.rowId, transactionId: "auto" }] })}
                          >
                            Automatic
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              }),
            )}
          </ul>
        )}

        {header("gaps", "New rows (not logged)", total.gaps)}
        {open.gaps && (
          <ul className="max-h-64 space-y-1.5 overflow-y-auto">
            {plans.flatMap(({ draft, plan }) =>
              plan.gaps.map((gap) => {
                const row = draft.rows.find((item) => item.id === gap.rowId);
                // Entries this row could be matched to by hand: its candidates, then every leftover.
                const options = [
                  ...gap.candidates.map((candidate) => candidate.transactionId),
                  ...plan.leftovers.map((leftover) => leftover.entry.id),
                ].filter((id, index, all) => all.indexOf(id) === index);
                const entryOf = (id: string) => plan.leftovers.find((leftover) => leftover.entry.id === id)?.entry;
                return (
                  <li key={`${draft.id}:${gap.rowId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-gray-1 p-2 dark:bg-dark-2">
                    <span className="min-w-0 flex-1">
                      <span className="text-dark-5 dark:text-dark-6">Row {gap.rowIndex + 1}:</span> {rowLine(row)}
                      {gap.unmatched && <span className="text-dark-5 dark:text-dark-6"> · unmatched by you</span>}
                    </span>
                    {(options.length > 0 || gap.unmatched) && (
                      <select
                        aria-label={`Match row ${gap.rowIndex + 1} to a logged entry`}
                        className="h-9 max-w-xs rounded-md border border-stroke bg-white px-2 text-xs dark:border-dark-3 dark:bg-dark-2"
                        disabled={busy}
                        value=""
                        onChange={(event) => {
                          const value = event.target.value;
                          if (value) onChange(draft.id, { rows: [{ rowId: gap.rowId, transactionId: value }] });
                        }}
                      >
                        <option value="">Match to a logged entry…</option>
                        {gap.unmatched && <option value="auto">Match automatically</option>}
                        {options.map((id) => {
                          const entry = entryOf(id);
                          return entry ? (
                            <option key={id} value={id}>
                              {entryLine(entry)}
                            </option>
                          ) : null;
                        })}
                      </select>
                    )}
                  </li>
                );
              }),
            )}
          </ul>
        )}

        {header("leftovers", "Logged but not on the statement", total.leftovers)}
        {open.leftovers && (
          <ul className="max-h-80 space-y-1.5 overflow-y-auto">
            {plans.flatMap(({ draft, plan }) =>
              plan.leftovers.map((leftover) => {
                const entry = leftover.entry;
                const setAction = (action: LeftoverAction, accountId?: string) =>
                  onChange(draft.id, { entries: [{ transactionId: entry.id, action, accountId: accountId ?? null }] });
                const moveTo =
                  leftover.reasons.find((reason) => reason.code === "wrong_account")?.accountId || null;
                return (
                  <li key={`${draft.id}:${entry.id}`} className="rounded-md bg-gray-1 p-2 dark:bg-dark-2">
                    <p>
                      {entryLine(entry)}
                      <span className="text-dark-5 dark:text-dark-6"> · {entry.accountName || accountName(entry.accountId)}</span>
                    </p>
                    <ul className="mt-0.5 space-y-0.5 text-dark-5 dark:text-dark-6">
                      {leftover.reasons.map((reason) => (
                        <li key={reason.code}>
                          <span className="font-medium text-dark dark:text-white">{LEFTOVER_REASON_LABELS[reason.code]}:</span>{" "}
                          {reason.message}
                        </li>
                      ))}
                      {leftover.suggestedAction !== "keep" && leftover.action === "keep" && (
                        <li>Suggested: {SUGGESTED_ACTION_LABELS[leftover.suggestedAction]}.</li>
                      )}
                    </ul>
                    {leftover.errors.map((error) => (
                      <p key={error} className="text-red">{error}</p>
                    ))}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <select
                        aria-label={`What to do with ${entryTitle(entry)}`}
                        className="h-9 rounded-md border border-stroke bg-white px-2 text-xs dark:border-dark-3 dark:bg-dark-2"
                        disabled={busy}
                        value={leftover.action}
                        onChange={(event) => {
                          const action = event.target.value as LeftoverAction;
                          const fallback = moveTo || accounts.find((account) => account.id !== entry.accountId && !account.archived)?.id;
                          if (action === "move") setAction("move", fallback);
                          else setAction(action);
                        }}
                      >
                        {(Object.keys(LEFTOVER_ACTION_LABELS) as LeftoverAction[]).map((action) => (
                          <option key={action} value={action}>
                            {LEFTOVER_ACTION_LABELS[action]}
                          </option>
                        ))}
                      </select>
                      {leftover.action === "move" && (
                        <select
                          aria-label={`Account to move ${entryTitle(entry)} to`}
                          className="h-9 rounded-md border border-stroke bg-white px-2 text-xs dark:border-dark-3 dark:bg-dark-2"
                          disabled={busy}
                          value={leftover.accountId || ""}
                          onChange={(event) => setAction("move", event.target.value)}
                        >
                          {accounts
                            .filter((account) => account.id !== entry.accountId && !account.archived)
                            .map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.name}
                              </option>
                            ))}
                        </select>
                      )}
                      {plan.gaps.length > 0 && (
                        <select
                          aria-label={`Link ${entryTitle(entry)} to a statement row`}
                          className="h-9 max-w-xs rounded-md border border-stroke bg-white px-2 text-xs dark:border-dark-3 dark:bg-dark-2"
                          disabled={busy}
                          value=""
                          onChange={(event) => {
                            if (event.target.value)
                              onChange(draft.id, { rows: [{ rowId: event.target.value, transactionId: entry.id }] });
                          }}
                        >
                          <option value="">Link to a statement row…</option>
                          {[...plan.gaps]
                            .sort((a, b) =>
                              a.rowId === leftover.suggestedRowId ? -1 : b.rowId === leftover.suggestedRowId ? 1 : a.rowIndex - b.rowIndex,
                            )
                            .map((gap) => (
                              <option key={gap.rowId} value={gap.rowId}>
                                Row {gap.rowIndex + 1}: {rowLine(draft.rows.find((row) => row.id === gap.rowId))}
                              </option>
                            ))}
                        </select>
                      )}
                      {leftover.suggestedAction === "link" && leftover.suggestedRowId && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          leftIcon={<Link2 className="size-3" />}
                          onClick={() =>
                            onChange(draft.id, { rows: [{ rowId: leftover.suggestedRowId as string, transactionId: entry.id }] })
                          }
                        >
                          Link to row {(plan.gaps.find((gap) => gap.rowId === leftover.suggestedRowId)?.rowIndex ?? 0) + 1}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              }),
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
