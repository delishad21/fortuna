"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Maximize2 } from "lucide-react";
import { TransactionTable } from "@/components/transaction-table/TransactionTable";
import type { Transaction } from "@/components/transaction-table/types";
import { useCellDraft } from "@/components/transaction-table/hooks/useCellDraft";
import { Button } from "@/components/ui/Button";
import { ReviewSaves } from "@/lib/chat/reviewSaves";
import {
  CANCEL_REVIEW_CONFIRM,
  cancelReview,
  chatApi,
  reviewStateLabel,
  SendResult,
  TransactionReview,
  reviewSuggestionSummary,
  isUnsure,
  NEUTRAL_COLOR,
} from "@/lib/chat/client";
import { useFullScreen } from "./useFullScreen";
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

/** A text field of a row's details that saves when it is left. */
function DraftInput({
  value,
  onCommit,
  ...props
}: {
  value: string;
  onCommit: (draft: string) => void | false;
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "onBlur"
>) {
  const { draft, setDraft, commit } = useCellDraft(value, onCommit);
  return (
    <input
      {...props}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
    />
  );
}

/** What the user is told besides failed saves; it goes away with the next edit. */
type Notice = { text: string; reload?: boolean; loading?: boolean };

export function TransactionReviewEditor({
  id,
  status,
  onSubmitted,
}: {
  id: string;
  /** The review's state in the conversation, which may change elsewhere. */
  status: string;
  onSubmitted: () => Promise<void>;
}) {
  const [, setTick] = useState(0),
    [notice, setNotice] = useState<Notice | null>(null),
    // Sending or cancelling: the table is locked until it is done.
    [locked, setLocked] = useState(false),
    [full, setFull] = useState(false),
    [gap, setGap] = useState(0);
  const saves = useMemo(
    () => new ReviewSaves(chatApi, id, () => setTick((n) => n + 1)),
    [id],
  );
  const place = useRef<HTMLDivElement>(null),
    container = useRef<HTMLDivElement>(null),
    toggle = useRef<HTMLButtonElement>(null),
    settled = useRef(false),
    key = useRef<string | null>(null);
  const review = saves.review,
    saving = saves.pending,
    error = saves.error;
  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        // Never while a cell of this review is being edited.
        await saves.load(
          () => !dead && !container.current?.contains(document.activeElement),
        );
        if (!dead) setNotice((n) => (n?.loading ? null : n));
      } catch (e) {
        if (!dead)
          setNotice({
            text: (e as Error).message,
            reload: true,
            loading: true,
          });
      }
    };
    void load();
    const timer = setInterval(() => void load(), 1500);
    return () => {
      dead = true;
      clearInterval(timer);
    };
  }, [saves]);
  // Closed or reopened elsewhere: read it again even while it has focus.
  useEffect(() => {
    let dead = false;
    void saves
      .idle()
      .then(() => {
        if (!dead && saves.review && saves.review.status !== status)
          return saves.load(() => !dead);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [saves, status]);

  const open = () => {
    setGap(place.current?.offsetHeight || 0);
    setFull(true);
  };
  const close = () => setFull(false);
  useFullScreen(full, container, close);
  useEffect(() => {
    const button = toggle.current;
    if (full) return () => button?.focus({ preventScroll: true });
  }, [full]);

  function update(index: number, field: string, value: any) {
    setNotice(null);
    // "Uncategorized" is an empty choice in the picker.
    saves.update(index, field, field === "categoryId" ? value || null : value);
  }
  /**
   * Send and Cancel wait for saves. A press that began when all was saved still counts when
   * leaving the last cell started one: it then goes on after that save.
   */
  function ready() {
    const pressed = settled.current;
    settled.current = false;
    return !locked && (!saves.pending || pressed);
  }
  async function submit() {
    if (!ready() || saves.error || saves.review?.status !== "pending") return;
    setLocked(true);
    setNotice(null);
    try {
      await saves.idle();
      const v = saves.review;
      if (saves.error || v?.status !== "pending") return;
      key.current ||= crypto.randomUUID();
      const sent = await chatApi<SendResult>(
        `/conversations/${v.conversationId}/messages`,
        {
          method: "POST",
          body: {
            text: `Here is my completed review: ${v.title}`,
            reviewId: id,
            reviewVersion: v.version,
            idempotencyKey: key.current,
          },
        },
      );
      // While a reply runs, the review waits its turn, locked.
      saves.accept({ ...v, status: sent.queued ? "queued" : "submitted" });
      close();
      await onSubmitted();
    } catch (e) {
      setNotice({ text: (e as Error).message, reload: true });
    } finally {
      setLocked(false);
    }
  }
  /** Closes the review without applying its suggestions, after the user confirms. */
  async function cancel() {
    if (!ready() || !window.confirm(CANCEL_REVIEW_CONFIRM)) return;
    setLocked(true);
    setNotice(null);
    try {
      await saves.idle();
      const v = saves.review;
      if (!v || !["pending", "queued"].includes(v.status)) return;
      saves.accept(await cancelReview(chatApi, v));
      close();
      await onSubmitted();
    } catch (e) {
      setNotice({ text: (e as Error).message, reload: true });
    } finally {
      setLocked(false);
    }
  }
  const transactions = useMemo<Transaction[]>(
    () =>
      (review?.rows || []).map(
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
      ),
    [review?.rows],
  );
  const categories = useMemo(
    () =>
      (review?.categories || []).map((c) => ({
        ...c,
        color: c.color || NEUTRAL_COLOR,
      })),
    [review?.categories],
  );
  const accounts = useMemo(
    () =>
      (review?.accounts || []).map((a) => ({
        ...a,
        color: a.color || NEUTRAL_COLOR,
      })),
    [review?.accounts],
  );
  const everyRow = useMemo(
    () => new Set(transactions.map((_, i) => i)),
    [transactions],
  );
  if (!review)
    return <p role="status">{notice?.text || "Loading transaction review…"}</p>;
  const closed = review.status !== "pending";
  const cancellable = ["pending", "queued"].includes(review.status);
  const suggestions = reviewSuggestionSummary(review.rows, review.categories);
  const unsure = review.rows.filter(isUnsure);
  const blocked = saving > 0 || locked || !!error;
  const sendLabel = closed
    ? review.status === "queued"
      ? "Queued"
      : "Review closed"
    : "Send review to Fortuna";
  const unsureNotice = unsure.length > 0 && !closed && (
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
  );
  const instructions = review.instructions && (
    <p className="text-sm text-dark-5 dark:text-dark-6">
      {review.instructions}
    </p>
  );
  const prefilled = suggestions.changed > 0 && (
    <p className="inline-flex flex-wrap items-center gap-x-2 rounded-md bg-primary/10 px-3 py-1.5 text-sm text-primary">
      <span className="font-medium">
        Pre-filled · {suggestions.changed} of {suggestions.total} rows
      </span>
      {suggestions.effects.map((effect) => (
        <span key={effect}>· {effect}</span>
      ))}
    </p>
  );
  const collapsed = [
    prefilled && `Pre-filled ${suggestions.changed} of ${suggestions.total}`,
    unsureNotice && `${unsure.length} to check`,
    instructions && "Instructions",
  ].filter(Boolean);
  const problem = error || notice?.text;
  // The same elements in both layouts, so opening and closing keeps the table as it is.
  return (
    <div ref={place} style={full ? { height: gap } : undefined}>
      <div
        ref={container}
        tabIndex={-1}
        role={full ? "dialog" : undefined}
        aria-modal={full || undefined}
        aria-label={review.title}
        onPointerDownCapture={() => {
          settled.current = !saves.pending;
        }}
        onKeyDownCapture={() => {
          settled.current = false;
        }}
        className={
          full
            ? "fixed inset-0 z-[60] flex min-w-0 flex-col gap-2 bg-white p-3 outline-none dark:bg-gray-dark sm:p-4"
            : "min-w-0 space-y-3 outline-none"
        }
      >
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h3
            className={`font-semibold ${full ? "min-w-0 basis-full truncate md:flex-1 md:basis-0" : ""}`}
          >
            {review.title}
          </h3>
          <div
            className={`flex flex-wrap items-center gap-2 ${full ? "w-full md:w-auto" : ""}`}
          >
            <p
              role="status"
              className={`text-xs text-dark-5 dark:text-dark-6 ${full ? "basis-full md:mr-1 md:basis-auto" : "mr-1"}`}
            >
              {closed
                ? ["submitted", "queued"].includes(review.status) ||
                  review.decidedAt
                  ? reviewStateLabel(review)
                  : "Closed"
                : error
                  ? "Not saved"
                  : saving
                    ? "Saving…"
                    : full
                      ? "All changes saved"
                      : "Changes save automatically"}
            </p>
            {cancellable && (
              <Button
                size="sm"
                variant="secondary"
                aria-disabled={saving > 0 || locked || undefined}
                className={saving > 0 || locked ? "opacity-70" : ""}
                onClick={() => void cancel()}
              >
                Cancel review
              </Button>
            )}
            {full && !closed && (
              <Button
                size="sm"
                variant="success"
                aria-disabled={blocked || undefined}
                className={blocked ? "opacity-70" : ""}
                onClick={() => void submit()}
              >
                Send review
                <span className="hidden sm:inline">&nbsp;to Fortuna</span>
              </Button>
            )}
            <button
              ref={toggle}
              type="button"
              onClick={full ? close : open}
              className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-stroke px-3 text-xs font-medium hover:bg-gray-2 dark:border-dark-3 dark:hover:bg-dark-3"
            >
              {full ? (
                <ArrowLeft size={15} aria-hidden />
              ) : (
                <Maximize2 size={14} aria-hidden />
              )}
              {full ? "Back to chat" : "Expand"}
            </button>
          </div>
        </div>
        {full ? (
          collapsed.length > 0 && (
            <details className="shrink-0 text-sm">
              <summary className="cursor-pointer text-xs text-dark-5 dark:text-dark-6">
                {collapsed.join(" · ")}
              </summary>
              <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                {unsureNotice}
                {instructions}
                {prefilled}
              </div>
            </details>
          )
        ) : (
          <>
            {unsureNotice}
            {instructions}
            {prefilled}
          </>
        )}
        {problem && (
          <div className="shrink-0 text-sm text-red">
            <p role="alert">{problem}</p>
            {(error || notice?.reload) && (
              <button
                type="button"
                className="mt-2 underline"
                onClick={() => {
                  void saves
                    .reload()
                    .then(() => setNotice(null))
                    .catch((e) => setNotice({ text: e.message, reload: true }));
                }}
              >
                Reload saved review
              </button>
            )}
          </div>
        )}
        <fieldset
          disabled={closed || locked}
          className={`min-w-0 ${full ? "min-h-0 flex-1" : ""}`}
          style={
            full
              ? undefined
              : { height: Math.min(520, 180 + transactions.length * 54) }
          }
          aria-label="Transaction review spreadsheet"
        >
          <TransactionTable
            showSelection={false}
            showToolbar={!full}
            parsedData={{
              success: true,
              filename: review.title,
              parserId: "",
              transactions,
              count: transactions.length,
            }}
            transactions={transactions}
            categories={categories}
            accountIdentifiers={accounts}
            accountIdentifier=""
            showAccountSelector={false}
            selectedIndices={everyRow}
            isImporting={closed || locked}
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
                setNotice({
                  text: "Only money-in rows can be reimbursements.",
                });
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
            onImport={() => void submit()}
            primaryActionLabel={sendLabel}
            primaryActionDisabled={blocked || closed}
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
                  <DraftInput
                    aria-label={`Currency for row ${i + 1}`}
                    value={review.rows[i].value.currency || "SGD"}
                    maxLength={3}
                    onCommit={(text) => {
                      const v = text.toUpperCase();
                      if (v !== (review.rows[i].value.currency || "SGD"))
                        update(i, "currency", v);
                      else return false;
                    }}
                    className="ml-2 w-20 rounded border border-stroke bg-transparent p-2"
                  />
                </label>
                <label className="text-sm">
                  Balance
                  <DraftInput
                    aria-label={`Balance for row ${i + 1}`}
                    value={String(review.rows[i].value.balance ?? "")}
                    inputMode="decimal"
                    onCommit={(text) => {
                      const v = text === "" ? null : Number(text);
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
                    const linkedIds = new Set(
                      allocations.map(allocationTarget),
                    );
                    const targets = review.rows.filter(
                      (r) =>
                        r.id !== row.id &&
                        Number(r.value.amountOut) > 0 &&
                        !linkedIds.has(
                          r.source.transactionId || r.source.rowId || "",
                        ),
                    );
                    return (
                      <div className="w-full space-y-2">
                        <p className="text-sm font-medium">
                          Pays back · ${allocated.toFixed(2)} of $
                          {Number(row.value.amountIn || 0).toFixed(2)}
                        </p>
                        {allocations.map((allocation, j) => (
                          <div
                            key={allocationTarget(allocation) || j}
                            className="flex items-center gap-2 text-sm"
                          >
                            <span className="min-w-0 truncate">
                              {(allocation as any).targetDescription ||
                                review.rows.find(
                                  (r) =>
                                    (r.source.transactionId ||
                                      r.source.rowId) ===
                                    allocationTarget(allocation),
                                )?.value.description ||
                                "Linked transaction"}
                            </span>
                            <DraftInput
                              aria-label={`Allocation ${j + 1} amount for row ${i + 1}`}
                              value={String(allocation.amount)}
                              inputMode="decimal"
                              className="w-28 rounded border bg-transparent p-2"
                              onCommit={(text) => {
                                const amount = Number(text);
                                if (
                                  !Number.isFinite(amount) ||
                                  amount < 0 ||
                                  amount === Number(allocation.amount)
                                )
                                  return false;
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
    </div>
  );
}
