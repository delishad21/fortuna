"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, X } from "lucide-react";
import { getAnalyticsInsights, getAnalyticsReport } from "@/app/actions/analytics";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DatePicker } from "@/components/ui/DatePicker";
import { PageTabs } from "@/components/ui/PageTabs";
import { Select } from "@/components/ui/Select";
import { ExpandableTransactionList } from "@/components/transactions/ExpandableTransactionList";
import { TransactionCard, type TransactionCardTransaction } from "@/components/transactions/TransactionCard";
import {
  BarList,
  ChartTooltip,
  accountMaps,
  toCardTransaction,
  barSizeFor,
  Delta,
  EmptyText,
  MonthSwitcher,
  SectionCard,
  Segmented,
  StatCard,
  TransactionRows,
  formatCurrency,
  formatDay,
  formatMonth,
  isoDay,
  type CompactTransaction,
} from "@/components/analytics/parts";
import { cn } from "@/lib/utils";

type Transaction = CompactTransaction & {
  merchant: string;
  merchantKey: string;
  accountIdentifier?: string | null;
  linkage?: TransactionCardTransaction["linkage"];
  originalAmountIn?: number | null;
  originalAmountOut?: number | null;
};

type Account = { accountIdentifier: string; label?: string | null; color: string };

type Ordering = "newest" | "oldest" | "largest" | "smallest";

const orderingOptions: Array<{ value: Ordering; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "largest", label: "Largest amount" },
  { value: "smallest", label: "Smallest amount" },
];

type Totals = { totalIn: number; totalOut: number; net: number; transactionCount: number };

type BreakdownRow = {
  key: string;
  name: string;
  color?: string;
  totalIn: number;
  totalOut: number;
  metricValue: number;
  transactionCount: number;
  percentOfTotal: number;
};

type SeriesPoint = { key: string; label: string; totalIn: number; totalOut: number; net: number; transactionCount: number };

type ReportData = {
  selectedMonth: string;
  importedMonths: string[];
  controls: { range: string; metric: string; groupBy: string; categoryId?: string | null; merchantKey?: string | null };
  period: { start: string; end: string };
  summary: Totals;
  previousPeriod?: { start: string; end: string; summary: Totals };
  chartSeries: SeriesPoint[];
  timeSeries?: SeriesPoint[];
  breakdown: BreakdownRow[];
  categoryBreakdown?: BreakdownRow[];
  merchantBreakdown?: BreakdownRow[];
  transactions: Transaction[];
  categories: Array<{ id: string; name: string; color: string }>;
  merchants: Array<{ key: string; name: string }>;
};

type RecurringPayment = {
  key: string;
  name: string;
  monthsSeen: number;
  totalOut: number;
  averageAmount: number;
  frequency: string;
  stability: string;
  lastDate?: string | null;
};

type InsightsData = {
  selectedMonth: string | null;
  importedMonths: string[];
  monthlySummary: Totals & {
    previousMonth: string | null;
    previousTotalOut: number | null;
    spendingDelta: number | null;
    threeMonthAverage: number | null;
    threeMonthDelta: number | null;
  };
  recurringMerchants: RecurringPayment[];
  merchantInsights: {
    topMerchants: Array<{ key: string; name: string; totalOut: number; transactionCount: number }>;
    newMerchants: Array<{ key: string; name: string; totalOut: number; transactionCount: number }>;
  };
  categoryChanges: Array<{ key: string; name: string; color?: string; totalOut: number; previousTotalOut: number; delta: number; percentDelta: number | null }>;
  anomalies: Transaction[];
  hasTransactions: boolean;
};

type OverviewInsightsData = {
  importedMonths: string[];
  summary: Totals;
  monthlyTrend: Array<{ month: string } & Totals>;
  topCategories: Array<{ key: string; name: string; color?: string; totalIn: number; totalOut: number; transactionCount: number }>;
  topMerchants: Array<{ key: string; name: string; totalOut: number; transactionCount: number }>;
  recurringMerchants: RecurringPayment[];
  anomalies: Transaction[];
  hasTransactions: boolean;
};

type Metric = "spending" | "income" | "inOut" | "net";
type Interval = "month" | "day";
type Preset = "month" | "last3" | "last12" | "ytd" | "custom";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const metricOptions: Array<{ value: Metric; label: string }> = [
  { value: "spending", label: "Spending" },
  { value: "income", label: "Income" },
  { value: "inOut", label: "Both" },
  { value: "net", label: "Net" },
];

const presetOptions: Array<{ value: Preset; label: string }> = [
  { value: "month", label: "Month" },
  { value: "last3", label: "3 months" },
  { value: "last12", label: "12 months" },
  { value: "ytd", label: "Year to date" },
  { value: "custom", label: "Custom" },
];

export function AnalyticsClient({
  initialOverview,
  initialReport,
  initialInsights,
  accounts = [],
}: {
  initialOverview: OverviewInsightsData;
  initialReport: ReportData;
  initialInsights: InsightsData;
  accounts?: Account[];
}) {
  const [activeTab, setActiveTab] = useState<"reports" | "insights" | "overall">("reports");
  const [insights, setInsights] = useState(initialInsights);
  const [insightsLoading, setInsightsLoading] = useState(false);

  const loadInsights = async (month: string) => {
    setInsightsLoading(true);
    try {
      setInsights(await getAnalyticsInsights(month));
    } finally {
      setInsightsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageTabs
        tabs={[
          { key: "reports", label: "Reports" },
          { key: "insights", label: "Month insights" },
          { key: "overall", label: "All time" },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "reports" ? (
        <ReportsTab initialReport={initialReport} accounts={accounts} />
      ) : activeTab === "insights" ? (
        <InsightsTab insights={insights} loading={insightsLoading} loadInsights={loadInsights} />
      ) : (
        <OverallTab overview={initialOverview} />
      )}
    </div>
  );
}

function ReportsTab({ initialReport, accounts }: { initialReport: ReportData; accounts: Account[] }) {
  const [report, setReport] = useState(initialReport);
  const [loading, setLoading] = useState(false);
  const [custom, setCustom] = useState(false);
  const [breakdownBy, setBreakdownBy] = useState<"category" | "merchant">("category");
  const [shownTransactions, setShownTransactions] = useState(25);
  const [ordering, setOrdering] = useState<Ordering>("newest");

  const metric = (report.controls.metric as Metric) || "inOut";
  const interval: Interval = report.controls.groupBy === "day" ? "day" : "month";
  const preset: Preset = custom ? "custom" : ((report.controls.range as Preset) || "month");
  const dateFrom = isoDay(report.period.start);
  const dateTo = isoDay(report.period.end);

  type Next = Partial<{
    month: string;
    range: Preset;
    dateFrom: string;
    dateTo: string;
    metric: Metric;
    interval: Interval;
    categoryId: string;
    merchantKey: string;
  }>;

  const load = async (next: Next, useCustomDates = custom) => {
    setLoading(true);
    try {
      const nextInterval = next.interval ?? interval;
      setReport(
        await getAnalyticsReport({
          month: next.month || report.selectedMonth,
          range: next.range && next.range !== "custom" ? next.range : report.controls.range,
          // Presets let the server work out the dates from the month.
          dateFrom: useCustomDates ? next.dateFrom ?? dateFrom : undefined,
          dateTo: useCustomDates ? next.dateTo ?? dateTo : undefined,
          metric: next.metric ?? metric,
          groupBy: nextInterval,
          interval: nextInterval,
          categoryId: next.categoryId === undefined ? report.controls.categoryId || undefined : next.categoryId || undefined,
          merchantKey: next.merchantKey === undefined ? report.controls.merchantKey || undefined : next.merchantKey || undefined,
        }),
      );
      setShownTransactions(25);
    } finally {
      setLoading(false);
    }
  };

  const choosePreset = (value: Preset) => {
    if (value === "custom") {
      setCustom(true);
      return;
    }
    setCustom(false);
    // One month reads best day by day; longer ranges month by month.
    void load({ range: value, interval: value === "month" ? "day" : "month" }, false);
  };

  /** Clicking a month bar opens that month by day; a day bar opens that day. */
  const zoomTo = (key: string) => {
    if (loading) return;
    if (interval === "month") {
      setCustom(false);
      void load({ month: key, range: "month", interval: "day" }, false);
      return;
    }
    setCustom(true);
    void load({ dateFrom: key, dateTo: key, interval: "day" }, true);
  };

  const exportCsv = () => {
    const rows = report.transactions.map((tx) => [
      isoDay(tx.date),
      tx.label || "",
      tx.description,
      tx.category?.name || "Uncategorized",
      tx.merchant,
      tx.amountIn || "",
      tx.amountOut || "",
    ]);
    const csv = [["Date", "Label", "Description", "Category", "Merchant", "Amount In", "Amount Out"], ...rows]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `fortuna-report-${dateFrom}-to-${dateTo}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const categoryName = report.categories.find((item) => item.id === report.controls.categoryId)?.name;
  const merchantName = report.merchants.find((item) => item.key === report.controls.merchantKey)?.name;
  const previous = report.previousPeriod?.summary;
  const hasPrevious = !!previous && previous.transactionCount > 0;
  const savingsRate = report.summary.totalIn > 0 ? Math.round((report.summary.net / report.summary.totalIn) * 100) : null;
  const breakdownRows = (breakdownBy === "category" ? report.categoryBreakdown ?? report.breakdown : report.merchantBreakdown ?? []).filter(
    (row) => Math.abs(row.metricValue) > 0.004,
  );
  const series = report.timeSeries ?? report.chartSeries;
  const valueTone = metric === "income" ? "good" : metric === "net" ? "default" : "bad";
  const metricWord = metric === "income" ? "Income" : metric === "net" ? "Net flow" : "Spending";

  return (
    <div className={cn("flex flex-col gap-6", loading && "[&>*:not(:first-child)]:opacity-60")}>
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented options={presetOptions} value={preset} onChange={choosePreset} disabled={loading} />
          {preset === "custom" ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-44"><DatePicker variant="field" value={dateFrom} onChange={(value) => void load({ dateFrom: value }, true)} /></div>
              <span className="text-sm text-dark-5 dark:text-dark-6">to</span>
              <div className="w-44"><DatePicker variant="field" value={dateTo} onChange={(value) => void load({ dateTo: value }, true)} /></div>
            </div>
          ) : (
            <MonthSwitcher
              months={report.importedMonths}
              value={report.selectedMonth}
              onChange={(month) => void load({ month })}
              loading={loading}
            />
          )}
          <span className="text-sm text-dark-5 dark:text-dark-6">
            {formatDay(dateFrom, "d MMM yyyy")} – {formatDay(dateTo, "d MMM yyyy")}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented options={metricOptions} value={metric} onChange={(value) => void load({ metric: value })} disabled={loading} />
          <Segmented
            options={[
              { value: "month", label: "Monthly" },
              { value: "day", label: "Daily" },
            ]}
            value={interval}
            onChange={(value) => void load({ interval: value })}
            disabled={loading}
          />
          <div className="w-52">
            <Select
              value={report.controls.categoryId || ""}
              options={[
                { value: "", label: "All categories" },
                ...report.categories.map((item) => ({ value: item.id, label: item.name, color: item.color || "#9ca3af" })),
              ]}
              onChange={(categoryId) => void load({ categoryId })}
              buttonClassName="w-full min-w-0"
            />
          </div>
          {merchantName ? (
            <span className="inline-flex h-11 items-center gap-2 rounded-lg border border-stroke bg-white px-3 text-sm text-dark dark:border-dark-3 dark:bg-dark-2 dark:text-white">
              {merchantName}
              <button type="button" aria-label="Remove merchant filter" onClick={() => void load({ merchantKey: "" })} className="text-dark-5 hover:text-dark dark:text-dark-6 dark:hover:text-white">
                <X className="size-4" />
              </button>
            </span>
          ) : null}
          {categoryName || merchantName ? (
            <button
              type="button"
              onClick={() => void load({ categoryId: "", merchantKey: "" })}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary"
            >
              <X className="size-4" /> Clear filters
            </button>
          ) : null}
          <div className="ml-auto">
            <Button variant="secondary" size="sm" onClick={exportCsv} leftIcon={<Download className="size-4" />}>Export CSV</Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Income"
          value={formatCurrency(report.summary.totalIn)}
          tone="good"
          sub={hasPrevious ? <Delta value={report.summary.totalIn - previous.totalIn} previous={previous.totalIn} suffix="vs previous period" invert /> : "No previous period to compare"}
        />
        <StatCard
          label="Spending"
          value={formatCurrency(report.summary.totalOut)}
          tone="bad"
          sub={hasPrevious ? <Delta value={report.summary.totalOut - previous.totalOut} previous={previous.totalOut} suffix="vs previous period" /> : "No previous period to compare"}
        />
        <StatCard
          label="Net flow"
          value={formatCurrency(report.summary.net, { signed: true })}
          tone={report.summary.net >= 0 ? "good" : "bad"}
          sub={savingsRate === null ? "No income in this period" : `${savingsRate}% of income kept`}
        />
        <StatCard
          label="Transactions"
          value={String(report.summary.transactionCount)}
          sub={hasPrevious ? `${previous.transactionCount} in the previous period` : undefined}
        />
      </div>

      <SectionCard
        title={`${metric === "inOut" ? "Income and spending" : metricWord} ${interval === "day" ? "by day" : "by month"}`}
        action={
          <span className="text-xs text-dark-5 dark:text-dark-6">
            {interval === "month" ? "Click a month to see it day by day" : dateFrom === dateTo ? "" : "Click a day to see just that day"}
          </span>
        }
      >
        <div className="h-[320px]">
          <SeriesChart data={series} metric={metric} interval={interval} onSelect={zoomTo} />
        </div>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[2fr_3fr]">
        <SectionCard
          title={`${metric === "inOut" ? "Spending" : metricWord} by ${breakdownBy}`}
          action={
            <Segmented
              options={[
                { value: "category", label: "Category" },
                { value: "merchant", label: "Merchant" },
              ]}
              value={breakdownBy}
              onChange={setBreakdownBy}
            />
          }
        >
          {breakdownRows.length === 0 ? (
            <EmptyText>Nothing to break down in this period.</EmptyText>
          ) : (
            <>
              <p className="mb-2 text-xs text-dark-5 dark:text-dark-6">Click a row to filter the report to it.</p>
              <BarList
                limit={12}
                valueTone={valueTone}
                selectedKey={breakdownBy === "category" ? report.controls.categoryId : report.controls.merchantKey}
                onSelect={(key) =>
                  void (breakdownBy === "category"
                    ? load({ categoryId: key === report.controls.categoryId ? "" : key })
                    : load({ merchantKey: key === report.controls.merchantKey ? "" : key }))
                }
                rows={breakdownRows.map((row) => ({
                  key: row.key,
                  name: row.name,
                  color: row.color || (breakdownBy === "merchant" ? "#5750F1" : undefined),
                  value: row.metricValue,
                  helper: plural(row.transactionCount, "transaction"),
                }))}
              />
            </>
          )}
        </SectionCard>

        <SectionCard
          title={`Transactions (${report.transactions.length})`}
          action={
            <div className="w-44">
              <Select
                value={ordering}
                options={orderingOptions}
                onChange={(value) => setOrdering(value as Ordering)}
                buttonClassName="w-full min-w-0"
              />
            </div>
          }
        >
          {report.transactions.length === 0 ? (
            <EmptyText>No transactions match this report.</EmptyText>
          ) : (
            <>
              <ReportTransactionCards
                transactions={report.transactions}
                ordering={ordering}
                limit={shownTransactions}
                accounts={accounts}
              />
              {report.transactions.length > shownTransactions ? (
                <button
                  type="button"
                  onClick={() => setShownTransactions((count) => count + 50)}
                  className="mt-3 w-full rounded-lg border border-stroke py-2 text-sm font-medium text-primary hover:bg-gray-2 dark:border-stroke-dark dark:hover:bg-dark-3"
                >
                  Show more ({report.transactions.length - shownTransactions} left)
                </button>
              ) : null}
            </>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function SeriesChart({
  data,
  metric,
  interval,
  onSelect,
}: {
  data: SeriesPoint[];
  metric: Metric;
  interval: Interval;
  onSelect?: (key: string) => void;
}) {
  if (data.length === 0 || data.every((item) => !item.totalIn && !item.totalOut)) {
    return <div className="flex h-full items-center justify-center text-sm text-dark-5 dark:text-dark-6">No transactions in this period.</div>;
  }
  const rows = data.map((item) => ({
    ...item,
    label: interval === "day" ? formatDay(item.key) : formatMonth(item.key, "MMM yy"),
  }));
  const barSize = barSizeFor(rows.length * (metric === "inOut" ? 2 : 1));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={rows}
        barGap={3}
        barCategoryGap={interval === "day" ? "12%" : "28%"}
        onClick={(state) => {
          const key = (state?.activePayload?.[0]?.payload as SeriesPoint | undefined)?.key;
          if (key && onSelect) onSelect(key);
        }}
        style={onSelect ? { cursor: "pointer" } : undefined}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--chart-muted)" }} axisLine={false} tickLine={false} minTickGap={16} />
        <YAxis tick={{ fontSize: 12, fill: "var(--chart-muted)" }} axisLine={false} tickLine={false} width={56} tickFormatter={(value: number) => (Math.abs(value) >= 1000 ? `${Math.round(value / 100) / 10}k` : String(value))} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--chart-grid)", opacity: 0.4 }} />
        {(metric === "income" || metric === "inOut") && <Bar dataKey="totalIn" name="Income" fill="#22AD5C" radius={[4, 4, 0, 0]} maxBarSize={barSize} />}
        {(metric === "spending" || metric === "inOut") && <Bar dataKey="totalOut" name="Spending" fill="#F23030" radius={[4, 4, 0, 0]} maxBarSize={barSize} />}
        {metric === "net" && (
          <Bar dataKey="net" name="Net flow" radius={[4, 4, 0, 0]} maxBarSize={barSize}>
            {rows.map((item) => (
              <Cell key={item.key} fill={item.net >= 0 ? "#22AD5C" : "#F23030"} />
            ))}
          </Bar>
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

function ReportTransactionCards({
  transactions,
  ordering,
  limit,
  accounts,
}: {
  transactions: Transaction[];
  ordering: Ordering;
  limit: number;
  accounts: Account[];
}) {
  const { colors: accountColorMap, names: accountNameMap } = accountMaps(accounts);
  const amountOf = (tx: Transaction) =>
    Math.max(Number(tx.originalAmountIn ?? tx.amountIn) || 0, Number(tx.originalAmountOut ?? tx.amountOut) || 0);
  const sorted = [...transactions].sort((a, b) => {
    if (ordering === "largest") return amountOf(b) - amountOf(a);
    if (ordering === "smallest") return amountOf(a) - amountOf(b);
    const byDate = isoDay(a.date).localeCompare(isoDay(b.date));
    return ordering === "oldest" ? byDate : -byDate;
  });
  const cards: TransactionCardTransaction[] = sorted.slice(0, limit).map(toCardTransaction);

  // Date orders group by day like the Transactions page; amount orders are a flat list.
  if (ordering === "newest" || ordering === "oldest") {
    return <ExpandableTransactionList transactions={cards} accountColorMap={accountColorMap} accountNameMap={accountNameMap} />;
  }
  return (
    <div className="space-y-3">
      {cards.map((card) => (
        <TransactionCard
          key={card.id}
          transaction={card}
          accountColor={card.accountIdentifier ? accountColorMap[card.accountIdentifier] : undefined}
          accountName={card.accountIdentifier ? accountNameMap[card.accountIdentifier] : undefined}
          showDate
        />
      ))}
    </div>
  );
}

function RecurringList({ items }: { items: RecurringPayment[] }) {
  if (items.length === 0) return <EmptyText>Merchants charged in two or more months show up here.</EmptyText>;
  return (
    <div className="divide-y divide-stroke dark:divide-stroke-dark">
      {items.map((item) => (
        <div key={item.key} className="flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-dark dark:text-white">{item.name}</p>
            <p className="mt-0.5 text-xs text-dark-5 dark:text-dark-6">
              {plural(item.monthsSeen, "month")} · {item.stability === "fixed" ? "fixed amount" : "varies"}
              {item.lastDate ? ` · last ${formatDay(item.lastDate)}` : ""}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold tabular-nums text-dark dark:text-white">{formatCurrency(item.averageAmount)}</p>
            <p className="text-xs text-dark-5 dark:text-dark-6">{formatCurrency(item.totalOut)} total</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function InsightsTab({
  insights,
  loading,
  loadInsights,
}: {
  insights: InsightsData;
  loading: boolean;
  loadInsights: (month: string) => void;
}) {
  if (!insights.hasTransactions) {
    return <Card><EmptyText>Import statements to see monthly insights.</EmptyText></Card>;
  }
  const summary = insights.monthlySummary;
  const previousLabel = summary.previousMonth ? formatMonth(summary.previousMonth, "MMM") : null;
  const changes = insights.categoryChanges.filter((item) => Math.abs(item.delta) > 0.004);

  return (
    <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-60")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-dark dark:text-white">{formatMonth(insights.selectedMonth, "MMMM yyyy")}</h2>
        <MonthSwitcher months={insights.importedMonths} value={insights.selectedMonth} onChange={loadInsights} loading={loading} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Spending"
          value={formatCurrency(summary.totalOut)}
          tone="bad"
          sub={summary.spendingDelta !== null && previousLabel ? <Delta value={summary.spendingDelta} previous={summary.previousTotalOut} suffix={`vs ${previousLabel}`} /> : "No earlier month to compare"}
        />
        <StatCard
          label="3-month average"
          value={summary.threeMonthAverage !== null ? formatCurrency(summary.threeMonthAverage) : "—"}
          sub={summary.threeMonthDelta !== null ? <Delta value={summary.threeMonthDelta} previous={summary.threeMonthAverage} suffix="this month vs average" /> : "Needs earlier months"}
        />
        <StatCard label="Income" value={formatCurrency(summary.totalIn)} tone="good" />
        <StatCard label="Transactions" value={String(summary.transactionCount)} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title={previousLabel ? `What changed since ${previousLabel}` : "What changed"}>
          {changes.length === 0 ? (
            <EmptyText>{previousLabel ? "Category spending is the same as last month." : "Needs an earlier month to compare."}</EmptyText>
          ) : (
            <div className="divide-y divide-stroke dark:divide-stroke-dark">
              {changes.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color || "#9ca3af" }} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-dark dark:text-white">{item.name}</p>
                      <p className="text-xs tabular-nums text-dark-5 dark:text-dark-6">
                        {formatCurrency(item.previousTotalOut)} → {formatCurrency(item.totalOut)}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 text-sm">
                    {item.previousTotalOut ? <Delta value={item.delta} previous={item.previousTotalOut} /> : <span className="font-medium text-red">New</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Top merchants">
          {insights.merchantInsights.topMerchants.length === 0 ? (
            <EmptyText>No spending this month.</EmptyText>
          ) : (
            <BarList
              valueTone="bad"
              rows={insights.merchantInsights.topMerchants
                .filter((item) => item.totalOut > 0)
                .map((item) => ({ key: item.key, name: item.name, color: "#5750F1", value: item.totalOut, helper: plural(item.transactionCount, "transaction") }))}
            />
          )}
        </SectionCard>

        <SectionCard title="First time this month">
          {insights.merchantInsights.newMerchants.length === 0 ? (
            <EmptyText>No new merchants compared with last month.</EmptyText>
          ) : (
            <div className="divide-y divide-stroke dark:divide-stroke-dark">
              {insights.merchantInsights.newMerchants.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-dark dark:text-white">{item.name}</p>
                    <p className="text-xs text-dark-5 dark:text-dark-6">{plural(item.transactionCount, "transaction")}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-red">{item.totalOut ? `-${formatCurrency(item.totalOut)}` : "—"}</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Unusually large">
          {insights.anomalies.length === 0 ? (
            <EmptyText>Nothing over 3× the month&apos;s average transaction.</EmptyText>
          ) : (
            <TransactionRows transactions={insights.anomalies} />
          )}
        </SectionCard>
      </div>

      <SectionCard title="Recurring payments">
        <RecurringList items={insights.recurringMerchants} />
      </SectionCard>
    </div>
  );
}

function OverallTab({ overview }: { overview: OverviewInsightsData }) {
  if (!overview.hasTransactions) {
    return <Card><EmptyText>Import statements to see all-time analytics.</EmptyText></Card>;
  }
  const months = overview.importedMonths.length;
  const trend: SeriesPoint[] = overview.monthlyTrend.map((item) => ({ ...item, key: item.month, label: item.month }));
  const first = overview.importedMonths[overview.importedMonths.length - 1];
  const last = overview.importedMonths[0];

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-dark-5 dark:text-dark-6">
        {plural(months, "month")} of statements{first && last ? `, ${formatMonth(first)} – ${formatMonth(last)}` : ""}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Income" value={formatCurrency(overview.summary.totalIn)} tone="good" sub={months ? `${formatCurrency(overview.summary.totalIn / months)} a month on average` : undefined} />
        <StatCard label="Spending" value={formatCurrency(overview.summary.totalOut)} tone="bad" sub={months ? `${formatCurrency(overview.summary.totalOut / months)} a month on average` : undefined} />
        <StatCard
          label="Net flow"
          value={formatCurrency(overview.summary.net, { signed: true })}
          tone={overview.summary.net >= 0 ? "good" : "bad"}
          sub={overview.summary.totalIn > 0 ? `${Math.round((overview.summary.net / overview.summary.totalIn) * 100)}% of income kept` : undefined}
        />
        <StatCard label="Transactions" value={String(overview.summary.transactionCount)} />
      </div>

      <SectionCard title="Income and spending, last 12 months">
        <div className="h-[320px]">
          <SeriesChart data={trend} metric="inOut" interval="month" />
        </div>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Top categories">
          <BarList
            valueTone="bad"
            rows={overview.topCategories
              .filter((item) => item.totalOut > 0)
              .map((item) => ({ key: item.key, name: item.name, color: item.color, value: item.totalOut, helper: plural(item.transactionCount, "transaction") }))}
          />
        </SectionCard>
        <SectionCard title="Top merchants">
          <BarList
            valueTone="bad"
            rows={overview.topMerchants
              .filter((item) => item.totalOut > 0)
              .map((item) => ({ key: item.key, name: item.name, color: "#5750F1", value: item.totalOut, helper: plural(item.transactionCount, "transaction") }))}
          />
        </SectionCard>
        <SectionCard title="Recurring payments">
          <RecurringList items={overview.recurringMerchants} />
        </SectionCard>
        <SectionCard title="Unusually large">
          {overview.anomalies.length === 0 ? <EmptyText>Nothing unusually large.</EmptyText> : <TransactionRows transactions={overview.anomalies} />}
        </SectionCard>
      </div>
    </div>
  );
}
