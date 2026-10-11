"use client";

import type { ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card } from "@/components/ui/Card";
import type { TransactionCardTransaction } from "@/components/transactions/TransactionCard";
import { accountDisplayMap } from "@/lib/accounts";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";

export const formatCurrency = (value: number, options: { signed?: boolean } = {}) => {
  const formatted = new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    maximumFractionDigits: 2,
  }).format(Math.abs(value || 0));
  if (!options.signed) return value < 0 ? `-${formatted}` : formatted;
  return `${value < 0 ? "-" : "+"}${formatted}`;
};

export const formatMonth = (month: string | null, pattern = "MMM yyyy") =>
  month ? format(parseISO(`${month}-01`), pattern) : "No month";

/** Calendar date of an ISO timestamp, ignoring the viewer's timezone. */
export const isoDay = (value: string | Date) =>
  (typeof value === "string" ? value : value.toISOString()).slice(0, 10);

export const formatDay = (value: string | Date, pattern = "d MMM") =>
  format(parseISO(isoDay(value)), pattern);

export function SectionCard({
  title,
  action,
  children,
  className,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="mb-4 flex min-h-8 items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-dark dark:text-white">{title}</h3>
        {action}
      </div>
      <div className="flex-1">{children}</div>
    </Card>
  );
}

export function EmptyText({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-dark-5 dark:text-dark-6">{children}</p>;
}

export function StatCard({
  label,
  value,
  tone = "default",
  sub,
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "bad" | "primary";
  sub?: ReactNode;
}) {
  const toneClass = {
    default: "text-dark dark:text-white",
    good: "text-green",
    bad: "text-red",
    primary: "text-primary",
  }[tone];
  return (
    <Card className="p-5">
      <p className="text-sm font-medium text-dark-5 dark:text-dark-6">{label}</p>
      <p className={cn("mt-2 text-2xl font-bold tabular-nums", toneClass)}>{value}</p>
      {sub ? <div className="mt-1.5 text-xs text-dark-5 dark:text-dark-6">{sub}</div> : null}
    </Card>
  );
}

/**
 * Change in spending: more spending is red, less is green. Pass `invert` for
 * income-like values where an increase is good.
 */
export function Delta({
  value,
  previous,
  suffix,
  invert = false,
}: {
  value: number;
  previous?: number | null;
  suffix?: string;
  invert?: boolean;
}) {
  if (Math.abs(value) < 0.005) {
    return <span className="text-dark-5 dark:text-dark-6">No change{suffix ? ` ${suffix}` : ""}</span>;
  }
  const up = value > 0;
  const good = invert ? up : !up;
  const percent = previous ? Math.round((value / previous) * 100) : null;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span>
      <span className={cn("inline-flex items-center gap-0.5 whitespace-nowrap font-medium", good ? "text-green" : "text-red")}>
        <Icon className="size-3.5" />
        {formatCurrency(Math.abs(value))}
        {percent !== null && Number.isFinite(percent) ? ` (${up ? "+" : ""}${percent}%)` : ""}
      </span>
      {suffix ? <span className="text-dark-5 dark:text-dark-6"> {suffix}</span> : null}
    </span>
  );
}

export function MonthSwitcher({
  months,
  value,
  onChange,
  loading,
}: {
  /** Month keys, newest first. */
  months: string[];
  value: string | null;
  onChange: (month: string) => void;
  loading?: boolean;
}) {
  const index = value ? months.indexOf(value) : -1;
  const older = index >= 0 ? months[index + 1] : undefined;
  const newer = index > 0 ? months[index - 1] : undefined;
  const buttonClass =
    "flex size-11 shrink-0 items-center justify-center rounded-lg border border-stroke bg-white text-dark transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-stroke dark:border-dark-3 dark:bg-dark-2 dark:text-white dark:hover:border-primary";
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={buttonClass} disabled={!older || loading} onClick={() => older && onChange(older)} aria-label="Previous month">
        <ChevronLeft className="size-4" />
      </button>
      <div className="w-44">
        <Select
          value={value || ""}
          options={months.map((month) => ({ value: month, label: formatMonth(month, "MMMM yyyy") }))}
          onChange={onChange}
          disabled={loading || months.length === 0}
          placeholder="Month"
          buttonClassName="w-full min-w-0"
        />
      </div>
      <button type="button" className={buttonClass} disabled={!newer || loading} onClick={() => newer && onChange(newer)} aria-label="Next month">
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

export type BarRow = {
  key: string;
  name: string;
  color?: string;
  value: number;
  helper?: ReactNode;
  trailing?: ReactNode;
};

/** Ranked horizontal bars: name, share of the largest row, amount. */
export function BarList({
  rows,
  valueTone = "default",
  onSelect,
  selectedKey,
  limit,
}: {
  rows: BarRow[];
  valueTone?: "default" | "good" | "bad";
  onSelect?: (key: string) => void;
  selectedKey?: string | null;
  limit?: number;
}) {
  const shown = limit ? rows.slice(0, limit) : rows;
  const max = Math.max(...shown.map((row) => Math.abs(row.value)), 0);
  const total = rows.reduce((sum, row) => sum + Math.abs(row.value), 0);
  const toneClass = valueTone === "good" ? "text-green" : valueTone === "bad" ? "text-red" : "text-dark dark:text-white";
  return (
    <div className="space-y-1">
      {shown.map((row) => {
        const width = max ? Math.max((Math.abs(row.value) / max) * 100, 2) : 0;
        const share = total ? Math.round((Math.abs(row.value) / total) * 100) : 0;
        const content = (
          <>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color || "#9ca3af" }} />
                <span className="truncate font-medium text-dark dark:text-white">{row.name}</span>
                <span className="shrink-0 text-xs text-dark-5 dark:text-dark-6">{share}%</span>
              </span>
              <span className={cn("shrink-0 font-semibold tabular-nums", toneClass)}>{formatCurrency(row.value)}</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-gray-2 dark:bg-dark-3">
              <div className="h-1.5 rounded-full" style={{ width: `${width}%`, backgroundColor: row.color || "#9ca3af" }} />
            </div>
            {row.helper || row.trailing ? (
              <div className="mt-1 flex items-center justify-between gap-3 text-xs text-dark-5 dark:text-dark-6">
                <span>{row.helper}</span>
                <span>{row.trailing}</span>
              </div>
            ) : null}
          </>
        );
        return onSelect ? (
          <button
            key={row.key}
            type="button"
            onClick={() => onSelect(row.key)}
            className={cn(
              "block w-full rounded-lg px-2 py-2 text-left transition hover:bg-gray-2 dark:hover:bg-dark-3",
              selectedKey === row.key && "bg-primary/5 ring-1 ring-primary/30",
            )}
          >
            {content}
          </button>
        ) : (
          <div key={row.key} className="px-2 py-2">
            {content}
          </div>
        );
      })}
    </div>
  );
}

export type CompactTransaction = {
  id: string;
  date: string;
  description: string;
  label?: string | null;
  amountIn: number;
  amountOut: number;
  category?: { id: string; name: string; color: string } | null;
};

export function TransactionRows({
  transactions,
  renderAside,
}: {
  transactions: CompactTransaction[];
  renderAside?: (tx: CompactTransaction) => ReactNode;
}) {
  return (
    <div className="divide-y divide-stroke dark:divide-stroke-dark">
      {transactions.map((tx) => {
        const income = tx.amountIn > 0;
        return (
          <div key={tx.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-dark dark:text-white">{tx.label || tx.description}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-dark-5 dark:text-dark-6">
                <span>{formatDay(tx.date)}</span>
                <span aria-hidden="true">·</span>
                <span className="size-2 rounded-full" style={{ backgroundColor: tx.category?.color || "#9ca3af" }} />
                <span className="truncate">{tx.category?.name || "Uncategorized"}</span>
              </p>
            </div>
            {renderAside ? (
              renderAside(tx)
            ) : (
              <span className={cn("shrink-0 text-sm font-semibold tabular-nums", income ? "text-green" : "text-red")}>
                {income ? `+${formatCurrency(tx.amountIn)}` : `-${formatCurrency(tx.amountOut)}`}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="no-scrollbar inline-flex h-11 max-w-full items-stretch overflow-x-auto rounded-lg border border-stroke bg-white p-1 dark:border-dark-3 dark:bg-dark-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex items-center whitespace-nowrap rounded-md px-3 text-sm font-medium transition",
            value === option.value
              ? "bg-primary text-white"
              : "text-dark-5 hover:text-dark dark:text-dark-6 dark:hover:text-white",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Recharts tooltip in the app's card style; follows light and dark mode. */
export function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; payload?: { fill?: string } }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-40 rounded-lg border border-stroke bg-white px-3 py-2 text-sm shadow-dropdown dark:border-dark-3 dark:bg-dark-2">
      {label !== undefined ? <p className="mb-1 font-semibold text-dark dark:text-white">{label}</p> : null}
      {payload.map((item) => (
        <p key={item.name} className="flex items-center justify-between gap-4 text-dark-5 dark:text-dark-6">
          <span className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: item.color || item.payload?.fill }} />
            {item.name}
          </span>
          <span className="font-semibold tabular-nums text-dark dark:text-white">{formatCurrency(Number(item.value || 0))}</span>
        </p>
      ))}
    </div>
  );
}

/** Wider bars when there are only a few of them. */
export const barSizeFor = (count: number) =>
  count <= 2 ? 120 : count <= 4 ? 88 : count <= 8 ? 56 : count <= 16 ? 36 : 24;

/** A transaction from the analytics API with what the transaction cards need. */
export type CardSource = CompactTransaction & {
  accountIdentifier?: string | null;
  linkage?: TransactionCardTransaction["linkage"];
  originalAmountIn?: number | null;
  originalAmountOut?: number | null;
};

export type AccountInfo = { accountIdentifier: string; label?: string | null; color: string };

/** Card data with the stored amounts, as on the Transactions page. */
export const toCardTransaction = (tx: CardSource): TransactionCardTransaction => ({
  id: tx.id,
  date: isoDay(tx.date),
  description: tx.description,
  label: tx.label || undefined,
  amountIn: tx.originalAmountIn !== undefined ? tx.originalAmountIn : tx.amountIn || null,
  amountOut: tx.originalAmountOut !== undefined ? tx.originalAmountOut : tx.amountOut || null,
  balance: null,
  accountIdentifier: tx.accountIdentifier ?? null,
  category: tx.category || undefined,
  linkage: tx.linkage ?? null,
});

export const accountMaps = (accounts: AccountInfo[]) => ({
  colors: Object.fromEntries(accounts.map((account) => [account.accountIdentifier, account.color])) as Record<string, string>,
  names: accountDisplayMap(accounts) as Record<string, string>,
});

/** Donut of spending per category with the total in the middle. */
export function SpendingPie({
  rows,
  total,
}: {
  rows: Array<{ key: string; name: string; color?: string; value: number }>;
  total: number;
}) {
  const data = rows
    .filter((row) => row.value > 0)
    .map((row) => ({ name: row.name, value: row.value, fill: row.color || "#9ca3af" }));
  return (
    <div className="relative h-60 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="95%" paddingAngle={1} stroke="none" isAnimationActive={false}>
            {data.map((row) => (
              <Cell key={row.name} fill={row.fill} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs text-dark-5 dark:text-dark-6">Total</span>
        <span className="text-lg font-bold tabular-nums text-dark dark:text-white">{formatCurrency(total)}</span>
      </div>
    </div>
  );
}
