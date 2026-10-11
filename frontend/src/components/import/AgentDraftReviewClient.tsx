"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bot, Check, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TransactionTable } from "@/components/transaction-table/TransactionTable";
import { ReimbursementLinkPicker } from "@/components/reimbursement/ReimbursementLinkPicker";
import type { Transaction } from "@/components/transaction-table/types";
import {
  commitAgentDraftSelection,
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
  returnTo,
  fill = false,
  reviewActionLeft,
}: {
  initialDraft?: Draft;
  initialDrafts?: Draft[];
  embedded?: boolean;
  onCommitted?: () => void;
  /** Where "back" and a finished commit go, e.g. the chat that opened this import. */
  returnTo?: string;
  /** Embedded in a container that sets the height, such as the chat's side panel. */
  fill?: boolean;
  /** Rendered just left of the "Validate & commit" button. */
  reviewActionLeft?: ReactNode;
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
  const [linkPicker, setLinkPicker] = useState<null | {
    draftId: string;
    rowId: string;
    title: string;
    leftoverCategoryId: string | null;
    mode: "expenses" | "reimbursements";
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
      // One commit for every selected file: links between them are kept, and
      // nothing is saved if any file fails.
      await commitAgentDraftSelection(
        selection.validations.map(
          ({ draftId, validation }: Record<string, any>) => ({
            draftId,
            confirmationToken: validation.confirmationToken,
          }),
        ),
      );
      setPendingCommit(null);
      if (onCommitted) onCommitted();
      else {
        router.push(returnTo || "/imports?tab=history");
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

  /**
   * Mark a money-in row as a reimbursement if needed, then choose what it pays
   * back. On an expense, choose the money-in rows that paid it back instead.
   */
  const openReimbursement = async (globalIndex: number) => {
    const item = flatRows[globalIndex];
    if (!item) return;
    const draftId = String(item.draft.id);
    const rowId = String(item.row.id);
    const payload = item.row.currentPayload || {};
    if (!(Number(payload.amountIn || 0) > 0)) {
      if (Number(payload.amountOut || 0) > 0) openReimbursedBy(globalIndex);
      else setMessage("Add an amount before linking reimbursements.");
      return;
    }
    if (payload.linkage?.type !== "reimbursement") {
      setBusy(true);
      try {
        await rowUpdateQueuesRef.current.get(`${draftId}:${rowId}`)?.catch(() => undefined);
        const latest = (await getAgentDraft(draftId)).draft as Draft;
        const latestRow = latest.rows.find((row) => String(row.id) === rowId);
        if (!latestRow) return;
        await updateAgentDraftRow(draftId, rowId, {
          expectedVersion: latestRow.version,
          currentPayload: {
            ...latestRow.currentPayload,
            linkage: { type: "reimbursement", leftoverCategoryId: null },
          },
          reviewStatus: "edited",
        });
        replaceDraft(draftId, (await getAgentDraft(draftId)).draft as Draft);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not mark the row");
        return;
      } finally {
        setBusy(false);
      }
    }
    setLinkPicker({
      draftId,
      rowId,
      title: String(payload.label || payload.description || "Reimbursement"),
      leftoverCategoryId: payload.linkage?.leftoverCategoryId ?? null,
      mode: "expenses",
    });
  };

  const openReimbursedBy = (globalIndex: number) => {
    const item = flatRows[globalIndex];
    if (!item) return;
    const payload = item.row.currentPayload || {};
    setLinkPicker({
      draftId: String(item.draft.id),
      rowId: String(item.row.id),
      title: String(payload.label || payload.description || "Expense"),
      leftoverCategoryId: null,
      mode: "reimbursements",
    });
  };

  // Linked rows must be committed together: flag pairs where only one side is selected.
  const linkProblems = useMemo(() => {
    const rowsById = new Map<string, { draft: Draft; row: DraftRow; index: number }>();
    flatRows.forEach((item, index) =>
      rowsById.set(String(item.row.id), { draft: item.draft, row: item.row, index }),
    );
    const seen = new Set<string>();
    const problems: Array<{ key: string; message: string; selectIndex?: number }> = [];
    for (const item of flatRows) {
      const views = [
        ...(item.row.links?.asReimbursement || []),
        ...(item.row.links?.asExpense || []),
      ] as Array<Record<string, any>>;
      for (const view of views) {
        if (!view.stagedRowId) continue;
        const pairKey = [String(item.row.id), String(view.stagedRowId)].sort().join(":");
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        const partner = rowsById.get(String(view.stagedRowId));
        const name = (row: DraftRow) =>
          String(row.currentPayload?.label || row.currentPayload?.description || "row");
        if (!partner) {
          if (item.row.selected)
            problems.push({
              key: pairKey,
              message: `${item.draft.sourceFilename} row ${item.row.rowIndex + 1} (${name(item.row)}) is linked to row ${(view.rowIndex ?? 0) + 1} of ${view.filename || "another staged import"}, which isn't in this review. Open both imports together to commit them, or remove the link.`,
            });
          continue;
        }
        if (!!item.row.selected === !!partner.row.selected) continue;
        const unselected = item.row.selected ? partner : { draft: item.draft, row: item.row, index: flatRows.indexOf(item) };
        const selected = item.row.selected ? item : partner;
        problems.push({
          key: pairKey,
          message: `${selected.draft.sourceFilename} row ${selected.row.rowIndex + 1} (${name(selected.row)}) is linked to ${unselected.draft.sourceFilename} row ${unselected.row.rowIndex + 1} (${name(unselected.row)}), which isn't selected.`,
          selectIndex: unselected.index,
        });
      }
    }
    return problems;
  }, [flatRows]);

  return (
    <div
      className={
        embedded
          ? fill
            ? "h-full"
            : "h-[68vh]"
          : "h-[calc(100vh-9rem)] space-y-3"
      }
    >
      {!embedded && (
        <div className="flex items-end justify-between">
          <div>
            <Link href={returnTo || "/imports"} className="text-sm text-primary">
              {returnTo ? "← Back to chat" : "← Imports"}
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
      {linkProblems.length > 0 && (
        <section
          className="rounded-lg border border-yellow-dark/40 bg-yellow-light-4 p-3 text-sm text-dark dark:bg-dark-3 dark:text-white"
          aria-label="Linked rows that will not be committed together"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-yellow-dark" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="font-medium">
                Linked rows must be committed together
              </p>
              {linkProblems.map((problem) => (
                <div key={problem.key} className="flex flex-wrap items-center gap-2">
                  <span className="text-dark-5 dark:text-dark-6">{problem.message}</span>
                  {problem.selectIndex !== undefined && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        updateRow(problem.selectIndex as number, () => ({ selected: true }))
                      }
                    >
                      Select it
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
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
        reviewActionLeft={reviewActionLeft}
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
        onOpenReimbursementSelector={(index) => void openReimbursement(index)}
        onOpenReimbursedBySelector={openReimbursedBy}
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
      {linkPicker && (
        <ReimbursementLinkPicker
          isOpen
          subject={{ draftRowId: linkPicker.rowId }}
          mode={linkPicker.mode}
          subjectTitle={linkPicker.title}
          currentDraftId={linkPicker.draftId}
          contextDraftIds={drafts.map((draft) => String(draft.id))}
          categories={linkPicker.mode === "expenses" ? categories : undefined}
          initialLeftoverCategoryId={linkPicker.leftoverCategoryId}
          onClose={() => setLinkPicker(null)}
          onSaved={async ({ warnings }) => {
            setLinkPicker(null);
            await refresh();
            if (warnings.length) setMessage(warnings.join("\n"));
          }}
        />
      )}
    </div>
  );
}
