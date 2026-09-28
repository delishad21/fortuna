"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { chatApi } from "@/lib/chat/client";
import { DataDetails } from "@/components/chat/ActionPreview";
export default function ChatTransactionPage() {
  const { id } = useParams<{ id: string }>(),
    [item, setItem] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void chatApi(`/transactions/${id}`, { signal: abort.signal })
      .then(setItem)
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [id]);
  return (
    <section className="mx-auto max-w-3xl space-y-5 text-dark dark:text-white">
      <Link className="text-primary" href="/chat">
        Back to chat
      </Link>
      <h1 className="text-2xl font-semibold">
        {item?.label || item?.description || "Transaction details"}
      </h1>
      {error ? (
        <p role="alert">{error}</p>
      ) : item ? (
        <div className="rounded-xl border border-stroke bg-white p-6 dark:border-stroke-dark dark:bg-gray-dark">
          <DataDetails
            value={{
              date: item.date,
              description: item.description,
              label: item.label,
              income: item.amountIn,
              expense: item.amountOut,
              currency: item.currency,
              account: item.accountIdentifier,
              category: item.category?.name || null,
              reimbursement: item.linkage,
            }}
          />
        </div>
      ) : (
        <p role="status">Loading transaction…</p>
      )}
    </section>
  );
}
