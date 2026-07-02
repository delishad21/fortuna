"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ImportSummaryCard } from "@/components/analytics/ImportSummaryCard";

type ImportSummary = {
  key: string;
  filename: string;
  batchFilename?: string;
  parserId: string | null;
  importedAt: string | null;
  startDate: string | null;
  endDate: string | null;
  totalIn: number;
  totalOut: number;
  net: number;
  transactionCount: number;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    maximumFractionDigits: 2,
  }).format(value || 0);

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-xs font-semibold uppercase text-dark-5 dark:text-dark-6">{label}</p>
        <p className="mt-2 text-2xl font-bold text-dark dark:text-white">{value}</p>
      </CardContent>
    </Card>
  );
}

export function ImportHistoryClient({ imports }: { imports: ImportSummary[] }) {
  const totals = imports.reduce(
    (acc, item) => ({
      totalIn: acc.totalIn + item.totalIn,
      totalOut: acc.totalOut + item.totalOut,
      transactionCount: acc.transactionCount + item.transactionCount,
    }),
    { totalIn: 0, totalOut: 0, transactionCount: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-dark dark:text-white">Imports</h1>
          <p className="text-sm text-dark-5 dark:text-dark-6">Historical imported files and their transaction totals.</p>
        </div>
        <Link href="/import">
          <Button variant="secondary" leftIcon={<FileText className="size-4" />}>Import File</Button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryMetric label="Files" value={String(imports.length)} />
        <SummaryMetric label="Transactions" value={String(totals.transactionCount)} />
        <SummaryMetric label="Total spending" value={formatCurrency(totals.totalOut)} />
      </div>

      <Card>
        <CardHeader><CardTitle>Previous Imports</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {imports.length === 0 ? (
            <div className="py-10 text-center text-sm text-dark-5 dark:text-dark-6">No imports yet.</div>
          ) : (
            imports.map((item) => (
              <ImportSummaryCard key={item.key} item={item} />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
