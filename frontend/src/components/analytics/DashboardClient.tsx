"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertCircle, CheckCircle2, FileText, Upload } from "lucide-react";
import { getDashboardOverview } from "@/app/actions/analytics";
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
  merchant?: string;
};

type OverviewData = {
  selectedMonth: string | null;
  importedMonths: Array<{ month: string; transactionCount: number }>;
  summary: {
    totalIn: number;
    totalOut: number;
    net: number;
    transactionCount: number;
    topCategory: { name: string; color: string; totalOut: number } | null;
    largestTransaction: Transaction | null;
    previousMonth: { month: string; totalOut: number; spendingDelta: number } | null;
  };
  trend: Array<{ month: string; totalIn: number; totalOut: number; net: number }>;
  recentTransactions: Transaction[];
  hasTransactions: boolean;
};

type ReviewData = {
  reviewQueue: {
    uncategorized: Transaction[];
    newMerchants: Array<{ key: string; name: string }>;
    largeTransactions: Transaction[];
  };
  importSummaries: Array<{
    month: string;
    latestTransactionDate: string;
    totalIn: number;
    totalOut: number;
    net: number;
    transactionCount: number;
    topCategory: { name: string; color: string; totalOut: number } | null;
  }>;
  dataHealth: {
    transactionCount: number;
    categorizedCount: number;
    uncategorizedCount: number;
    categorizedPercent: number;
    ruleCount: number;
    merchantCount: number;
    categoryCount: number;
  };
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

function MetricCard({ title, value, hint, tone = "default" }: { title: string; value: string; hint: string; tone?: "default" | "good" | "bad" }) {
  const toneClass = tone === "good" ? "text-green" : tone === "bad" ? "text-red" : "text-dark dark:text-white";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold text-dark-5 dark:text-dark-6">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
        <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">{hint}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <FileText className="size-10 text-dark-4" />
        <div>
          <h3 className="font-semibold text-dark dark:text-white">{title}</h3>
          <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">{description}</p>
        </div>
        {action}
      </CardContent>
    </Card>
  );
}

export function DashboardClient({ initialOverview, initialReview }: { initialOverview: OverviewData; initialReview: ReviewData }) {
  const [activeTab, setActiveTab] = useState<"overview" | "review">("overview");
  const [overview, setOverview] = useState(initialOverview);
  const [loadingMonth, setLoadingMonth] = useState(false);

  const monthOptions = overview.importedMonths.map((item) => ({
    value: item.month,
    label: formatMonth(item.month),
    description: `${item.transactionCount} transactions`,
  }));

  const trend = useMemo(
    () => overview.trend.map((item) => ({ ...item, label: formatMonth(item.month) })),
    [overview.trend],
  );

  const reviewCount =
    initialReview.reviewQueue.uncategorized.length +
    initialReview.reviewQueue.newMerchants.length +
    initialReview.reviewQueue.largeTransactions.length;

  const handleMonthChange = async (month: string) => {
    setLoadingMonth(true);
    try {
      setOverview(await getDashboardOverview(month));
    } finally {
      setLoadingMonth(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageTabs
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "review", label: `Review${reviewCount ? ` (${reviewCount})` : ""}` },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "overview" ? (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-dark dark:text-white">Imported Month Overview</h2>
              <p className="text-sm text-dark-5 dark:text-dark-6">
                Quick analytics from completed statement periods, not live current-month data.
              </p>
            </div>
            <div className="w-full max-w-xs">
              <Select
                value={overview.selectedMonth || ""}
                options={monthOptions}
                onChange={handleMonthChange}
                buttonClassName="w-full"
                placeholder="Select imported month"
              />
            </div>
          </div>

          {!overview.hasTransactions ? (
            <EmptyState
              title="No transactions imported yet"
              description="Import a statement to unlock dashboard analytics and review queues."
              action={<Link href="/import"><Button leftIcon={<Upload className="size-4" />}>Import Statement</Button></Link>}
            />
          ) : !overview.selectedMonth ? (
            <EmptyState
              title="No completed statement month detected"
              description="A month appears here after it has at least one transaction dated after the 15th."
              action={<Link href="/import"><Button>Import Another Statement</Button></Link>}
            />
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard title="Spending" value={formatCurrency(overview.summary.totalOut)} hint={formatMonth(overview.selectedMonth)} tone="bad" />
                <MetricCard title="Income" value={formatCurrency(overview.summary.totalIn)} hint={`${overview.summary.transactionCount} transactions`} tone="good" />
                <MetricCard title="Net Flow" value={formatCurrency(overview.summary.net)} hint="Income minus spending" tone={overview.summary.net >= 0 ? "good" : "bad"} />
                <MetricCard title="Top Category" value={overview.summary.topCategory?.name || "None"} hint={overview.summary.topCategory ? formatCurrency(overview.summary.topCategory.totalOut) : "No spending categories"} />
              </div>

              <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
                <Card className="min-h-[360px]">
                  <CardHeader className="flex items-center justify-between">
                    <CardTitle>Spending and Income Trend</CardTitle>
                    {loadingMonth && <span className="text-xs text-dark-5 dark:text-dark-6">Updating...</span>}
                  </CardHeader>
                  <CardContent className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-stroke)" />
                        <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--color-dark-5)" }} />
                        <YAxis tick={{ fontSize: 12, fill: "var(--color-dark-5)" }} />
                        <Tooltip formatter={(value: number) => formatCurrency(Number(value))} />
                        <Bar dataKey="totalOut" name="Spending" fill="#F23030" radius={[6, 6, 0, 0]} />
                        <Bar dataKey="totalIn" name="Income" fill="#22AD5C" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle>Quick Actions</CardTitle></CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <Link href="/import"><Button className="w-full" leftIcon={<Upload className="size-4" />}>Import Statement</Button></Link>
                    <Link href="/analytics"><Button className="w-full" variant="secondary">Open Analytics</Button></Link>
                    <Link href="/transactions"><Button className="w-full" variant="secondary">Review Transactions</Button></Link>
                    <Link href="/settings"><Button className="w-full" variant="secondary">Manage Categories</Button></Link>
                    {overview.summary.largestTransaction && (
                      <div className="mt-3 rounded-lg bg-gray-2 p-4 dark:bg-dark-2">
                        <p className="text-xs font-semibold uppercase text-dark-5 dark:text-dark-6">Largest transaction</p>
                        <p className="mt-2 truncate text-sm font-semibold text-dark dark:text-white">
                          {overview.summary.largestTransaction.label || overview.summary.largestTransaction.description}
                        </p>
                        <p className="text-sm text-red">{formatCurrency(overview.summary.largestTransaction.amountOut)}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader><CardTitle>Recent Transactions</CardTitle></CardHeader>
                <CardContent>
                  <TransactionList transactions={overview.recentTransactions} />
                </CardContent>
              </Card>
            </>
          )}
        </div>
      ) : (
        <ReviewTab data={initialReview} />
      )}
    </div>
  );
}

function TransactionList({ transactions }: { transactions: Transaction[] }) {
  if (transactions.length === 0) {
    return <div className="py-8 text-center text-sm text-dark-5 dark:text-dark-6">No transactions to show.</div>;
  }
  return (
    <div className="divide-y divide-stroke dark:divide-dark-3">
      {transactions.map((tx) => (
        <div key={tx.id} className="flex items-center justify-between gap-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-dark dark:text-white">{tx.label || tx.description}</div>
            <div className="text-xs text-dark-5 dark:text-dark-6">
              {format(parseISO(String(tx.date)), "dd MMM yyyy")} - {tx.category?.name || "Uncategorized"}
            </div>
          </div>
          <div className={`shrink-0 text-sm font-semibold ${tx.amountIn > 0 ? "text-green" : "text-red"}`}>
            {tx.amountIn > 0 ? `+${formatCurrency(tx.amountIn)}` : `-${formatCurrency(tx.amountOut)}`}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReviewTab({ data }: { data: ReviewData }) {
  const queueEmpty =
    data.reviewQueue.uncategorized.length === 0 &&
    data.reviewQueue.newMerchants.length === 0 &&
    data.reviewQueue.largeTransactions.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold text-dark dark:text-white">Review Queue</h2>
        <p className="text-sm text-dark-5 dark:text-dark-6">Cleanup and data quality signals from imported statements.</p>
      </div>

      {queueEmpty ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-8">
            <CheckCircle2 className="size-8 text-green" />
            <div>
              <h3 className="font-semibold text-dark dark:text-white">No urgent review items</h3>
              <p className="text-sm text-dark-5 dark:text-dark-6">Your imported transaction data looks clean.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          <QueueCard title="Uncategorized" count={data.reviewQueue.uncategorized.length} transactions={data.reviewQueue.uncategorized} />
          <Card>
            <CardHeader><CardTitle>New Merchants</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {data.reviewQueue.newMerchants.length === 0 ? <p className="text-sm text-dark-5 dark:text-dark-6">No new merchants detected.</p> : data.reviewQueue.newMerchants.map((merchant) => (
                <div key={merchant.key} className="rounded-lg bg-gray-2 px-3 py-2 text-sm text-dark dark:bg-dark-2 dark:text-white">{merchant.name}</div>
              ))}
            </CardContent>
          </Card>
          <QueueCard title="Large Transactions" count={data.reviewQueue.largeTransactions.length} transactions={data.reviewQueue.largeTransactions} />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Recent Import Summaries</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {data.importSummaries.length === 0 ? <p className="text-sm text-dark-5 dark:text-dark-6">No imported months detected yet.</p> : data.importSummaries.map((item) => (
              <div key={item.month} className="grid gap-3 rounded-lg border border-stroke p-4 dark:border-stroke-dark md:grid-cols-4">
                <div><p className="text-sm font-semibold text-dark dark:text-white">{formatMonth(item.month)}</p><p className="text-xs text-dark-5 dark:text-dark-6">{item.transactionCount} transactions</p></div>
                <div><p className="text-xs text-dark-5 dark:text-dark-6">Spending</p><p className="font-semibold text-red">{formatCurrency(item.totalOut)}</p></div>
                <div><p className="text-xs text-dark-5 dark:text-dark-6">Income</p><p className="font-semibold text-green">{formatCurrency(item.totalIn)}</p></div>
                <div><p className="text-xs text-dark-5 dark:text-dark-6">Top category</p><p className="font-semibold text-dark dark:text-white">{item.topCategory?.name || "None"}</p></div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Data Health</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-sm"><span className="text-dark-5 dark:text-dark-6">Categorized</span><span className="font-semibold text-dark dark:text-white">{data.dataHealth.categorizedPercent}%</span></div>
              <div className="mt-2 h-2 rounded-full bg-gray-2 dark:bg-dark-2"><div className="h-2 rounded-full bg-primary" style={{ width: `${data.dataHealth.categorizedPercent}%` }} /></div>
            </div>
            <HealthRow label="Transactions" value={data.dataHealth.transactionCount} />
            <HealthRow label="Uncategorized" value={data.dataHealth.uncategorizedCount} warning={data.dataHealth.uncategorizedCount > 0} />
            <HealthRow label="Rules" value={data.dataHealth.ruleCount} />
            <HealthRow label="Merchants" value={data.dataHealth.merchantCount} />
            {data.dataHealth.uncategorizedCount > 0 && <div className="flex gap-2 rounded-lg bg-red/10 p-3 text-sm text-red"><AlertCircle className="size-4 shrink-0" />Review uncategorized transactions to improve analytics accuracy.</div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function QueueCard({ title, count, transactions }: { title: string; count: number; transactions: Transaction[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title} ({count})</CardTitle></CardHeader>
      <CardContent><TransactionList transactions={transactions.slice(0, 5)} /></CardContent>
    </Card>
  );
}

function HealthRow({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-dark-5 dark:text-dark-6">{label}</span>
      <span className={`font-semibold ${warning ? "text-red" : "text-dark dark:text-white"}`}>{value}</span>
    </div>
  );
}
