"use client";

import Link from "next/link";
import { useState } from "react";
import { PageTabs } from "@/components/ui/PageTabs";
import { Bot, FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ImportSummaryCard } from "@/components/analytics/ImportSummaryCard";
import { getAgentDraft } from "@/app/actions/agentDrafts";
import { AgentDraftReviewClient } from "@/components/import/AgentDraftReviewClient";

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

export function ImportHistoryClient({
  imports,
  agentDrafts = [],
}: {
  imports: ImportSummary[];
  agentDrafts?: Array<Record<string, any>>;
}) {
  const [tab, setTab] = useState("staged");
  const [showTogether, setShowTogether] = useState(false);
  const [detailedDrafts, setDetailedDrafts] = useState<Array<Record<string, any>>>([]);
  const [loadingTogether, setLoadingTogether] = useState(false);
  const staged = agentDrafts.filter(
    (d) =>
      !["committed", "discarded", "expired"].includes(d.status) &&
      new Date(d.expiresAt) > new Date(),
  );
  return (
    <div className="space-y-6">
      <PageTabs
        tabs={[
          { key: "staged", label: `Staged (${staged.length})` },
          { key: "history", label: "Imported history" },
        ]}
        activeTab={tab}
        onChange={setTab}
      />
      <div className="flex justify-end">
        <Link href="/import">
          <Button variant="secondary" leftIcon={<FileText className="size-4" />}>
            Import File
          </Button>
        </Link>
      </div>
      {tab === "staged" && (
        <>
          <label className="flex min-h-11 items-center gap-3 rounded-lg border border-stroke px-4 text-sm font-medium text-dark dark:border-dark-3 dark:text-white">
            <input
              type="checkbox"
              checked={showTogether}
              onChange={async (event) => {
                const checked = event.target.checked;
                setShowTogether(checked);
                if (!checked || detailedDrafts.length) return;
                setLoadingTogether(true);
                try {
                  setDetailedDrafts(
                    await Promise.all(
                      staged.map((draft) =>
                        getAgentDraft(draft.id).then((result) => result.draft),
                      ),
                    ),
                  );
                } finally {
                  setLoadingTogether(false);
                }
              }}
            />
            View and label all staged imports together
          </label>
          {showTogether ? (
            loadingTogether ? (
              <p className="py-8 text-center text-dark-5 dark:text-dark-6">
                Loading staged transactions…
              </p>
            ) : (
              <AgentDraftReviewClient initialDrafts={detailedDrafts as any} embedded />
            )
          ) : <Card>
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
          </Card>}
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
