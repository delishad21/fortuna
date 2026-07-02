"use client";

import { useState, useRef, useEffect } from "react";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef("");
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerFocusRef = useRef(false);

  const reservedNames = ["internal", "reimbursement"];
  const filteredCategories = categories.filter((cat) => {
    const name = cat.name.toLowerCase();
    if (name === "uncategorized") return false;
    if (excludeReserved && reservedNames.includes(name)) return false;
    return true;
  });
  const selectedCategory = filteredCategories.find((c) => c.id === value);

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
    return () => document.removeEventListener("mousedown", handleClickOutside);
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
    onChange(categoryId);
    setIsOpen(false);
  };

  const handleAddNew = () => {
    setIsOpen(false);
    onAddClick();
  };

  const handleTypeahead = (key: string) => {
    if (disabled || lockedByLinkage || key.length !== 1 || !/\S/.test(key)) {
      return false;
    }

    const nextQuery = `${typeaheadRef.current}${key}`.toLowerCase();
    typeaheadRef.current = nextQuery;
    if (typeaheadTimerRef.current) {
      clearTimeout(typeaheadTimerRef.current);
    }
    typeaheadTimerRef.current = setTimeout(() => {
      typeaheadRef.current = "";
    }, 2000);

    const match = filteredCategories.find((category) =>
      category.name.toLowerCase().startsWith(nextQuery),
    );
    if (match) {
      onChange(match.id);
    }
    return true;
  };

  const {
    className: triggerClassNameProp,
    onKeyDown: triggerOnKeyDown,
    onFocus: triggerOnFocus,
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
        type="button"
        onMouseDown={() => {
          pointerFocusRef.current = true;
        }}
        onClick={() => {
          if (disabled) return;
          pointerFocusRef.current = false;
          setIsOpen((prev) => !prev);
        }}
        onFocus={(event) => {
          triggerOnFocus?.(event);
          if (openOnFocus && !disabled && !pointerFocusRef.current) {
            updateDropdownPosition();
            setIsOpen(true);
          }
        }}
        onKeyDown={(event) => {
          triggerOnKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === "Escape") {
            setIsOpen(false);
            return;
          }
          if (event.key === "Tab") {
            setIsOpen(false);
            return;
          }
          if (handleTypeahead(event.key)) {
            event.preventDefault();
          }
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

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className={`${
            dropdownPlacement === "inline"
              ? "absolute left-0 right-0 z-30"
              : "fixed z-20"
          } py-1 bg-white dark:bg-dark-2 border border-stroke dark:border-dark-3 rounded-lg shadow-dropdown max-h-60 overflow-auto`}
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
          {/* Uncategorized Option */}
          <button
            type="button"
            onClick={() => handleSelect("")}
            className="w-full flex items-center px-4 py-2.5 text-sm text-left hover:bg-gray-2 dark:hover:bg-dark-3 transition-colors"
          >
            <div className="w-2.5 h-2.5 rounded-full mr-2 flex-shrink-0 bg-dark-5 dark:bg-dark-6" />
            <span className="flex-1 text-dark dark:text-white">{emptyLabel}</span>
            {!value && <Check className="h-4 w-4 text-primary ml-2" />}
          </button>

          {/* Divider */}
          <div className="h-px bg-stroke dark:bg-dark-3 my-1" />

          {/* Category Options */}
          {filteredCategories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => handleSelect(cat.id)}
              className="w-full flex items-center px-4 py-2.5 text-sm text-left hover:bg-gray-2 dark:hover:bg-dark-3 transition-colors"
            >
              <div
                className="w-2.5 h-2.5 rounded-full mr-2 flex-shrink-0"
                style={{ backgroundColor: cat.color }}
              />
              <span className="flex-1 text-dark dark:text-white">
                {cat.name}
              </span>
              {value === cat.id && (
                <Check className="h-4 w-4 text-primary ml-2" />
              )}
            </button>
          ))}

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
      )}
    </div>
  );
}
