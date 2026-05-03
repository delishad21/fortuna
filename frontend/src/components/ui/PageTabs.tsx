"use client";

import { cn } from "@/lib/utils";

export interface PageTab<T extends string> {
  key: T;
  label: string;
}

interface PageTabsProps<T extends string> {
  tabs: PageTab<T>[];
  activeTab: T;
  onChange: (tab: T) => void;
  className?: string;
}

export function PageTabs<T extends string>({
  tabs,
  activeTab,
  onChange,
  className,
}: PageTabsProps<T>) {
  return (
    <div
      className={cn(
        "-mx-4 -mt-4 border-b border-stroke bg-white px-4 dark:border-stroke-dark dark:bg-gray-dark md:-mx-5 md:-mt-5 md:px-5 2xl:-mx-6 2xl:-mt-6 2xl:px-6",
        className,
      )}
    >
      <div className="flex min-h-12 items-end gap-6 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onChange(tab.key)}
              className={cn(
                "relative whitespace-nowrap px-1 py-3 text-sm font-semibold transition-colors",
                isActive
                  ? "text-primary"
                  : "text-dark-5 hover:text-dark dark:text-dark-6 dark:hover:text-white",
              )}
            >
              {tab.label}
              {isActive && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
