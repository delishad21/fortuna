"use client";

import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  ArrowLeft,
  CalendarDays,
  FileText,
  Receipt,
  WalletCards,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ExpandableTransactionList } from "@/components/transactions/ExpandableTransactionList";
import type { TransactionCardTransaction } from "@/components/transactions/TransactionCard";

type BreakdownItem = {
  key: string;
  name: string;
  color?: string;
  totalIn: number;
  totalOut: number;
  net?: number;
  transactionCount: number;
};

type ImportTransaction = {
  id: string;
  date: string;
  description: string;
  label?: string | null;
  amountIn: number;
  amountOut: number;
  category?: { id: string; name: string; color: string } | null;
  merchant?: string;
};

type ImportDetail = {
  key: string;
  filename: string;
  batchFilename: string;
  parserId: string | null;
  importedAt: string | null;
  startDate: string | null;
  endDate: string | null;
  totalIn: number;
  totalOut: number;
  net: number;
  transactionCount: number;
  categoryBreakdown: BreakdownItem[];
  accountBreakdown: BreakdownItem[];
  dailySeries: Array<{
    date: string;
    totalIn: number;
    totalOut: number;
    net: number;
    transactionCount: number;
  }>;
  transactions: ImportTransaction[];
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    maximumFractionDigits: 2,
  }).format(value || 0);

const formatDate = (date: string | null | undefined) =>
  date ? format(parseISO(date), "dd MMM yyyy") : "Unknown";

const formatDateRange = (startDate: string | null, endDate: string | null) => {
  if (!startDate && !endDate) return "No transaction dates";
  if (startDate === endDate) return formatDate(startDate);
  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
};

function MetricCard({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "default" | "good" | "bad";
}) {
  const toneClass =
    tone === "good" ? "text-green" : tone === "bad" ? "text-red" : "text-dark dark:text-white";
  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-5">
        <div className="flex size-11 items-center justify-center rounded-lg bg-gray-2 text-dark-5 dark:bg-dark-2 dark:text-dark-6">
          {icon}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-dark-5 dark:text-dark-6">{label}</p>
          <p className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function BreakdownList({ items, metric }: { items: BreakdownItem[]; metric: "totalOut" | "transactionCount" }) {
  const maxValue = Math.max(...items.map((item) => Number(item[metric]) || 0), 1);
  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="text-sm text-dark-5 dark:text-dark-6">No breakdown available.</p>
      ) : (
        items.slice(0, 8).map((item) => {
          const value = Number(item[metric]) || 0;
          return (
            <div key={item.key}>
              <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color || "#5750F1" }} />
                  <span className="truncate font-medium text-dark dark:text-white">{item.name}</span>
                </div>
                <span className="shrink-0 text-dark-5 dark:text-dark-6">
                  {metric === "totalOut" ? formatCurrency(item.totalOut) : item.transactionCount}
                </span>
              </div>
              <div className="h-2 rounded-full bg-gray-2 dark:bg-dark-2">
                <div
                  className="h-2 rounded-full"
                  style={{
                    width: `${Math.max((value / maxValue) * 100, value > 0 ? 4 : 0)}%`,
                    backgroundColor: item.color || "#5750F1",
                  }}
                />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

const toCardTransactions = (transactions: ImportTransaction[]): TransactionCardTransaction[] =>
  transactions.map((tx) => ({
    id: tx.id,
    date: String(tx.date),
    description: tx.description,
    label: tx.label || undefined,
    amountIn: tx.amountIn > 0 ? tx.amountIn : null,
    amountOut: tx.amountOut > 0 ? tx.amountOut : null,
    balance: null,
    category: tx.category || undefined,
  }));

export function ImportDetailClient({ importDetail }: { importDetail: ImportDetail }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <Link href="/imports">
          <Button variant="ghost" size="sm" leftIcon={<ArrowLeft className="size-4" />}>Imports</Button>
        </Link>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="break-words font-display text-3xl font-bold text-dark dark:text-white">{importDetail.filename}</h1>
            <p className="mt-2 text-sm text-dark-5 dark:text-dark-6">
              Imported {formatDate(importDetail.importedAt)} · {formatDateRange(importDetail.startDate, importDetail.endDate)} · {importDetail.parserId || "Unknown parser"}
            </p>
          </div>
          <Link href={`/transactions?search=${encodeURIComponent(importDetail.filename)}`}>
            <Button variant="secondary" leftIcon={<Receipt className="size-4" />}>Transactions</Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<WalletCards className="size-5" />} label="Spending" value={formatCurrency(importDetail.totalOut)} tone="bad" />
        <MetricCard icon={<WalletCards className="size-5" />} label="Income" value={formatCurrency(importDetail.totalIn)} tone="good" />
        <MetricCard icon={<CalendarDays className="size-5" />} label="Net" value={formatCurrency(importDetail.net)} />
        <MetricCard icon={<FileText className="size-5" />} label="Transactions" value={String(importDetail.transactionCount)} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Daily Cashflow</CardTitle></CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={importDetail.dailySeries} barGap={6} barCategoryGap="28%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: "var(--chart-muted)" }}
                  tickFormatter={(value) => format(parseISO(String(value)), "dd MMM")}
                />
                <YAxis tick={{ fontSize: 12, fill: "var(--chart-muted)" }} />
                <Tooltip
                  labelFormatter={(value) => format(parseISO(String(value)), "dd MMM yyyy")}
                  formatter={(value: number) => formatCurrency(Number(value))}
                />
                <Bar dataKey="totalOut" name="Spending" fill="#F23030" barSize={28} radius={[6, 6, 0, 0]} />
                <Bar dataKey="totalIn" name="Income" fill="#22AD5C" barSize={28} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Categories</CardTitle></CardHeader>
          <CardContent>
            <BreakdownList items={importDetail.categoryBreakdown} metric="totalOut" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Accounts</CardTitle></CardHeader>
        <CardContent>
          <BreakdownList items={importDetail.accountBreakdown} metric="transactionCount" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Transactions</CardTitle></CardHeader>
        <CardContent>
          <ExpandableTransactionList transactions={toCardTransactions(importDetail.transactions)} />
        </CardContent>
      </Card>
    </div>
  );
}
