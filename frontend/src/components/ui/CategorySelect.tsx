"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { HTMLAttributes, ReactNode } from "react";
import { ChevronDown, Plus, Check, Lock } from "lucide-react";
import { HoverTooltip } from "@/components/ui/HoverTooltip";

interface Category {
  id: string;
  name: string;
  color: string;
}

interface CategorySelectProps {
  value?: string;
  categories: Category[];
  onChange: (categoryId: string) => void;
  onAddClick: () => void;
  disabled?: boolean;
  lockedByLinkage?: boolean;
  variant?: "default" | "borderless";
  excludeReserved?: boolean;
  dropdownPlacement?: "fixed" | "inline";
  showOpenRing?: boolean;
  openOnFocus?: boolean;
  emptyLabel?: string;
  suggestionMarker?: {
    show: boolean;
    tooltipContent?: ReactNode;
  };
  triggerProps?: HTMLAttributes<HTMLButtonElement> & {
    [key: `data-${string}`]: string;
  };
}

export function CategorySelect({
  value,
  categories,
  onChange,
  onAddClick,
  disabled = false,
  lockedByLinkage = false,
  variant = "default",
  excludeReserved = false,
  dropdownPlacement = "fixed",
  showOpenRing = true,
  openOnFocus = false,
  emptyLabel = "Uncategorized",
  suggestionMarker,
  triggerProps,
}: CategorySelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });
  const [showAbove, setShowAbove] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pointerFocusRef = useRef(false);
  const focusSearchOnOpenRef = useRef(true);
  const typeaheadRef = useRef("");
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingIdRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;
  // Type-ahead previews its match here and commits it once typing pauses, so a
  // category with side effects (Reimbursement opens a picker) is not chosen
  // halfway through typing another name.
  const [pendingId, setPendingId] = useState<string | null>(null);
  // The choice just handed to onChange, shown until the parent's value catches
  // up so a slow save doesn't flash the old category.
  const [committedId, setCommittedId] = useState<string | null>(null);

  const reservedNames = ["internal", "reimbursement"];
  const filteredCategories = categories.filter((cat) => {
    const name = cat.name.toLowerCase();
    if (name === "uncategorized") return false;
    if (excludeReserved && reservedNames.includes(name)) return false;
    return true;
  });
  const shownId = pendingId ?? committedId ?? value;
  const selectedCategory = filteredCategories.find((c) => c.id === shownId);
  const needle = searchQuery.trim().toLowerCase();
  const visibleCategories = needle
    ? [
        ...filteredCategories.filter((category) =>
          category.name.toLowerCase().startsWith(needle),
        ),
        ...filteredCategories.filter(
          (category) =>
            !category.name.toLowerCase().startsWith(needle) &&
            category.name.toLowerCase().includes(needle),
        ),
      ]
    : filteredCategories;
  const alphabetical = [...filteredCategories].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );

  const isReserved = (id: string) =>
    reservedNames.includes(
      categories.find((c) => c.id === id)?.name.toLowerCase() ?? "",
    );

  // Reserved picks open their own dialogs instead of changing the value.
  const holdChoice = (id: string) => {
    if (!isReserved(id)) setCommittedId(id);
  };

  const clearTypeahead = () => {
    typeaheadRef.current = "";
    if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
    typeaheadTimerRef.current = null;
  };

  const showPending = (id: string | null) => {
    pendingIdRef.current = id;
    setPendingId(id);
  };

  const commitTypeahead = () => {
    clearTypeahead();
    const next = pendingIdRef.current;
    if (next === null) return false;
    showPending(null);
    setIsOpen(false);
    if (next !== (valueRef.current ?? "")) {
      holdChoice(next);
      onChangeRef.current(next);
    } else if (isReserved(next)) {
      // Picking Reimbursement again reopens its picker, as a click does.
      onChangeRef.current(next);
    }
    return true;
  };

  const cancelTypeahead = () => {
    clearTypeahead();
    showPending(null);
  };

  // Typing letters on the closed or open trigger jumps to the first category,
  // alphabetically, whose name starts with everything typed in the last 2s.
  const handleTypeahead = (event: React.KeyboardEvent) => {
    if (disabled || lockedByLinkage) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const typing = typeaheadRef.current;
    let next: string;
    if (event.key === "Backspace") {
      if (!typing) return false;
      next = typing.slice(0, -1);
    } else if (event.key.length === 1 && (typing || /\S/.test(event.key))) {
      next = `${typing}${event.key.toLowerCase()}`;
    } else {
      return false;
    }
    event.preventDefault();
    if (!next) {
      cancelTypeahead();
      return true;
    }
    typeaheadRef.current = next;
    const match = alphabetical.find((category) =>
      category.name.toLowerCase().startsWith(next),
    );
    if (match) showPending(match.id);
    if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
    typeaheadTimerRef.current = setTimeout(commitTypeahead, 2000);
    return true;
  };

  useEffect(() => {
    if (committedId === null) return;
    // A rejected change (e.g. Reimbursement on an expense) never updates value.
    const timer = setTimeout(() => setCommittedId(null), 4000);
    return () => clearTimeout(timer);
  }, [committedId]);

  useEffect(() => setCommittedId(null), [value]);

  // A row can unmount (virtualized tables) mid-typing; keep what was typed.
  useEffect(() => () => void commitTypeahead(), []);

  useEffect(() => {
    if (!isOpen || !shownId) return;
    const frame = requestAnimationFrame(() =>
      dropdownRef.current
        ?.querySelector<HTMLElement>(
          `[data-category-id="${CSS.escape(shownId)}"]`,
        )
        ?.scrollIntoView({ block: "nearest" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [isOpen, shownId]);

  const renderMenu = (menu: React.ReactNode) =>
    dropdownPlacement === "inline" || typeof document === "undefined"
      ? menu
      : createPortal(menu, document.body);

  const updateDropdownPosition = () => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const dropdownHeight = 240; // max-h-60 = 240px
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    // Determine if dropdown should show above or below
    const shouldShowAbove =
      spaceBelow < dropdownHeight && spaceAbove > spaceBelow;

    setShowAbove(shouldShowAbove);
    if (dropdownPlacement === "inline") return;

    setDropdownPosition({
      top: shouldShowAbove ? rect.top - 4 : rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  };

  useEffect(() => {
    if (!isOpen) return;

    const focusFrame = focusSearchOnOpenRef.current
      ? requestAnimationFrame(() => searchRef.current?.focus())
      : 0;

    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) setSearchQuery("");
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      updateDropdownPosition();

      // Update position on scroll
      const handleScroll = () => {
        updateDropdownPosition();
      };

      // Listen to scroll on all scrollable parents
      window.addEventListener("scroll", handleScroll, true);
      window.addEventListener("resize", handleScroll);

      return () => {
        window.removeEventListener("scroll", handleScroll, true);
        window.removeEventListener("resize", handleScroll);
      };
    }
  }, [isOpen, dropdownPlacement]);

  const handleSelect = (categoryId: string) => {
    cancelTypeahead();
    if (categoryId !== (value ?? "")) holdChoice(categoryId);
    onChange(categoryId);
    setIsOpen(false);
  };

  const handleAddNew = () => {
    cancelTypeahead();
    setIsOpen(false);
    onAddClick();
  };

  const {
    className: triggerClassNameProp,
    onKeyDown: triggerOnKeyDown,
    onFocus: triggerOnFocus,
    onBlur: triggerOnBlur,
    ...triggerRestProps
  } = triggerProps || {};
  const triggerClassName = [
    `w-full h-full flex items-center px-4 py-3 text-sm text-left rounded-lg outline-none cursor-pointer transition-all disabled:cursor-not-allowed ${
      variant === "borderless"
        ? "bg-transparent border border-transparent hover:bg-gray-2 dark:hover:bg-dark-3 hover:rounded-none"
        : "bg-white dark:bg-dark-2 border border-stroke dark:border-dark-3 hover:border-primary dark:hover:border-primary"
    } ${
      isOpen && showOpenRing
        ? "ring-2 ring-inset ring-primary border-primary"
        : ""
    }`,
    triggerClassNameProp,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={containerRef} className="relative w-full h-full">
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        onMouseDown={() => {
          pointerFocusRef.current = true;
        }}
        onClick={() => {
          if (disabled) return;
          pointerFocusRef.current = false;
          if (commitTypeahead()) return;
          // Position before the first frame so the menu never flashes at 0,0.
          if (!isOpen) updateDropdownPosition();
          focusSearchOnOpenRef.current = true;
          setIsOpen((prev) => !prev);
        }}
        onFocus={(event) => {
          triggerOnFocus?.(event);
          if (openOnFocus && !disabled && !pointerFocusRef.current) {
            updateDropdownPosition();
            // Keep focus here so typing picks a category without the search box.
            focusSearchOnOpenRef.current = false;
            setIsOpen(true);
          }
        }}
        onBlur={(event) => {
          triggerOnBlur?.(event);
          const next = event.relatedTarget as Node | null;
          if (next && dropdownRef.current?.contains(next)) {
            // Moving into the search box: searching replaces the type-ahead.
            cancelTypeahead();
            return;
          }
          commitTypeahead();
        }}
        onKeyDown={(event) => {
          triggerOnKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === "Escape") {
            cancelTypeahead();
            setIsOpen(false);
            return;
          }
          if (event.key === "Tab") {
            commitTypeahead();
            setIsOpen(false);
            return;
          }
          if (event.key === "Enter" && pendingIdRef.current !== null) {
            event.preventDefault();
            commitTypeahead();
            return;
          }
          if (event.key === "Enter" || event.key === "ArrowDown") {
            event.preventDefault();
            cancelTypeahead();
            updateDropdownPosition();
            focusSearchOnOpenRef.current = true;
            if (isOpen) searchRef.current?.focus();
            setIsOpen(true);
            return;
          }
          handleTypeahead(event);
        }}
        disabled={disabled}
        {...triggerRestProps}
        className={triggerClassName}
      >
        {selectedCategory ? (
          <>
            <div
              className="w-2.5 h-2.5 rounded-full mr-2 shrink-0"
              style={{ backgroundColor: selectedCategory.color }}
            />
            <span className="flex-1 truncate font-medium text-dark dark:text-white">
              {selectedCategory.name}
            </span>
          </>
        ) : (
          <span className="flex-1 text-dark-5 dark:text-dark-6">
            {emptyLabel}
          </span>
        )}
        {suggestionMarker?.show && (
          <HoverTooltip
            content={suggestionMarker.tooltipContent || "Suggested category"}
            align="end"
          >
            <span className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-primary/50 bg-primary/10 text-xs font-bold leading-none text-primary">
              *
            </span>
          </HoverTooltip>
        )}
        {lockedByLinkage ? (
          <Lock className="h-4 w-4 text-dark-5 dark:text-dark-6 ml-2 flex-shrink-0" />
        ) : (
          <ChevronDown
            className={`h-4 w-4 text-dark-5 dark:text-dark-6 ml-2 flex-shrink-0 transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        )}
      </button>

      {/* Dropdown Menu: portalled so transformed or clipped ancestors (panels, modals) cannot offset it */}
      {isOpen &&
        renderMenu(
          <div
            ref={dropdownRef}
            onMouseDown={(event) => {
              // Clicking an option keeps focus on the trigger; only the search
              // box takes focus.
              if (event.target !== searchRef.current) event.preventDefault();
            }}
            className={`${
              dropdownPlacement === "inline"
                ? "absolute left-0 right-0 z-30"
                : "fixed z-[90]"
            } flex max-h-60 flex-col overflow-hidden bg-white dark:bg-dark-2 border border-stroke dark:border-dark-3 rounded-lg shadow-dropdown`}
            style={
              dropdownPlacement === "inline"
                ? showAbove
                  ? {
                      bottom: "calc(100% + 4px)",
                      transformOrigin: "bottom",
                    }
                  : {
                      top: "calc(100% + 4px)",
                      transformOrigin: "top",
                    }
                : {
                    top: showAbove ? "auto" : dropdownPosition.top,
                    bottom: showAbove
                      ? window.innerHeight - dropdownPosition.top
                      : "auto",
                    left: dropdownPosition.left,
                    width: dropdownPosition.width,
                    transformOrigin: showAbove ? "bottom" : "top",
                  }
            }
          >
            <div className="shrink-0 border-b border-stroke bg-white p-2 dark:border-dark-3 dark:bg-dark-2">
              <input
                ref={searchRef}
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setIsOpen(false);
                    requestAnimationFrame(() => triggerRef.current?.focus());
                    return;
                  }
                  if (event.key === "Enter" && visibleCategories[0]) {
                    event.preventDefault();
                    handleSelect(visibleCategories[0].id);
                  }
                }}
                placeholder="Search categories..."
                aria-label="Search categories"
                className="w-full rounded-md border border-stroke bg-transparent px-3 py-2 text-sm text-dark outline-none focus:border-primary dark:border-dark-3 dark:text-white"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-auto py-1">
              {/* Uncategorized Option */}
              <button
                type="button"
                data-category-id=""
                onClick={() => handleSelect("")}
                className={`w-full flex items-center px-4 py-2.5 text-sm text-left hover:bg-gray-2 dark:hover:bg-dark-3 transition-colors ${
                  pendingId === "" ? "bg-gray-2 dark:bg-dark-3" : ""
                }`}
              >
                <div className="w-2.5 h-2.5 rounded-full mr-2 flex-shrink-0 bg-dark-5 dark:bg-dark-6" />
                <span className="flex-1 text-dark dark:text-white">
                  {emptyLabel}
                </span>
                {!shownId && <Check className="h-4 w-4 text-primary ml-2" />}
              </button>

              {/* Divider */}
              <div className="h-px bg-stroke dark:bg-dark-3 my-1" />

              {/* Category Options */}
              {visibleCategories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  data-category-id={cat.id}
                  onClick={() => handleSelect(cat.id)}
                  className={`w-full flex items-center px-4 py-2.5 text-sm text-left hover:bg-gray-2 dark:hover:bg-dark-3 transition-colors ${
                    pendingId === cat.id ? "bg-gray-2 dark:bg-dark-3" : ""
                  }`}
                >
                  <div
                    className="w-2.5 h-2.5 rounded-full mr-2 flex-shrink-0"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="flex-1 text-dark dark:text-white">
                    {cat.name}
                  </span>
                  {shownId === cat.id && (
                    <Check className="h-4 w-4 text-primary ml-2" />
                  )}
                </button>
              ))}
              {visibleCategories.length === 0 && (
                <p className="px-4 py-3 text-sm text-dark-5 dark:text-dark-6">
                  No categories found
                </p>
              )}

              {/* Divider */}
              <div className="h-px bg-stroke dark:bg-dark-3 my-1" />

              {/* Add New Category */}
              <button
                type="button"
                onClick={handleAddNew}
                className="w-full flex items-center px-4 py-2.5 text-sm text-left text-primary hover:bg-gray-2 dark:hover:bg-dark-3 transition-colors font-medium"
              >
                <Plus className="h-4 w-4 mr-2" />
                <span>New Category</span>
              </button>
            </div>
          </div>,
        )}
    </div>
  );
}
