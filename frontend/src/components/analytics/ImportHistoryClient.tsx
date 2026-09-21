"use client";

import Link from "next/link";
import { useState } from "react";
import { PageTabs } from "@/components/ui/PageTabs";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ImportSummaryCard } from "@/components/analytics/ImportSummaryCard";
import { getAgentDraft } from "@/app/actions/agentDrafts";
import { AgentDraftReviewClient } from "@/components/import/AgentDraftReviewClient";
import { ImportClient } from "@/components/import/ImportClient";

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
  categories,
  accountNumbers,
  parserOptions,
}: {
  imports: ImportSummary[];
  agentDrafts?: Array<Record<string, any>>;
  categories: Array<{ id: string; name: string; color: string }>;
  accountNumbers: Array<{
    id: string;
    accountIdentifier: string;
    color: string;
  }>;
  parserOptions: Array<{
    value: string;
    label: string;
    description: string;
  }>;
}) {
  const [tab, setTab] = useState("import");
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(
    new Set(),
  );
  const [showTogether, setShowTogether] = useState(false);
  const [detailedDrafts, setDetailedDrafts] = useState<
    Array<Record<string, any>>
  >([]);
  const [loadingTogether, setLoadingTogether] = useState(false);
  const staged = agentDrafts.filter(
    (d) =>
      !["committed", "discarded", "expired"].includes(d.status) &&
      new Date(d.expiresAt) > new Date(),
  );
  const allSelected =
    staged.length > 0 &&
    staged.every((draft) => selectedDraftIds.has(draft.id));
  const toggleDraft = (draftId: string) => {
    setSelectedDraftIds((current) => {
      const next = new Set(current);
      if (next.has(draftId)) next.delete(draftId);
      else next.add(draftId);
      return next;
    });
  };
  const reviewSelected = async () => {
    if (!selectedDraftIds.size) return;
    setLoadingTogether(true);
    try {
      setDetailedDrafts(
        await Promise.all(
          staged
            .filter((draft) => selectedDraftIds.has(draft.id))
            .map((draft) =>
              getAgentDraft(draft.id).then((result) => result.draft),
            ),
        ),
      );
      setShowTogether(true);
    } finally {
      setLoadingTogether(false);
    }
  };
  return (
    <div className="flex h-full flex-col gap-6">
      <PageTabs
        tabs={[
          { key: "import", label: "Import" },
          { key: "staged", label: `Staged (${staged.length})` },
          { key: "history", label: "Imported history" },
        ]}
        activeTab={tab}
        onChange={setTab}
      />
      {tab === "import" && (
        <div className="min-h-0 flex-1">
          <ImportClient
            initialCategories={categories}
            initialAccountNumbers={accountNumbers}
            parserOptions={parserOptions}
          />
        </div>
      )}
      {tab === "staged" && (
        <>
          {showTogether ? (
            <>
              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  onClick={() => setShowTogether(false)}
                >
                  Change staged imports
                </Button>
              </div>
              <AgentDraftReviewClient
                initialDrafts={detailedDrafts as any}
                embedded
              />
            </>
          ) : (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-dark dark:text-white">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(event) =>
                        setSelectedDraftIds(
                          event.target.checked
                            ? new Set(staged.map((draft) => draft.id))
                            : new Set(),
                        )
                      }
                    />
                    Select all staged imports
                  </label>
                  <Button
                    disabled={!selectedDraftIds.size || loadingTogether}
                    isLoading={loadingTogether}
                    onClick={() => void reviewSelected()}
                  >
                    Review selected ({selectedDraftIds.size})
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {!staged.length && (
                  <p className="py-6 text-center text-dark-5 dark:text-dark-6">
                    No staged imports. Transactions prepared through the MCP
                    appear here.
                  </p>
                )}
                {staged.map((d) => (
                  <div
                    key={d.id}
                    className="rounded-lg border border-stroke p-4 dark:border-dark-3"
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedDraftIds.has(d.id)}
                        onChange={() => toggleDraft(d.id)}
                        aria-label={`Select ${d.sourceFilename}`}
                        className="mt-1"
                      />
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
                        <Link
                          href={`/imports/drafts/${d.id}`}
                          className="mt-2 inline-block text-sm font-medium text-primary"
                        >
                          Review transactions →
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
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
