"use client";
import { useEffect, useRef, useState } from "react";
import { TransactionTable } from "@/components/transaction-table/TransactionTable";
import type { Transaction } from "@/components/transaction-table/types";
import {
  chatApi,
  TransactionReview,
  reviewSuggestionSummary,
} from "@/lib/chat/client";
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
        metadata: r.value.metadata || {},
      }) as Transaction,
  );
  const closed = review.status !== "pending";
  const suggestions = reviewSuggestionSummary(review.rows, review.categories);
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
          onOpenReimbursementSelector={(i) =>
            update(i, "linkage", {
              type: "reimbursement",
              reimbursesAllocations: [],
            })
          }
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
              {review.rows[i].value.linkage?.type === "reimbursement" && (
                <div className="w-full space-y-2">
                  <p className="text-sm font-medium">
                    Reimbursement allocations
                  </p>
                  {(
                    review.rows[i].value.linkage.reimbursesAllocations || []
                  ).map((allocation: any, j: number) => (
                    <div key={j} className="flex items-center gap-2 text-sm">
                      <span>
                        {allocation.targetDescription ||
                          review.rows.find(
                            (r) =>
                              r.id ===
                              (allocation.transactionId ||
                                allocation.stagedRowId),
                          )?.value.description ||
                          "Linked transaction"}
                      </span>
                      <input
                        key={`allocation-${review.rows[i].version}`}
                        aria-label={`Allocation ${j + 1} amount for row ${i + 1}`}
                        defaultValue={allocation.amount}
                        inputMode="decimal"
                        className="w-28 rounded border bg-transparent p-2"
                        onBlur={(e) => {
                          const items = [
                            ...review.rows[i].value.linkage
                              .reimbursesAllocations,
                          ];
                          items[j] = {
                            ...allocation,
                            amount: Number(e.target.value),
                          };
                          update(i, "linkage", {
                            type: "reimbursement",
                            reimbursesAllocations: items.map(
                              ({
                                transactionId,
                                stagedDraftId,
                                stagedRowId,
                                amount,
                              }: any) => ({
                                transactionId,
                                stagedDraftId,
                                stagedRowId,
                                amount,
                              }),
                            ),
                          });
                        }}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          update(i, "linkage", {
                            type: "reimbursement",
                            reimbursesAllocations: review.rows[
                              i
                            ].value.linkage.reimbursesAllocations
                              .filter((_: any, k: number) => k !== j)
                              .map(
                                ({
                                  transactionId,
                                  stagedDraftId,
                                  stagedRowId,
                                  amount,
                                }: any) => ({
                                  transactionId,
                                  stagedDraftId,
                                  stagedRowId,
                                  amount,
                                }),
                              ),
                          })
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
                      className="ml-2 max-w-80 rounded border bg-transparent p-2"
                      onChange={(e) => {
                        const target = review.rows.find(
                          (r) => r.id === e.target.value,
                        );
                        if (target)
                          update(i, "linkage", {
                            type: "reimbursement",
                            reimbursesAllocations: [
                              ...(
                                review.rows[i].value.linkage
                                  .reimbursesAllocations || []
                              ).map(
                                ({
                                  transactionId,
                                  stagedDraftId,
                                  stagedRowId,
                                  amount,
                                }: any) => ({
                                  transactionId,
                                  stagedDraftId,
                                  stagedRowId,
                                  amount,
                                }),
                              ),
                              {
                                transactionId: target.source.transactionId,
                                stagedDraftId: target.source.draftId,
                                stagedRowId: target.source.rowId,
                                amount: Math.min(
                                  Number(target.value.amountOut),
                                  Number(review.rows[i].value.amountIn),
                                ),
                              },
                            ],
                          });
                      }}
                    >
                      <option value="">Choose transaction…</option>
                      {review.rows
                        .filter(
                          (r) =>
                            r.id !== review.rows[i].id &&
                            Number(r.value.amountOut) > 0,
                        )
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {String(r.value.date).slice(0, 10)} ·{" "}
                            {r.value.description}
                          </option>
                        ))}
                    </select>
                  </label>
                  <p className="text-xs text-dark-5">
                    Unallocated portions remain untargeted. Ask Fortuna to
                    include other targets in this review.
                  </p>
                </div>
              )}
            </div>
          )}
        />
      </fieldset>
    </div>
  );
}
