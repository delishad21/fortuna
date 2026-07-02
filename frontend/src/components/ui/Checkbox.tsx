"use client";

import { Check, Minus } from "lucide-react";

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean, event?: React.MouseEvent<HTMLButtonElement>) => void;
  indeterminate?: boolean;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({
  checked,
  onChange,
  indeterminate = false,
  disabled = false,
  className = "",
}: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!disabled) {
          onChange(!checked, event);
        }
      }}
      className={`w-4 h-4 rounded-sm border-2 flex items-center justify-center transition-all ${
        checked || indeterminate
          ? "bg-primary border-primary"
          : "bg-white dark:bg-dark-2 border-stroke dark:border-dark-3 hover:border-primary"
      } ${
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "cursor-pointer hover:border-primary"
      } ${className}`}
    >
      {indeterminate ? (
        <Minus className="h-3 w-3 text-white" strokeWidth={3} />
      ) : checked ? (
        <Check className="h-3 w-3 text-white" strokeWidth={3} />
      ) : null}
    </button>
  );
}
