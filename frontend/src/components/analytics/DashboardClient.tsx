"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { ArrowRight, CheckCircle2, FileText, Upload } from "lucide-react";
import { getDashboardOverview } from "@/app/actions/analytics";
import { updateTransaction } from "@/app/actions/transactions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CategorySelect } from "@/components/ui/CategorySelect";
import { PageTabs } from "@/components/ui/PageTabs";
import { ImportSummaryCard } from "@/components/analytics/ImportSummaryCard";
import { TransactionCard } from "@/components/transactions/TransactionCard";
import {
  BarList,
  ChartTooltip,
  SpendingPie,
  accountMaps,
  toCardTransaction,
  type AccountInfo,
  type CardSource,
  barSizeFor,
  Delta,
  EmptyText,
  MonthSwitcher,
  SectionCard,
  StatCard,
  TransactionRows,
  formatCurrency,
  formatDay,
  formatMonth,
  type CompactTransaction,
} from "@/components/analytics/parts";
import { cn } from "@/lib/utils";

type Category = { id: string; name: string; color: string };

type OverviewData = {
  selectedMonth: string | null;
  importedMonths: Array<{ month: string; transactionCount: number }>;
  summary: {
    totalIn: number;
    totalOut: number;
    net: number;
    transactionCount: number;
    previousMonth: { month: string; totalOut: number; spendingDelta: number } | null;
  };
  trend: Array<{ month: string; totalIn: number; totalOut: number; net: number }>;
  spendingByCategory?: Array<{ key: string; name: string; color: string; totalOut: number; transactionCount: number; previousTotalOut: number }>;
  largestExpenses?: CardSource[];
  attention?: { stagedImports: number; stagedRows: number; uncategorizedCount: number };
  hasTransactions: boolean;
};

type CoverageAccount = {
  accountIdentifier: string | null;
  label: string;
  color: string;
  months: Array<{ month: string; transactionCount: number; tracked: boolean }>;
  missingMonths: string[];
};

type ReviewData = {
  reviewQueue: {
    uncategorized: CompactTransaction[];
    newMerchants: Array<{ key: string; name: string; totalOut?: number; totalIn?: number; transactionCount?: number }>;
    newMerchantsMonth?: string | null;
  };
  stagedImports?: Array<{ id: string; filename: string; rowCount: number; updatedAt: string }>;
  coverage?: { months: string[]; accounts: CoverageAccount[] };
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
  };
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function DashboardClient({
  initialOverview,
  initialReview,
  categories,
  accounts = [],
}: {
  initialOverview: OverviewData;
  initialReview: ReviewData;
  categories: Category[];
  accounts?: AccountInfo[];
}) {
  const [activeTab, setActiveTab] = useState<"overview" | "review">("overview");
  const [overview, setOverview] = useState(initialOverview);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [uncategorized, setUncategorized] = useState(initialReview.reviewQueue.uncategorized);
  const categorisedNow = initialReview.reviewQueue.uncategorized.length - uncategorized.length;
  const uncategorizedCount = Math.max(initialReview.dataHealth.uncategorizedCount - categorisedNow, 0);
  const stagedImports = initialReview.stagedImports || [];
  const reviewCount = uncategorizedCount + stagedImports.length;

  const changeMonth = async (month: string) => {
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
        <OverviewTab overview={overview} loading={loadingMonth} onMonthChange={changeMonth} accounts={accounts} />
      ) : (
        <ReviewTab
          data={initialReview}
          categories={categories}
          uncategorized={uncategorized}
          setUncategorized={setUncategorized}
          uncategorizedCount={uncategorizedCount}
          categorisedNow={categorisedNow}
        />
      )}
    </div>
  );
}

function NoData({ title, description }: { title: string; description: string }) {
  return (
    <Card className="flex flex-col items-center gap-3 py-12 text-center">
      <FileText className="size-10 text-dark-4" />
      <div>
        <h3 className="font-semibold text-dark dark:text-white">{title}</h3>
        <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">{description}</p>
      </div>
      <Link href="/imports">
        <Button leftIcon={<Upload className="size-4" />}>Import Statement</Button>
      </Link>
    </Card>
  );
}

function OverviewTab({
  overview,
  loading,
  onMonthChange,
  accounts,
}: {
  overview: OverviewData;
  loading: boolean;
  onMonthChange: (month: string) => void;
  accounts: AccountInfo[];
}) {
  const trend = useMemo(
    () => overview.trend.map((item) => ({ ...item, label: formatMonth(item.month, "MMM") })),
    [overview.trend],
  );

  if (!overview.hasTransactions) {
    return <NoData title="No transactions imported yet" description="Import a statement to see your monthly overview." />;
  }
  if (!overview.selectedMonth) {
    return <NoData title="No complete statement month yet" description="A month appears once it has transactions after the 15th." />;
  }

  const { summary } = overview;
  const previous = summary.previousMonth;
  const savingsRate = summary.totalIn > 0 ? Math.round((summary.net / summary.totalIn) * 100) : null;
  const categories = overview.spendingByCategory || [];
  const largest = overview.largestExpenses || [];
  const { colors: accountColors, names: accountNames } = accountMaps(accounts);

  return (
    <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-60")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-dark dark:text-white">{formatMonth(overview.selectedMonth, "MMMM yyyy")}</h2>
        <MonthSwitcher
          months={overview.importedMonths.map((item) => item.month)}
          value={overview.selectedMonth}
          onChange={onMonthChange}
          loading={loading}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Income" value={formatCurrency(summary.totalIn)} tone="good" />
        <StatCard
          label="Spending"
          value={formatCurrency(summary.totalOut)}
          tone="bad"
          sub={previous ? <Delta value={previous.spendingDelta} previous={previous.totalOut} suffix={`vs ${formatMonth(previous.month, "MMM")}`} /> : "No earlier month to compare"}
        />
        <StatCard
          label="Net flow"
          value={formatCurrency(summary.net, { signed: true })}
          tone={summary.net >= 0 ? "good" : "bad"}
          sub={savingsRate === null ? "No income this month" : `${savingsRate}% of income kept`}
        />
        <StatCard label="Transactions" value={String(summary.transactionCount)} sub={largest[0] ? `Largest: ${largest[0].label || largest[0].description}` : undefined} />
      </div>

      <SectionCard title="Income and spending" action={<span className="text-xs text-dark-5 dark:text-dark-6">Click a month to open it</span>}>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={trend}
              barGap={4}
              barCategoryGap="28%"
              style={{ cursor: "pointer" }}
              onClick={(state) => {
                const month = (state?.activePayload?.[0]?.payload as { month?: string } | undefined)?.month;
                if (month && month !== overview.selectedMonth) onMonthChange(month);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--chart-muted)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "var(--chart-muted)" }} axisLine={false} tickLine={false} width={56} tickFormatter={(value: number) => (value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(value))} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--chart-grid)", opacity: 0.4 }} />
              <Bar dataKey="totalIn" name="Income" fill="#22AD5C" radius={[4, 4, 0, 0]} maxBarSize={barSizeFor(trend.length * 2)}>
                {trend.map((item) => (
                  <Cell key={item.month} fill="#22AD5C" fillOpacity={item.month === overview.selectedMonth ? 1 : 0.35} />
                ))}
              </Bar>
              <Bar dataKey="totalOut" name="Spending" fill="#F23030" radius={[4, 4, 0, 0]} maxBarSize={barSizeFor(trend.length * 2)}>
                {trend.map((item) => (
                  <Cell key={item.month} fill="#F23030" fillOpacity={item.month === overview.selectedMonth ? 1 : 0.35} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <SectionCard title="Spending by category">
          {categories.length === 0 ? (
            <EmptyText>No spending this month.</EmptyText>
          ) : (
            <div className="grid items-center gap-6 md:grid-cols-[minmax(200px,260px)_1fr]">
              <SpendingPie
                total={summary.totalOut}
                rows={categories.map((item) => ({ key: item.key, name: item.name, color: item.color, value: item.totalOut }))}
              />
              <BarList
                limit={8}
                valueTone="bad"
                rows={categories.map((item) => ({
                  key: item.key,
                  name: item.name,
                  color: item.color,
                  value: item.totalOut,
                  helper: plural(item.transactionCount, "transaction"),
                  trailing: previous ? (
                    item.previousTotalOut ? (
                      <Delta value={item.totalOut - item.previousTotalOut} previous={item.previousTotalOut} />
                    ) : (
                      "New this month"
                    )
                  ) : null,
                }))}
              />
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Largest expenses"
          action={
            <Link href="/transactions" className="text-sm font-medium">
              <span className="text-primary">All transactions</span>
            </Link>
          }
        >
          {largest.length === 0 ? (
            <EmptyText>No expenses this month.</EmptyText>
          ) : (
            <div className="space-y-3">
              {largest.map((tx) => {
                const card = toCardTransaction(tx);
                return (
                  <TransactionCard
                    key={card.id}
                    transaction={card}
                    accountColor={card.accountIdentifier ? accountColors[card.accountIdentifier] : undefined}
                    accountName={card.accountIdentifier ? accountNames[card.accountIdentifier] : undefined}
                    showDate
                  />
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function ReviewTab({
  data,
  categories,
  uncategorized,
  setUncategorized,
  uncategorizedCount,
  categorisedNow,
}: {
  data: ReviewData;
  categories: Category[];
  uncategorized: CompactTransaction[];
  setUncategorized: React.Dispatch<React.SetStateAction<CompactTransaction[]>>;
  uncategorizedCount: number;
  categorisedNow: number;
}) {
  const router = useRouter();
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const health = data.dataHealth;
  const categorisedPercent = health.transactionCount
    ? Math.round(((health.categorizedCount + categorisedNow) / health.transactionCount) * 100)
    : 0;
  const stagedImports = data.stagedImports || [];
  const coverage = data.coverage;
  const newMerchants = data.reviewQueue.newMerchants;
  const visibleUncategorized = showAll ? uncategorized : uncategorized.slice(0, 10);

  const categorise = async (tx: CompactTransaction, categoryId: string) => {
    if (!categoryId) return;
    setError(null);
    setSavingIds((prev) => new Set(prev).add(tx.id));
    try {
      await updateTransaction(tx.id, { categoryId });
      setUncategorized((prev) => prev.filter((item) => item.id !== tx.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update category");
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(tx.id);
        return next;
      });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {error ? <div className="rounded-lg bg-red/10 px-4 py-3 text-sm text-red">{error}</div> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5">
          <p className="text-sm font-medium text-dark-5 dark:text-dark-6">Categorised</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-dark dark:text-white">{categorisedPercent}%</p>
          <div className="mt-2 h-1.5 rounded-full bg-gray-2 dark:bg-dark-3">
            <div className="h-1.5 rounded-full bg-primary" style={{ width: `${categorisedPercent}%` }} />
          </div>
        </Card>
        <StatCard label="Without a category" value={String(uncategorizedCount)} tone={uncategorizedCount ? "bad" : "default"} sub={`of ${health.transactionCount} transactions`} />
        <StatCard label="Staged imports" value={String(stagedImports.length)} tone={stagedImports.length ? "primary" : "default"} sub={stagedImports.length ? "Waiting to be committed" : "Nothing waiting"} />
        <StatCard label="Import rules" value={String(health.ruleCount)} sub={<Link href="/settings"><span className="text-primary">Manage rules</span></Link>} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <SectionCard
          title={`Without a category${uncategorizedCount ? ` (${uncategorizedCount})` : ""}`}
          action={
            uncategorized.length > 10 ? (
              <button type="button" onClick={() => setShowAll((value) => !value)} className="text-sm font-medium text-primary">
                {showAll ? "Show fewer" : `Show all ${uncategorized.length}`}
              </button>
            ) : null
          }
        >
          {uncategorized.length === 0 ? (
            <div className="flex items-center gap-3 rounded-lg bg-green/5 p-4">
              <CheckCircle2 className="size-6 shrink-0 text-green" />
              <p className="text-sm text-dark dark:text-white">Every transaction has a category.</p>
            </div>
          ) : (
            <>
              <p className="mb-2 text-xs text-dark-5 dark:text-dark-6">Tab into a category and type its first letters to pick it.</p>
              <TransactionRows
                transactions={visibleUncategorized}
                renderAside={(tx) => (
                  <div className="flex shrink-0 items-center gap-3">
                    <span className={cn("hidden text-sm font-semibold tabular-nums sm:inline", tx.amountIn > 0 ? "text-green" : "text-red")}>
                      {tx.amountIn > 0 ? `+${formatCurrency(tx.amountIn)}` : `-${formatCurrency(tx.amountOut)}`}
                    </span>
                    <div className="w-44">
                      <CategorySelect
                        value=""
                        categories={categories}
                        onChange={(categoryId) => void categorise(tx, categoryId)}
                        onAddClick={() => router.push("/settings")}
                        disabled={savingIds.has(tx.id)}
                        excludeReserved
                        emptyLabel={savingIds.has(tx.id) ? "Saving…" : "Choose category"}
                        triggerProps={{ className: "py-2" }}
                      />
                    </div>
                  </div>
                )}
              />
            </>
          )}
        </SectionCard>

        <div className="flex flex-col gap-6">
          <SectionCard title="Staged imports">
            {stagedImports.length === 0 ? (
              <EmptyText>No imports waiting to be committed.</EmptyText>
            ) : (
              <div className="divide-y divide-stroke dark:divide-stroke-dark">
                {stagedImports.map((draft) => (
                  <Link key={draft.id} href={`/imports/drafts/${draft.id}`} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-dark dark:text-white">{draft.filename}</p>
                      <p className="mt-0.5 text-xs text-dark-5 dark:text-dark-6">
                        {plural(draft.rowCount, "row")} · staged {formatDay(draft.updatedAt)}
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
                      Review <ArrowRight className="size-4" />
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title={`New merchants${data.reviewQueue.newMerchantsMonth ? ` in ${formatMonth(data.reviewQueue.newMerchantsMonth, "MMMM")}` : ""}`}>
            {newMerchants.length === 0 ? (
              <EmptyText>No first-time merchants this month.</EmptyText>
            ) : (
              <div className="divide-y divide-stroke dark:divide-stroke-dark">
                {newMerchants.map((merchant) => (
                  <div key={merchant.key} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-dark dark:text-white">{merchant.name}</p>
                      {merchant.transactionCount ? <p className="mt-0.5 text-xs text-dark-5 dark:text-dark-6">{plural(merchant.transactionCount, "transaction")}</p> : null}
                    </div>
                    {merchant.totalOut ? <span className="shrink-0 text-sm font-semibold tabular-nums text-red">-{formatCurrency(merchant.totalOut)}</span> : null}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {coverage && coverage.accounts.length > 0 ? <CoverageCard coverage={coverage} /> : null}

      <SectionCard
        title="Recent imports"
        action={
          <Link href="/imports?tab=history">
            <Button variant="secondary" size="sm" rightIcon={<ArrowRight className="size-4" />}>View all</Button>
          </Link>
        }
      >
        {data.importSummaries.length === 0 ? (
          <EmptyText>No imported files yet.</EmptyText>
        ) : (
          <div className="space-y-3">
            {data.importSummaries.slice(0, 4).map((item) => (
              <ImportSummaryCard key={item.key} item={item} />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function CoverageCard({ coverage }: { coverage: NonNullable<ReviewData["coverage"]> }) {
  return (
    <SectionCard
      title="Statement coverage"
      action={
        <div className="hidden items-center gap-4 text-xs text-dark-5 sm:flex dark:text-dark-6">
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-sm bg-primary/70" />Has transactions</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-sm border border-dashed border-red bg-red/10" />Missing</span>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th className="w-48 text-left font-medium text-dark-5 dark:text-dark-6" />
              {coverage.months.map((month) => (
                <th key={month} className="font-medium text-dark-5 dark:text-dark-6">
                  {formatMonth(month, "MMM")}
                  <span className="block text-[10px] font-normal opacity-70">{formatMonth(month, "yy")}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {coverage.accounts.map((account) => (
              <tr key={account.label}>
                <td className="pr-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-dark dark:text-white">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: account.color }} />
                    <span className="truncate">{account.label}</span>
                  </span>
                </td>
                {account.months.map((cell) => (
                  <td key={cell.month} className="p-0">
                    <div
                      title={`${formatMonth(cell.month)}: ${cell.transactionCount ? plural(cell.transactionCount, "transaction") : cell.tracked ? "missing" : "before this account's first statement"}`}
                      className={cn(
                        "flex h-8 items-center justify-center rounded-md tabular-nums",
                        cell.transactionCount
                          ? "bg-primary/70 font-semibold text-white"
                          : cell.tracked
                            ? "border border-dashed border-red bg-red/10 text-red"
                            : "bg-gray-2 dark:bg-dark-3",
                      )}
                    >
                      {cell.transactionCount || (cell.tracked ? "–" : "")}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
