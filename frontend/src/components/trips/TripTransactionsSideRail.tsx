"use client";

import { format } from "date-fns";
import { useRouter } from "next/navigation";
import type { WalletSummary } from "@/app/actions/trips";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import {
  AlertTriangle,
  Link2,
  Pencil,
  Trash2,
  Wallet,
  WalletCards,
} from "lucide-react";

interface TripTransactionsSideRailProps {
  tripId: string;
  fundingTransactions: Array<
    | {
        kind: "in";
        id: string;
        fundingId?: string;
        date: string;
        description: string;
        currency: string;
        amount: number;
        walletColor?: string;
        /** Set when the funding lost its bank transaction and needs relinking. */
        notice?: string;
      }
    | {
        kind: "out";
        id: string;
        date: string;
        description: string;
        currency: string;
        amount: number;
        walletColor?: string;
      }
  >;
  walletSummaries: WalletSummary[];
  onManageWallets: () => void;
  onEditFunding?: (fundingId: string) => void;
  onDeleteFunding?: (fundingId: string) => void;
  formatCurrencyValue: (value: number) => string;
}

export function TripTransactionsSideRail({
  tripId,
  fundingTransactions,
  walletSummaries,
  onManageWallets,
  onEditFunding,
  onDeleteFunding,
  formatCurrencyValue,
}: TripTransactionsSideRailProps) {
  const router = useRouter();

  return (
    <aside className="lg:order-2 min-h-0 min-w-0 w-full max-w-full overflow-hidden overflow-x-hidden flex flex-col lg:h-[calc(100vh-11rem)] lg:w-[22rem] lg:max-w-[22rem] lg:flex-none">
      <div className="grid h-full min-h-0 min-w-0 flex-1 gap-4 overflow-x-hidden lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-h-0 min-w-0 w-full max-w-full flex flex-col gap-2">
          <div className="flex min-w-0 w-full max-w-full items-center justify-between gap-2 px-1">
            <h3 className="truncate text-sm font-semibold text-dark dark:text-white">
              Funding Transactions
            </h3>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => router.push(`/trips/${tripId}/manage/funding`)}
              leftIcon={<Link2 className="h-4 w-4" />}
            >
              Manage
            </Button>
          </div>
          <Card className="min-h-0 min-w-0 w-full max-w-full flex-1 rounded-lg p-0 overflow-hidden">
            <CardContent className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden p-3 space-y-2">
              {fundingTransactions.length === 0 && (
                <div className="rounded-lg border border-dashed border-stroke dark:border-dark-3 px-3 py-4 text-sm text-dark-5 dark:text-dark-6">
                  No funding transactions yet.
                </div>
              )}
              {fundingTransactions.map((item) => (
                <div
                  key={item.id}
                  className="min-w-0 overflow-hidden rounded-lg border border-stroke dark:border-dark-3 px-3 py-2.5 text-xs bg-white dark:bg-dark-2"
                  style={{
                    borderLeftWidth: 4,
                    borderLeftColor: item.walletColor || "#ffffff",
                  }}
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-dark dark:text-white truncate">
                        {item.description || "Funding transaction"}
                      </div>
                      <div className="mt-1 text-dark-5 dark:text-dark-6 truncate">
                        {format(new Date(item.date), "dd MMM yyyy")} • {item.currency}
                      </div>
                      {item.kind === "in" && item.notice && (
                        <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          <span className="truncate">{item.notice}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-start gap-1.5">
                      <div
                        className={`max-w-[45%] shrink-0 truncate text-right font-semibold ${
                          item.kind === "in" ? "text-green" : "text-orange-500"
                        }`}
                      >
                        {item.kind === "in" ? "+" : "-"}
                        {formatCurrencyValue(item.amount)}
                      </div>
                      {item.kind === "in" && item.fundingId ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onEditFunding?.(item.fundingId as string)}
                            className="rounded-md border border-stroke p-1 text-dark-5 transition-colors hover:bg-gray-2 hover:text-dark dark:border-dark-3 dark:text-dark-6 dark:hover:bg-dark-3 dark:hover:text-white"
                            aria-label="Edit funding"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onDeleteFunding?.(item.fundingId as string)
                            }
                            className="rounded-md border border-stroke p-1 text-red transition-colors hover:bg-red/10 dark:border-dark-3"
                            aria-label="Delete funding"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="min-h-0 min-w-0 w-full max-w-full flex flex-col gap-2">
          <div className="flex min-w-0 w-full max-w-full items-center justify-between gap-2 px-1">
            <h3 className="truncate text-sm font-semibold text-dark dark:text-white">
              Wallets
            </h3>
            <Button
              variant="secondary"
              size="sm"
              onClick={onManageWallets}
              leftIcon={<WalletCards className="h-4 w-4" />}
              className="shrink-0 whitespace-nowrap"
            >
              Manage
            </Button>
          </div>
          <div className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden space-y-2 pr-1">
            {walletSummaries.length === 0 && (
              <div className="rounded-lg border border-dashed border-stroke dark:border-dark-3 px-3 py-4 text-sm text-dark-5 dark:text-dark-6">
                No wallets yet.
              </div>
            )}
            {walletSummaries.map((wallet) => (
              <div
                key={wallet.id}
                className="min-w-0 overflow-hidden rounded-lg border border-stroke dark:border-dark-3 px-3 py-2.5 bg-white dark:bg-dark-2"
                style={{
                  borderLeftWidth: 4,
                  borderLeftColor: wallet.color || "#ffffff",
                }}
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <Wallet className="h-4 w-4 shrink-0 text-dark-5 dark:text-dark-6" />
                      <span className="truncate text-sm font-medium text-dark dark:text-white">
                        {wallet.name}
                      </span>
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
                        {formatCurrencyValue(balance.amount)} {balance.currency}
                      </span>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
