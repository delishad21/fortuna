"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  Trash2,
  ArrowLeftRight,
  Receipt,
  Link2,
  Plane,
} from "lucide-react";
import { Checkbox } from "@/components/ui/Checkbox";
import Link from "next/link";

export interface TransactionLinkage {
  type: "internal" | "reimbursement" | "reimbursed";
  reimbursesAllocations?: Array<{
    transactionId?: string;
    pendingBatchIndex?: number;
    amount: number;
  }>;
  reimbursedByAllocations?: Array<{
    transactionId: string;
    amount: number;
  }>;
  autoDetected?: boolean;
  detectionReason?: string;
}

export interface LinkedTransaction {
  id: string;
  date: string;
  label?: string | null;
  description: string;
  amountIn: number | null;
  amountOut: number | null;
  reimbursementAmount?: number | null;
}

export interface TransactionCardTransaction {
  id: string;
  date: string;
  description: string;
  label?: string;
  amountIn: number | null;
  amountOut: number | null;
  balance: number | null;
  currency?: string | null;
  displayCurrency?: string;
  accountIdentifier?: string | null;
  category?: {
    id: string;
    name: string;
    color: string;
  };
  tripFundings?: Array<{
    id: string;
    trip: { id: string; name: string };
  }>;
  metadata?: Record<string, any>;
  linkage?: TransactionLinkage | null;
  accentColor?: string;
  secondaryAmount?: {
    value: number;
    currency: string;
    direction?: "in" | "out";
    label?: string;
    muted?: boolean;
  };
}

interface TransactionCardProps {
  transaction: TransactionCardTransaction;
  accountColor?: string;
  accentColor?: string;
  className?: string;
  wrapText?: boolean;
  onEdit?: (transaction: TransactionCardTransaction) => void;
  onDelete?: (id: string) => void;
  selected?: boolean;
  selectionTone?: "primary" | "success";
  onToggleSelect?: () => void;
  linkedTransactions?: {
    reimburses: LinkedTransaction[];
    reimbursedBy: LinkedTransaction[];
  };
}

export type TransactionCardPrimaryClickAction =
  | "toggle-selection"
  | "toggle-expansion";

export const getTransactionCardPrimaryClickAction = ({
  hasSelectionToggle,
}: {
  hasSelectionToggle: boolean;
}): TransactionCardPrimaryClickAction =>
  hasSelectionToggle ? "toggle-selection" : "toggle-expansion";

export function TransactionCard({
  transaction,
  accountColor,
  accentColor,
  className,
  wrapText = false,
  onEdit,
  onDelete,
  selected = false,
  selectionTone = "primary",
  onToggleSelect,
  linkedTransactions,
}: TransactionCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const primaryClickAction = getTransactionCardPrimaryClickAction({
    hasSelectionToggle: Boolean(onToggleSelect),
  });

  const linkageType = transaction.linkage?.type;
  const isInternal = linkageType === "internal";
  const isReimbursement = linkageType === "reimbursement";
  const isReimbursed = linkageType === "reimbursed";

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatAmountInCurrency = (amount: number | null, currency?: string | null) => {
    if (amount === null) return "-";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || transaction.displayCurrency || transaction.currency || "SGD",
    }).format(amount);
  };
  const formatAmount = (amount: number | null) =>
    formatAmountInCurrency(amount, transaction.displayCurrency || transaction.currency || "SGD");

  const amount = transaction.amountIn ?? transaction.amountOut ?? 0;
  const isIncome = transaction.amountIn !== null;
  const reimbursedTotal =
    linkedTransactions?.reimbursedBy.reduce(
      (sum, linked) => sum + (linked.reimbursementAmount ?? 0),
      0,
    ) ?? 0;
  const currentOut = Math.max(transaction.amountOut ?? 0, 0);
  const remainingOut = Math.max(currentOut - reimbursedTotal, 0);

  // Determine left border color based on linkage type
  const getLeftBorderColor = () => {
    if (isReimbursement) return "#22c55e"; // bright green for reimbursement
    if (isInternal) return "#9ca3af"; // gray for internal
    if (accentColor) return accentColor;
    return accountColor;
  };

  return (
    <div
      className={`bg-white dark:bg-dark-2 transition-colors border ${
        isExpanded || selected
          ? selectionTone === "success"
            ? "border-green bg-green/5 dark:bg-green/10"
            : "border-primary"
          : "border-transparent"
      } ${isInternal ? "opacity-70" : ""} ${className || ""}`}
    >
      {/* Main Content */}
      <div
        onClick={() => {
          if (primaryClickAction === "toggle-selection") {
            onToggleSelect?.();
            return;
          }

          setIsExpanded((prev) => !prev);
        }}
        className="relative p-4 pl-6 cursor-pointer hover:bg-gray-1 dark:hover:bg-dark-3/50"
      >
        {(accentColor || accountColor || isReimbursement || isInternal) && (
          <span
            className="absolute left-0 top-0 h-full w-1"
            style={{ backgroundColor: getLeftBorderColor() }}
          />
        )}
          <div className="flex items-start justify-between gap-4">
          {onToggleSelect && (
            <div className="pt-1" onClick={(event) => event.stopPropagation()}>
              <Checkbox checked={selected} onChange={onToggleSelect} />
            </div>
          )}
          {/* Left: Description */}
          <div className="flex-1 min-w-0">
            <div
              className={`font-medium text-dark dark:text-white ${
                wrapText ? "break-words whitespace-normal" : "truncate"
              }`}
            >
              {transaction.label && transaction.label.trim().length > 0
                ? transaction.label
                : transaction.description}
            </div>
            <div
              className={`mt-0.5 text-xs text-dark-5 dark:text-dark-6 ${
                wrapText ? "break-words whitespace-normal" : "truncate"
              }`}
            >
              {transaction.description}
            </div>
            {transaction.tripFundings && transaction.tripFundings.length > 0 && (
              <div className="mt-1">
                <Link
                  href={`/trips/${transaction.tripFundings[0].trip.id}`}
                  onClick={(event) => event.stopPropagation()}
                  className="inline-flex items-center gap-1 rounded-full border border-stroke dark:border-dark-3 px-2 py-0.5 text-[11px] text-primary hover:border-primary"
                >
                  <Plane className="h-3 w-3" />
                  Funding: {transaction.tripFundings[0].trip.name}
                </Link>
              </div>
            )}
            {transaction.category && (
              <div
                className={`mt-1 flex items-center gap-2 text-xs text-dark-5 dark:text-dark-6 ${
                  wrapText ? "whitespace-normal break-words" : "truncate"
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: transaction.category.color }}
                />
                <span>{transaction.category.name}</span>
              </div>
            )}
          </div>

          {/* Right: Amount & Actions */}
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end">
              {/* Linkage badge */}
              {linkageType && (
                <div className="flex items-center gap-1 mb-1">
                  {isInternal && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-gray-2 dark:bg-dark-3 text-dark-5 dark:text-dark-6">
                      <ArrowLeftRight className="w-3 h-3" />
                      Internal
                    </span>
                  )}
                  {isReimbursement && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-green/10 text-green dark:text-green-light">
                      <Receipt className="w-3 h-3" />
                      Reimbursement
                    </span>
                  )}
                  {isReimbursed && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-green/10 text-green dark:text-green-light">
                      <Link2 className="w-3 h-3" />
                      Reimbursed
                    </span>
                  )}
                </div>
              )}
              {/* Amount display */}
              <div
                className={`text-lg font-semibold ${
                  isInternal
                    ? "text-dark-5 dark:text-dark-6 line-through"
                    : isIncome
                      ? "text-green dark:text-green-light"
                      : "text-red dark:text-red-light"
                }`}
              >
                {isIncome ? "+" : "-"}
                {formatAmount(Math.abs(amount))}
              </div>
              {transaction.secondaryAmount && transaction.secondaryAmount.value > 0 && (
                <div
                  className={`text-xs ${
                    transaction.secondaryAmount.muted
                      ? "text-dark-5 dark:text-dark-6"
                      : isIncome ||
                          transaction.secondaryAmount.direction === "in"
                        ? "text-green dark:text-green-light"
                        : "text-red dark:text-red-light"
                  }`}
                >
                  {transaction.secondaryAmount.direction
                    ? transaction.secondaryAmount.direction === "in"
                      ? "+"
                      : "-"
                    : isIncome
                      ? "+"
                      : "-"}
                  {formatAmountInCurrency(
                    Math.abs(transaction.secondaryAmount.value),
                    transaction.secondaryAmount.currency,
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1">
              {onEdit && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(transaction);
                  }}
                  className="p-1.5 text-dark-5 hover:text-dark dark:text-dark-6 dark:hover:text-white hover:bg-gray-2 dark:hover:bg-dark-3 rounded transition-colors"
                  title="Edit transaction"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              )}
              {onDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(transaction.id);
                  }}
                  className="p-1.5 text-red hover:text-red dark:text-red hover:bg-gray-2 dark:hover:bg-dark-3 rounded transition-colors"
                  title="Delete transaction"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  setIsExpanded((prev) => !prev);
                }}
                className="p-1.5 text-dark-5 hover:text-dark dark:text-dark-6 dark:hover:text-white hover:bg-gray-2 dark:hover:bg-dark-3 rounded transition-colors"
                title={isExpanded ? "Collapse" : "Expand"}
              >
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Details */}
      <div
        className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-out ${
          isExpanded ? "max-h-[1400px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="border-t border-stroke dark:border-dark-3 bg-gray-1 dark:bg-dark-3/50 p-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-dark-5 dark:text-dark-6">Date</div>
              <div className="font-medium text-dark dark:text-white mt-0.5">
                {formatDate(transaction.date)}
              </div>
            </div>

            <div>
              <div className="text-dark-5 dark:text-dark-6">Label</div>
              <div className="font-medium text-dark dark:text-white mt-0.5">
                {transaction.label && transaction.label.trim().length > 0
                  ? transaction.label
                  : transaction.description}
              </div>
            </div>

            <div>
              <div className="text-dark-5 dark:text-dark-6">Description</div>
              <div className="font-medium text-dark dark:text-white mt-0.5">
                {transaction.description}
              </div>
            </div>

            {transaction.category && (
              <div>
                <div className="text-dark-5 dark:text-dark-6">Category</div>
                <div className="font-medium text-dark dark:text-white mt-0.5 flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: transaction.category.color }}
                  />
                  <span>{transaction.category.name}</span>
                </div>
              </div>
            )}

            {transaction.accountIdentifier && (
              <div>
                <div className="text-dark-5 dark:text-dark-6">
                  Account Identifier
                </div>
                <div className="font-medium text-dark dark:text-white mt-0.5 flex items-center gap-2">
                  {accountColor && (
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: accountColor }}
                    />
                  )}
                  <span>{transaction.accountIdentifier}</span>
                </div>
              </div>
            )}

            {transaction.balance !== null && (
              <div>
                <div className="text-dark-5 dark:text-dark-6">Balance</div>
                <div className="font-medium text-dark dark:text-white mt-0.5">
                  {formatAmount(transaction.balance)}
                </div>
              </div>
            )}

            {transaction.amountIn !== null && (
              <div>
                <div className="text-dark-5 dark:text-dark-6">Amount In</div>
                <div className="font-medium text-green dark:text-green-light mt-0.5">
                  {formatAmount(transaction.amountIn)}
                </div>
              </div>
            )}

            {transaction.amountOut !== null && (
              <div>
                <div className="text-dark-5 dark:text-dark-6">Amount Out</div>
                <div className="font-medium text-red dark:text-red-light mt-0.5">
                  {formatAmount(transaction.amountOut)}
                </div>
              </div>
            )}

            {transaction.secondaryAmount && transaction.secondaryAmount.value > 0 && (
              <div>
                <div className="text-dark-5 dark:text-dark-6">
                  {transaction.secondaryAmount.label || "Secondary Amount"}
                </div>
                <div
                  className={`font-medium mt-0.5 ${
                    transaction.secondaryAmount.muted
                      ? "text-dark-5 dark:text-dark-6"
                      : transaction.secondaryAmount.direction
                        ? transaction.secondaryAmount.direction === "in"
                          ? "text-green dark:text-green-light"
                          : "text-red dark:text-red-light"
                        : isIncome
                          ? "text-green dark:text-green-light"
                          : "text-red dark:text-red-light"
                  }`}
                >
                  {transaction.secondaryAmount.direction
                    ? transaction.secondaryAmount.direction === "in"
                      ? "+"
                      : "-"
                    : isIncome
                      ? "+"
                      : "-"}
                  {formatAmountInCurrency(
                    Math.abs(transaction.secondaryAmount.value),
                    transaction.secondaryAmount.currency,
                  )}
                </div>
              </div>
            )}

            {transaction.metadata &&
              Object.keys(transaction.metadata).length > 0 && (
                <div className="col-span-2">
                  <div className="text-dark-5 dark:text-dark-6 mb-2">
                    Additional Details
                  </div>
                  <div className="bg-white dark:bg-dark-2 rounded border border-stroke dark:border-dark-3 p-3">
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                      {Object.entries(transaction.metadata).map(
                        ([key, value]) => (
                          <div key={key} className="flex gap-2">
                            <dt className="text-dark-5 dark:text-dark-6">
                              {key.replace(/([A-Z])/g, " $1").trim()}:
                            </dt>
                            <dd className="text-dark dark:text-white font-medium truncate">
                              {String(value)}
                            </dd>
                          </div>
                        ),
                      )}
                    </dl>
                  </div>
                </div>
              )}

            {/* Linked Transactions Section */}
            {linkedTransactions &&
              (linkedTransactions.reimburses.length > 0 ||
                linkedTransactions.reimbursedBy.length > 0) && (
                <div className="col-span-2 mt-2">
                  {linkedTransactions.reimbursedBy.length > 0 &&
                    transaction.amountOut !== null && (
                      <div className="mb-3 grid grid-cols-1 gap-2 rounded border border-stroke bg-white p-3 dark:border-dark-3 dark:bg-dark-2 md:grid-cols-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-dark-5 dark:text-dark-6">
                            Original Out
                          </div>
                          <div className="text-sm font-semibold text-red dark:text-red-light">
                            {formatAmount(currentOut)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-dark-5 dark:text-dark-6">
                            Reimbursed
                          </div>
                          <div className="text-sm font-semibold text-green dark:text-green-light">
                            {formatAmount(reimbursedTotal)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-dark-5 dark:text-dark-6">
                            Remaining
                          </div>
                          <div className="text-sm font-semibold text-primary">
                            {formatAmount(remainingOut)}
                          </div>
                        </div>
                      </div>
                    )}

                  {/* Reimburses Section */}
                  {linkedTransactions.reimburses.length > 0 && (
                    <div className="mb-4">
                      <div className="text-dark-5 dark:text-dark-6 mb-3 flex items-center gap-2">
                        <Receipt className="w-4 h-4 text-green" />
                        <span>
                          This reimbursement pays ({linkedTransactions.reimburses.length})
                        </span>
                      </div>
                      <div className="space-y-3">
                        {linkedTransactions.reimburses.map((linked) => (
                          <LinkedTransactionPreview
                            key={linked.id}
                            transaction={linked}
                            formatDate={formatDate}
                            formatAmount={formatAmount}
                            mode="pays"
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Reimbursed By Section */}
                  {linkedTransactions.reimbursedBy.length > 0 && (
                    <div>
                      <div className="text-dark-5 dark:text-dark-6 mb-3 flex items-center gap-2">
                        <Link2 className="w-4 h-4 text-green" />
                        <span>
                          Reimbursed by (
                          {linkedTransactions.reimbursedBy.length})
                        </span>
                      </div>
                      <div className="space-y-3">
                        {linkedTransactions.reimbursedBy.map((linked) => (
                          <LinkedTransactionPreview
                            key={linked.id}
                            transaction={linked}
                            formatDate={formatDate}
                            formatAmount={formatAmount}
                            mode="received"
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper component for displaying linked transactions
function LinkedTransactionPreview({
  transaction,
  formatDate,
  formatAmount,
  mode,
}: {
  transaction: LinkedTransaction;
  formatDate: (date: string) => string;
  formatAmount: (amount: number | null) => string;
  mode: "pays" | "received";
}) {
  const amount = transaction.amountIn ?? transaction.amountOut ?? 0;
  const isIncome = transaction.amountIn !== null;
  const accentColor =
    mode === "pays"
      ? "bg-primary"
      : "bg-green dark:bg-green-light";
  const title =
    transaction.label && transaction.label.trim().length > 0
      ? transaction.label
      : transaction.description;

  return (
    <div className="relative flex items-center justify-between gap-4 rounded border border-stroke bg-white px-4 py-3 dark:border-dark-3 dark:bg-dark-2">
      <span
        aria-hidden
        className={`absolute left-0 top-0 h-full w-1 rounded-l ${accentColor}`}
      />
      <div className="min-w-0 flex-1 pl-2">
        <div className="flex items-center gap-2.5 text-xs text-dark-5 dark:text-dark-6">
          <span>{formatDate(transaction.date)}</span>
          <span>#{transaction.id.slice(-6)}</span>
          <span className="rounded bg-gray-1 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-dark-5 dark:bg-dark-3 dark:text-dark-6">
            {mode === "pays" ? "Paid by reimbursement" : "Reimbursed by"}
          </span>
        </div>
        <div className="mt-1 truncate text-sm font-semibold text-dark dark:text-white">
          {title}
        </div>
        <div className="mt-0.5 truncate text-xs text-dark-5 dark:text-dark-6">
          {transaction.description}
        </div>
      </div>
      <div className="text-right pl-3">
        <div className="text-[11px] uppercase tracking-wide text-dark-5 dark:text-dark-6">
          {mode === "pays" ? "Allocated" : "Received"}
        </div>
        <div className="text-sm font-semibold text-primary">
          {formatAmount(transaction.reimbursementAmount ?? 0)}
        </div>
        {transaction.reimbursementAmount === null ||
        transaction.reimbursementAmount === undefined ? (
          <div
            className={`text-xs ${
              isIncome
                ? "text-green dark:text-green-light"
                : "text-red dark:text-red-light"
            }`}
          >
            {isIncome ? "+" : "-"}
            {formatAmount(Math.abs(amount))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
