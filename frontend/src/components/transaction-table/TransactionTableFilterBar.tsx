"use client";

import { EyeOff, RefreshCw, RotateCcw, Search, X } from "lucide-react";

interface TransactionTableFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  needsReviewOnly: boolean;
  onNeedsReviewChange: (value: boolean) => void;
  needsReviewCount: number;
  visibleCount: number;
  totalCount: number;
  hiddenSelectedCount: number;
  isActive: boolean;
  onReset: () => void;
  /** Edits made since filters/sorts were applied changed what would match. */
  isStale: boolean;
  onReapply: () => void;
}

/** Slim row above the review table: search, quick toggles and filter status. */
export function TransactionTableFilterBar({
  search,
  onSearchChange,
  needsReviewOnly,
  onNeedsReviewChange,
  needsReviewCount,
  visibleCount,
  totalCount,
  hiddenSelectedCount,
  isActive,
  onReset,
  isStale,
  onReapply,
}: TransactionTableFilterBarProps) {
  return (
    <div className="mb-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
      <div className="relative w-full max-w-xs min-w-[180px] flex-1 sm:flex-none">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dark-5 dark:text-dark-6"
          aria-hidden="true"
        />
        <input
          type="text"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && search) {
              event.preventDefault();
              onSearchChange("");
            }
          }}
          placeholder="Search label or description"
          aria-label="Search label or description"
          className="h-8 w-full rounded-lg border border-stroke bg-white pl-8 pr-7 text-xs text-dark outline-none transition-colors placeholder:text-dark-5 focus:border-primary focus:ring-1 focus:ring-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white dark:placeholder:text-dark-6"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-dark-5 hover:bg-gray-2 dark:text-dark-6 dark:hover:bg-dark-3"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <button
        type="button"
        aria-pressed={needsReviewOnly}
        onClick={() => onNeedsReviewChange(!needsReviewOnly)}
        title="Rows not auto-applied that still have no category, label or link"
        className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
          needsReviewOnly
            ? "border-primary bg-primary/10 text-primary"
            : "border-stroke text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-3"
        }`}
      >
        Needs review
        <span
          className={`rounded-full px-1.5 text-[10px] tabular-nums ${
            needsReviewOnly
              ? "bg-primary/15"
              : "bg-gray-2 text-dark-5 dark:bg-dark-3 dark:text-dark-6"
          }`}
        >
          {needsReviewCount}
        </span>
      </button>

      {visibleCount < totalCount && (
        <span className="text-xs text-dark-5 dark:text-dark-6" aria-live="polite">
          Showing {visibleCount.toLocaleString()} of{" "}
          {totalCount.toLocaleString()}
        </span>
      )}

      {hiddenSelectedCount > 0 && (
        <span className="inline-flex items-center gap-1 text-xs text-orange-dark dark:text-orange-light">
          <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
          {hiddenSelectedCount} selected row
          {hiddenSelectedCount !== 1 ? "s are" : " is"} hidden by filters
        </span>
      )}

      {isStale && (
        <button
          type="button"
          onClick={onReapply}
          title="Your edits changed which rows match. Re-run the filters and sorts."
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Reapply filters
        </button>
      )}

      {isActive && (
        <button
          type="button"
          onClick={onReset}
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Reset filters
        </button>
      )}
    </div>
  );
}
