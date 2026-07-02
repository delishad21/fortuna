"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

type SelectSize = "sm" | "md" | "lg";

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  size?: SelectSize;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  menuPlacement?: "down" | "up" | "auto";
  menuStrategy?: "absolute" | "fixed";
  menuClassName?: string;
}

const sizeStyles: Record<SelectSize, string> = {
  sm: "h-9 px-3 text-xs",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-4 text-base",
};

export function Select({
  value,
  options,
  onChange,
  placeholder = "Select an option",
  label,
  size = "md",
  disabled = false,
  className = "",
  buttonClassName = "",
  menuPlacement = "down",
  menuStrategy = "absolute",
  menuClassName = "",
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({
    top: 0,
    bottom: "auto" as number | "auto",
    left: 0,
    width: 220,
  });
  const [showAbove, setShowAbove] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  const updateMenuPosition = useCallback(() => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const dropdownHeight = 240;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const shouldShowAbove =
      menuPlacement === "up" ||
      (menuPlacement === "auto" &&
        spaceBelow < dropdownHeight &&
        spaceAbove > spaceBelow);
    setShowAbove(shouldShowAbove);

    if (menuStrategy !== "fixed") return;

    setMenuPosition({
      top: shouldShowAbove ? 0 : rect.bottom + 4,
      bottom: shouldShowAbove ? window.innerHeight - rect.top + 4 : "auto",
      left: rect.left,
      width: Math.max(rect.width, 220),
    });
  }, [menuPlacement, menuStrategy]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    updateMenuPosition();
    window.addEventListener("scroll", updateMenuPosition, true);
    window.addEventListener("resize", updateMenuPosition);
    return () => {
      window.removeEventListener("scroll", updateMenuPosition, true);
      window.removeEventListener("resize", updateMenuPosition);
    };
  }, [isOpen, updateMenuPosition]);

  const handleSelect = (optionValue: string) => {
    if (disabled) return;
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <div className={`${label ? "flex items-center gap-2" : ""} ${className}`}>
      {label && (
        <label className="text-sm font-medium text-dark dark:text-white whitespace-nowrap">
          {label}
        </label>
      )}
      <div ref={containerRef} className={`relative ${!label ? "w-full" : ""}`}>
        {/* Trigger Button */}
        <button
          type="button"
          onClick={() => {
            if (disabled) return;
            setIsOpen(!isOpen);
          }}
          disabled={disabled}
          className={`
            flex items-center gap-2 text-left
            bg-white dark:bg-dark-2 border border-stroke dark:border-dark-3 rounded-lg
            text-dark dark:text-white outline-none
            ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}
            ${disabled ? "" : "hover:border-primary dark:hover:border-primary focus:ring-2 focus:ring-primary"}
            transition-colors
            ${sizeStyles[size]}
            ${buttonClassName || "min-w-[180px]"}
          `}
        >
          <span
            className={`flex-1 truncate ${
              selectedOption
                ? "text-dark dark:text-white"
                : "text-dark-5 dark:text-dark-6"
            }`}
          >
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-dark-5 dark:text-dark-6 flex-shrink-0 transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </button>

        {isOpen && !disabled && menuStrategy === "absolute" && (
          <div
            ref={menuRef}
            className={`absolute left-0 right-0 z-[70] py-1 bg-white dark:bg-dark-2 border border-stroke dark:border-dark-3 rounded-lg shadow-dropdown max-h-60 overflow-auto min-w-[220px] ${
              showAbove ? "bottom-full mb-1" : "top-full mt-1"
            } ${menuClassName}`}
          >
            <SelectMenuOptions
              options={options}
              value={value}
              onSelect={handleSelect}
            />
          </div>
        )}
      </div>

      {isOpen &&
        !disabled &&
        menuStrategy === "fixed" &&
        createPortal(
          <div
            ref={menuRef}
            className={`fixed z-[90] py-1 bg-white dark:bg-dark-2 border border-stroke dark:border-dark-3 rounded-lg shadow-dropdown max-h-60 overflow-auto min-w-[220px] ${menuClassName}`}
            style={{
              top:
                menuPosition.bottom === "auto"
                  ? menuPosition.top
                  : "auto",
              bottom: menuPosition.bottom,
              left: menuPosition.left,
              width: menuPosition.width,
            }}
          >
            <SelectMenuOptions
              options={options}
              value={value}
              onSelect={handleSelect}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

function SelectMenuOptions({
  options,
  value,
  onSelect,
}: {
  options: SelectOption[];
  value: string;
  onSelect: (value: string) => void;
}) {
  return (
    <>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onSelect(option.value)}
          className="w-full flex items-start px-3 py-2.5 text-sm text-left hover:bg-gray-2 dark:hover:bg-dark-3 transition-colors"
        >
          <div className="flex-1 min-w-0">
            <div className="font-medium text-dark dark:text-white">
              {option.label}
            </div>
            {option.description && (
              <div className="text-xs text-dark-5 dark:text-dark-6 mt-0.5 truncate">
                {option.description}
              </div>
            )}
          </div>
          {value === option.value && (
            <Check className="h-4 w-4 text-primary ml-2 flex-shrink-0 mt-0.5" />
          )}
        </button>
      ))}
    </>
  );
}
