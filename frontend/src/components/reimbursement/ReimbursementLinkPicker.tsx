"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRightCircle, Receipt, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";
import { SearchBar } from "@/components/ui/SearchBar";
import { Select } from "@/components/ui/Select";
import { AllocationEditorRow } from "@/components/reimbursement/AllocationEditorRow";
import { TransactionCard } from "@/components/transactions/TransactionCard";
import { getCategories } from "@/app/actions/categories";
import { getAccountNumbers } from "@/app/actions/accountNumbers";
import { accountDisplay } from "@/lib/accounts";
import {
  getReimbursementCandidates,
  setReimbursementLinks,
  type LinkEnd,
  type ReimbursementCandidate,
  type ReimbursementCandidates,
} from "@/app/actions/reimbursements";

/**
 * "expenses": the subject is a reimbursement choosing what it pays back.
 * "reimbursements": the subject is an expense choosing what paid it back.
 */
export type ReimbursementPickerMode = "expenses" | "reimbursements";

interface ReimbursementLinkPickerProps {
  isOpen: boolean;
  subject: LinkEnd;
  mode: ReimbursementPickerMode;
  subjectTitle: string;
  /** The subject's staged import, when it is a staged row. */
  currentDraftId?: string;
  /** Staged imports reviewed (and committed) together with the subject. */
  contextDraftIds?: string[];
  categories?: Array<{ id: string; name: string; color?: string }>;
  initialLeftoverCategoryId?: string | null;
  onClose: () => void;
  onSaved: (result: { warnings: string[] }) => void;
}

type Tab = "current" | "staged" | "existing";
type Filters = { categoryId: string | null; dateFrom: string; dateTo: string; sameAmount: boolean };

const PAGE_SIZE = 20;
const EPSILON = 0.005;
const NO_FILTERS: Filters = { categoryId: null, dateFrom: "", dateTo: "", sameAmount: false };

const money = (value: number) => Number(Number(value || 0).toFixed(2));
const formatAmount = (amount: number) => `$${money(amount).toFixed(2)}`;
const formatDate = (date: string | null) =>
  date
    ? new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "";

const endOf = (key: string): LinkEnd =>
  key.startsWith("t:") ? { transactionId: key.slice(2) } : { draftRowId: key.slice(2) };

export function ReimbursementLinkPicker({
  isOpen,
  subject,
  mode,
  subjectTitle,
  currentDraftId,
  contextDraftIds,
  categories: providedCategories,
  initialLeftoverCategoryId,
  onClose,
  onSaved,
}: ReimbursementLinkPickerProps) {
  const lookingFor = mode === "expenses" ? "expense" : "reimbursement";
  const subjectIsSaved = "transactionId" in subject;
  const subjectKey = subjectIsSaved ? `t:${subject.transactionId}` : `r:${subject.draftRowId}`;
  const [tab, setTab] = useState<Tab>("existing");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReimbursementCandidates | null>(null);
  const [known, setKnown] = useState<Map<string, ReimbursementCandidate>>(new Map());
  const [selection, setSelection] = useState<Map<string, number>>(new Map());
  const [initialized, setInitialized] = useState(false);
  const [leftoverCategoryId, setLeftoverCategoryId] = useState(initialLeftoverCategoryId || "");
  const [categories, setCategories] = useState(providedCategories || []);
  const [accounts, setAccounts] = useState<Array<{ accountIdentifier: string; color: string; label?: string | null }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const contextKey = (contextDraftIds || []).join(",");

  const load = useCallback(
    async (nextPage: number, search: string, nextFilters: Filters, amount: number | null) => {
      const id = ++requestId.current;
      setIsLoading(true);
      setError("");
      try {
        const result = await getReimbursementCandidates({
          subject,
          lookingFor,
          query: search,
          limit: PAGE_SIZE,
          offset: (nextPage - 1) * PAGE_SIZE,
          contextDraftIds: contextKey ? contextKey.split(",") : undefined,
          ...(nextFilters.categoryId !== null ? { categoryId: nextFilters.categoryId } : {}),
          ...(nextFilters.dateFrom ? { dateFrom: nextFilters.dateFrom } : {}),
          ...(nextFilters.dateTo ? { dateTo: nextFilters.dateTo } : {}),
          ...(nextFilters.sameAmount && amount ? { amountEquals: amount } : {}),
        });
        if (id !== requestId.current) return;
        setData(result);
        setKnown((previous) => {
          const next = new Map(previous);
          [...result.saved.items, ...result.staged].forEach((item) => next.set(item.key, item));
          return next;
        });
      } catch (loadError) {
        if (id === requestId.current)
          setError(loadError instanceof Error ? loadError.message : "Could not load transactions");
      } finally {
        if (id === requestId.current) setIsLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subjectKey, lookingFor, contextKey],
  );

  useEffect(() => {
    if (!isOpen) return;
    setTab(currentDraftId && !subjectIsSaved ? "current" : "existing");
    setSearchInput("");
    setQuery("");
    setFilters(NO_FILTERS);
    setPage(1);
    setSelection(new Map());
    setKnown(new Map());
    setData(null);
    setInitialized(false);
    setLeftoverCategoryId(initialLeftoverCategoryId || "");
    void load(1, "", NO_FILTERS, null);
  }, [isOpen, subjectKey, load, currentDraftId, subjectIsSaved, initialLeftoverCategoryId]);

  useEffect(() => {
    if (!isOpen) return;
    if (!providedCategories?.length)
      getCategories({ scope: "settings" }).then(setCategories).catch(() => undefined);
    getAccountNumbers().then(setAccounts).catch(() => undefined);
  }, [isOpen, providedCategories]);

  const subjectAmount = data?.subject.amount || 0;

  // Search as you type; filters and paging reload straight away.
  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      if (searchInput.trim() !== query) {
        setQuery(searchInput.trim());
        setPage(1);
        void load(1, searchInput.trim(), filters, subjectAmount);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, query, isOpen, load, filters, subjectAmount]);

  const applyFilters = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    setPage(1);
    void load(1, query, next, subjectAmount);
  };
  const goToPage = (next: number) => {
    setPage(next);
    void load(next, query, filters, subjectAmount);
  };
  const resetFilters = () => {
    setSearchInput("");
    setQuery("");
    setFilters(NO_FILTERS);
    setPage(1);
    void load(1, "", NO_FILTERS, subjectAmount);
  };

  // A saved transaction's links to staged rows belong to those rows: shown, not edited here.
  const readOnlyLinks = useMemo(
    () => (subjectIsSaved ? (data?.subject.linked || []).filter((link) => link.key.startsWith("r:")) : []),
    [data, subjectIsSaved],
  );

  useEffect(() => {
    if (!data || initialized) return;
    setSelection(
      new Map(
        data.subject.linked
          .filter((link) => !(subjectIsSaved && link.key.startsWith("r:")))
          .map((link) => [link.key, link.amount]),
      ),
    );
    setInitialized(true);
  }, [data, initialized, subjectIsSaved]);

  const allocated = money([...selection.values()].reduce((sum, value) => sum + value, 0));
  // Staged claims on a saved subject are pending, not counted: first save wins.
  const remaining = money(subjectAmount - allocated);

  const maxFor = (key: string) => {
    const candidate = known.get(key);
    const current = selection.get(key) || 0;
    const fromCandidate = candidate ? candidate.available : current;
    return money(Math.max(Math.min(fromCandidate, remaining + current), 0));
  };

  const setAmount = (key: string, value: number) => {
    setSelection((previous) => {
      const next = new Map(previous);
      const current = previous.get(key) || 0;
      const candidate = known.get(key);
      const cap = money(
        Math.max(
          Math.min(
            candidate ? candidate.available : current,
            subjectAmount - ([...previous.values()].reduce((sum, item) => sum + item, 0) - current),
          ),
          0,
        ),
      );
      next.set(key, money(Math.min(Math.max(value, 0), cap)));
      return next;
    });
  };

  const remove = (key: string) =>
    setSelection((previous) => {
      const next = new Map(previous);
      next.delete(key);
      return next;
    });

  const toggle = (candidate: ReimbursementCandidate) => {
    if (selection.has(candidate.key)) return remove(candidate.key);
    if (candidate.fullyAllocated) return;
    const amount = money(Math.max(Math.min(candidate.available, remaining), 0));
    if (!(amount > 0)) return;
    setSelection((previous) => new Map(previous).set(candidate.key, amount));
  };

  const stagedInImport = (data?.staged || []).filter((item) => currentDraftId && item.draftId === currentDraftId);
  const stagedElsewhere = (data?.staged || []).filter((item) => !currentDraftId || item.draftId !== currentDraftId);
  const visible = tab === "existing" ? data?.saved.items || [] : tab === "current" ? stagedInImport : stagedElsewhere;
  const savedTotal = data?.saved.total || 0;
  const totalPages = Math.max(1, Math.ceil(savedTotal / PAGE_SIZE));

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accountByIdentifier = useMemo(
    () => new Map(accounts.map((a) => [a.accountIdentifier, a])),
    [accounts],
  );

  const handleSave = async () => {
    setIsSaving(true);
    setError("");
    try {
      const result = await setReimbursementLinks({
        subject,
        role: mode === "expenses" ? "reimbursement" : "expense",
        links: [...selection.entries()]
          .filter(([, amount]) => amount > 0)
          .map(([key, amount]) => ({ other: endOf(key), amount })),
        ...(mode === "expenses" ? { leftoverCategoryId: leftoverCategoryId || null } : {}),
        contextDraftIds,
      });
      onSaved({ warnings: result.warnings || [] });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save links");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const roleProblem = data?.subject.roleProblem;
  const tabs: Array<{ id: Tab; label: string; count: number; show: boolean }> = [
    { id: "current", label: "Current Import", count: stagedInImport.length, show: !!currentDraftId },
    {
      id: "staged",
      label: currentDraftId ? "Other Staged Imports" : "Staged Transactions",
      count: stagedElsewhere.length,
      show: true,
    },
    { id: "existing", label: "Existing Transactions", count: savedTotal, show: true },
  ];
  const sameAmountLabel = `Same ${mode === "expenses" ? "outflow" : "inflow"} amount (${formatAmount(subjectAmount)})`;
  const hasFilters =
    !!query || filters.categoryId !== null || !!filters.dateFrom || !!filters.dateTo || filters.sameAmount;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[92vh] w-[95vw] max-w-[1500px] flex-col overflow-hidden rounded-xl border border-stroke bg-white shadow-xl dark:border-dark-3 dark:bg-dark-2"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "expenses" ? "Reimbursement Allocation" : "Reimbursed By"}
      >
        <div className="flex items-start justify-between border-b border-stroke px-6 py-4 dark:border-dark-3">
          <div className="flex min-w-0 items-center gap-3">
            <Receipt className="h-6 w-6 shrink-0 text-green" />
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-dark dark:text-white">
                {mode === "expenses" ? "Reimbursement Allocation" : "Reimbursed By"}
              </h3>
              <p className="mt-1 truncate text-sm text-dark-5 dark:text-dark-6">
                {mode === "expenses"
                  ? "Select reimbursed transactions and allocate amounts."
                  : "Select the reimbursements that paid this expense back."}{" "}
                <span className="font-medium text-dark dark:text-white">
                  {subjectTitle} · {formatAmount(subjectAmount)}
                </span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 transition-colors hover:bg-gray-1 dark:hover:bg-dark-3"
            aria-label="Close"
          >
            <X className="h-5 w-5 text-dark-5 dark:text-dark-6" />
          </button>
        </div>

        {roleProblem ? (
          <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-yellow-dark/30 bg-yellow-light-4 px-3 py-2 text-sm text-dark dark:bg-dark-3 dark:text-white">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-dark" />
            <span>{roleProblem}. Save the transaction first, then link it.</span>
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden px-6 py-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(380px,1fr)]">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-stroke dark:border-dark-3">
            <div className="border-b border-stroke px-3 pt-2 dark:border-dark-3">
              <div className="flex gap-2">
                {tabs
                  .filter((item) => item.show)
                  .map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTab(item.id)}
                      className={`rounded-t-md px-3 py-2 text-sm font-medium transition-colors ${
                        tab === item.id
                          ? "bg-primary/10 text-primary"
                          : "text-dark-5 hover:bg-gray-1 dark:text-dark-6 dark:hover:bg-dark-3"
                      }`}
                    >
                      {item.label}
                      <span className="ml-1.5 text-xs opacity-70">{item.count}</span>
                    </button>
                  ))}
              </div>
            </div>

            <div className="border-b border-stroke p-3 dark:border-dark-3">
              <div className="space-y-2">
                <div className="flex flex-wrap items-end gap-2">
                  <SearchBar
                    placeholder="Search label or description"
                    value={searchInput}
                    onChange={setSearchInput}
                    isLoading={isLoading}
                    className="min-w-[260px] flex-1"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant={filters.sameAmount ? "primary" : "secondary"}
                    onClick={() => applyFilters({ sameAmount: !filters.sameAmount })}
                  >
                    {sameAmountLabel}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={!hasFilters} onClick={resetFilters}>
                    Reset filters
                  </Button>
                </div>

                <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-stroke bg-white dark:border-dark-3 dark:bg-dark-2 md:grid-cols-3 md:divide-x md:divide-stroke md:dark:divide-dark-3">
                  <div className="border-b border-stroke dark:border-dark-3 md:border-b-0">
                    <Select
                      value={filters.categoryId === null ? "__all__" : filters.categoryId || "__none__"}
                      onChange={(value) =>
                        applyFilters({
                          categoryId: value === "__all__" ? null : value === "__none__" ? "" : value,
                        })
                      }
                      options={[
                        { value: "__all__", label: "All categories" },
                        { value: "__none__", label: "Uncategorized" },
                        ...categories.map((category) => ({ value: category.id, label: category.name })),
                      ]}
                      buttonClassName="rounded-none border-0"
                      menuPlacement="auto"
                      menuStrategy="fixed"
                    />
                  </div>
                  <div className="border-b border-stroke dark:border-dark-3 md:border-b-0">
                    <DatePicker
                      value={filters.dateFrom}
                      onChange={(dateFrom) => applyFilters({ dateFrom })}
                      triggerProps={{ className: "rounded-none" }}
                    />
                  </div>
                  <DatePicker
                    value={filters.dateTo}
                    onChange={(dateTo) => applyFilters({ dateTo })}
                    triggerProps={{ className: "rounded-none" }}
                  />
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="space-y-2">
                {isLoading && !data ? (
                  <div className="py-8 text-center text-sm text-dark-5 dark:text-dark-6">Loading transactions...</div>
                ) : visible.length === 0 ? (
                  <div className="py-8 text-center text-sm text-dark-5 dark:text-dark-6">
                    {mode === "expenses"
                      ? "No expenses to link here."
                      : "No reimbursements here. Mark the money-in transaction as a reimbursement first."}
                  </div>
                ) : (
                  visible.map((candidate) => {
                    const selected = selection.has(candidate.key);
                    const blocked = (candidate.fullyAllocated && !selected) || !!roleProblem;
                    const category = candidate.categoryId ? categoryById.get(candidate.categoryId) : undefined;
                    const account = candidate.accountIdentifier
                      ? accountByIdentifier.get(candidate.accountIdentifier)
                      : undefined;
                    const pending = candidate.pending
                      .map((item) => `${formatAmount(item.amount)} pending in ${item.filename}`)
                      .join(" · ");
                    const details = [
                      candidate.fullyAllocated && !selected
                        ? "Fully allocated"
                        : candidate.available < candidate.amount - EPSILON
                          ? `${formatAmount(candidate.available)} of ${formatAmount(candidate.amount)} still available`
                          : null,
                      candidate.filename ? `${candidate.filename} row ${(candidate.rowIndex ?? 0) + 1}` : null,
                    ].filter(Boolean);
                    const exact = Math.abs(candidate.amount - subjectAmount) < EPSILON;
                    return (
                      <div key={candidate.key} className={blocked ? "pointer-events-none opacity-50" : undefined}>
                        <TransactionCard
                          transaction={{
                            id: candidate.key,
                            date: candidate.date || "",
                            description: candidate.description,
                            label: candidate.label || undefined,
                            amountIn: lookingFor === "reimbursement" ? candidate.amount : null,
                            amountOut: lookingFor === "expense" ? candidate.amount : null,
                            balance: null,
                            accountIdentifier: candidate.accountIdentifier,
                            category: category
                              ? { id: category.id, name: category.name, color: category.color || "#9ca3af" }
                              : undefined,
                            notice: pending || undefined,
                          }}
                          accountColor={account?.color}
                          accountName={account ? accountDisplay(account) : undefined}
                          selected={selected}
                          selectionTone="success"
                          onToggleSelect={() => toggle(candidate)}
                          wrapText
                          showDate
                        />
                        {(details.length > 0 || exact) && (
                          <p className="mt-1 flex flex-wrap items-center gap-2 px-1 text-xs text-dark-5 dark:text-dark-6">
                            {exact ? (
                              <span className="rounded bg-green/10 px-1.5 py-0.5 font-medium text-green">Same amount</span>
                            ) : null}
                            {details.join(" · ")}
                          </p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {tab === "existing" && savedTotal > 0 ? (
              <div className="flex items-center justify-between border-t border-stroke px-3 py-2 text-xs text-dark-5 dark:border-dark-3 dark:text-dark-6">
                <span>
                  Showing {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, savedTotal)} of {savedTotal}
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" disabled={page <= 1 || isLoading} onClick={() => goToPage(page - 1)}>
                    Prev
                  </Button>
                  <span>
                    {page}/{totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page >= totalPages || isLoading}
                    onClick={() => goToPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-col rounded-lg border border-stroke dark:border-dark-3">
            <div className="border-b border-stroke p-3 dark:border-dark-3">
              <div className="text-sm font-semibold text-dark dark:text-white">
                {mode === "expenses" ? "Reimbursement Summary" : "Expense Summary"}
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-dark-5 dark:text-dark-6">Initial amount</span>
                  <span className={`font-semibold ${mode === "expenses" ? "text-green" : "text-red"}`}>
                    {formatAmount(subjectAmount)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-dark-5 dark:text-dark-6">Allocated</span>
                  <span className="font-semibold text-dark dark:text-white">{formatAmount(allocated)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-dark-5 dark:text-dark-6">
                    {mode === "expenses" ? "Remaining" : "Not reimbursed"}
                  </span>
                  <span className={`font-semibold ${remaining < -EPSILON ? "text-red" : "text-primary"}`}>
                    {formatAmount(remaining)}
                  </span>
                </div>
              </div>
              {(data?.subject.pending || []).map((item) => (
                <p key={item.filename} className="mt-1 text-xs text-yellow-dark">
                  {formatAmount(item.amount)} pending in {item.filename}
                </p>
              ))}
            </div>

            {mode === "expenses" ? (
              <div className="border-b border-stroke p-3 dark:border-dark-3">
                <label className="mb-1 block text-xs font-medium text-dark-5 dark:text-dark-6">
                  Leftover Category (optional)
                </label>
                <Select
                  value={leftoverCategoryId}
                  onChange={setLeftoverCategoryId}
                  options={[
                    { value: "", label: "Uncategorized" },
                    ...categories.map((category) => ({ value: category.id, label: category.name })),
                  ]}
                  menuPlacement="auto"
                  menuStrategy="fixed"
                />
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="space-y-2">
                {selection.size === 0 && readOnlyLinks.length === 0 ? (
                  <div className="py-8 text-center text-sm text-dark-5 dark:text-dark-6">
                    Select transactions from the left panel.
                  </div>
                ) : null}
                {[...selection.entries()].map(([key, amount]) => {
                  const candidate = known.get(key);
                  const linked = data?.subject.linked.find((link) => link.key === key);
                  const reimbursable = candidate ? candidate.amount : amount;
                  const already = candidate ? candidate.otherLinked : 0;
                  const max = maxFor(key);
                  return (
                    <AllocationEditorRow
                      key={key}
                      formatAmount={formatAmount}
                      item={{
                        key,
                        title: candidate
                          ? candidate.label || candidate.description
                          : linked?.label || linked?.description || "Transaction",
                        subtitle: [
                          formatDate(candidate?.date || linked?.date || null),
                          candidate?.filename || linked?.filename,
                        ]
                          .filter(Boolean)
                          .join(" · "),
                        reimbursableAmount: reimbursable,
                        alreadyAllocated: already,
                        allocatedNow: amount,
                        maxAllowed: max,
                        leftoverAfterAllocation: money(Math.max(reimbursable - already - amount, 0)),
                        onSetAllocation: (value) => setAmount(key, value),
                        onSetPercent: (percent) => setAmount(key, (reimbursable * percent) / 100),
                        onSetFull: () => setAmount(key, max),
                        onSetHalf: () => setAmount(key, Math.min(reimbursable / 2, max)),
                        onRemove: () => remove(key),
                      }}
                    />
                  );
                })}
                {readOnlyLinks.map((link) => (
                  <div key={link.key} className="rounded-lg border border-dashed border-stroke p-3 text-sm dark:border-dark-3">
                    <p className="truncate font-medium text-dark dark:text-white">{link.label || link.description}</p>
                    <p className="text-xs text-dark-5 dark:text-dark-6">
                      {formatAmount(link.amount)} pending in {link.filename || "a staged import"}. Change it in that import.
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {error ? (
          <p className="px-6 pb-2 text-sm text-red" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex justify-between border-t border-stroke p-4 dark:border-dark-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="success"
            onClick={handleSave}
            disabled={isSaving || !data || !!roleProblem || remaining < -EPSILON}
            isLoading={isSaving}
            leftIcon={<ArrowRightCircle className="h-4 w-4" />}
          >
            Save Reimbursement
          </Button>
        </div>
      </div>
    </div>
  );
}
