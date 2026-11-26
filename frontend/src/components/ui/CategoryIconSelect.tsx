"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { CATEGORY_ICONS, categoryIconKey } from "@/lib/categoryIcons";
import { CATEGORY_LUCIDE_ICONS, CategoryIcon } from "@/components/ui/CategoryIcon";

const MENU_HEIGHT = 296;

/** Picks a category icon from CATEGORY_ICONS, drawn in the category's colour. */
export function CategoryIconSelect({
  value,
  name,
  color,
  onChange,
}: {
  value: string | null | undefined;
  /** The category name, so an unset icon shows the one its name implies. */
  name?: string;
  color: string;
  onChange: (icon: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = categoryIconKey({ icon: value, name });

  const updateMenuPosition = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const below = rect.bottom + 8 + MENU_HEIGHT <= window.innerHeight;
    setMenuPosition({
      left: rect.left,
      top: below ? rect.bottom + 8 : Math.max(8, rect.top - 8 - MENU_HEIGHT),
    });
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
        className="flex h-11 items-center gap-2 rounded-lg border border-stroke dark:border-dark-3 bg-white dark:bg-dark-2 px-2 text-xs text-dark dark:text-white hover:border-primary dark:hover:border-primary transition-colors"
        title="Icon"
        aria-label="Icon"
      >
        <CategoryIcon category={{ icon: selected, color, name }} size={28} />
        <ChevronDown className="h-4 w-4 text-dark-5 dark:text-dark-6" />
      </button>

      {open && (
        <div
          className="fixed z-[60] w-[17rem] overflow-y-auto rounded-lg border border-stroke dark:border-dark-3 bg-white dark:bg-dark-2 p-2 shadow-dropdown"
          style={{ left: menuPosition.left, top: menuPosition.top, maxHeight: MENU_HEIGHT }}
        >
          <div className="grid grid-cols-6 gap-1">
            {CATEGORY_ICONS.map((option) => {
              const Icon = CATEGORY_LUCIDE_ICONS[option.key];
              const active = option.key === selected;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => {
                    onChange(option.key);
                    setOpen(false);
                  }}
                  className={`flex h-10 w-10 items-center justify-center rounded-md border-2 transition-colors ${
                    active
                      ? "border-dark dark:border-white"
                      : "border-transparent hover:border-stroke dark:hover:border-dark-3"
                  }`}
                  style={{ color }}
                  title={option.label}
                  aria-label={option.label}
                >
                  <Icon className="h-5 w-5" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
