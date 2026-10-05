"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ListFilter, RotateCcw, X } from "lucide-react";
import { Checkbox } from "@/components/ui/Checkbox";
import { DatePicker } from "@/components/ui/DatePicker";
import type {
  AmountFilter,
  CategoryFilterOption,
  SortDirection,
} from "./columnFilters";
import { UNCATEGORIZED_KEY } from "./columnFilters";

const MENU_WIDTH = 288;
const VIEWPORT_MARGIN = 8;
const MENU_GAP = 4;
const PREFERRED_MENU_HEIGHT = 420;

interface MenuPosition {
  left: number;
  top: number | "auto";
  bottom: number | "auto";
  maxHeight: number;
}

function computeMenuPosition(trigger: HTMLElement): MenuPosition {
  const rect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(MENU_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2);
  // Right-align with the trigger (it sits at the right edge of the header).
  const left = Math.min(
    Math.max(rect.right - width, VIEWPORT_MARGIN),
    viewportWidth - width - VIEWPORT_MARGIN,
  );
  const spaceBelow = viewportHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN;
  const spaceAbove = rect.top - MENU_GAP - VIEWPORT_MARGIN;
  const showAbove =
    spaceBelow < PREFERRED_MENU_HEIGHT && spaceAbove > spaceBelow;
  return showAbove
    ? {
        left,
        top: "auto",
        bottom: viewportHeight - rect.top + MENU_GAP,
        maxHeight: Math.max(spaceAbove, 160),
      }
    : {
        left,
        top: rect.bottom + MENU_GAP,
        bottom: "auto",
        maxHeight: Math.max(spaceBelow, 160),
      };
}

/**
 * True when `target` lives in a portal appended to <body> after `menu`
 * (e.g. the calendar of a DatePicker opened from inside the menu).
 */
function isInLaterPortal(target: Node, menu: HTMLElement): boolean {
  if (typeof document === "undefined") return false;
  let topLevel: Node | null = target;
  while (topLevel && topLevel.parentNode !== document.body) {
    topLevel = topLevel.parentNode;
  }
  let menuTopLevel: Node | null = menu;
  while (menuTopLevel && menuTopLevel.parentNode !== document.body) {
    menuTopLevel = menuTopLevel.parentNode;
  }
  if (!topLevel || !menuTopLevel || topLevel === menuTopLevel) return false;
  return !!(
    menuTopLevel.compareDocumentPosition(topLevel) &
    Node.DOCUMENT_POSITION_FOLLOWING
  );
}

interface ColumnFilterMenuProps {
  columnLabel: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  sortLabels: { asc: string; desc: string };
  sortDirection: SortDirection | null;
  /** 1-based position in the sort order, or null when not sorted. */
  sortPriority: number | null;
  sortCount: number;
  isFiltered: boolean;
  onSortChange: (direction: SortDirection | null) => void;
  onReset: () => void;
  disabled?: boolean;
  children?: ReactNode;
}

export function ColumnFilterMenu({
  columnLabel,
  isOpen,
  onOpenChange,
  sortLabels,
  sortDirection,
  sortPriority,
  sortCount,
  isFiltered,
  onSortChange,
  onReset,
  disabled = false,
  children,
}: ColumnFilterMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const isActive = isFiltered || sortDirection !== null;

  const updatePosition = () => {
    if (triggerRef.current) {
      setPosition(computeMenuPosition(triggerRef.current));
    }
  };

  // Keep the latest callback without re-subscribing listeners every render.
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => {
    if (!isOpen) return;

    const close = () => onOpenChangeRef.current(false);
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      const menu = menuRef.current;
      if (!target || !menu) return;
      if (menu.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      if (isInLaterPortal(target, menu)) return;
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
      triggerRef.current?.focus();
    };
    const handleReposition = () => {
      if (triggerRef.current) {
        setPosition(computeMenuPosition(triggerRef.current));
      }
    };
    const focusFrame = requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLElement>("[data-autofocus]")
        ?.focus({ preventScroll: true });
    });

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [isOpen]);

  const sortOptions: Array<{
    direction: SortDirection;
    label: string;
    icon: ReactNode;
  }> = [
    {
      direction: "asc",
      label: sortLabels.asc,
      icon: <ArrowUp className="h-3.5 w-3.5" />,
    },
    {
      direction: "desc",
      label: sortLabels.desc,
      icon: <ArrowDown className="h-3.5 w-3.5" />,
    },
  ];

  const TriggerIcon =
    sortDirection === "asc"
      ? ArrowUp
      : sortDirection === "desc"
        ? ArrowDown
        : ListFilter;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={`Filter and sort ${columnLabel}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title={`Filter and sort ${columnLabel}`}
        onClick={() => {
          if (isOpen) {
            onOpenChange(false);
            return;
          }
          // Position before the first paint so the menu never flashes at 0,0.
          updatePosition();
          onOpenChange(true);
        }}
        className={`inline-flex h-6 shrink-0 items-center gap-0.5 rounded px-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          isActive || isOpen
            ? "bg-primary/10 text-primary"
            : "text-dark-5 hover:bg-gray-2 hover:text-dark dark:text-dark-6 dark:hover:bg-dark-3 dark:hover:text-white"
        }`}
      >
        {isFiltered && sortDirection && (
          <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        <TriggerIcon className="h-3.5 w-3.5" aria-hidden="true" />
        {sortPriority !== null && (
          <span className="text-[10px] font-semibold leading-none tabular-nums">
            {sortPriority}
          </span>
        )}
      </button>

      {isOpen &&
        position &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-label={`Filter and sort ${columnLabel}`}
            className="fixed z-[90] flex flex-col overflow-hidden rounded-lg border border-stroke bg-white text-left text-sm font-normal text-dark shadow-dropdown dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            style={{
              left: position.left,
              top: position.top,
              bottom: position.bottom,
              width: Math.min(MENU_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2),
              maxHeight: position.maxHeight,
            }}
          >
            <div className="flex items-center justify-between border-b border-stroke px-3 py-2 dark:border-dark-3">
              <p
                className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6"
              >
                {columnLabel}
              </p>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="Close menu"
                className="rounded p-1 text-dark-5 hover:bg-gray-2 dark:text-dark-6 dark:hover:bg-dark-3"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="p-2">
                <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                  Sort
                </p>
                <div className="space-y-0.5">
                  {sortOptions.map((option, optionIndex) => {
                    const selected = sortDirection === option.direction;
                    return (
                      <button
                        key={option.direction}
                        type="button"
                        aria-pressed={selected}
                        data-autofocus={optionIndex === 0 ? "" : undefined}
                        onClick={() => onSortChange(option.direction)}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                          selected
                            ? "bg-primary/10 font-medium text-primary"
                            : "hover:bg-gray-2 dark:hover:bg-dark-3"
                        }`}
                      >
                        {option.icon}
                        <span className="flex-1">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
                {sortPriority !== null && sortCount > 1 && (
                  <p className="px-1 pt-1.5 text-xs text-dark-5 dark:text-dark-6">
                    {sortPriority === 1
                      ? `Primary sort; ${sortCount - 1} more as tie-breaker${sortCount > 2 ? "s" : ""}.`
                      : `Tie-breaker ${sortPriority} of ${sortCount}. Choose a direction to make it the primary sort.`}
                  </p>
                )}
                {sortDirection && (
                  <button
                    type="button"
                    onClick={() => onSortChange(null)}
                    className="mt-1 px-1 text-xs text-primary hover:underline"
                  >
                    Clear sort
                  </button>
                )}
              </div>

              {children && (
                <div className="border-t border-stroke p-2 dark:border-dark-3">
                  {children}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-stroke px-3 py-2 dark:border-dark-3">
              <button
                type="button"
                onClick={onReset}
                disabled={!isActive}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:text-dark-5 disabled:no-underline dark:disabled:text-dark-6"
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary/90"
              >
                Done
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Filter sections
// ---------------------------------------------------------------------------

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
      {children}
    </p>
  );
}

interface DateRangeFilterProps {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
}

export function DateRangeFilter({ from, to, onChange }: DateRangeFilterProps) {
  const rows = [
    {
      label: "From",
      value: from,
      set: (value: string) => onChange({ from: value, to }),
    },
    {
      label: "To",
      value: to,
      set: (value: string) => onChange({ from, to: value }),
    },
  ];
  return (
    <div>
      <SectionTitle>Date range</SectionTitle>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2">
            <span className="w-9 shrink-0 px-1 text-xs text-dark-5 dark:text-dark-6">
              {row.label}
            </span>
            <div className="h-10 min-w-0 flex-1 overflow-hidden rounded-lg border border-stroke dark:border-dark-3">
              <DatePicker
                value={row.value}
                onChange={row.set}
                triggerProps={{ "aria-label": `${row.label} date` }}
              />
            </div>
            <button
              type="button"
              aria-label={`Clear ${row.label.toLowerCase()} date`}
              disabled={!row.value}
              onClick={() => row.set("")}
              className="rounded p-1 text-dark-5 hover:bg-gray-2 disabled:invisible dark:text-dark-6 dark:hover:bg-dark-3"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      {from && to && from > to && (
        <p className="px-1 pt-1.5 text-xs text-red">
          “From” is after “To”, so no rows match.
        </p>
      )}
    </div>
  );
}

interface CategoryChecklistFilterProps {
  options: CategoryFilterOption[];
  hiddenKeys: ReadonlySet<string>;
  onChange: (hiddenKeys: ReadonlySet<string>) => void;
}

const CATEGORY_SEARCH_THRESHOLD = 8;

export function CategoryChecklistFilter({
  options,
  hiddenKeys,
  onChange,
}: CategoryChecklistFilterProps) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const listed = needle
    ? options.filter((option) => option.name.toLowerCase().includes(needle))
    : options;
  const pinned = listed.filter((option) => option.pinned);
  const others = listed.filter((option) => !option.pinned);

  const setListed = (show: boolean) => {
    const next = new Set(hiddenKeys);
    for (const option of listed) {
      if (show) next.delete(option.key);
      else next.add(option.key);
    }
    onChange(next);
  };

  const toggle = (key: string, show: boolean) => {
    const next = new Set(hiddenKeys);
    if (show) next.delete(key);
    else next.add(key);
    onChange(next);
  };

  const renderOption = (option: CategoryFilterOption) => {
    const checked = !hiddenKeys.has(option.key);
    return (
      <label
        key={option.key}
        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-gray-2 dark:hover:bg-dark-3"
      >
        <Checkbox
          checked={checked}
          onChange={(next) => toggle(option.key, next)}
        />
        <span
          aria-hidden="true"
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${
            option.key === UNCATEGORIZED_KEY || !option.color
              ? "bg-dark-5 dark:bg-dark-6"
              : ""
          }`}
          style={
            option.key !== UNCATEGORIZED_KEY && option.color
              ? { backgroundColor: option.color }
              : undefined
          }
        />
        <span className="min-w-0 flex-1 truncate">{option.name}</span>
        <span className="shrink-0 text-xs tabular-nums text-dark-5 dark:text-dark-6">
          {option.count}
        </span>
      </label>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between px-1 pb-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
          Show categories
        </p>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setListed(true)}
            className="text-primary hover:underline"
          >
            Select all
          </button>
          <span className="text-dark-5 dark:text-dark-6">·</span>
          <button
            type="button"
            onClick={() => setListed(false)}
            className="text-primary hover:underline"
          >
            Clear all
          </button>
        </div>
      </div>
      {options.length > CATEGORY_SEARCH_THRESHOLD && (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search categories..."
          aria-label="Search categories"
          className="mb-1.5 w-full rounded-md border border-stroke bg-transparent px-2.5 py-1.5 text-xs text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
        />
      )}
      <div className="max-h-56 overflow-y-auto">
        {pinned.map(renderOption)}
        {pinned.length > 0 && others.length > 0 && (
          <div className="mx-2 my-1 h-px bg-stroke dark:bg-dark-3" />
        )}
        {others.map(renderOption)}
        {listed.length === 0 && (
          <p className="px-2 py-2 text-xs text-dark-5 dark:text-dark-6">
            No categories found
          </p>
        )}
      </div>
    </div>
  );
}

interface AmountRangeFilterProps {
  filter: AmountFilter;
  onlyWithValueLabel: string;
  onChange: (filter: AmountFilter) => void;
}

export function AmountRangeFilter({
  filter,
  onlyWithValueLabel,
  onChange,
}: AmountRangeFilterProps) {
  const isInvalid = (value: string) =>
    value.trim() !== "" && !Number.isFinite(Number(value.trim()));
  const inputClass = (value: string) =>
    `w-full rounded-md border bg-transparent px-2.5 py-1.5 text-xs text-dark outline-none focus:border-primary dark:text-white ${
      isInvalid(value) ? "border-red" : "border-stroke dark:border-dark-3"
    }`;

  return (
    <div>
      <SectionTitle>Amount</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block px-1 text-xs text-dark-5 dark:text-dark-6">
            Min
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={filter.min}
            onChange={(event) =>
              onChange({ ...filter, min: event.target.value })
            }
            placeholder="No min"
            className={inputClass(filter.min)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block px-1 text-xs text-dark-5 dark:text-dark-6">
            Max
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={filter.max}
            onChange={(event) =>
              onChange({ ...filter, max: event.target.value })
            }
            placeholder="No max"
            className={inputClass(filter.max)}
          />
        </label>
      </div>
      <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-md px-1 py-1">
        <Checkbox
          checked={filter.onlyWithValue}
          onChange={(next) => onChange({ ...filter, onlyWithValue: next })}
        />
        <span className="text-xs">{onlyWithValueLabel}</span>
      </label>
    </div>
  );
}
