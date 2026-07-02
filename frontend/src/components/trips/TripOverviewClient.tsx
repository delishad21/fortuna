"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import {
  CircleDollarSign,
  Landmark,
  PieChart as PieChartIcon,
  Plane,
  ReceiptText,
  TrendingDown,
  Wallet,
  WalletCards,
} from "lucide-react";
import {
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
import { format, parseISO } from "date-fns";
import {
  type Trip,
  type TripAnalytics,
  type WalletSummary,
} from "@/app/actions/trips";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { useHeaderConfig } from "@/components/Layouts/header-context";

interface TripOverviewClientProps {
  trip: Trip;
  initialAnalytics: TripAnalytics;
  initialWallets: WalletSummary[];
}

const formatCurrency = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);

const formatCompact = (amount: number) =>
  new Intl.NumberFormat("en-SG", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(amount);

const sectionTitleClass =
  "inline-flex items-center gap-2 text-sm font-semibold text-dark dark:text-white";
const sectionIconClass = "h-4 w-4 shrink-0 text-primary";

const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-SG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

export function TripOverviewClient({
  trip,
  initialAnalytics,
  initialWallets = [],
}: TripOverviewClientProps) {
  const { setHeaderConfig } = useHeaderConfig();

  useEffect(() => {
    setHeaderConfig({
      title: trip.name,
      showBack: true,
      backHref: "/trips",
    });
    return () => setHeaderConfig(null);
  }, [setHeaderConfig, trip.name]);

  const analytics = initialAnalytics;
  const wallets = initialWallets;

  const lineData = useMemo(
    () =>
      analytics.dailySeries.map((item) => ({
        ...item,
        label: format(parseISO(String(item.date)), "dd MMM"),
      })),
    [analytics.dailySeries],
  );

  const pieData = useMemo(() => {
    const top = analytics.categoryBreakdown.slice(0, 7);
    const other = analytics.categoryBreakdown.slice(7);
    const otherTotal = other.reduce((sum, item) => sum + item.totalOut, 0);

    const result = top.map((item) => ({
      name: item.category?.name || "Uncategorized",
      value: item.totalOut,
      color: item.category?.color || "#94a3b8",
    }));

    if (otherTotal > 0) {
      result.push({
        name: "Others",
        value: otherTotal,
        color: "#64748b",
      });
    }

    return result;
  }, [analytics.categoryBreakdown]);

  const highlightSections = [
    {
      key: "flights",
      title: "Flights",
      icon: Plane,
      total: analytics.highlights.flights,
      transactions: analytics.highlightTransactions.flights,
    },
    {
      key: "accommodations",
      title: "Accommodations",
      icon: Landmark,
      total: analytics.highlights.accommodations,
      transactions: analytics.highlightTransactions.accommodations,
    },
    {
      key: "attractions",
      title: "Attractions",
      icon: ReceiptText,
      total: analytics.highlights.attractions,
      transactions: analytics.highlightTransactions.attractions,
    },
  ] as const;

  const summaryCards = [
    {
      key: "net",
      title: "Net Trip Cost",
      icon: TrendingDown,
      value: analytics.totals.netTripCost,
      borderClass: "border-primary/50 dark:border-primary/60",
      iconWrapClass: "bg-primary/10 text-primary dark:bg-primary/20",
      valueClass: "text-primary",
    },
    {
      key: "spent",
      title: "Total Spent",
      icon: ReceiptText,
      value: analytics.totals.totalSpent,
      borderClass: "border-red/40 dark:border-red/60",
      iconWrapClass: "bg-red/10 text-red dark:bg-red/15",
      valueClass: "text-red",
    },
    {
      key: "funding-in",
      title: "Funding In",
      icon: CircleDollarSign,
      value: analytics.totals.totalFundingIn ?? analytics.totals.totalFunding,
      borderClass: "border-green/40 dark:border-green/60",
      iconWrapClass: "bg-green/10 text-green dark:bg-green/15",
      valueClass: "text-green",
    },
    {
      key: "funding-out",
      title: "Funding Out",
      icon: Wallet,
      value: analytics.totals.totalFundingOut ?? 0,
      borderClass: "border-amber-400/40 dark:border-amber-400/60",
      iconWrapClass: "bg-amber-500/10 text-amber-500 dark:bg-amber-500/15",
      valueClass: "text-amber-500",
    },
  ] as const;

  const categoryTotal = pieData.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="flex min-h-full flex-col gap-5">
      <section className="grid items-stretch gap-5 xl:grid-cols-[minmax(280px,0.95fr)_minmax(0,1.55fr)]">
        <div className="grid gap-3">
          {summaryCards.map((item) => (
            <Card
              key={item.key}
              className={`rounded-xl border ${item.borderClass} bg-white dark:bg-gray-dark`}
            >
              <CardContent className="flex items-center justify-between gap-4 px-4 py-3.5">
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-lg ${item.iconWrapClass}`}
                  >
                    <item.icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                      {item.title}
                    </p>
                  </div>
                </div>
                <div
                  className={`text-right text-[1.45rem] font-semibold leading-none ${item.valueClass}`}
                >
                  {formatCurrency(item.value, trip.baseCurrency)}
                </div>
              </CardContent>
            </Card>
          ))}
          <Link href={`/trips/${trip.id}/details`} className="block">
            <Button variant="secondary" className="w-full">
              Manage Details
            </Button>
          </Link>
          <Link href={`/trips/${trip.id}/manage`} className="block">
            <Button variant="primary" className="w-full">
              Transactions
            </Button>
          </Link>
        </div>

        <Card className="flex h-full min-h-[220px] flex-col rounded-xl border border-stroke dark:border-dark-3">
          <CardHeader className="mb-3 flex items-center justify-between gap-3 pb-0">
            <CardTitle className={sectionTitleClass}>
              <WalletCards className={sectionIconClass} />
              Wallet Balances
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 overflow-y-auto pr-1">
            <div className="grid gap-2.5 md:grid-cols-2">
              {wallets.length === 0 && (
                <div className="col-span-full rounded-lg border border-dashed border-stroke px-3 py-4 text-sm text-dark-5 dark:border-dark-3 dark:text-dark-6">
                  No wallets yet. Use manage page to create trip wallets.
                </div>
              )}
              {wallets.map((wallet) => (
                <div
                  key={wallet.id}
                  className="rounded-lg border border-stroke/90 bg-gray-1/40 px-3 py-2.5 dark:border-dark-3 dark:bg-dark-2/60"
                  style={{
                    borderLeftWidth: 4,
                    borderLeftColor: wallet.color || "#ffffff",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex items-center gap-2">
                      <Wallet className="h-4 w-4 shrink-0 text-dark-5 dark:text-dark-6" />
                      <div className="truncate text-sm font-semibold text-dark dark:text-white">
                        {wallet.name}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-stroke px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-dark-5 dark:border-dark-3 dark:text-dark-6">
                      {wallet.currency}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    {wallet.balances.length === 0 ? (
                      <span className="text-dark-5 dark:text-dark-6">No balance yet</span>
                    ) : (
                      wallet.balances.map((balance, index) => (
                        <span
                          key={`${wallet.id}:${balance.currency}:${index}`}
                          className={
                            balance.amount >= 0
                              ? "text-green"
                              : "text-red dark:text-red-light"
                          }
                        >
                          {formatCompact(balance.amount)} {balance.currency}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.95fr)]">
        <div className="grid min-h-[680px] grid-rows-3 gap-4">
          {highlightSections.map((section) => (
            <Card
              key={section.key}
              className="flex min-h-0 flex-col rounded-xl border border-stroke dark:border-dark-3"
            >
              <CardHeader className="mb-3 flex items-center justify-between gap-3 pb-0">
                <CardTitle className={sectionTitleClass}>
                  <section.icon className={sectionIconClass} />
                  {section.title}
                </CardTitle>
                <span className="text-sm font-semibold text-dark dark:text-white">
                  {formatCurrency(section.total, trip.baseCurrency)}
                </span>
              </CardHeader>
              <CardContent className="flex-1 min-h-0">
                <div className="h-full space-y-2 overflow-y-auto pr-1">
                  {section.transactions.map((tx) => (
                    <div
                      key={tx.id}
                      className="rounded-lg border border-stroke/90 bg-gray-1/35 px-3 py-2.5 dark:border-dark-3 dark:bg-dark-2/65"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-dark dark:text-white">
                            {tx.label?.trim() || tx.description}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-dark-5 dark:text-dark-6">
                            {format(parseISO(String(tx.date)), "dd MMM yyyy")} •{" "}
                            {tx.walletName}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-[11px] font-medium text-dark dark:text-white">
                          {formatCompact(tx.localAmount)} {tx.localCurrency}
                        </div>
                      </div>
                    </div>
                  ))}
                  {section.transactions.length === 0 && (
                    <div className="rounded-lg border border-dashed border-stroke px-3 py-4 text-xs text-dark-5 dark:border-dark-3 dark:text-dark-6">
                      No transactions in this category yet.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="flex min-h-[680px] flex-col rounded-xl border border-stroke dark:border-dark-3">
          <CardHeader className="mb-3 flex items-center justify-between gap-3 pb-0">
            <CardTitle className={sectionTitleClass}>
              <PieChartIcon className={sectionIconClass} />
              Spending By Category
            </CardTitle>
            <span className="text-xs font-medium text-dark-5 dark:text-dark-6">
              Total {formatCurrency(categoryTotal, trip.baseCurrency)}
            </span>
          </CardHeader>
          <CardContent className="flex flex-1 min-h-0 flex-col gap-4">
            <div className="h-[330px] min-h-[330px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={56}
                    outerRadius={90}
                    paddingAngle={3}
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) =>
                      formatCurrency(Number(value), trip.baseCurrency)
                    }
                    contentStyle={{
                      backgroundColor: "var(--color-white)",
                      border: "1px solid var(--color-stroke)",
                      borderRadius: 10,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {pieData.map((item) => {
                const ratio = categoryTotal > 0 ? (item.value / categoryTotal) * 100 : 0;
                return (
                  <div
                    key={item.name}
                    className="flex items-center justify-between rounded-md px-1.5 py-1"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="truncate text-sm text-dark dark:text-white">
                        {item.name}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-dark dark:text-white">
                        {formatCurrency(item.value, trip.baseCurrency)}
                      </div>
                      <div className="text-[11px] text-dark-5 dark:text-dark-6">
                        {ratio.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </section>

      <Card className="min-h-[360px] rounded-xl border border-stroke dark:border-dark-3">
        <CardHeader className="flex items-center justify-between">
          <CardTitle className={sectionTitleClass}>
            <TrendingDown className={sectionIconClass} />
            Trip Spending Trend
          </CardTitle>
        </CardHeader>
        <CardContent className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lineData}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--color-stroke)"
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: "var(--color-dark-5)" }}
              />
              <YAxis tick={{ fontSize: 12, fill: "var(--color-dark-5)" }} />
              <Tooltip
                formatter={(value: number) =>
                  formatCurrency(Number(value), trip.baseCurrency)
                }
                contentStyle={{
                  backgroundColor: "var(--color-white)",
                  border: "1px solid var(--color-stroke)",
                  borderRadius: 8,
                }}
              />
              <Line
                type="monotone"
                dataKey="spending"
                stroke="#F23030"
                strokeWidth={2}
                dot={false}
                name="Spendings"
              />
              <Line
                type="monotone"
                dataKey="reimbursement"
                stroke="#22AD5C"
                strokeWidth={2}
                dot={false}
                name="Reimbursements"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
