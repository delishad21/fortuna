"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Download, TrendingDown, TrendingUp } from "lucide-react";
import { getAnalyticsInsights, getAnalyticsReport } from "@/app/actions/analytics";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { PageTabs } from "@/components/ui/PageTabs";
import { Select } from "@/components/ui/Select";

type Transaction = {
  id: string;
  date: string;
  description: string;
  label?: string | null;
  amountIn: number;
  amountOut: number;
  category?: { id: string; name: string; color: string } | null;
  merchant: string;
  merchantKey: string;
};

type ReportData = {
  selectedMonth: string;
  importedMonths: string[];
  controls: { range: string; metric: string; groupBy: string; categoryId?: string | null; merchantKey?: string | null };
  summary: { totalIn: number; totalOut: number; net: number; transactionCount: number };
  chartSeries: Array<{ key: string; label: string; totalIn: number; totalOut: number; net: number; metricValue?: number; transactionCount: number; color?: string }>;
  breakdown: Array<{ key: string; name: string; color?: string; totalIn: number; totalOut: number; net?: number; metricValue: number; transactionCount: number; percentOfTotal: number }>;
  categoryBreakdown?: Array<{ key: string; name: string; color?: string; totalIn: number; totalOut: number; net?: number; metricValue: number; transactionCount: number; percentOfTotal: number }>;
  transactions: Transaction[];
  categories: Array<{ id: string; name: string; color: string }>;
  merchants: Array<{ key: string; name: string }>;
};

type InsightsData = {
  selectedMonth: string | null;
  importedMonths: string[];
  monthlySummary: {
    totalIn: number;
    totalOut: number;
    net: number;
    transactionCount: number;
    previousMonth: string | null;
    previousTotalOut: number | null;
    spendingDelta: number | null;
    threeMonthAverage: number | null;
    threeMonthDelta: number | null;
    mainDrivers: Array<{ key: string; name: string; totalOut: number; delta: number; percentDelta: number | null }>;
  };
  recurringMerchants: Array<{ key: string; name: string; monthsSeen: number; totalOut: number; averageAmount: number; frequency: string; stability: string }>;
  merchantInsights: {
    topMerchants: Array<{ key: string; name: string; totalOut: number; transactionCount: number }>;
    newMerchants: Array<{ key: string; name: string; totalOut: number; transactionCount: number }>;
  };
  categoryChanges: Array<{ key: string; name: string; totalOut: number; previousTotalOut: number; delta: number; percentDelta: number | null }>;
  anomalies: Transaction[];
  hasTransactions: boolean;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    maximumFractionDigits: 2,
  }).format(value || 0);

const formatMonth = (month: string | null) => {
  if (!month) return "No imported month";
  return format(parseISO(`${month}-01`), "MMM yyyy");
};

const rangeOptions = [
  { value: "month", label: "Selected month" },
  { value: "last3", label: "Last 3 months" },
  { value: "ytd", label: "Year to date" },
  { value: "last12", label: "Last 12 months" },
];

const metricOptions = [
  { value: "spending", label: "Spending only" },
  { value: "income", label: "Income only" },
  { value: "inOut", label: "Income vs spending" },
  { value: "net", label: "Net flow" },
];

const groupOptions = [
  { value: "month", label: "By month" },
  { value: "day", label: "By day" },
  { value: "category", label: "By category" },
  { value: "merchant", label: "By merchant" },
];

const chartOptions = [
  { value: "bar", label: "Bar chart" },
  { value: "line", label: "Line chart" },
  { value: "pie", label: "Pie chart" },
];

const fallbackChartColors = ["#5750F1", "#22AD5C", "#F23030", "#F59E0B", "#3B82F6", "#F97316"];
const reportBarSize = 42;

export function AnalyticsClient({ initialReport, initialInsights }: { initialReport: ReportData; initialInsights: InsightsData }) {
  const [activeTab, setActiveTab] = useState<"reports" | "insights">("reports");
  const [report, setReport] = useState(initialReport);
  const [insights, setInsights] = useState(initialInsights);
  const [chartType, setChartType] = useState("bar");
  const [loading, setLoading] = useState(false);

  const monthOptions = report.importedMonths.map((month) => ({ value: month, label: formatMonth(month) }));
  const categoryOptions = [{ value: "", label: "All categories" }, ...report.categories.map((item) => ({ value: item.id, label: item.name }))];
  const merchantOptions = [{ value: "", label: "All merchants" }, ...report.merchants.map((item) => ({ value: item.key, label: item.name }))];

  const selectedChartType = chartType === "pie" && !["category", "merchant"].includes(report.controls.groupBy) ? "bar" : chartType;

  const loadReport = async (next: Partial<ReportData["controls"]> & { month?: string }) => {
    setLoading(true);
    try {
      const nextReport = await getAnalyticsReport({
        month: next.month || report.selectedMonth,
        range: next.range || report.controls.range,
        metric: next.metric || report.controls.metric,
        groupBy: next.groupBy || report.controls.groupBy,
        categoryId: next.categoryId === undefined ? report.controls.categoryId || undefined : next.categoryId || undefined,
        merchantKey: next.merchantKey === undefined ? report.controls.merchantKey || undefined : next.merchantKey || undefined,
      });
      setReport(nextReport);
      if (next.month) setInsights(await getAnalyticsInsights(next.month));
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    const rows = report.transactions.map((tx) => [
      format(parseISO(String(tx.date)), "yyyy-MM-dd"),
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
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `analytics-report-${report.selectedMonth}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageTabs
        tabs={[
          { key: "reports", label: "Reports" },
          { key: "insights", label: "Insights" },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "reports" ? (
        <ReportsTab
          report={report}
          loading={loading}
          monthOptions={monthOptions}
          categoryOptions={categoryOptions}
          merchantOptions={merchantOptions}
          chartType={selectedChartType}
          setChartType={setChartType}
          loadReport={loadReport}
          exportCsv={exportCsv}
        />
      ) : (
        <InsightsTab insights={insights} />
      )}
    </div>
  );
}

function ReportsTab({ report, loading, monthOptions, categoryOptions, merchantOptions, chartType, setChartType, loadReport, exportCsv }: {
  report: ReportData;
  loading: boolean;
  monthOptions: Array<{ value: string; label: string }>;
  categoryOptions: Array<{ value: string; label: string }>;
  merchantOptions: Array<{ value: string; label: string }>;
  chartType: string;
  setChartType: (value: string) => void;
  loadReport: (next: Partial<ReportData["controls"]> & { month?: string }) => void;
  exportCsv: () => void;
}) {
  const categoryBreakdown = report.categoryBreakdown ?? report.breakdown;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h2 className="font-display text-3xl font-bold text-dark dark:text-white">Reports</h2>
          <p className="text-sm text-dark-5 dark:text-dark-6">Build charts and tables from imported statement data.</p>
        </div>
        <Button variant="secondary" onClick={exportCsv} leftIcon={<Download className="size-4" />}>Export CSV</Button>
      </div>

      <Card className="p-4">
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-7">
          <Select value={report.selectedMonth || ""} options={monthOptions} onChange={(month) => loadReport({ month })} placeholder="Month" buttonClassName="w-full min-w-0" />
          <Select value={report.controls.range} options={rangeOptions} onChange={(range) => loadReport({ range })} buttonClassName="w-full min-w-0" />
          <Select value={report.controls.metric} options={metricOptions} onChange={(metric) => loadReport({ metric })} buttonClassName="w-full min-w-0" />
          <Select value={report.controls.groupBy} options={groupOptions} onChange={(groupBy) => loadReport({ groupBy })} buttonClassName="w-full min-w-0" />
          <Select value={chartType} options={chartOptions} onChange={setChartType} buttonClassName="w-full min-w-0" />
          <Select value={report.controls.categoryId || ""} options={categoryOptions} onChange={(categoryId) => loadReport({ categoryId })} buttonClassName="w-full min-w-0" />
          <Select value={report.controls.merchantKey || ""} options={merchantOptions} onChange={(merchantKey) => loadReport({ merchantKey })} buttonClassName="w-full min-w-0" />
        </CardContent>
        {loading && <div className="mt-3 text-xs text-dark-5 dark:text-dark-6">Updating report...</div>}
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Metric title="Income" value={formatCurrency(report.summary.totalIn)} tone="good" />
        <Metric title="Spending" value={formatCurrency(report.summary.totalOut)} tone="bad" />
        <Metric title="Net Flow" value={formatCurrency(report.summary.net)} tone={report.summary.net >= 0 ? "good" : "bad"} />
        <Metric title="Transactions" value={String(report.summary.transactionCount)} />
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Main Chart</CardTitle>
          {loading && <span className="text-xs text-dark-5 dark:text-dark-6">Updating...</span>}
        </CardHeader>
        <CardContent className="h-[360px]">
          <ReportChart data={report.chartSeries} metric={report.controls.metric} chartType={chartType} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Category Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <BreakdownChart rows={categoryBreakdown} metric={report.controls.metric} />
        </CardContent>
      </Card>
    </div>
  );
}

function ReportChart({ data, metric, chartType }: { data: ReportData["chartSeries"]; metric: string; chartType: string }) {
  if (data.length === 0) return <div className="flex h-full items-center justify-center text-sm text-dark-5 dark:text-dark-6">No data for the selected report.</div>;
  if (chartType === "pie") {
    const pieData = data.map((item) => ({
      ...item,
      chartValue: Math.abs(metric === "inOut" ? item.totalOut : item.metricValue || 0),
    }));

    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={pieData}
            dataKey="chartValue"
            nameKey="label"
            innerRadius={48}
            outerRadius={130}
            paddingAngle={0}
            stroke="none"
          >
            {pieData.map((entry, index) => <Cell key={entry.key} fill={entry.color || fallbackChartColors[index % fallbackChartColors.length]} />)}
          </Pie>
          <Tooltip formatter={(value: number) => formatCurrency(Number(value))} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--chart-muted)" }} />
          <YAxis tick={{ fontSize: 12, fill: "var(--chart-muted)" }} />
          <Tooltip formatter={(value: number) => formatCurrency(Number(value))} />
          {(metric === "income" || metric === "inOut") && <Line type="monotone" dataKey="totalIn" name="Income" stroke="#22AD5C" strokeWidth={2} />}
          {(metric === "spending" || metric === "inOut") && <Line type="monotone" dataKey="totalOut" name="Spending" stroke="#F23030" strokeWidth={2} />}
          {metric === "net" && <Line type="monotone" dataKey="net" name="Net" stroke="#5750F1" strokeWidth={2} />}
        </LineChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} barGap={6} barCategoryGap="32%">
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--chart-muted)" }} />
        <YAxis tick={{ fontSize: 12, fill: "var(--chart-muted)" }} />
        <Tooltip formatter={(value: number) => formatCurrency(Number(value))} />
        {(metric === "income" || metric === "inOut") && <Bar dataKey="totalIn" name="Income" fill="#22AD5C" barSize={reportBarSize} radius={[6, 6, 0, 0]} />}
        {(metric === "spending" || metric === "inOut") && <Bar dataKey="totalOut" name="Spending" fill="#F23030" barSize={reportBarSize} radius={[6, 6, 0, 0]} />}
        {metric === "net" && <Bar dataKey="net" name="Net" fill="#5750F1" barSize={reportBarSize} radius={[6, 6, 0, 0]} />}
      </BarChart>
    </ResponsiveContainer>
  );
}

function InsightsTab({ insights }: { insights: InsightsData }) {
  if (!insights.hasTransactions) {
    return <Card><CardContent className="py-12 text-center text-sm text-dark-5 dark:text-dark-6">Import multiple statements to unlock insights.</CardContent></Card>;
  }
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-3xl font-bold text-dark dark:text-white">Insights</h2>
        <p className="text-sm text-dark-5 dark:text-dark-6">What changed in {formatMonth(insights.selectedMonth)} and what deserves attention.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <InsightMetric title="Vs Previous Month" value={insights.monthlySummary.spendingDelta} />
        <InsightMetric title="Vs 3-Month Average" value={insights.monthlySummary.threeMonthDelta} />
        <Metric title="Recurring Merchants" value={String(insights.recurringMerchants.length)} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <InsightList title="Main Spending Drivers" rows={insights.monthlySummary.mainDrivers.map((item) => ({ key: item.key, label: item.name, value: item.delta, helper: item.percentDelta === null ? "New category" : `${item.percentDelta}%` }))} />
        <InsightList title="Recurring Spend" rows={insights.recurringMerchants.map((item) => ({ key: item.key, label: item.name, value: item.totalOut, helper: `${item.frequency}, ${item.stability}, ${item.monthsSeen} months` }))} />
        <InsightList title="Top Merchants" rows={insights.merchantInsights.topMerchants.map((item) => ({ key: item.key, label: item.name, value: item.totalOut, helper: `${item.transactionCount} transactions` }))} />
        <InsightList title="Category Changes" rows={insights.categoryChanges.map((item) => ({ key: item.key, label: item.name, value: item.delta, helper: item.percentDelta === null ? "No previous spend" : `${item.percentDelta}%` }))} />
      </div>
      <Card>
        <CardHeader><CardTitle>Anomalies</CardTitle></CardHeader>
        <CardContent>{insights.anomalies.length === 0 ? <p className="text-sm text-dark-5 dark:text-dark-6">No large unusual transactions detected.</p> : <TransactionTable transactions={insights.anomalies} />}</CardContent>
      </Card>
    </div>
  );
}

function Metric({ title, value, tone = "default" }: { title: string; value: string; tone?: "default" | "good" | "bad" }) {
  const toneClass = tone === "good" ? "text-green" : tone === "bad" ? "text-red" : "text-dark dark:text-white";
  return <Card><CardHeader><CardTitle className="text-sm font-semibold text-dark-5 dark:text-dark-6">{title}</CardTitle></CardHeader><CardContent><div className={`text-2xl font-bold ${toneClass}`}>{value}</div></CardContent></Card>;
}

function InsightMetric({ title, value }: { title: string; value: number | null }) {
  const positive = (value || 0) >= 0;
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm font-semibold text-dark-5 dark:text-dark-6">{title}</CardTitle></CardHeader>
      <CardContent className="flex items-center gap-3">
        {value === null ? <AlertTriangle className="size-6 text-dark-4" /> : positive ? <TrendingUp className="size-6 text-red" /> : <TrendingDown className="size-6 text-green" />}
        <div className={`text-2xl font-bold ${value === null ? "text-dark-5" : positive ? "text-red" : "text-green"}`}>{value === null ? "Not enough data" : formatCurrency(value)}</div>
      </CardContent>
    </Card>
  );
}

function InsightList({ title, rows }: { title: string; rows: Array<{ key: string; label: string; value: number; helper: string }> }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? <p className="text-sm text-dark-5 dark:text-dark-6">No insight available yet.</p> : rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4 rounded-lg bg-gray-2 p-3 dark:bg-dark-2">
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-dark dark:text-white">{row.label}</p><p className="text-xs text-dark-5 dark:text-dark-6">{row.helper}</p></div>
            <span className={`shrink-0 text-sm font-semibold ${row.value >= 0 ? "text-red" : "text-green"}`}>{formatCurrency(row.value)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function BreakdownChart({ rows, metric }: { rows: ReportData["breakdown"]; metric: string }) {
  const chartRows = rows
    .filter((row) => Math.abs(row.metricValue) > 0)
    .map((row) => ({ ...row, chartValue: Math.abs(row.metricValue) }));
  if (chartRows.length === 0) return <p className="text-sm text-dark-5 dark:text-dark-6">No breakdown data.</p>;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(280px,420px)_1fr] xl:items-center">
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartRows}
              dataKey="chartValue"
              nameKey="name"
              innerRadius={44}
              outerRadius={120}
              paddingAngle={0}
              stroke="none"
            >
              {chartRows.map((row, index) => (
                <Cell
                  key={row.key}
                  fill={row.color || fallbackChartColors[index % fallbackChartColors.length]}
                />
              ))}
            </Pie>
            <Tooltip formatter={(value: number) => formatCurrency(Math.abs(Number(value)))} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="max-h-[320px] space-y-3 overflow-auto pr-1">
        {chartRows.slice(0, 12).map((row, index) => {
          const valueClass = metric === "income" ? "text-green" : metric === "net" && row.metricValue < 0 ? "text-green" : "text-red";
          return (
            <div key={row.key} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 text-sm">
              <span
                className="size-3 rounded-full"
                style={{ backgroundColor: row.color || fallbackChartColors[index % fallbackChartColors.length] }}
              />
              <span className="truncate font-semibold text-dark dark:text-white">{row.name}</span>
              <span className="font-mono text-xs text-dark-5 dark:text-dark-6">{row.percentOfTotal}%</span>
              <span className={`font-semibold ${valueClass}`}>{formatCurrency(row.metricValue)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TransactionTable({ transactions }: { transactions: Transaction[] }) {
  if (transactions.length === 0) return <p className="py-8 text-center text-sm text-dark-5 dark:text-dark-6">No transactions match this report.</p>;
  return (
    <div className="divide-y divide-stroke dark:divide-dark-3">
      {transactions.slice(0, 80).map((tx) => (
        <div key={tx.id} className="grid gap-2 py-3 text-sm md:grid-cols-[1fr_auto_auto] md:items-center">
          <div className="min-w-0"><p className="truncate font-semibold text-dark dark:text-white">{tx.label || tx.description}</p><p className="text-xs text-dark-5 dark:text-dark-6">{format(parseISO(String(tx.date)), "dd MMM yyyy")} - {tx.category?.name || "Uncategorized"} - {tx.merchant}</p></div>
          <span className="text-dark-5 dark:text-dark-6">{tx.amountIn > 0 ? "Income" : "Spending"}</span>
          <span className={`font-semibold ${tx.amountIn > 0 ? "text-green" : "text-red"}`}>{tx.amountIn > 0 ? `+${formatCurrency(tx.amountIn)}` : `-${formatCurrency(tx.amountOut)}`}</span>
        </div>
      ))}
    </div>
  );
}
