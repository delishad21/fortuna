"use client";

import { useState } from "react";
import { HandCoins } from "lucide-react";
import { clearTransactionsReimbursable, setTransactionsReimbursable } from "@/app/actions/reimbursables";
import { getTransaction } from "@/app/actions/transactions";
import { Button } from "@/components/ui/Button";
import { formatCurrency } from "@/components/analytics/parts";
import { ReimbursableEditor } from "./ReimbursableEditor";
import { describeShare, flagFromRow, type ReimbursableFlag } from "@/lib/reimbursables";

/**
 * A transaction's reimbursable flag in its details: who it was paid for and
 * what they owe, with Mark / Edit / Unmark. Saves straight away.
 */
export function ReimbursableSection({
  transaction,
  onChanged,
}: {
  transaction: Parameters<typeof flagFromRow>[0] & { id: string; amountOut: number | null };
  onChanged: () => void | Promise<void>;
}) {
  const [flag, setFlag] = useState<ReimbursableFlag | null>(flagFromRow(transaction));
  const [editing, setEditing] = useState(false);

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-stroke px-3 py-2 dark:border-dark-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-dark-5 dark:text-dark-6">
          {flag
            ? `For ${flag.person || "someone"} · owes ${describeShare(flag.share)} (${formatCurrency(flag.owed)})${flag.note ? ` · ${flag.note}` : ""}`
            : "Not paid for anyone"}
        </p>
        {!editing ? (
          <Button type="button" size="sm" variant="secondary" leftIcon={<HandCoins className="h-4 w-4" />} onClick={() => setEditing(true)}>
            {flag ? "Edit reimbursable" : "Reimbursable…"}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <ReimbursableEditor
          current={flag}
          amountOut={Number(transaction.amountOut || 0)}
          onCancel={() => setEditing(false)}
          onSave={async (input) => {
            await setTransactionsReimbursable({ ids: [transaction.id], ...input });
            const fresh = await getTransaction(transaction.id).catch(() => null);
            setFlag(fresh ? flagFromRow(fresh.transaction ?? fresh) : null);
            setEditing(false);
            await onChanged();
          }}
          onClear={async () => {
            await clearTransactionsReimbursable([transaction.id]);
            setFlag(null);
            setEditing(false);
            await onChanged();
          }}
        />
      ) : null}
    </div>
  );
}
