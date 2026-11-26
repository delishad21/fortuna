"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";
import { getAccounts } from "@/app/actions/accounts";
import {
  confirmReviewAccount,
  correctReviewEntries,
  getReviewQueue,
  mergeReviewAccount,
  setReviewEntriesStatus,
} from "@/app/actions/review";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CategorySelect } from "@/components/ui/CategorySelect";
import { Checkbox } from "@/components/ui/Checkbox";
import { DatePicker } from "@/components/ui/DatePicker";
import { Select } from "@/components/ui/Select";
import { TextInput } from "@/components/ui/TextInput";
import { TransactionAvatar } from "@/components/ui/CategoryIcon";
import { EntrySourceBadge } from "@/components/transactions/EntrySourceBadge";
import { EmptyText, SectionCard, formatCurrency, formatDay } from "@/components/analytics/parts";
import { autoCreatedFromDisplay, type Account } from "@/lib/accountTypes";
import { ENTRY_SOURCES, classificationLabel, entrySourceLabel, reviewReasonLabel, type EntrySource } from "@/lib/entrySource";
import {
  REVIEW_REASONS,
  suggestRuleMatch,
  type ReviewEntry,
  type ReviewQueue,
  type ReviewQueueFilters,
  type ReviewReason,
} from "@/lib/reviewTypes";
import { cn } from "@/lib/utils";
import { RepaymentProposalCard } from "@/components/reimbursables/RepaymentProposalCard";
import { ReimbursableEditor } from "@/components/reimbursables/ReimbursableEditor";
import { setTransactionsReimbursable } from "@/app/actions/reimbursables";
import { describeShare } from "@/lib/reimbursables";

type Category = { id: string; name: string; color: string; icon?: string | null };

const PAGE = 50;
const fieldLabel = "text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6";

/**
 * To review: what the assistant logged and Fortuna classified, waiting for a
 * look. The same queue twee works through (the shared review API).
 */
export function ReviewClient({
  initialQueue,
  initialAccounts,
  categories,
}: {
  initialQueue: ReviewQueue;
  initialAccounts: Account[];
  categories: Category[];
}) {
  const router = useRouter();
  const [queue, setQueue] = useState(initialQueue);
  const [rows, setRows] = useState<ReviewEntry[]>(initialQueue.transactions);
  const [accounts, setAccounts] = useState(initialAccounts);
  const [filters, setFilters] = useState<ReviewQueueFilters>({ status: "to_review" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const autoCreated = accounts.filter((account) => account.autoCreated);

  const fail = (err: unknown, fallback: string) => setError(err instanceof Error ? err.message : fallback);

  const load = async (next: ReviewQueueFilters, append = false) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getReviewQueue({ ...next, limit: PAGE, offset: append ? rows.length : 0 });
      setQueue(result);
      setRows((previous) => (append ? [...previous, ...result.transactions] : result.transactions));
      if (!append) setSelected(new Set());
    } catch (err) {
      fail(err, "Failed to load the queue");
    } finally {
      setLoading(false);
    }
  };

  const changeFilters = (patch: Partial<ReviewQueueFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    void load(next);
  };

  /** After a change: reload the queue and accounts, and the sidebar count. */
  const refresh = async () => {
    await load(filters);
    try {
      setAccounts(await getAccounts({ includeArchived: false }));
    } catch {}
    router.refresh();
  };

  const toggle = (id: string, on: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const markReviewed = async (ids: string[]) => {
    setError(null);
    setLoading(true);
    try {
      await setReviewEntriesStatus(ids, "reviewed");
      setNotice(`${ids.length === 1 ? "1 entry" : `${ids.length} entries`} marked reviewed.`);
      await refresh();
    } catch (err) {
      fail(err, "Failed to mark reviewed");
      setLoading(false);
    }
  };

  const selectedRows = rows.filter((row) => selected.has(row.id));
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const reasonFilter = filters.reasons ?? [];

  return (
    <div className="flex flex-col gap-6">
      {error ? <div className="rounded-lg bg-red/10 px-4 py-3 text-sm text-red">{error}</div> : null}
      {notice ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-green/10 px-4 py-3 text-sm text-dark dark:text-white">
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      {autoCreated.length > 0 ? (
        <SectionCard title={`New accounts to confirm (${autoCreated.length})`}>
          <div className="divide-y divide-stroke dark:divide-stroke-dark">
            {autoCreated.map((account) => (
              <AutoAccountRow
                key={account.id}
                account={account}
                others={accounts.filter((other) => other.id !== account.id && !other.archived)}
                onDone={async (message) => {
                  setNotice(message);
                  await refresh();
                }}
                onError={(err) => fail(err, "Failed to update the account")}
              />
            ))}
          </div>
        </SectionCard>
      ) : null}

      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-40">
            <Select
              value={filters.status || "to_review"}
              options={[
                { value: "to_review", label: "To review" },
                { value: "reviewed", label: "Reviewed" },
                { value: "all", label: "All" },
              ]}
              onChange={(status) => changeFilters({ status: status as ReviewQueueFilters["status"] })}
              buttonClassName="w-full min-w-0"
            />
          </div>
          <div className="w-40">
            <Select
              value={filters.entrySource?.[0] || ""}
              options={[
                { value: "", label: "Any source" },
                ...ENTRY_SOURCES.map((source) => ({ value: source, label: entrySourceLabel(source) })),
              ]}
              onChange={(source) => changeFilters({ entrySource: source ? [source as EntrySource] : undefined })}
              buttonClassName="w-full min-w-0"
            />
          </div>
          <div className="w-52">
            <Select
              value={filters.account || ""}
              options={[
                { value: "", label: "All accounts" },
                ...accounts.map((account) => ({ value: account.id, label: account.name, color: account.color })),
              ]}
              onChange={(account) => changeFilters({ account: account || undefined })}
              buttonClassName="w-full min-w-0"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-40">
              <DatePicker variant="field" value={filters.dateFrom || ""} onChange={(value) => changeFilters({ dateFrom: value || undefined })} />
            </div>
            <span className="text-sm text-dark-5 dark:text-dark-6">to</span>
            <div className="w-40">
              <DatePicker variant="field" value={filters.dateTo || ""} onChange={(value) => changeFilters({ dateTo: value || undefined })} />
            </div>
          </div>
          {filters.account || filters.entrySource || filters.dateFrom || filters.dateTo || reasonFilter.length || filters.status !== "to_review" ? (
            <button
              type="button"
              onClick={() => changeFilters({ status: "to_review", account: undefined, entrySource: undefined, dateFrom: undefined, dateTo: undefined, reasons: undefined })}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary"
            >
              <X className="size-4" /> Clear filters
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {REVIEW_REASONS.map((reason) => {
            const active = reasonFilter.includes(reason);
            return (
              <button
                key={reason}
                type="button"
                onClick={() =>
                  changeFilters({
                    reasons: active ? reasonFilter.filter((item) => item !== reason) : [...reasonFilter, reason],
                  })
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-stroke text-dark-5 hover:border-primary dark:border-dark-3 dark:text-dark-6",
                )}
              >
                {reviewReasonLabel(reason)}
                <span className="tabular-nums text-xs">{queue.reasons?.[reason] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </Card>

      {selectedRows.length > 0 ? (
        <BulkCorrection
          rows={selectedRows}
          categories={categories}
          accounts={accounts.filter((account) => !account.archived)}
          disabled={loading}
          onMarkReviewed={() => void markReviewed(selectedRows.map((row) => row.id))}
          onClear={() => setSelected(new Set())}
          onDone={async (message) => {
            setNotice(message);
            await refresh();
          }}
          onError={(err) => fail(err, "Failed to correct the entries")}
        />
      ) : null}

      <SectionCard
        title={`${filters.status === "reviewed" ? "Reviewed" : filters.status === "all" ? "Entries" : "To review"} (${queue.total})`}
        action={
          rows.length > 0 ? (
            <label className="flex items-center gap-2 text-sm text-dark-5 dark:text-dark-6">
              <Checkbox
                checked={allSelected}
                indeterminate={!allSelected && selected.size > 0}
                onChange={(on) => setSelected(on ? new Set(rows.map((row) => row.id)) : new Set())}
                aria-label="Select all shown"
              />
              Select all shown
            </label>
          ) : null
        }
        className={cn(loading && "opacity-60")}
      >
        {rows.length === 0 ? (
          filters.status === "to_review" && !reasonFilter.length ? (
            <div className="flex items-center gap-3 rounded-lg bg-green/5 p-4">
              <CheckCircle2 className="size-6 shrink-0 text-green" />
              <p className="text-sm text-dark dark:text-white">Nothing waits for review.</p>
            </div>
          ) : (
            <EmptyText>No entries match these filters.</EmptyText>
          )
        ) : (
          <div className="divide-y divide-stroke dark:divide-stroke-dark">
            {rows.map((row) => (
              <ReviewRow
                key={row.id}
                row={row}
                account={row.accountId ? accountById.get(row.accountId) : undefined}
                selected={selected.has(row.id)}
                onSelect={(on) => toggle(row.id, on)}
                onMarkReviewed={() => void markReviewed([row.id])}
                onLinked={async (message) => {
                  setNotice(message);
                  await refresh();
                }}
                onError={(err) => fail(err, "Failed to link the repayment")}
                disabled={loading}
              />
            ))}
          </div>
        )}
        {rows.length < queue.total ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => void load(filters, true)}
            className="mt-3 w-full rounded-lg border border-stroke py-2 text-sm font-medium text-primary hover:bg-gray-2 dark:border-stroke-dark dark:hover:bg-dark-3"
          >
            Load more ({queue.total - rows.length} left)
          </button>
        ) : null}
      </SectionCard>
    </div>
  );
}

function ReviewRow({
  row,
  account,
  selected,
  onSelect,
  onMarkReviewed,
  onLinked,
  onError,
  disabled,
}: {
  row: ReviewEntry;
  account?: Account;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onMarkReviewed: () => void;
  onLinked: (message: string) => Promise<void>;
  onError: (err: unknown) => void;
  disabled: boolean;
}) {
  const income = (row.amountIn ?? 0) > 0;
  const decidedBy = row.classification?.decidedBy === "none" ? null : classificationLabel(row.classification);
  return (
    <div className={cn("flex items-start gap-3 py-3", selected && "bg-primary/5")}>
      <div className="pt-2.5">
        <Checkbox checked={selected} onChange={onSelect} aria-label={`Select ${row.label || row.description}`} />
      </div>
      <TransactionAvatar transaction={row} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-dark dark:text-white">{row.label || row.description}</p>
            {row.label ? <p className="truncate text-xs text-dark-5 dark:text-dark-6">{row.description}</p> : null}
          </div>
          <span className={cn("shrink-0 text-sm font-semibold tabular-nums", income ? "text-green" : "text-red")}>
            {income ? `+${formatCurrency(row.amountIn ?? 0)}` : `-${formatCurrency(row.amountOut ?? 0)}`}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-dark-5 dark:text-dark-6">
          <span>{formatDay(row.date, "d MMM yyyy")}{row.time ? ` ${row.time}` : ""}</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: row.category?.color || "#9ca3af" }} />
            {row.category?.name || "Uncategorized"}
          </span>
          {account || row.account ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                {account ? <span className="size-2 rounded-full" style={{ backgroundColor: account.color }} /> : null}
                {account?.name || row.account}
                {row.card?.last4 ? ` ·· ${row.card.last4}` : ""}
              </span>
            </>
          ) : null}
          <EntrySourceBadge entrySource={row.entrySource} reconciled={row.reconciled} />
          {row.reviewReasons.map((reason) => (
            <span
              key={reason}
              className="inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[11px] text-amber-700 dark:text-amber-300"
            >
              {reviewReasonLabel(reason)}
            </span>
          ))}
          {row.reimbursable ? (
            <span className="inline-flex items-center rounded border border-stroke px-1.5 py-px text-[11px] dark:border-dark-3">
              For {row.reimbursable.person || "someone"} · {describeShare(row.reimbursable.share)}
            </span>
          ) : null}
        </div>
        {decidedBy ? (
          <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
            Category chosen by: {decidedBy}
            {row.classification?.suggestedCategory && row.classification.decidedBy !== "assistant"
              ? ` · the assistant suggested ${row.classification.suggestedCategory}`
              : ""}
          </p>
        ) : null}
        {row.reimbursementProposal ? (
          <RepaymentProposalCard proposal={row.reimbursementProposal} onConfirmed={onLinked} onError={onError} />
        ) : null}
      </div>
      {row.reviewStatus === "to_review" ? (
        <Button variant="secondary" size="sm" disabled={disabled} onClick={onMarkReviewed}>
          Mark reviewed
        </Button>
      ) : null}
    </div>
  );
}

function BulkCorrection({
  rows,
  categories,
  accounts,
  disabled,
  onMarkReviewed,
  onClear,
  onDone,
  onError,
}: {
  rows: ReviewEntry[];
  categories: Category[];
  accounts: Account[];
  disabled: boolean;
  onMarkReviewed: () => void;
  onClear: () => void;
  onDone: (message: string) => Promise<void>;
  onError: (err: unknown) => void;
}) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [label, setLabel] = useState("");
  const [makeRule, setMakeRule] = useState(false);
  const [matchValue, setMatchValue] = useState("");
  const [accountOnly, setAccountOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reimbursable, setReimbursable] = useState(false);

  const descriptions = rows.map((row) => row.description);
  const suggestion = suggestRuleMatch(descriptions);
  const ruleMatch = matchValue || suggestion;
  const hasChange = Boolean(categoryId || accountId || label.trim());
  const ruleMissesRows =
    makeRule && ruleMatch.trim().length >= 2
      ? descriptions.filter((text) => !text.toLowerCase().includes(ruleMatch.trim().toLowerCase())).length
      : 0;
  const ruleReady = !makeRule || (ruleMatch.trim().length >= 2 && ruleMissesRows === 0 && Boolean(categoryId || label.trim()));

  const apply = async () => {
    setSaving(true);
    try {
      const result = await correctReviewEntries({
        ids: rows.map((row) => row.id),
        ...(categoryId ? { category: categoryId } : {}),
        ...(accountId ? { account: accountId } : {}),
        ...(label.trim() ? { label: label.trim() } : {}),
        markReviewed: true,
        ...(makeRule ? { createRule: { matchValue: ruleMatch.trim(), accountOnly } } : {}),
      });
      const count = result.transactions.length;
      await onDone(
        `${count === 1 ? "1 entry" : `${count} entries`} corrected and reviewed.${result.rule ? ` Rule “${result.rule.name}” saved.` : ""}`,
      );
      setCategoryId("");
      setAccountId("");
      setLabel("");
      setMakeRule(false);
      setMatchValue("");
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4 border border-primary/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-dark dark:text-white">
          {rows.length === 1 ? "1 entry selected" : `${rows.length} entries selected`}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={disabled || saving} onClick={onMarkReviewed}>
            Mark reviewed
          </Button>
          <Button variant="secondary" size="sm" disabled={disabled || saving} onClick={() => setReimbursable((open) => !open)}>
            Reimbursable…
          </Button>
          <button type="button" onClick={onClear} className="text-sm font-medium text-primary">
            Clear selection
          </button>
        </div>
      </div>
      {reimbursable ? (
        <div className="rounded-lg border border-stroke p-3 dark:border-dark-3">
          <ReimbursableEditor
            count={rows.length}
            amountOut={rows.length === 1 ? rows[0].amountOut ?? undefined : undefined}
            onCancel={() => setReimbursable(false)}
            onSave={async (input) => {
              const result = await setTransactionsReimbursable({ ids: rows.map((row) => row.id), ...input });
              setReimbursable(false);
              await onDone(
                `Marked reimbursable: ${formatCurrency(result.owed)} owed.${result.skipped.length ? ` ${result.skipped.length} skipped (money in or transfers).` : ""}`,
              );
            }}
          />
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Category</span>
          <CategorySelect
            value={categoryId}
            categories={categories}
            onChange={setCategoryId}
            onAddClick={() => router.push("/settings")}
            emptyLabel="Keep as is"
            triggerProps={{ className: "py-2.5" }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Account</span>
          <Select
            value={accountId}
            options={[
              { value: "", label: "Keep as is" },
              ...accounts.map((account) => ({ value: account.id, label: account.name, color: account.color })),
            ]}
            onChange={setAccountId}
            buttonClassName="w-full min-w-0"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Label</span>
          <TextInput value={label} placeholder="Keep as is" onChange={(event) => setLabel(event.target.value)} />
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded-lg border border-stroke p-3 dark:border-dark-3">
        <label className="flex items-center gap-2 text-sm text-dark dark:text-white">
          <Checkbox checked={makeRule} onChange={setMakeRule} aria-label="Make a rule from this correction" />
          Make a rule from this correction
        </label>
        {makeRule ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-dark-5 dark:text-dark-6">Descriptions containing</span>
              <div className="w-64">
                <TextInput value={ruleMatch} onChange={(event) => setMatchValue(event.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm text-dark-5 dark:text-dark-6">
                <Checkbox checked={accountOnly} onChange={setAccountOnly} aria-label="Only for this account" />
                Only for this account
              </label>
            </div>
            {ruleMissesRows > 0 ? (
              <p className="text-xs text-red">
                {ruleMissesRows === 1 ? "1 selected description doesn't" : `${ruleMissesRows} selected descriptions don't`} contain it.
              </p>
            ) : !categoryId && !label.trim() ? (
              <p className="text-xs text-dark-5 dark:text-dark-6">A rule needs a category or label to set.</p>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex justify-end">
        <Button disabled={!hasChange || !ruleReady || saving || disabled} onClick={() => void apply()}>
          {saving ? "Saving…" : "Apply and mark reviewed"}
        </Button>
      </div>
    </Card>
  );
}

function AutoAccountRow({
  account,
  others,
  onDone,
  onError,
}: {
  account: Account;
  others: Account[];
  onDone: (message: string) => Promise<void>;
  onError: (err: unknown) => void;
}) {
  const [name, setName] = useState(account.name);
  const [into, setInto] = useState("");
  const [saving, setSaving] = useState(false);

  const keep = async () => {
    setSaving(true);
    try {
      const trimmed = name.trim();
      await confirmReviewAccount(account.id, trimmed && trimmed !== account.name ? trimmed : undefined);
      await onDone(`Kept ${trimmed || account.name}.`);
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  };

  const merge = async () => {
    const target = others.find((other) => other.id === into);
    if (!target) return;
    if (!window.confirm(`Merge ${account.name} into ${target.name}? Its cards, identifiers and ${account.transactionCount} transactions move to ${target.name}.`))
      return;
    setSaving(true);
    try {
      const result = await mergeReviewAccount(account.id, target.id);
      await onDone(`Merged into ${target.name}; ${result.transactionsMoved} transactions moved.`);
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: account.color }} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-dark dark:text-white">{account.name}</p>
          <p className="mt-0.5 truncate text-xs text-dark-5 dark:text-dark-6">
            {autoCreatedFromDisplay(account.autoCreatedFrom)} · {account.transactionCount === 1 ? "1 transaction" : `${account.transactionCount} transactions`}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-48">
          <TextInput value={name} onChange={(event) => setName(event.target.value)} aria-label="Account name" />
        </div>
        <Button size="sm" disabled={saving} onClick={() => void keep()}>
          Keep
        </Button>
        {others.length > 0 ? (
          <>
            <div className="w-48">
              <Select
                value={into}
                options={[
                  { value: "", label: "Merge into…" },
                  ...others.map((other) => ({ value: other.id, label: other.name, color: other.color })),
                ]}
                onChange={setInto}
                buttonClassName="w-full min-w-0"
              />
            </div>
            <Button variant="secondary" size="sm" disabled={saving || !into} onClick={() => void merge()}>
              Merge
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
