"use client";

import Link from "next/link";
import { useState } from "react";
import { PageTabs } from "@/components/ui/PageTabs";
import { Bot, FileText } from "lucide-react";
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

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-xs font-semibold uppercase text-dark-5 dark:text-dark-6">
          {label}
        </p>
        <p className="mt-2 text-2xl font-bold text-dark dark:text-white">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

export function ImportHistoryClient({
  imports,
  agentDrafts = [],
}: {
  imports: ImportSummary[];
  agentDrafts?: Array<Record<string, any>>;
}) {
  const [tab, setTab] = useState("staged");
  const staged = agentDrafts.filter(
    (d) =>
      !["committed", "discarded", "expired"].includes(d.status) &&
      new Date(d.expiresAt) > new Date(),
  );
  const needsReview = staged.reduce(
    (sum, d) => sum + (d.reviewSummary?.needsReview || 0),
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-dark dark:text-white">
            Imports
          </h1>
          <p className="text-sm text-dark-5 dark:text-dark-6">
            Review staged transactions, resolve agent flags, and browse saved
            imports.
          </p>
        </div>
        <Link href="/import">
          <Button
            variant="secondary"
            leftIcon={<FileText className="size-4" />}
          >
            Import File
          </Button>
        </Link>
      </div>

      <PageTabs
        tabs={[
          { key: "staged", label: `Staged (${staged.length})` },
          { key: "history", label: "Imported history" },
        ]}
        activeTab={tab}
        onChange={setTab}
      />
      {tab === "staged" && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <SummaryMetric
              label="Staged groups"
              value={String(staged.length)}
            />
            <SummaryMetric
              label="Transactions"
              value={String(
                staged.reduce((s, d) => s + (d._count?.rows || 0), 0),
              )}
            />
            <SummaryMetric label="Needs review" value={String(needsReview)} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Staged imports</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!staged.length && (
                <p className="py-6 text-center text-dark-5 dark:text-dark-6">
                  No staged imports. Transactions prepared through the MCP
                  appear here.
                </p>
              )}
              {staged.map((d) => (
                <Link
                  key={d.id}
                  href={`/imports/drafts/${d.id}`}
                  className="block rounded-lg border border-stroke p-4 hover:border-primary dark:border-dark-3"
                >
                  <div className="flex items-start gap-3">
                    <Bot className="mt-1 size-5 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="break-words font-semibold text-dark dark:text-white">
                        {d.sourceFilename}
                      </p>
                      <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                        {d._count?.rows || 0} transactions · {d.mode} ·{" "}
                        {d.status}
                      </p>
                      <p className="mt-2 text-sm text-primary">
                        {d.reviewSummary?.labelling || 0} need labelling ·{" "}
                        {d.reviewSummary?.reconciliation || 0} need
                        reconciliation · {d.reviewSummary?.ready || 0} ready
                      </p>
                      <p className="mt-2 text-sm font-medium text-primary">
                        Review transactions →
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        </>
      )}
      {tab === "history" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Previous Imports</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {imports.length === 0 ? (
                <div className="py-10 text-center text-sm text-dark-5 dark:text-dark-6">
                  No imports yet.
                </div>
              ) : (
                imports.map((item) => (
                  <ImportSummaryCard key={item.key} item={item} />
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
