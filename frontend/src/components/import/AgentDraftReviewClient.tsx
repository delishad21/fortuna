"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Check, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TransactionTable } from "@/components/transaction-table/TransactionTable";
import { ReimbursementSelectorModal } from "./ReimbursementSelectorModal";
import type {
  Transaction,
  TransactionLinkage,
} from "@/components/transaction-table/types";
import {
  commitAgentDraft,
  decideAgentProposal,
  getAgentDraft,
  updateAgentDraftRow,
  validateAgentDraftSelection,
} from "@/app/actions/agentDrafts";
import { getCategories } from "@/app/actions/categories";
import { getAccountNumbers } from "@/app/actions/accountNumbers";

type DraftRow = Record<string, any>;
type Draft = Record<string, any> & { rows: DraftRow[] };
type RowUpdate = {
  currentPayload?: Record<string, unknown>;
  selected?: boolean;
};

function rowTone(row: DraftRow) {
  if (row.review?.labelling) return "needs_label";
  if (
    (row.proposals || []).some((proposal: Record<string, any>) =>
      ["proposed", "accepted", "auto_applied"].includes(proposal.status),
    )
  )
    return "llm";
  const payload = row.currentPayload || {};
  if (
    payload.suggestionApplied ||
    payload.suggestionSource ||
    payload.suggestedLabel ||
    payload.suggestedCategoryId
  )
    return "algorithm";
  return "";
}

function tableTransaction(draft: Draft, row: DraftRow): Transaction {
  const payload = row.currentPayload || {};
  const acceptedProposal = (row.proposals || []).find(
    (proposal: Record<string, any>) =>
      proposal.status === "accepted" || proposal.status === "auto_applied",
  );
  return {
    ...payload,
    date: String(payload.date || "").slice(0, 10),
    description: payload.description || "",
    metadata: {
      ...(payload.metadata || {}),
      sourceFilename: draft.sourceFilename,
      reviewStatus: row.reviewStatus,
      reviewTint: rowTone(row),
    },
    suggestedLabel: acceptedProposal?.proposedLabel || payload.suggestedLabel,
    suggestedCategoryId:
      acceptedProposal?.proposedCategoryId || payload.suggestedCategoryId,
    suggestionApplied: rowTone(row) === "algorithm",
    suggestionSource: payload.suggestionSource || "heuristic",
  };
}

export function AgentDraftReviewClient({
  initialDraft,
  initialDrafts,
  embedded = false,
  onCommitted,
}: {
  initialDraft?: Draft;
  initialDrafts?: Draft[];
  embedded?: boolean;
  onCommitted?: () => void;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>(
    initialDrafts || (initialDraft ? [initialDraft] : []),
  );
  const draftsRef = useRef(drafts);
  const rowUpdateQueuesRef = useRef(new Map<string, Promise<void>>());
  const pendingUpdateCountRef = useRef(0);
  const [categories, setCategories] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingCommit, setPendingCommit] = useState<Record<string, any> | null>(null);
  const [reimbursement, setReimbursement] = useState<null | {
    globalIndex: number;
    transactions: Transaction[];
    currentIndex: number;
  }>(null);

  useEffect(() => {
    Promise.all([getCategories({ scope: "settings" }), getAccountNumbers()])
      .then(([nextCategories, nextAccounts]) => {
        setCategories(nextCategories);
        setAccounts(nextAccounts);
      })
      .catch((error) => setMessage(error.message));
  }, []);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  const flatRows = useMemo(
    () =>
      drafts
        .flatMap((draft) =>
          (draft.rows || []).map((row) => ({
            draft,
            row,
            transaction: tableTransaction(draft, row),
          })),
        )
        .sort((left, right) => {
          const dateOrder = String(left.transaction.date || "").localeCompare(
            String(right.transaction.date || ""),
          );
          if (dateOrder !== 0) return dateOrder;
          const draftOrder = String(
            left.draft.sourceFilename || "",
          ).localeCompare(String(right.draft.sourceFilename || ""));
          return draftOrder !== 0
            ? draftOrder
            : Number(left.row.rowIndex || 0) - Number(right.row.rowIndex || 0);
        }),
    [drafts],
  );
  const transactions = flatRows.map((item) => item.transaction);
  const selectedIndices = new Set(
    flatRows.flatMap((item, index) => (item.row.selected ? [index] : [])),
  );

  const refresh = async () => {
    const nextDrafts = await Promise.all(
      draftsRef.current.map((draft) =>
        getAgentDraft(draft.id).then((result) => result.draft as Draft),
      ),
    );
    draftsRef.current = nextDrafts;
    setDrafts(nextDrafts);
  };

  const replaceDraft = (draftId: string, nextDraft: Draft) => {
    const nextDrafts = draftsRef.current.map((draft) =>
      draft.id === draftId ? nextDraft : draft,
    );
    draftsRef.current = nextDrafts;
    setDrafts(nextDrafts);
  };

  const updateRow = (
    index: number,
    createInput: (latestRow: DraftRow) => RowUpdate,
  ) => {
    const item = flatRows[index];
    if (!item) return;
    const draftId = String(item.draft.id);
    const rowId = String(item.row.id);
    const queueKey = `${draftId}:${rowId}`;
    const previous = rowUpdateQueuesRef.current.get(queueKey) ||
      Promise.resolve();

    pendingUpdateCountRef.current += 1;
    setBusy(true);
    setMessage("");
    setPendingCommit(null);

    const run = previous
      .catch(() => undefined)
      .then(async () => {
        let latestDraft = draftsRef.current.find(
          (draft) => String(draft.id) === draftId,
        );
        let latestRow = latestDraft?.rows.find(
          (row) => String(row.id) === rowId,
        );
        if (!latestDraft || !latestRow) return;

        const save = (row: DraftRow) => {
          const input = createInput(row);
          return updateAgentDraftRow(draftId, rowId, {
            expectedVersion: row.version,
            ...input,
            ...(input.currentPayload
              ? { reviewStatus: "edited" as const }
              : {}),
          });
        };

        try {
          await save(latestRow);
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "Draft row is stale") {
            throw error;
          }
          const refreshed = (await getAgentDraft(draftId)).draft as Draft;
          replaceDraft(draftId, refreshed);
          latestDraft = refreshed;
          latestRow = refreshed.rows.find((row) => String(row.id) === rowId);
          if (!latestRow) return;
          await save(latestRow);
        }

        const refreshed = (await getAgentDraft(draftId)).draft as Draft;
        replaceDraft(draftId, refreshed);
      })
      .catch((error) => {
        setMessage(
          error instanceof Error ? error.message : "Could not update row",
        );
      })
      .finally(() => {
        if (rowUpdateQueuesRef.current.get(queueKey) === run) {
          rowUpdateQueuesRef.current.delete(queueKey);
        }
        pendingUpdateCountRef.current -= 1;
        if (pendingUpdateCountRef.current === 0) setBusy(false);
      });

    rowUpdateQueuesRef.current.set(queueKey, run);
  };

  const updateField = (index: number, field: string, value: any) => {
    const item = flatRows[index];
    if (!item) return;
    updateRow(index, (latestRow) => ({
      currentPayload: { ...latestRow.currentPayload, [field]: value },
    }));
  };

  const setAllSelected = async (selected: boolean) => {
    setBusy(true);
    setMessage("");
    setPendingCommit(null);
    try {
      await Promise.all(
        flatRows
          .filter((item) => item.row.selected !== selected)
          .map((item) =>
            updateAgentDraftRow(item.draft.id, item.row.id, {
              expectedVersion: item.row.version,
              selected,
            }),
          ),
      );
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not update rows",
      );
    } finally {
      setBusy(false);
    }
  };

  const commitValidated = async (selection: Record<string, any>) => {
    setBusy(true);
    setMessage("");
    try {
      for (const { draftId, validation } of selection.validations) {
        await commitAgentDraft(draftId, validation.confirmationToken);
      }
      setPendingCommit(null);
      if (onCommitted) onCommitted();
      else {
        router.push("/imports?tab=history");
        router.refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Commit failed");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const commitSelectedDrafts = async () => {
    setBusy(true);
    setMessage("");
    setPendingCommit(null);
    try {
      const candidates = drafts.filter((draft) =>
        draft.rows.some((row: DraftRow) => row.selected),
      );
      if (!candidates.length) return;
      const selection = await validateAgentDraftSelection(candidates.map((draft) => draft.id));
      const invalid = selection.validations.filter((item: Record<string, any>) => !item.validation.valid);
      if (invalid.length) {
        setMessage(
          invalid
            .flatMap(({ filename, validation }: Record<string, any>) =>
              [
                ...(validation.errors || []),
                ...(validation.warnings || []),
              ].map(
                (item: any) =>
                  `${filename}${item.rowIndex !== undefined ? ` row ${item.rowIndex + 1}` : ""}: ${item.message}`,
              ),
            )
            .join("\n") || "Resolve the flagged rows before committing.",
        );
        await refresh();
        return;
      }
      const selected = selection.validations.reduce(
        (sum: number, item: Record<string, any>) => sum + Number(item.validation.summary?.selected || 0),
        0,
      );
      if (selection.duplicates.length) {
        setPendingCommit(selection);
        return;
      }
      if (
        !window.confirm(
          `Commit ${selected} selected rows across ${selection.validations.length} staged import${selection.validations.length === 1 ? "" : "s"}?`,
        )
      )
        return;
      await commitValidated(selection);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Commit failed");
    } finally {
      setBusy(false);
    }
  };

  const openReimbursement = (globalIndex: number) => {
    const source = flatRows[globalIndex];
    if (!source) return;
    const sourceRows = flatRows.filter(
      (item) => item.draft.id === source.draft.id,
    );
    setReimbursement({
      globalIndex,
      transactions: sourceRows.map((item) => item.transaction),
      currentIndex: sourceRows.findIndex(
        (item) => item.row.id === source.row.id,
      ),
    });
  };

  return (
    <div className={embedded ? "h-[68vh]" : "h-[calc(100vh-9rem)] space-y-3"}>
      {!embedded && (
        <div className="flex items-end justify-between">
          <div>
            <Link href="/imports" className="text-sm text-primary">
              ← Imports
            </Link>
            <h1 className="font-display text-2xl font-bold text-dark dark:text-white">
              {drafts.length === 1
                ? drafts[0].sourceFilename
                : "Staged imports"}
            </h1>
          </div>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void refresh()}
            leftIcon={<RefreshCw className="size-4" />}
          >
            Refresh
          </Button>
        </div>
      )}
      {message && (
        <div className="whitespace-pre-wrap rounded-lg border border-stroke p-3 text-sm text-dark dark:border-dark-3 dark:text-white">
          {message}
        </div>
      )}
      {pendingCommit && (
        <section className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-dark dark:text-white" aria-label="Possible duplicate transactions">
          <h2 className="font-semibold">Review {pendingCommit.duplicates.length} possible duplicate{pendingCommit.duplicates.length === 1 ? "" : "s"}</h2>
          <p className="mt-1 text-dark-5 dark:text-dark-6">These selected rows look like transactions already saved or selected elsewhere in this staged import. Exclude a row if it should not be imported.</p>
          <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto">
            {pendingCommit.duplicates.map((finding: Record<string, any>, index: number) => (
              <li key={`${finding.row.rowId}:${finding.match.rowId}:${index}`} className="rounded-md bg-white/70 p-3 dark:bg-dark-3">
                <span className="font-medium">{finding.row.filename} · row {finding.row.rowIndex + 1}: {finding.row.date} · {finding.row.description} · {finding.row.amountIn ? "+" : "−"}S${Number(finding.row.amountIn || finding.row.amountOut || 0).toFixed(2)}</span>
                <span className="block text-dark-5 dark:text-dark-6">Matches {finding.match.source === "saved" ? "saved transaction" : `${finding.match.filename} row ${finding.match.rowIndex + 1}`}: {finding.match.date} · {finding.match.description} · {finding.reasons.join(", ")}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setPendingCommit(null)}>Back to review</Button>
            <Button disabled={busy} onClick={() => void commitValidated(pendingCommit)}>Commit anyway</Button>
          </div>
        </section>
      )}
      <TransactionTable
        parsedData={{
          success: true,
          filename: drafts.map((draft) => draft.sourceFilename).join("; "),
          parserId: `${drafts.length} staged group${drafts.length === 1 ? "" : "s"}`,
          transactions,
          count: transactions.length,
        }}
        transactions={transactions}
        categories={categories}
        accountIdentifier=""
        accountIdentifiers={accounts}
        selectedIndices={selectedIndices}
        isCheckingDuplicates={false}
        isImporting={busy}
        showAccountSelector={false}
        onUpdateTransaction={updateField}
        onAccountIdentifierChange={() => undefined}
        onTransactionAccountIdentifierChange={(index, value) =>
          updateField(index, "accountIdentifier", value)
        }
        onImport={() => void commitSelectedDrafts()}
        primaryActionLabel={`Validate & commit (${selectedIndices.size})`}
        onSelectAll={() => void setAllSelected(true)}
        onDeselectAll={() => void setAllSelected(false)}
        onToggleSelection={(index) =>
          updateRow(index, (latestRow) => ({ selected: !latestRow.selected }))
        }
        onAddCategoryClick={() =>
          setMessage(
            "Create new categories in Settings, then refresh this review.",
          )
        }
        onLinkageChange={(index, linkage) =>
          updateField(index, "linkage", linkage)
        }
        onOpenReimbursementSelector={openReimbursement}
        deferCellCommit
        lockLinkedReimbursements={false}
        allowReservedCategorySelection
        renderExpandedActions={(index) => {
          const item = flatRows[index];
          if (!item) return null;
          return (
            <div className="space-y-3">
              {(item.row.review?.reasons || []).map((reason: string) => (
                <p key={reason} className="text-sm text-primary">
                  {reason}
                </p>
              ))}
              {(item.row.proposals || []).map(
                (proposal: Record<string, any>) => (
                  <div
                    key={proposal.id}
                    className="rounded-lg border border-primary/20 bg-primary/5 p-3"
                  >
                    <div className="flex items-start gap-2">
                      <Bot className="mt-0.5 size-4 text-primary" />
                      <div className="flex-1">
                        <p className="font-medium text-dark dark:text-white">
                          LLM suggestion ·{" "}
                          {Math.round(Number(proposal.confidence) * 100)}% ·{" "}
                          {proposal.status}
                        </p>
                        <p className="mt-1 text-dark-5 dark:text-dark-6">
                          {proposal.reason}
                        </p>
                        <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                          Label: {proposal.proposedLabel || "unchanged"} ·
                          Category:{" "}
                          {categories.find(
                            (category) =>
                              category.id === proposal.proposedCategoryId,
                          )?.name || "unchanged"}
                        </p>
                      </div>
                    </div>
                    {proposal.status === "proposed" && (
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          disabled={busy}
                          leftIcon={<Check className="size-3" />}
                          onClick={() =>
                            void decideAgentProposal(
                              proposal.id,
                              "accept",
                            ).then(refresh)
                          }
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          leftIcon={<X className="size-3" />}
                          onClick={() =>
                            void decideAgentProposal(
                              proposal.id,
                              "reject",
                            ).then(refresh)
                          }
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                ),
              )}
            </div>
          );
        }}
      />
      {reimbursement && (
        <ReimbursementSelectorModal
          isOpen
          onClose={() => setReimbursement(null)}
          currentIndex={reimbursement.currentIndex}
          transactions={reimbursement.transactions}
          currentLinkage={
            reimbursement.transactions[reimbursement.currentIndex]?.linkage
          }
          categories={categories}
          excludeStagedDraftId={flatRows[reimbursement.globalIndex]?.draft.id}
          onConfirm={(linkage: TransactionLinkage) => {
            updateField(reimbursement.globalIndex, "linkage", linkage);
            setReimbursement(null);
          }}
        />
      )}
    </div>
  );
}
