"use client";

import Link from "next/link";
import { CheckCircle2, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TransactionCard } from "@/components/transactions/TransactionCard";
import {
  Delta,
  EmptyText,
  SectionCard,
  StatCard,
  formatCurrency,
  formatDay,
  formatMonth,
  toCardTransaction,
  type CardSource,
} from "@/components/analytics/parts";
import type { WorkflowMode } from "@/lib/workflow";
import { cn } from "@/lib/utils";

export type DailyOverviewData = {
  workflow: { mode: WorkflowMode; chosen: boolean };
  today: string;
  monthToDate: {
    month: string;
    today: string;
    dayOfMonth: number;
    daysInMonth: number;
    spent: number;
    income: number;
    transactionCount: number;
    todaySpent: number;
    weekStart: string;
    weekSpent: number;
    previous: { month: string; sameDay: string; spentSameDay: number; spentTotal: number; hasData: boolean };
    change: number;
    projected: number | null;
    categories: Array<{
      key: string;
      name: string;
      color: string;
      icon: string | null;
      spent: number;
      transactionCount: number;
      previousSameDay: number;
      previousTotal: number;
    }>;
  };
  recent: CardSource[];
  attention: {
    toReview: number;
    autoCreatedAccounts: Array<{ id: string; name: string; transactionCount: number }>;
    uncategorizedCount: number;
    unreconciledPastMonths: { count: number; months: Array<{ month: string; count: number }> };
    stagedImports: number;
  };
  hasTransactions: boolean;
};

const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

/** The dashboard for daily tracking: today, this week and the month so far. */
export function DailyOverview({
  data,
  onOpenReviewTab,
}: {
  data: DailyOverviewData;
  onOpenReviewTab: () => void;
}) {
  const mtd = data.monthToDate;
  const previous = mtd.previous;
  const monthName = formatMonth(mtd.month, "MMMM");
  const previousName = formatMonth(previous.month, "MMM");

  if (!data.hasTransactions) {
    return (
      <Card className="flex flex-col items-center gap-3 py-12 text-center">
        <div>
          <h3 className="font-semibold text-dark dark:text-white">No entries yet</h3>
          <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
            Entries appear here as the assistant logs them, or add one in Transactions.
          </p>
        </div>
        <Link href="/transactions">
          <Button leftIcon={<Plus className="size-4" />}>Go to Transactions</Button>
        </Link>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Today" value={formatCurrency(mtd.todaySpent)} tone={mtd.todaySpent ? "bad" : "default"} sub={formatDay(mtd.today, "EEE d MMM")} />
        <StatCard label="This week" value={formatCurrency(mtd.weekSpent)} sub={`Since ${formatDay(mtd.weekStart, "EEE d MMM")}`} />
        <StatCard
          label={`${monthName} so far`}
          value={formatCurrency(mtd.spent)}
          tone="bad"
          sub={
            previous.hasData ? (
              <Delta value={mtd.change} previous={previous.spentSameDay} suffix={`vs 1–${formatDay(previous.sameDay)}`} />
            ) : (
              `Day ${mtd.dayOfMonth} of ${mtd.daysInMonth}`
            )
          }
        />
        <StatCard
          label="Projected month-end"
          value={mtd.projected === null ? "—" : formatCurrency(mtd.projected)}
          sub={
            mtd.projected !== null && previous.hasData ? (
              <Delta value={mtd.projected - previous.spentTotal} previous={previous.spentTotal} suffix={`vs all of ${previousName}`} />
            ) : (
              "At the pace so far"
            )
          }
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <SectionCard
          title="Latest entries"
          action={
            <Link href="/transactions" className="text-sm font-medium">
              <span className="text-primary">All transactions</span>
            </Link>
          }
        >
          {data.recent.length === 0 ? (
            <EmptyText>No entries yet.</EmptyText>
          ) : (
            <div className="space-y-3">
              {data.recent.map((tx) => (
                <TransactionCard key={tx.id} transaction={toCardTransaction(tx)} showDate showAvatar />
              ))}
            </div>
          )}
        </SectionCard>

        <div className="flex flex-col gap-6">
          <NeedsAttention attention={data.attention} onOpenReviewTab={onOpenReviewTab} />
          <SectionCard title={`Categories in ${monthName}`}>
            {mtd.categories.length === 0 ? (
              <EmptyText>No spending this month yet.</EmptyText>
            ) : (
              <div className="space-y-3">
                {mtd.categories.slice(0, 10).map((item) => (
                  <CategoryProgress key={item.key} item={item} showPrevious={previous.hasData} previousName={previousName} />
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

function CategoryProgress({
  item,
  showPrevious,
  previousName,
}: {
  item: DailyOverviewData["monthToDate"]["categories"][number];
  showPrevious: boolean;
  previousName: string;
}) {
  // The bar is last month's total; the marker is where last month was by today.
  const scale = Math.max(item.previousTotal, item.spent, 0.01);
  const width = Math.min((item.spent / scale) * 100, 100);
  const marker = showPrevious && item.previousTotal > 0 ? Math.min((item.previousSameDay / scale) * 100, 100) : null;
  const over = item.previousSameDay > 0 && item.spent > item.previousSameDay;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
          <span className="truncate font-medium text-dark dark:text-white">{item.name}</span>
        </span>
        <span className="shrink-0 font-semibold tabular-nums text-dark dark:text-white">{formatCurrency(item.spent)}</span>
      </div>
      <div className="relative mt-1.5 h-1.5 rounded-full bg-gray-2 dark:bg-dark-3">
        <div className="h-1.5 rounded-full" style={{ width: `${Math.max(width, 2)}%`, backgroundColor: item.color }} />
        {marker !== null ? (
          <span
            className="absolute -top-1 h-3.5 w-0.5 rounded bg-dark dark:bg-white"
            style={{ left: `calc(${marker}% - 1px)` }}
            title={`${previousName} by this day: ${formatCurrency(item.previousSameDay)}`}
          />
        ) : null}
      </div>
      <p className={cn("mt-1 text-xs", over ? "text-red" : "text-dark-5 dark:text-dark-6")}>
        {showPrevious
          ? `${formatCurrency(item.spent)} so far · ${formatCurrency(item.previousSameDay)} by this day in ${previousName}${
              item.previousTotal ? ` · ${formatCurrency(item.previousTotal)} in all` : ""
            }`
          : plural(item.transactionCount, "transaction")}
      </p>
    </div>
  );
}

function NeedsAttention({
  attention,
  onOpenReviewTab,
}: {
  attention: DailyOverviewData["attention"];
  onOpenReviewTab: () => void;
}) {
  const accounts = attention.autoCreatedAccounts;
  const unreconciled = attention.unreconciledPastMonths;
  const rows = [
    attention.toReview > 0 && {
      key: "review",
      title: `${plural(attention.toReview, "entry", "entries")} to review`,
      helper: "Check the category and account Fortuna chose",
      href: "/review",
    },
    accounts.length > 0 && {
      key: "accounts",
      title: `${plural(accounts.length, "new account")} to confirm`,
      helper: accounts.map((account) => account.name).slice(0, 3).join(", "),
      href: "/review",
    },
    attention.uncategorizedCount > 0 && {
      key: "uncategorised",
      title: `${plural(attention.uncategorizedCount, "transaction")} without a category`,
      helper: "Pick categories in the Review tab",
      onClick: onOpenReviewTab,
    },
    unreconciled.count > 0 && {
      key: "unreconciled",
      title: `${plural(unreconciled.count, "entry", "entries")} from past months not on a statement`,
      helper: unreconciled.months
        .slice(0, 4)
        .map((item) => `${formatMonth(item.month, "MMM yyyy")} (${item.count})`)
        .join(", "),
      href: "/transactions",
    },
    attention.stagedImports > 0 && {
      key: "staged",
      title: `${plural(attention.stagedImports, "staged import")} to commit`,
      helper: "Waiting in Imports",
      href: "/imports",
    },
  ].filter(Boolean) as Array<{ key: string; title: string; helper: string; href?: string; onClick?: () => void }>;

  return (
    <SectionCard title="Needs attention">
      {rows.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg bg-green/5 p-4">
          <CheckCircle2 className="size-6 shrink-0 text-green" />
          <p className="text-sm text-dark dark:text-white">Nothing needs attention.</p>
        </div>
      ) : (
        <div className="divide-y divide-stroke dark:divide-stroke-dark">
          {rows.map((row) => {
            const content = (
              <>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-dark dark:text-white">{row.title}</p>
                  {row.helper ? <p className="mt-0.5 truncate text-xs text-dark-5 dark:text-dark-6">{row.helper}</p> : null}
                </div>
                <ChevronRight className="size-4 shrink-0 text-primary" />
              </>
            );
            return row.href ? (
              <Link key={row.key} href={row.href} className="flex items-center justify-between gap-3 py-2.5">
                {content}
              </Link>
            ) : (
              <button key={row.key} type="button" onClick={row.onClick} className="flex w-full items-center justify-between gap-3 py-2.5 text-left">
                {content}
              </button>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
