"use client";

import { useEffect } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { HandCoins, ReceiptText, Users } from "lucide-react";
import type { Trip } from "@/app/actions/trips";
import type { TripSharedOverview } from "@/app/actions/tripSharing";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { useHeaderConfig } from "@/components/Layouts/header-context";

interface TripSharedOverviewClientProps {
  trip: Trip;
  overview: TripSharedOverview | null;
  /** Why the overview couldn't load, e.g. the trip isn't shared. */
  error?: string | null;
}

const formatCurrency = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-SG", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};

const sectionTitleClass =
  "inline-flex items-center gap-2 text-sm font-semibold text-dark dark:text-white";
const sectionIconClass = "h-4 w-4 shrink-0 text-primary";
const headCellClass =
  "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6";
const cellClass = "px-3 py-2 text-sm text-dark dark:text-white";

/** What everyone on a shared trip sees: combined totals, who owes whom, and all entries. */
export function TripSharedOverviewClient({
  trip,
  overview,
  error,
}: TripSharedOverviewClientProps) {
  const { setHeaderConfig } = useHeaderConfig();

  useEffect(() => {
    setHeaderConfig({
      title: `${trip.name} · Shared`,
      showBack: true,
      backHref: `/trips/${trip.id}`,
    });
    return () => setHeaderConfig(null);
  }, [setHeaderConfig, trip.id, trip.name]);

  if (!overview) {
    return (
      <div className="max-w-3xl space-y-3">
        <div className="rounded-lg border border-dashed border-stroke px-4 py-6 text-sm text-dark-5 dark:border-dark-3 dark:text-dark-6">
          {error || "This trip isn't shared."}
        </div>
        <Link href={`/trips/${trip.id}/details`}>
          <Button variant="secondary">Share from trip details</Button>
        </Link>
      </div>
    );
  }

  const currency = overview.baseCurrency;
  const money = (value: number) => formatCurrency(value, currency);
  const summaryCards = [
    { key: "spent", title: "Spent together", value: overview.totals.combinedSpent, valueClass: "text-red" },
    { key: "reimbursed", title: "Reimbursed", value: overview.totals.combinedReimbursed, valueClass: "text-green" },
    { key: "net", title: "Net trip cost", value: overview.totals.combinedNet, valueClass: "text-primary" },
  ];

  return (
    <div className="flex min-h-full flex-col gap-5">
      <section className="grid gap-3 md:grid-cols-3">
        {summaryCards.map((card) => (
          <Card
            key={card.key}
            className="rounded-xl border border-stroke dark:border-dark-3"
          >
            <CardContent className="flex items-center justify-between gap-4 px-4 py-3.5">
              <p className="truncate text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                {card.title}
              </p>
              <div className={`text-right text-[1.35rem] font-semibold leading-none ${card.valueClass}`}>
                {money(card.value)}
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
        <Card className="rounded-xl border border-stroke dark:border-dark-3">
          <CardHeader className="mb-3 flex items-center justify-between gap-3 pb-0">
            <CardTitle className={sectionTitleClass}>
              <Users className={sectionIconClass} />
              Members
            </CardTitle>
            <span className="text-xs text-dark-5 dark:text-dark-6">
              Totals in {currency}
            </span>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead className="border-b border-stroke dark:border-dark-3">
                <tr>
                  <th className={headCellClass}>Member</th>
                  <th className={`${headCellClass} text-right`}>Paid</th>
                  <th className={`${headCellClass} text-right`}>Shared to others</th>
                  <th className={`${headCellClass} text-right`}>Shares received</th>
                  <th className={`${headCellClass} text-right`}>Reimbursed</th>
                  <th className={`${headCellClass} text-right`}>Net</th>
                </tr>
              </thead>
              <tbody>
                {overview.totals.members.map((row) => (
                  <tr
                    key={row.userId}
                    className="border-b border-stroke/60 last:border-0 dark:border-dark-3/60"
                  >
                    <td className={`${cellClass} font-medium`}>{row.name}</td>
                    <td className={`${cellClass} text-right`}>{money(row.paid)}</td>
                    <td className={`${cellClass} text-right`}>
                      {row.sharesGiven ? `−${money(row.sharesGiven)}` : "—"}
                    </td>
                    <td className={`${cellClass} text-right`}>
                      {row.sharesReceived ? `+${money(row.sharesReceived)}` : "—"}
                    </td>
                    <td className={`${cellClass} text-right`}>
                      {row.reimbursed ? `−${money(row.reimbursed)}` : "—"}
                    </td>
                    <td className={`${cellClass} text-right font-semibold`}>
                      {money(row.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {overview.members.some((member) => member.status === "invited") && (
              <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                Invited, not joined yet:{" "}
                {overview.members
                  .filter((member) => member.status === "invited")
                  .map((member) => member.name)
                  .join(", ")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl border border-stroke dark:border-dark-3">
          <CardHeader className="mb-3 pb-0">
            <CardTitle className={sectionTitleClass}>
              <HandCoins className={sectionIconClass} />
              Settle up
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {overview.settleUp.length === 0 && (
              <div className="rounded-lg border border-dashed border-stroke px-3 py-4 text-sm text-dark-5 dark:border-dark-3 dark:text-dark-6">
                Nobody owes anyone.
              </div>
            )}
            {overview.settleUp.map((row) => (
              <div
                key={`${row.from.userId}:${row.to.userId}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-stroke/90 bg-gray-1/40 px-3 py-2.5 text-sm dark:border-dark-3 dark:bg-dark-2/60"
              >
                <span className="min-w-0 truncate text-dark dark:text-white">
                  <span className="font-medium">{row.from.name}</span> owes{" "}
                  <span className="font-medium">{row.to.name}</span>
                </span>
                <span className="shrink-0 font-semibold text-dark dark:text-white">
                  {money(row.amountBase)}
                </span>
              </div>
            ))}
            {overview.settleUp.length > 0 && (
              <p className="text-xs text-dark-5 dark:text-dark-6">
                Whoever pays records it as a settlement in their own
                transactions.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <Card className="rounded-xl border border-stroke dark:border-dark-3">
        <CardHeader className="mb-3 flex items-center justify-between gap-3 pb-0">
          <CardTitle className={sectionTitleClass}>
            <ReceiptText className={sectionIconClass} />
            All entries
          </CardTitle>
          <span className="text-xs text-dark-5 dark:text-dark-6">
            {overview.entries.length} entries
          </span>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {overview.entries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-stroke px-3 py-4 text-sm text-dark-5 dark:border-dark-3 dark:text-dark-6">
              No spending yet.
            </div>
          ) : (
            <table className="w-full min-w-[640px]">
              <thead className="border-b border-stroke dark:border-dark-3">
                <tr>
                  <th className={headCellClass}>Date</th>
                  <th className={headCellClass}>Member</th>
                  <th className={headCellClass}>Entry</th>
                  <th className={`${headCellClass} text-right`}>Amount</th>
                  <th className={headCellClass}>Shares</th>
                </tr>
              </thead>
              <tbody>
                {overview.entries.map((entry) => {
                  const isForeign =
                    entry.localCurrency.toUpperCase() !== currency.toUpperCase();
                  const signed = entry.type === "reimbursement" ? "+" : "";
                  return (
                    <tr
                      key={entry.id}
                      className="border-b border-stroke/60 align-top last:border-0 dark:border-dark-3/60"
                    >
                      <td className={`${cellClass} whitespace-nowrap text-dark-5 dark:text-dark-6`}>
                        {format(new Date(entry.date), "dd MMM")}
                      </td>
                      <td className={`${cellClass} whitespace-nowrap`}>{entry.member.name}</td>
                      <td className={cellClass}>
                        <div className="font-medium">{entry.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-dark-5 dark:text-dark-6">
                          {entry.type === "reimbursement" ? (
                            <span>Reimbursement</span>
                          ) : entry.category ? (
                            <span className="inline-flex items-center gap-1">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: entry.category.color || "#94a3b8" }}
                              />
                              {entry.category.name}
                            </span>
                          ) : null}
                          {entry.isShare && entry.owedTo && (
                            <span>Share, owed to {entry.owedTo}</span>
                          )}
                          {!entry.isShare && entry.owedTo && (
                            <span>Owed to {entry.owedTo}</span>
                          )}
                        </div>
                      </td>
                      <td className={`${cellClass} whitespace-nowrap text-right`}>
                        <div className={entry.type === "reimbursement" ? "text-green" : ""}>
                          {signed}
                          {money(entry.baseAmount)}
                        </div>
                        {isForeign && (
                          <div className="text-xs text-dark-5 dark:text-dark-6">
                            {formatCurrency(entry.localAmount, entry.localCurrency)}
                          </div>
                        )}
                      </td>
                      <td className={`${cellClass} text-xs text-dark-5 dark:text-dark-6`}>
                        {entry.shares.length === 0
                          ? "—"
                          : entry.shares
                              .map((share) => `${share.name} ${money(share.baseAmount)}`)
                              .join(", ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
