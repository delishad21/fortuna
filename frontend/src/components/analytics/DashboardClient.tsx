"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { AlertCircle, ArrowRight, CheckCircle2, FileText, Upload } from "lucide-react";
import { updateTransaction } from "@/app/actions/transactions";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { CategorySelect } from "@/components/ui/CategorySelect";
import { PageTabs } from "@/components/ui/PageTabs";
import { ImportSummaryCard } from "@/components/analytics/ImportSummaryCard";
import { ExpandableTransactionList } from "@/components/transactions/ExpandableTransactionList";
import type { TransactionCardTransaction } from "@/components/transactions/TransactionCard";

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

type Category = {
  id: string;
  name: string;
  color: string;
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
    key: string;
    filename: string;
    parserId: string | null;
    importedAt: string | null;
    latestTransactionDate: string;
    totalIn: number;
    totalOut: number;
    net: number;
    transactionCount: number;
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

const dashboardBarSize = 42;

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

export function DashboardClient({ initialOverview, initialReview, categories }: { initialOverview: OverviewData; initialReview: ReviewData; categories: Category[] }) {
  const [activeTab, setActiveTab] = useState<"overview" | "review">("overview");
  const overview = initialOverview;

  const trend = useMemo(
    () => overview.trend.map((item) => ({ ...item, label: formatMonth(item.month) })),
    [overview.trend],
  );

  const reviewCount =
    initialReview.reviewQueue.uncategorized.length +
    initialReview.reviewQueue.largeTransactions.length;

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
              <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
                <Card className="min-h-[360px]">
                  <CardHeader><CardTitle>Spending and Income Trend</CardTitle></CardHeader>
                  <CardContent className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trend} barGap={6} barCategoryGap="32%">
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                        <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--chart-muted)" }} />
                        <YAxis tick={{ fontSize: 12, fill: "var(--chart-muted)" }} />
                        <Tooltip formatter={(value: number) => formatCurrency(Number(value))} />
                        <Bar dataKey="totalOut" name="Spending" fill="#F23030" barSize={dashboardBarSize} radius={[6, 6, 0, 0]} />
                        <Bar dataKey="totalIn" name="Income" fill="#22AD5C" barSize={dashboardBarSize} radius={[6, 6, 0, 0]} />
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
                  </CardContent>
                </Card>
              </div>

                <Card>
                  <CardHeader><CardTitle>Recent Transactions</CardTitle></CardHeader>
                  <CardContent>
                  <RecentTransactionCards transactions={overview.recentTransactions} />
                  </CardContent>
                </Card>
            </>
          )}
        </div>
      ) : (
        <ReviewTab data={initialReview} categories={categories} />
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

function RecentTransactionCards({ transactions }: { transactions: Transaction[] }) {
  if (transactions.length === 0) {
    return <div className="py-8 text-center text-sm text-dark-5 dark:text-dark-6">No transactions to show.</div>;
  }

  const cardTransactions: TransactionCardTransaction[] = transactions.map((tx) => ({
    id: tx.id,
    date: String(tx.date),
    description: tx.description,
    label: tx.label || undefined,
    amountIn: tx.amountIn > 0 ? tx.amountIn : null,
    amountOut: tx.amountOut > 0 ? tx.amountOut : null,
    balance: null,
    category: tx.category || undefined,
  }));

  return <ExpandableTransactionList transactions={cardTransactions} />;
}

function ReviewTab({ data, categories }: { data: ReviewData; categories: Category[] }) {
  const [uncategorized, setUncategorized] = useState(data.reviewQueue.uncategorized);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const queueEmpty =
    uncategorized.length === 0 &&
    data.reviewQueue.largeTransactions.length === 0;
  const reviewData = {
    ...data,
    reviewQueue: {
      ...data.reviewQueue,
      uncategorized,
    },
    dataHealth: {
      ...data.dataHealth,
      uncategorizedCount: Math.max(data.dataHealth.uncategorizedCount - (data.reviewQueue.uncategorized.length - uncategorized.length), 0),
      categorizedCount: data.dataHealth.categorizedCount + (data.reviewQueue.uncategorized.length - uncategorized.length),
      categorizedPercent: data.dataHealth.transactionCount
        ? Math.round(((data.dataHealth.categorizedCount + (data.reviewQueue.uncategorized.length - uncategorized.length)) / data.dataHealth.transactionCount) * 100)
        : 0,
    },
  };

  const handleCategorize = async (transaction: Transaction, categoryId: string) => {
    if (!categoryId) return;
    setError(null);
    setSavingIds((prev) => new Set(prev).add(transaction.id));
    try {
      await updateTransaction(transaction.id, { categoryId });
      setUncategorized((prev) => prev.filter((item) => item.id !== transaction.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update category");
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(transaction.id);
        return next;
      });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-lg bg-red/10 px-4 py-3 text-sm text-red">
          {error}
        </div>
      )}
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
        <div className="grid gap-6 xl:grid-cols-2">
          <UncategorizedQueueCard
            categories={categories}
            savingIds={savingIds}
            transactions={uncategorized}
            onCategorize={handleCategorize}
          />
          <DataHealthCard data={reviewData} />
        </div>
      )}

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Recent Import Summaries</CardTitle>
            <Link href="/imports">
              <Button variant="secondary" size="sm" rightIcon={<ArrowRight className="size-4" />}>View All</Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.importSummaries.length === 0 ? <p className="text-sm text-dark-5 dark:text-dark-6">No imported files detected yet.</p> : data.importSummaries.map((item) => (
              <ImportSummaryCard key={item.key} item={item} />
            ))}
          </CardContent>
        </Card>

        <QueueCard title="Large Transactions" count={data.reviewQueue.largeTransactions.length} transactions={data.reviewQueue.largeTransactions} useTransactionCards />
      </div>
    </div>
  );
}

function UncategorizedQueueCard({
  categories,
  savingIds,
  transactions,
  onCategorize,
}: {
  categories: Category[];
  savingIds: Set<string>;
  transactions: Transaction[];
  onCategorize: (transaction: Transaction, categoryId: string) => void;
}) {
  const router = useRouter();

  return (
    <Card>
      <CardHeader><CardTitle>Uncategorized ({transactions.length})</CardTitle></CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <div className="py-8 text-center text-sm text-dark-5 dark:text-dark-6">No uncategorized transactions.</div>
        ) : (
          <div className="space-y-3">
            {transactions.slice(0, 8).map((tx) => {
              const isSaving = savingIds.has(tx.id);
              return (
                <div key={tx.id} className="grid gap-3 rounded-lg border border-stroke p-3 dark:border-stroke-dark md:grid-cols-[minmax(0,1fr)_220px] md:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-dark dark:text-white">{tx.label || tx.description}</p>
                    <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                      {format(parseISO(String(tx.date)), "dd MMM yyyy")} · {tx.amountIn > 0 ? `+${formatCurrency(tx.amountIn)}` : `-${formatCurrency(tx.amountOut)}`}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <CategorySelect
                      value=""
                      categories={categories}
                      onChange={(categoryId) => onCategorize(tx, categoryId)}
                      onAddClick={() => router.push("/settings")}
                      disabled={isSaving}
                      excludeReserved
                      emptyLabel={isSaving ? "Saving..." : "Choose category"}
                      dropdownPlacement="inline"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DataHealthCard({ data }: { data: ReviewData }) {
  return (
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
  );
}

function QueueCard({
  title,
  count,
  transactions,
  useTransactionCards = false,
}: {
  title: string;
  count: number;
  transactions: Transaction[];
  useTransactionCards?: boolean;
}) {
  return (
    <Card>
      <CardHeader><CardTitle>{title} ({count})</CardTitle></CardHeader>
      <CardContent>
        {useTransactionCards ? (
          <RecentTransactionCards transactions={transactions.slice(0, 5)} />
        ) : (
          <TransactionList transactions={transactions.slice(0, 5)} />
        )}
      </CardContent>
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
