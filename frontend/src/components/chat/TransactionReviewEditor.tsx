"use client";
import { useEffect, useRef, useState } from "react";
import { TransactionTable } from "@/components/transaction-table/TransactionTable";
import type { Transaction } from "@/components/transaction-table/types";
import {
  chatApi,
  TransactionReview,
  reviewSuggestionSummary,
  isUnsure,
} from "@/lib/chat/client";
type ReviewAllocation = {
  transactionId?: string;
  stagedDraftId?: string;
  stagedRowId?: string;
  amount: number;
};

/** The allocation fields the review API accepts. */
const toAllocation = ({
  transactionId,
  stagedDraftId,
  stagedRowId,
  amount,
}: ReviewAllocation): ReviewAllocation => ({
  ...(transactionId ? { transactionId } : {}),
  ...(stagedRowId ? { stagedDraftId, stagedRowId } : {}),
  amount: Number(Number(amount || 0).toFixed(2)),
});

const allocationTarget = (allocation: ReviewAllocation) =>
  allocation.transactionId || allocation.stagedRowId || "";

export function TransactionReviewEditor({
  id,
  onSubmitted,
}: {
  id: string;
  onSubmitted: () => Promise<void>;
}) {
  const [review, setReview] = useState<TransactionReview | null>(null),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(0);
  const current = useRef(review),
    queue = useRef(Promise.resolve()),
    pending = useRef(0),
    container = useRef<HTMLDivElement>(null),
    key = useRef<string | null>(null);
  const queued = useRef(
    new Map<string, { version: number; patch: Record<string, any> }>(),
  );
  const accept = (v: TransactionReview) => {
    current.current = v;
    setReview(v);
  };
  useEffect(() => {
    let dead = false;
    const load = async () => {
      if (
        pending.current ||
        container.current?.contains(document.activeElement)
      )
        return;
      try {
        const v = await chatApi<TransactionReview>(`/reviews/${id}`);
        if (
          !dead &&
          !pending.current &&
          !container.current?.contains(document.activeElement)
        )
          accept(v);
      } catch (e) {
        if (!dead) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 1500);
    return () => {
      dead = true;
      clearInterval(timer);
    };
  }, [id]);
  function update(index: number, field: string, value: any) {
    if (current.current?.status !== "pending") return;
    const row = current.current.rows[index];
    if (!row) return;
    const existing = queued.current.get(row.id);
    if (existing) {
      existing.patch[field] = value ?? null;
      return;
    }
    const item = { version: row.version, patch: { [field]: value ?? null } };
    queued.current.set(row.id, item);
    pending.current++;
    setSaving(pending.current);
    setError("");
    queue.current = queue.current.then(async () => {
      try {
        const v = await chatApi<TransactionReview>(`/reviews/${id}`, {
          method: "PUT",
          body: { rowId: row.id, version: item.version, patch: item.patch },
        });
        accept({ ...current.current!, ...v });
      } catch (e) {
        setError((e as Error).message);
        const v = await chatApi<TransactionReview>(`/reviews/${id}`).catch(
          () => null,
        );
        if (v) accept(v);
      } finally {
        queued.current.delete(row.id);
        pending.current--;
        setSaving(pending.current);
      }
    });
  }
  async function submit() {
    await queue.current;
    const v = current.current;
    if (!v || v.status !== "pending" || pending.current) return;
    pending.current++;
    setSaving(pending.current);
    try {
      key.current ||= crypto.randomUUID();
      await chatApi(`/conversations/${v.conversationId}/messages`, {
        method: "POST",
        body: {
          text: `Here is my completed review: ${v.title}`,
          reviewId: id,
          reviewVersion: v.version,
          idempotencyKey: key.current,
        },
      });
      accept({ ...v, status: "submitted" });
      await onSubmitted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current--;
      setSaving(pending.current);
    }
  }
  if (!review)
    return <p role="status">{error || "Loading transaction review…"}</p>;
  const transactions: Transaction[] = review.rows.map(
    (r) =>
      ({
        ...r.value,
        date: String(r.value.date).slice(0, 10),
        label: r.value.label ?? "",
        categoryId: r.value.categoryId ?? undefined,
        accountIdentifier: r.value.accountIdentifier ?? undefined,
        metadata: {
          ...(r.value.metadata || {}),
          ...(r.suggestion?.reason
            ? {
                "Fortuna's note": `${r.suggestion.reason}${
                  r.suggestion.confidence !== undefined
                    ? ` (${Math.round(r.suggestion.confidence * 100)}% sure)`
                    : ""
                }`,
              }
            : {}),
        },
      }) as Transaction,
  );
  const closed = review.status !== "pending";
  const suggestions = reviewSuggestionSummary(review.rows, review.categories);
  const unsure = review.rows.filter(isUnsure);
  return (
    <div
      ref={container}
      className="min-w-0 space-y-3"
      aria-label={review.title}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-semibold">{review.title}</h3>
        <p role="status" className="text-xs text-dark-5 dark:text-dark-6">
          {closed
            ? review.status === "submitted"
              ? "Sent to Fortuna"
              : "Closed"
            : saving
              ? "Saving…"
              : "Changes save automatically"}
        </p>
      </div>
      {unsure.length > 0 && !closed && (
        <div className="rounded-md border border-orange/40 bg-orange/5 px-3 py-2 text-sm">
          <p className="font-medium">
            Fortuna wasn’t sure about {unsure.length}{" "}
            {unsure.length === 1 ? "row" : "rows"}. Please check{" "}
            {unsure.length === 1 ? "it" : "them"}:
          </p>
          <ul className="mt-1 space-y-0.5 text-dark-5 dark:text-dark-6">
            {unsure.slice(0, 5).map((row) => (
              <li key={row.id} className="truncate">
                {String(row.value.date).slice(0, 10)} ·{" "}
                {row.value.label || row.value.description} —{" "}
                {row.suggestion?.reason || "Needs your call"}
              </li>
            ))}
            {unsure.length > 5 && <li>…and {unsure.length - 5} more</li>}
          </ul>
        </div>
      )}
      {review.instructions && (
        <p className="text-sm text-dark-5 dark:text-dark-6">
          {review.instructions}
        </p>
      )}
      {suggestions.changed > 0 && (
        <p className="inline-flex flex-wrap items-center gap-x-2 rounded-md bg-primary/10 px-3 py-1.5 text-sm text-primary">
          <span className="font-medium">
            Pre-filled · {suggestions.changed} of {suggestions.total} rows
          </span>
          {suggestions.effects.map((effect) => (
            <span key={effect}>· {effect}</span>
          ))}
        </p>
      )}
      {error && (
        <div className="text-sm text-red">
          <p role="alert">{error}</p>
          <button
            type="button"
            className="mt-2 underline"
            onClick={() => {
              void chatApi<TransactionReview>(`/reviews/${id}`)
                .then((v) => {
                  accept(v);
                  setError("");
                })
                .catch((e) => setError(e.message));
            }}
          >
            Reload saved review
          </button>
        </div>
      )}
      <fieldset
        disabled={closed || saving > 0}
        className="min-w-0"
        style={{ height: Math.min(520, 180 + transactions.length * 54) }}
        aria-label="Transaction review spreadsheet"
      >
        <TransactionTable
          showSelection={false}
          parsedData={{
            success: true,
            filename: review.title,
            parserId: "",
            transactions,
            count: transactions.length,
          }}
          transactions={transactions}
          categories={review.categories.map((c) => ({
            ...c,
            color: c.color || "#5750F1",
          }))}
          accountIdentifiers={review.accounts.map((a) => ({
            ...a,
            color: a.color || "#5750F1",
          }))}
          accountIdentifier=""
          showAccountSelector={false}
          selectedIndices={new Set(transactions.map((_, i) => i))}
          isImporting={closed || saving > 0}
          deferCellCommit
          allowReservedCategorySelection
          onUpdateTransaction={update}
          onTransactionAccountIdentifierChange={(i, v) =>
            update(i, "accountIdentifier", v)
          }
          onAccountIdentifierChange={() => {}}
          onLinkageChange={(i, v) => update(i, "linkage", v)}
          onOpenReimbursementSelector={(i) => {
            if (!(Number(review.rows[i]?.value.amountIn) > 0)) {
              setError("Only money-in rows can be reimbursements.");
              return;
            }
            if (review.rows[i]?.value.linkage?.type !== "reimbursement")
              update(i, "linkage", {
                type: "reimbursement",
                reimbursesAllocations: [],
                leftoverCategoryId: null,
              });
          }}
          onAddCategoryClick={() =>
            window.open("/categories", "_blank", "noopener,noreferrer")
          }
          onImport={() => {
            if (!closed && !saving && !error) void submit();
          }}
          primaryActionLabel={
            closed
              ? "Review closed"
              : saving
                ? "Saving…"
                : "Send review to Fortuna"
          }
          reviewActionLeft={
            error ? (
              <span className="text-xs text-red">
                Resolve the save error before sending.
              </span>
            ) : null
          }
          renderExpandedActions={(i) => (
            <div className="flex flex-wrap gap-4 py-3">
              <label className="text-sm">
                Currency
                <input
                  key={`currency-${review.rows[i].version}`}
                  aria-label={`Currency for row ${i + 1}`}
                  defaultValue={review.rows[i].value.currency || "SGD"}
                  maxLength={3}
                  onBlur={(e) => {
                    const v = e.target.value.toUpperCase();
                    if (v !== (review.rows[i].value.currency || "SGD"))
                      update(i, "currency", v);
                  }}
                  className="ml-2 w-20 rounded border border-stroke bg-transparent p-2"
                />
              </label>
              <label className="text-sm">
                Balance
                <input
                  key={`balance-${review.rows[i].version}`}
                  aria-label={`Balance for row ${i + 1}`}
                  defaultValue={review.rows[i].value.balance ?? ""}
                  inputMode="decimal"
                  onBlur={(e) => {
                    const v =
                      e.target.value === "" ? null : Number(e.target.value);
                    if (v !== review.rows[i].value.balance)
                      update(i, "balance", v);
                  }}
                  className="ml-2 w-32 rounded border border-stroke bg-transparent p-2"
                />
              </label>
              {review.rows[i].value.linkage?.type === "reimbursement" &&
                (() => {
                  const row = review.rows[i];
                  const allocations: ReviewAllocation[] =
                    row.value.linkage.reimbursesAllocations || [];
                  const allocated = allocations.reduce(
                    (sum, item) => sum + Number(item.amount || 0),
                    0,
                  );
                  const unallocated = Math.max(
                    Number(row.value.amountIn || 0) - allocated,
                    0,
                  );
                  const save = (items: ReviewAllocation[]) =>
                    update(i, "linkage", {
                      type: "reimbursement",
                      reimbursesAllocations: items
                        .filter((item) => Number(item.amount) > 0)
                        .map(toAllocation),
                      leftoverCategoryId:
                        row.value.linkage.leftoverCategoryId ?? null,
                    });
                  const linkedIds = new Set(allocations.map(allocationTarget));
                  const targets = review.rows.filter(
                    (r) =>
                      r.id !== row.id &&
                      Number(r.value.amountOut) > 0 &&
                      !linkedIds.has(r.source.transactionId || r.source.rowId || ""),
                  );
                  return (
                    <div className="w-full space-y-2">
                      <p className="text-sm font-medium">
                        Pays back · ${allocated.toFixed(2)} of $
                        {Number(row.value.amountIn || 0).toFixed(2)}
                      </p>
                      {allocations.map((allocation, j) => (
                        <div key={allocationTarget(allocation) || j} className="flex items-center gap-2 text-sm">
                          <span className="min-w-0 truncate">
                            {(allocation as any).targetDescription ||
                              review.rows.find(
                                (r) =>
                                  (r.source.transactionId || r.source.rowId) ===
                                  allocationTarget(allocation),
                              )?.value.description ||
                              "Linked transaction"}
                          </span>
                          <input
                            key={`allocation-${row.version}-${j}`}
                            aria-label={`Allocation ${j + 1} amount for row ${i + 1}`}
                            defaultValue={allocation.amount}
                            inputMode="decimal"
                            className="w-28 rounded border bg-transparent p-2"
                            onBlur={(e) => {
                              const amount = Number(e.target.value);
                              if (!Number.isFinite(amount) || amount < 0) {
                                e.target.value = String(allocation.amount);
                                return;
                              }
                              if (amount === Number(allocation.amount)) return;
                              const items = [...allocations];
                              items[j] = { ...allocation, amount };
                              save(items);
                            }}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              save(allocations.filter((_, k) => k !== j))
                            }
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <label className="text-sm">
                        Add target from this review
                        <select
                          aria-label={`Add reimbursement target for row ${i + 1}`}
                          value=""
                          disabled={unallocated <= 0 || targets.length === 0}
                          className="ml-2 max-w-80 rounded border bg-transparent p-2"
                          onChange={(e) => {
                            const target = targets.find(
                              (r) => r.id === e.target.value,
                            );
                            if (!target) return;
                            save([
                              ...allocations,
                              {
                                transactionId: target.source.transactionId,
                                stagedDraftId: target.source.draftId,
                                stagedRowId: target.source.rowId,
                                amount: Math.min(
                                  Number(target.value.amountOut),
                                  unallocated,
                                ),
                              },
                            ]);
                          }}
                        >
                          <option value="">Choose transaction…</option>
                          {targets.map((r) => (
                            <option key={r.id} value={r.id}>
                              {String(r.value.date).slice(0, 10)} ·{" "}
                              {r.value.description}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="text-xs text-dark-5">
                        What isn&apos;t linked stays as leftover. Links are
                        checked when saved: an expense can&apos;t be paid back
                        more than its amount.
                      </p>
                    </div>
                  );
                })()}
            </div>
          )}
        />
      </fieldset>
    </div>
  );
}
