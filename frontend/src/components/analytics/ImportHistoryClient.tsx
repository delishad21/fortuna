"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageTabs } from "@/components/ui/PageTabs";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ImportSummaryCard } from "@/components/analytics/ImportSummaryCard";
import { discardAgentDraft, getAgentDraft } from "@/app/actions/agentDrafts";
import { Modal } from "@/components/ui/Modal";
import { Checkbox } from "@/components/ui/Checkbox";
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
  accountNumbers,
  parserOptions,
  initialTab = "import",
}: {
  imports: ImportSummary[];
  agentDrafts?: Array<Record<string, any>>;
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
  initialTab?: "import" | "staged" | "history";
}) {
  const router = useRouter();
  const [tab, setTab] = useState(initialTab);
  const [commitNotice, setCommitNotice] = useState("");
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(
    new Set(),
  );
  const [showTogether, setShowTogether] = useState(false);
  const [detailedDrafts, setDetailedDrafts] = useState<
    Array<Record<string, any>>
  >([]);
  const [loadingTogether, setLoadingTogether] = useState(false);
  const [removedDraftIds, setRemovedDraftIds] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const staged = agentDrafts.filter(
    (d) =>
      !["committed", "discarded", "expired"].includes(d.status) &&
      !removedDraftIds.has(d.id),
  );
  const deleteTargets = (pendingDelete || [])
    .map((id) => staged.find((draft) => draft.id === id))
    .filter((draft): draft is (typeof staged)[number] => !!draft);
  const deleteDrafts = async (draftIds: string[]) => {
    setDeleting(true);
    setDeleteError("");
    const removed: string[] = [];
    try {
      for (const draftId of draftIds) {
        await discardAgentDraft(draftId);
        removed.push(draftId);
      }
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Could not delete the staged import",
      );
    } finally {
      setRemovedDraftIds((current) => new Set([...current, ...removed]));
      setSelectedDraftIds((current) => {
        const next = new Set(current);
        removed.forEach((id) => next.delete(id));
        return next;
      });
      setDeleting(false);
      router.refresh();
    }
  };
  const allSelected =
    staged.length > 0 &&
    staged.every((draft) => selectedDraftIds.has(draft.id));
  // Staged imports joined by reimbursement links must be committed together.
  const missingPartners = staged.flatMap((draft) =>
    selectedDraftIds.has(draft.id)
      ? ((draft.linkedDraftIds || []) as string[])
          .filter((id) => !selectedDraftIds.has(id))
          .flatMap((id) => {
            const partner = staged.find((item) => item.id === id);
            return partner ? [{ draft, partner }] : [];
          })
      : [],
  );
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
            initialAccountNumbers={accountNumbers}
            parserOptions={parserOptions}
            onStaged={(drafts) => {
              setDetailedDrafts(drafts);
              setSelectedDraftIds(new Set(drafts.map((draft) => String(draft.id))));
              setShowTogether(true);
              setTab("staged");
              router.refresh();
            }}
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
                onCommitted={() => {
                  setShowTogether(false);
                  setDetailedDrafts([]);
                  setSelectedDraftIds(new Set());
                  setCommitNotice("Selected staged imports committed successfully.");
                  setTab("history");
                  router.refresh();
                }}
              />
            </>
          ) : (
            <Card className="overflow-hidden p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stroke px-5 py-3 dark:border-dark-3">
                <div className="flex items-center gap-3 text-sm">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={selectedDraftIds.size > 0 && !allSelected}
                    disabled={!staged.length}
                    aria-label="Select all staged imports"
                    onChange={(checked) =>
                      setSelectedDraftIds(
                        checked ? new Set(staged.map((draft) => draft.id)) : new Set(),
                      )
                    }
                  />
                  <span className="font-medium text-dark dark:text-white">
                    {selectedDraftIds.size
                      ? `${selectedDraftIds.size} of ${staged.length} selected`
                      : `${staged.length} staged ${staged.length === 1 ? "import" : "imports"}`}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!selectedDraftIds.size || deleting}
                    leftIcon={<Trash2 className="size-4" />}
                    className="text-dark-5 hover:text-red dark:text-dark-6"
                    onClick={() => setPendingDelete([...selectedDraftIds])}
                  >
                    Delete selected ({selectedDraftIds.size})
                  </Button>
                  <Button
                    size="sm"
                    disabled={!selectedDraftIds.size || loadingTogether}
                    isLoading={loadingTogether}
                    onClick={() => void reviewSelected()}
                  >
                    Review selected ({selectedDraftIds.size})
                  </Button>
                </div>
              </div>
              {deleteError && (
                <p
                  role="alert"
                  className="border-b border-stroke bg-red/5 px-5 py-3 text-sm text-red dark:border-dark-3"
                >
                  {deleteError}
                </p>
              )}
              {missingPartners.length > 0 && (
                <div
                  role="status"
                  className="space-y-2 border-b border-yellow-dark/30 bg-yellow-light-4 px-5 py-3 text-sm text-dark dark:bg-dark-3 dark:text-white"
                >
                  {missingPartners.map(({ draft, partner }) => (
                    <div
                      key={`${draft.id}:${partner.id}`}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span>
                        {draft.sourceFilename} has reimbursement links to{" "}
                        {partner.sourceFilename}. Linked imports must be
                        committed together.
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          setSelectedDraftIds(
                            (current) => new Set([...current, partner.id]),
                          )
                        }
                      >
                        Select {partner.sourceFilename} too
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {!staged.length ? (
                <p className="px-5 py-12 text-center text-sm text-dark-5 dark:text-dark-6">
                  No staged imports. Statements you upload and imports prepared in chat
                  appear here.
                </p>
              ) : (
                <ul className="divide-y divide-stroke dark:divide-dark-3">
                  {staged.map((d) => {
                    const selected = selectedDraftIds.has(d.id);
                    const labelling = Number(d.reviewSummary?.labelling || 0);
                    const reconciliation = Number(d.reviewSummary?.reconciliation || 0);
                    const rows = Number(d._count?.rows || 0);
                    return (
                      <li
                        key={d.id}
                        className={`flex items-center gap-4 px-5 py-3.5 transition-colors ${
                          selected
                            ? "bg-primary/5"
                            : "hover:bg-gray-1 dark:hover:bg-dark-3/40"
                        }`}
                      >
                        <Checkbox
                          checked={selected}
                          aria-label={`Select ${d.sourceFilename}`}
                          onChange={() => toggleDraft(d.id)}
                        />
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/imports/drafts/${d.id}`}
                            className="block truncate font-medium text-dark hover:text-primary dark:text-white dark:hover:text-primary"
                            title={`Review ${d.sourceFilename}`}
                          >
                            {d.sourceFilename}
                          </Link>
                          <p className="mt-0.5 text-xs text-dark-5 dark:text-dark-6">
                            {rows} {rows === 1 ? "transaction" : "transactions"}
                            {d.mode === "trip" ? " · Trip import" : ""}
                            {d.createdAt
                              ? ` · Staged ${new Date(d.createdAt).toLocaleDateString("en-SG", {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                })}`
                              : ""}
                            {d.status === "valid" ? " · Validated" : ""}
                          </p>
                        </div>
                        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                          {labelling > 0 && (
                            <span className="rounded-full bg-yellow-light-4 px-2 py-0.5 text-xs font-medium text-yellow-dark dark:bg-yellow-dark/15">
                              {labelling} to label
                            </span>
                          )}
                          {reconciliation > 0 && (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                              {reconciliation} to reconcile
                            </span>
                          )}
                          {!labelling && !reconciliation && (
                            <span className="rounded-full bg-green/10 px-2 py-0.5 text-xs font-medium text-green">
                              Ready
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={deleting}
                          aria-label={`Delete ${d.sourceFilename}`}
                          title="Delete"
                          onClick={() => setPendingDelete([d.id])}
                          className="shrink-0 rounded-md p-2 text-dark-5 transition-colors hover:bg-red/10 hover:text-red disabled:opacity-50 dark:text-dark-6"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}
        </>
      )}
      <Modal
        isOpen={deleteTargets.length > 0}
        onClose={() => setPendingDelete(null)}
        type="warning"
        title={
          deleteTargets.length === 1
            ? "Delete staged import?"
            : `Delete ${deleteTargets.length} staged imports?`
        }
        message={[
          deleteTargets.map((draft) => draft.sourceFilename).join("\n"),
          "",
          "Its rows and review edits are discarded and nothing is saved to your transactions. The uploaded statement is deleted unless it is kept as a parser fixture.",
          ...(deleteTargets.some((draft) => (draft.linkedDraftIds || []).length)
            ? ["Reimbursement links between these rows and other staged imports are removed too."]
            : []),
        ].join("\n")}
        confirmText={deleteTargets.length === 1 ? "Delete import" : "Delete imports"}
        onConfirm={() => void deleteDrafts(deleteTargets.map((draft) => draft.id))}
      />
      {tab === "history" && (
        <>
          {commitNotice && (
            <p role="status" className="rounded-lg border border-green/30 bg-green/10 p-3 text-sm text-dark dark:text-white">
              {commitNotice}
            </p>
          )}
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
