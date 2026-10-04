"use client";

import { TransactionCard, type LinkedTransaction, type TransactionCardTransaction } from "./TransactionCard";

interface ExpandableTransactionListProps {
  transactions: TransactionCardTransaction[];
  accountColorMap?: Record<string, string>;
  /** Account display names by identifier (label with identifier). */
  accountNameMap?: Record<string, string>;
  accentColorById?: Record<string, string>;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onEdit?: (transaction: TransactionCardTransaction) => void;
  canEdit?: (transaction: TransactionCardTransaction) => boolean;
  onDelete?: (id: string) => void;
  linkedTransactionsById?: Record<
    string,
    {
      reimburses: LinkedTransaction[];
      reimbursedBy: LinkedTransaction[];
    }
  >;
}

const formatGroupDate = (date: string) =>
  new Date(date).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

export function ExpandableTransactionList({
  transactions,
  accountColorMap = {},
  accountNameMap = {},
  accentColorById = {},
  selectedIds,
  onToggleSelect,
  onEdit,
  canEdit,
  onDelete,
  linkedTransactionsById,
}: ExpandableTransactionListProps) {
  const groupedTransactions = transactions.reduce(
    (groups, transaction) => {
      const date = formatGroupDate(transaction.date);
      if (!groups[date]) groups[date] = [];
      groups[date].push(transaction);
      return groups;
    },
    {} as Record<string, TransactionCardTransaction[]>,
  );

  return (
    <div className="space-y-6">
      {Object.entries(groupedTransactions).map(([date, dateTransactions]) => (
        <div key={date}>
          <div className="flex items-center gap-3 mb-3">
            <h3 className="text-sm font-semibold text-dark dark:text-white whitespace-nowrap uppercase tracking-wide">
              {date}
            </h3>
            <div className="flex-1 h-px bg-stroke dark:bg-dark-3" />
          </div>

          <div className="overflow-hidden rounded-lg dark:border-dark-3">
            {dateTransactions.map((transaction, index) => (
              <div
                key={transaction.id}
                className={
                  index < dateTransactions.length - 1
                    ? "border-b border-stroke dark:border-dark-3"
                    : ""
                }
              >
                <TransactionCard
                  transaction={transaction}
                  accountColor={
                    transaction.accountIdentifier
                      ? accountColorMap[transaction.accountIdentifier]
                      : undefined
                  }
                  accentColor={accentColorById[transaction.id]}
                  accountName={
                    transaction.accountIdentifier
                      ? accountNameMap[transaction.accountIdentifier]
                      : undefined
                  }
                  onEdit={
                    onEdit &&
                    (canEdit ? canEdit(transaction) : true)
                      ? onEdit
                      : undefined
                  }
                  onDelete={onDelete}
                  selected={selectedIds ? selectedIds.has(transaction.id) : false}
                  onToggleSelect={
                    onToggleSelect ? () => onToggleSelect(transaction.id) : undefined
                  }
                  linkedTransactions={linkedTransactionsById?.[transaction.id]}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
