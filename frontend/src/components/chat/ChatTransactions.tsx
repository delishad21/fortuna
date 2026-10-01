"use client";
import { useState } from "react";
import { ExpandableTransactionList } from "@/components/transactions/ExpandableTransactionList";
import type { TransactionCardTransaction } from "@/components/transactions/TransactionCard";

const PAGE = 20;
const amount = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : Number(value);

/** Recognise transaction rows in a tool data block, from either an array or `{ transactions }`. */
export function asTransactions(
  data: unknown,
): TransactionCardTransaction[] | null {
  const rows = Array.isArray(data)
    ? data
    : (data as { transactions?: unknown })?.transactions;
  if (!Array.isArray(rows) || !rows.length) return null;
  const looksLikeTransaction = (row: any) =>
    row &&
    typeof row === "object" &&
    typeof row.id === "string" &&
    typeof row.date === "string" &&
    typeof row.description === "string" &&
    ("amountIn" in row || "amountOut" in row);
  if (!rows.every(looksLikeTransaction)) return null;
  return rows.map((row: any) => ({
    id: row.id,
    date: row.date,
    description: row.description,
    label: row.label ?? undefined,
    amountIn: amount(row.amountIn),
    amountOut: amount(row.amountOut),
    balance: amount(row.balance),
    currency: row.currency,
    accountIdentifier: row.accountIdentifier,
    category: row.category
      ? { ...row.category, color: row.category.color || "#9ca3af" }
      : undefined,
    linkage: row.linkage ?? null,
  }));
}

/** Transaction cards as on the transactions page. Without `footer`, long lists reveal locally. */
export function ChatTransactions({
  title,
  transactions,
  total = transactions.length,
  footer,
}: {
  title: string;
  transactions: TransactionCardTransaction[];
  total?: number;
  footer?: React.ReactNode;
}) {
  const [shown, setShown] = useState(footer ? Infinity : PAGE);
  const remaining = transactions.length - shown;
  return (
    <section className="space-y-4 rounded-lg border border-stroke p-4 dark:border-stroke-dark">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-sm text-dark-5 dark:text-dark-6">
          {total.toLocaleString()}{" "}
          {total === 1 ? "transaction" : "transactions"}
        </span>
      </div>
      <ExpandableTransactionList transactions={transactions.slice(0, shown)} />
      {remaining > 0 && (
        <button
          type="button"
          className="w-full rounded-lg border border-stroke py-2 text-sm text-primary hover:bg-gray-2 dark:border-stroke-dark dark:hover:bg-dark-3"
          onClick={() => setShown((n) => n + PAGE * 2)}
        >
          Show {Math.min(remaining, PAGE * 2)} more
        </button>
      )}
      {!transactions.length && (
        <p className="text-sm text-dark-5">No matching transactions.</p>
      )}
      {footer}
    </section>
  );
}
