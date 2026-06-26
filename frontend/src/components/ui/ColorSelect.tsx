"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

const PRESET_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
];

interface ColorSelectProps {
  value: string;
  onChange: (color: string) => void;
}

export function getColorSelectMenuPosition(rect: DOMRect) {
  return {
    left: rect.left,
    top: rect.bottom + 8,
  };
}

export function ColorSelect({ value, onChange }: ColorSelectProps) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const updateMenuPosition = () => {
    if (!containerRef.current) return;
    setMenuPosition(
      getColorSelectMenuPosition(containerRef.current.getBoundingClientRect()),
    );
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();

    window.addEventListener("scroll", updateMenuPosition, true);
    window.addEventListener("resize", updateMenuPosition);

    return () => {
      window.removeEventListener("scroll", updateMenuPosition, true);
      window.removeEventListener("resize", updateMenuPosition);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-11 items-center gap-2 rounded-lg border border-stroke dark:border-dark-3 bg-white dark:bg-dark-2 px-3 text-xs text-dark dark:text-white hover:border-primary dark:hover:border-primary transition-colors"
      >
        <span
          className="h-5 w-5 rounded-full border border-white/70"
          style={{ backgroundColor: value }}
        />
        <ChevronDown className="h-4 w-4 text-dark-5 dark:text-dark-6" />
      </button>

      {open && (
        <div
          className="fixed z-[60] w-44 rounded-lg border border-stroke dark:border-dark-3 bg-white dark:bg-dark-2 p-2 shadow-dropdown"
          style={{ left: menuPosition.left, top: menuPosition.top }}
        >
          <div className="grid grid-cols-4 gap-2">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => {
                  onChange(color);
                  setOpen(false);
                }}
                className={`h-8 w-8 rounded-md border-2 transition-all ${
                  value === color
                    ? "border-dark dark:border-white scale-105"
                    : "border-transparent hover:border-stroke dark:hover:border-dark-3"
                }`}
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
