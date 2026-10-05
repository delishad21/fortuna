"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRightCircle, Receipt, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { NumberInput } from "@/components/ui/NumberInput";
import { SearchBar } from "@/components/ui/SearchBar";
import { Select } from "@/components/ui/Select";
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
  categories?: Array<{ id: string; name: string }>;
  initialLeftoverCategoryId?: string | null;
  onClose: () => void;
  onSaved: (result: { warnings: string[] }) => void;
}

type Tab = "saved" | "import" | "staged";

const PAGE_SIZE = 30;
const EPSILON = 0.005;

const money = (value: number) => Number(Number(value || 0).toFixed(2));
const formatAmount = (amount: number) => `$${money(amount).toFixed(2)}`;
const formatDate = (date: string | null) =>
  date
    ? new Date(date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";

const endOf = (key: string): LinkEnd =>
  key.startsWith("t:")
    ? { transactionId: key.slice(2) }
    : { draftRowId: key.slice(2) };

export function ReimbursementLinkPicker({
  isOpen,
  subject,
  mode,
  subjectTitle,
  currentDraftId,
  contextDraftIds,
  categories,
  initialLeftoverCategoryId,
  onClose,
  onSaved,
}: ReimbursementLinkPickerProps) {
  const lookingFor = mode === "expenses" ? "expense" : "reimbursement";
  const subjectIsSaved = "transactionId" in subject;
  const subjectKey = subjectIsSaved
    ? `t:${subject.transactionId}`
    : `r:${subject.draftRowId}`;
  const [tab, setTab] = useState<Tab>("saved");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<ReimbursementCandidates | null>(null);
  const [savedItems, setSavedItems] = useState<ReimbursementCandidate[]>([]);
  const [known, setKnown] = useState<Map<string, ReimbursementCandidate>>(new Map());
  const [selection, setSelection] = useState<Map<string, number>>(new Map());
  const [initialized, setInitialized] = useState(false);
  const [leftoverCategoryId, setLeftoverCategoryId] = useState(
    initialLeftoverCategoryId || "",
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const contextKey = (contextDraftIds || []).join(",");

  const load = useCallback(
    async (offset: number, search: string) => {
      const id = ++requestId.current;
      setIsLoading(true);
      setError("");
      try {
        const result = await getReimbursementCandidates({
          subject,
          lookingFor,
          query: search,
          limit: PAGE_SIZE,
          offset,
          contextDraftIds: contextKey ? contextKey.split(",") : undefined,
        });
        if (id !== requestId.current) return;
        setData(result);
        setSavedItems((previous) =>
          offset === 0 ? result.saved.items : [...previous, ...result.saved.items],
        );
        setKnown((previous) => {
          const next = new Map(previous);
          [...result.saved.items, ...result.staged].forEach((item) =>
            next.set(item.key, item),
          );
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
    setTab(currentDraftId && !subjectIsSaved ? "import" : "saved");
    setSearchInput("");
    setQuery("");
    setSelection(new Map());
    setKnown(new Map());
    setSavedItems([]);
    setData(null);
    setInitialized(false);
    setLeftoverCategoryId(initialLeftoverCategoryId || "");
    void load(0, "");
  }, [isOpen, subjectKey, load, currentDraftId, subjectIsSaved, initialLeftoverCategoryId]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      if (searchInput.trim() !== query) {
        setQuery(searchInput.trim());
        void load(0, searchInput.trim());
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, query, isOpen, load]);

  // A saved transaction's links to staged rows belong to those rows: shown, not edited here.
  const readOnlyLinks = useMemo(
    () =>
      subjectIsSaved
        ? (data?.subject.linked || []).filter((link) => link.key.startsWith("r:"))
        : [],
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

  const subjectAmount = data?.subject.amount || 0;
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
            subjectAmount -
              ([...previous.values()].reduce((sum, item) => sum + item, 0) - current),
          ),
          0,
        ),
      );
      next.set(key, money(Math.min(Math.max(value, 0), cap)));
      return next;
    });
  };

  const toggle = (candidate: ReimbursementCandidate) => {
    if (selection.has(candidate.key)) {
      setSelection((previous) => {
        const next = new Map(previous);
        next.delete(candidate.key);
        return next;
      });
      return;
    }
    if (candidate.fullyAllocated) return;
    const amount = money(Math.max(Math.min(candidate.available, remaining), 0));
    if (!(amount > 0)) return;
    setSelection((previous) => new Map(previous).set(candidate.key, amount));
  };

  const stagedInImport = (data?.staged || []).filter(
    (item) => currentDraftId && item.draftId === currentDraftId,
  );
  const stagedElsewhere = (data?.staged || []).filter(
    (item) => !currentDraftId || item.draftId !== currentDraftId,
  );
  const visible =
    tab === "saved" ? savedItems : tab === "import" ? stagedInImport : stagedElsewhere;

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
        ...(mode === "expenses" && categories
          ? { leftoverCategoryId: leftoverCategoryId || null }
          : {}),
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

  const title =
    mode === "expenses" ? "What does this reimbursement pay back?" : "What reimbursed this expense?";
  const roleProblem = data?.subject.roleProblem;
  const tabs: Array<{ id: Tab; label: string; count: number; show: boolean }> = [
    { id: "saved", label: "Saved transactions", count: data?.saved.total || 0, show: true },
    { id: "import", label: "This import", count: stagedInImport.length, show: !!currentDraftId },
    {
      id: "staged",
      label: currentDraftId ? "Other staged imports" : "Staged imports",
      count: stagedElsewhere.length,
      show: true,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[92vh] w-[95vw] max-w-[1200px] flex-col overflow-hidden rounded-xl border border-stroke bg-white shadow-xl dark:border-dark-3 dark:bg-dark-2"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-start justify-between border-b border-stroke px-6 py-4 dark:border-dark-3">
          <div className="flex min-w-0 items-center gap-3">
            <Receipt className="h-6 w-6 shrink-0 text-green" />
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-dark dark:text-white">{title}</h3>
              <p className="mt-1 truncate text-sm text-dark-5 dark:text-dark-6">
                {subjectTitle} · {formatAmount(subjectAmount)}
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

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden px-6 py-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(340px,1fr)]">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-stroke dark:border-dark-3">
            <div className="flex gap-2 border-b border-stroke px-3 pt-2 dark:border-dark-3">
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
            <div className="border-b border-stroke p-3 dark:border-dark-3">
              <SearchBar
                placeholder="Search label or description"
                value={searchInput}
                onChange={setSearchInput}
                isLoading={isLoading}
              />
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {visible.length === 0 && !isLoading ? (
                <p className="py-10 text-center text-sm text-dark-5 dark:text-dark-6">
                  {mode === "expenses"
                    ? "No expenses to link here."
                    : "No reimbursements here. Mark the money-in transaction as a reimbursement first."}
                </p>
              ) : null}
              {visible.map((candidate) => (
                <CandidateCard
                  key={candidate.key}
                  candidate={candidate}
                  selected={selection.has(candidate.key)}
                  exact={Math.abs(candidate.amount - subjectAmount) < EPSILON}
                  onToggle={() => toggle(candidate)}
                  disabled={!!roleProblem}
                />
              ))}
              {tab === "saved" && data && savedItems.length < data.saved.total ? (
                <div className="flex justify-center pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isLoading}
                    onClick={() => void load(savedItems.length, query)}
                  >
                    Show more
                  </Button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-col rounded-lg border border-stroke dark:border-dark-3">
            <div className="border-b border-stroke p-3 text-sm dark:border-dark-3">
              <SummaryRow label={mode === "expenses" ? "Reimbursement" : "Expense"} value={formatAmount(subjectAmount)} />
              <SummaryRow label="Linked" value={formatAmount(allocated)} />
              <SummaryRow
                label={mode === "expenses" ? "Left over" : "Not reimbursed"}
                value={formatAmount(remaining)}
                tone={remaining < -EPSILON ? "danger" : "primary"}
              />
              {(data?.subject.pending || []).map((item) => (
                <p key={item.filename} className="mt-1 text-xs text-yellow-dark">
                  {formatAmount(item.amount)} pending in {item.filename}
                </p>
              ))}
            </div>

            {mode === "expenses" && categories ? (
              <div className="border-b border-stroke p-3 dark:border-dark-3">
                <label className="mb-1 block text-xs font-medium text-dark-5 dark:text-dark-6">
                  Category for what is left over
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

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {selection.size === 0 && readOnlyLinks.length === 0 ? (
                <p className="py-8 text-center text-sm text-dark-5 dark:text-dark-6">
                  Choose transactions on the left.
                </p>
              ) : null}
              {[...selection.entries()].map(([key, amount]) => {
                const candidate = known.get(key);
                const linked = data?.subject.linked.find((link) => link.key === key);
                const name = candidate
                  ? candidate.label || candidate.description
                  : linked?.label || linked?.description || "Transaction";
                return (
                  <div key={key} className="rounded-lg border border-stroke p-3 dark:border-dark-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-dark dark:text-white">{name}</p>
                        <p className="text-xs text-dark-5 dark:text-dark-6">
                          {formatDate(candidate?.date || linked?.date || null)}
                          {candidate?.filename || linked?.filename
                            ? ` · ${candidate?.filename || linked?.filename}`
                            : ""}
                          {candidate ? ` · ${formatAmount(candidate.amount)}` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setSelection((previous) => {
                            const next = new Map(previous);
                            next.delete(key);
                            return next;
                          })
                        }
                        className="rounded p-1 text-dark-5 hover:bg-gray-1 hover:text-dark dark:text-dark-6 dark:hover:bg-dark-3 dark:hover:text-white"
                        aria-label={`Remove ${name}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <NumberInput
                        value={amount || ""}
                        onChange={(event) => setAmount(key, Number(event.target.value || 0))}
                        step="0.01"
                        min="0"
                        aria-label={`Amount for ${name}`}
                      />
                      <Button type="button" variant="secondary" size="sm" onClick={() => setAmount(key, maxFor(key))}>
                        Max
                      </Button>
                    </div>
                    <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                      Up to {formatAmount(maxFor(key))}
                    </p>
                  </div>
                );
              })}
              {readOnlyLinks.map((link) => (
                <div
                  key={link.key}
                  className="rounded-lg border border-dashed border-stroke p-3 text-sm dark:border-dark-3"
                >
                  <p className="truncate font-medium text-dark dark:text-white">
                    {link.label || link.description}
                  </p>
                  <p className="text-xs text-dark-5 dark:text-dark-6">
                    {formatAmount(link.amount)} pending in {link.filename || "a staged import"}. Change it in that import.
                  </p>
                </div>
              ))}
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
            Save links
          </Button>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "primary" | "danger";
}) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-dark-5 dark:text-dark-6">{label}</span>
      <span
        className={`font-semibold ${
          tone === "danger" ? "text-red" : tone === "primary" ? "text-primary" : "text-dark dark:text-white"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function CandidateCard({
  candidate,
  selected,
  exact,
  disabled,
  onToggle,
}: {
  candidate: ReimbursementCandidate;
  selected: boolean;
  exact: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const blocked = candidate.fullyAllocated && !selected;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled || blocked}
      aria-pressed={selected}
      className={`w-full rounded-lg border p-3 text-left transition-colors ${
        selected
          ? "border-primary bg-primary/5"
          : blocked
            ? "cursor-not-allowed border-stroke bg-gray-1 opacity-60 dark:border-dark-3 dark:bg-dark-3"
            : "border-stroke hover:border-primary/60 hover:bg-gray-1 dark:border-dark-3 dark:hover:bg-dark-3"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-dark dark:text-white">
            {candidate.label || candidate.description}
          </p>
          {candidate.label ? (
            <p className="truncate text-xs text-dark-5 dark:text-dark-6">{candidate.description}</p>
          ) : null}
          <p className="mt-0.5 text-xs text-dark-5 dark:text-dark-6">
            {formatDate(candidate.date)}
            {candidate.filename
              ? ` · ${candidate.filename} row ${(candidate.rowIndex ?? 0) + 1}`
              : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold text-dark dark:text-white">{formatAmount(candidate.amount)}</p>
          {blocked ? (
            <span className="mt-1 inline-block rounded bg-gray-3 px-1.5 py-0.5 text-[11px] font-medium text-dark-5 dark:bg-dark-2 dark:text-dark-6">
              Fully allocated
            </span>
          ) : (
            <p className="mt-0.5 text-xs text-dark-5 dark:text-dark-6">
              {formatAmount(candidate.available)} of {formatAmount(candidate.amount)} available
            </p>
          )}
          {exact ? (
            <span className="mt-1 inline-block rounded bg-green/10 px-1.5 py-0.5 text-[11px] font-medium text-green">
              Same amount
            </span>
          ) : null}
        </div>
      </div>
      {candidate.pending.length ? (
        <p className="mt-1 text-xs text-yellow-dark">
          {candidate.pending
            .map((item) => `${formatAmount(item.amount)} pending in ${item.filename}`)
            .join(" · ")}
        </p>
      ) : null}
    </button>
  );
}
