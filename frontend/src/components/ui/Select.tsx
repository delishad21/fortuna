"use client";

import { useState, useRef, useEffect } from "react";
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
  menuPlacement?: "down" | "up";
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
  menuClassName = "",
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

        {/* Dropdown Menu */}
        {isOpen && !disabled && (
          <div
            className={`absolute left-0 right-0 z-[70] py-1 bg-white dark:bg-dark-2 border border-stroke dark:border-dark-3 rounded-lg shadow-dropdown max-h-60 overflow-auto min-w-[220px] ${
              menuPlacement === "up" ? "bottom-full mb-1" : "top-full mt-1"
            } ${menuClassName}`}
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
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
          </div>
        )}
      </div>
    </div>
  );
}
