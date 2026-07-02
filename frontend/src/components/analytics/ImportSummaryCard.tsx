"use client";

import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ChevronRight } from "lucide-react";

export type ImportSummaryCardItem = {
  key: string;
  filename: string;
  parserId: string | null;
  importedAt: string | null;
  startDate?: string | null;
  endDate?: string | null;
  totalIn: number;
  totalOut: number;
  transactionCount: number;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    maximumFractionDigits: 2,
  }).format(value || 0);

const formatDate = (date: string | null | undefined) =>
  date ? format(parseISO(date), "dd MMM yyyy") : "Unknown";

const formatDateRange = (startDate?: string | null, endDate?: string | null) => {
  if (!startDate && !endDate) return null;
  if (startDate === endDate) return formatDate(startDate);
  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
};

export function ImportSummaryCard({ item }: { item: ImportSummaryCardItem }) {
  const dateRange = formatDateRange(item.startDate, item.endDate);

  return (
    <Link
      href={`/imports/${encodeURIComponent(item.key)}`}
      className="block overflow-hidden rounded-lg border border-transparent bg-white transition-colors hover:bg-gray-1 dark:bg-dark-2 dark:hover:bg-dark-3/50"
    >
      <div className="relative flex flex-col gap-4 p-4 pl-6 sm:flex-row sm:items-center">
        <span className="absolute left-0 top-0 h-full w-1 bg-primary" />

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-dark dark:text-white">
            {item.filename}
          </p>
          <p className="mt-0.5 truncate text-xs text-dark-5 dark:text-dark-6">
            {item.transactionCount} transactions · Imported {formatDate(item.importedAt)}
            {dateRange ? ` · ${dateRange}` : ""} · {item.parserId || "Unknown parser"}
          </p>
        </div>

        <div className="flex items-center justify-end gap-4 sm:gap-6">
          <div className="grid min-w-[150px] grid-cols-2 gap-4 text-right sm:min-w-[220px] sm:gap-6">
            <div>
              <p className="text-[11px] font-medium uppercase text-dark-5 dark:text-dark-6">
                Income
              </p>
              <p className="mt-1 font-semibold text-green dark:text-green-light">
                +{formatCurrency(item.totalIn)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase text-dark-5 dark:text-dark-6">
                Spending
              </p>
              <p className="mt-1 font-semibold text-red dark:text-red-light">
                -{formatCurrency(item.totalOut)}
              </p>
            </div>
          </div>

          <ChevronRight className="size-5 shrink-0 text-dark-5 dark:text-dark-6" />
        </div>
      </div>
    </Link>
  );
}
