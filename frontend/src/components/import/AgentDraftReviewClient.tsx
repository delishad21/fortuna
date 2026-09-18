"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, Check, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import {
  commitAgentDraft,
  decideAgentProposal,
  getAgentDraft,
  updateAgentDraftRow,
  validateAgentDraft,
} from "@/app/actions/agentDrafts";

import { getCategories } from "@/app/actions/categories";
import { getAccountNumbers } from "@/app/actions/accountNumbers";

type Draft = Record<string, any> & { rows: Array<Record<string, any>> };

function amount(payload: Record<string, any>) {
  const value = Number(
    payload.amountOut || payload.amountIn || payload.localAmount || 0,
  );
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: payload.currency || payload.localCurrency || "SGD",
  }).format(value);
}

export function AgentDraftReviewClient({
  initialDraft,
}: {
  initialDraft: Draft;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [filter, setFilter] = useState("Needs review");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<string, any>>({});
  const [categories, setCategories] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [accounts, setAccounts] = useState<
    Array<{ accountIdentifier: string }>
  >([]);
  useEffect(() => {
    Promise.all([getCategories({ scope: "settings" }), getAccountNumbers()])
      .then(([c, a]) => {
        setCategories(c);
        setAccounts(a);
      })
      .catch((error) => setMessage(error.message));
  }, []);
  const closed =
    ["committed", "discarded", "expired"].includes(draft.status) ||
    new Date(draft.expiresAt) <= new Date();
  const rows = draft.rows.filter((row) => {
    const review = row.review || {};
    const match =
      filter === "All" ||
      (filter === "Needs review" && review.needsReview) ||
      (filter === "Labelling" && review.labelling) ||
      (filter === "Reconciliation" && review.reconciliation) ||
      (filter === "Ready" && !review.needsReview);
    return (
      match &&
      `${row.currentPayload?.label || ""} ${row.currentPayload?.description || ""}`
        .toLowerCase()
        .includes(search.toLowerCase())
    );
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    const next = await getAgentDraft(draft.id);
    setDraft(next.draft as Draft);
  };

  const decide = async (proposalId: string, decision: "accept" | "reject") => {
    setBusy(proposalId);
    setMessage(null);
    try {
      await decideAgentProposal(proposalId, decision);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Decision failed");
    } finally {
      setBusy(null);
    }
  };

  const toggleSelected = async (row: Record<string, any>) => {
    setBusy(row.id);
    try {
      await updateAgentDraftRow(draft.id, row.id, {
        expectedVersion: row.version,
        selected: !row.selected,
      });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const validateAndCommit = async () => {
    setBusy("commit");
    setMessage(null);
    try {
      const validation = await validateAgentDraft(draft.id);
      if (!validation.valid) {
        setMessage(
          [...(validation.errors || []), ...(validation.warnings || [])]
            .map(
              (item: any) =>
                `${item.rowIndex !== undefined ? `Row ${item.rowIndex + 1}: ` : ""}${item.message}`,
            )
            .join("\n") || "Review the flagged rows before committing.",
        );
        await refresh();
        return;
      }
      if (
        !window.confirm(
          `${validation.duplicates?.length ? `${validation.duplicates.length} possible duplicates found. Review these before continuing.\n` : ""}Commit ${validation.summary.selected} selected rows? This writes financial records and cannot be automatically undone.`,
        )
      )
        return;
      await commitAgentDraft(draft.id, validation.confirmationToken);
      setMessage("Import committed successfully.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Commit failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            href="/imports"
            className="mb-2 inline-flex items-center gap-1 text-sm text-primary"
          >
            <ArrowLeft className="size-4" /> Imports
          </Link>
          <h1 className="font-display text-3xl font-bold text-dark dark:text-white">
            Agent Import Draft
          </h1>
          <p className="text-sm text-dark-5 dark:text-dark-6">
            {draft.sourceFilename} · {draft.mode} · version {draft.version} ·{" "}
            {draft.status}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={!!busy}
            onClick={() =>
              void refresh().catch((error) => setMessage(error.message))
            }
            leftIcon={<RefreshCw className="size-4" />}
          >
            Refresh
          </Button>
          {!closed && (
            <Button
              disabled={!!busy}
              onClick={validateAndCommit}
              isLoading={busy === "commit"}
              leftIcon={<Check className="size-4" />}
            >
              Validate and Commit
            </Button>
          )}
        </div>
      </div>

      {message && (
        <div className="whitespace-pre-wrap rounded-lg border border-stroke p-3 text-sm text-dark dark:border-dark-3 dark:text-white">
          {message}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {["Needs review", "Labelling", "Reconciliation", "Ready", "All"].map(
          (value) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`min-h-11 rounded-lg border px-4 text-sm ${filter === value ? "border-primary bg-primary/10 text-primary" : "border-stroke text-dark dark:border-dark-3 dark:text-white"}`}
            >
              {value}
            </button>
          ),
        )}
      </div>
      <input
        aria-label="Search staged transactions"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search description or label"
        className="min-h-11 w-full rounded-lg border border-stroke bg-white px-3 text-dark dark:border-dark-3 dark:bg-gray-dark dark:text-white"
      />
      <p className="text-sm text-dark-5 dark:text-dark-6">
        {draft.reviewSummary?.needsReview || 0} need review ·{" "}
        {draft.reviewSummary?.ready || 0} ready ·{" "}
        {draft.rows.filter((r) => r.selected).length} selected. Ready rows are
        still staged until you commit.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Review Rows ({draft.rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.length === 0 && (
            <p className="py-6 text-dark-5 dark:text-dark-6">
              No transactions match this view. Choose All to see every staged
              row.
            </p>
          )}
          {rows.map((row) => {
            const payload = row.currentPayload || {};
            const proposals = (row.proposals || []) as Array<
              Record<string, any>
            >;
            return (
              <div
                key={row.id}
                className="rounded-lg border border-stroke p-4 dark:border-dark-3"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="checkbox"
                        checked={row.selected}
                        aria-label={`Select row ${row.rowIndex + 1}`}
                        disabled={!!busy || closed}
                        onChange={() => toggleSelected(row)}
                      />
                      <span className="font-semibold text-dark dark:text-white">
                        {payload.label || payload.description}
                      </span>
                      <span className="rounded bg-gray-2 px-2 py-0.5 text-xs dark:bg-dark-3">
                        {row.reviewStatus}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                      {payload.date} · {payload.description} · {amount(payload)}
                    </p>
                    <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                      Category:{" "}
                      {categories.find((c) => c.id === payload.categoryId)
                        ?.name || "Unassigned"}
                      {payload.tripId ? ` · Trip: ${payload.tripId}` : ""}
                    </p>
                  </div>
                </div>
                {row.review?.reasons?.map((reason: string) => (
                  <p key={reason} className="mt-2 text-sm text-primary">
                    {reason}
                  </p>
                ))}
                {!closed && (
                  <div className="mt-3">
                    <Button
                      variant="secondary"
                      disabled={!!busy}
                      onClick={() => {
                        setEditing(row.id);
                        setEdit({ ...payload });
                      }}
                    >
                      Edit label, category & account
                    </Button>
                  </div>
                )}
                {editing === row.id && (
                  <div className="mt-4 space-y-3">
                    {[
                      { key: "label", name: "Label" },
                      { key: "description", name: "Description" },
                    ].map((f) => (
                      <label
                        key={f.key}
                        className="block text-sm text-dark dark:text-white"
                      >
                        {f.name}
                        <input
                          value={edit[f.key] || ""}
                          onChange={(e) =>
                            setEdit((old) => ({
                              ...old,
                              [f.key]: e.target.value,
                            }))
                          }
                          className="mt-1 min-h-11 w-full rounded border border-stroke bg-transparent px-3 dark:border-dark-3"
                        />
                      </label>
                    ))}
                    <label className="block text-sm text-dark dark:text-white">
                      Category
                      <select
                        value={edit.categoryId || ""}
                        onChange={(e) =>
                          setEdit((old) => ({
                            ...old,
                            categoryId: e.target.value || null,
                          }))
                        }
                        className="mt-1 min-h-11 w-full rounded border border-stroke bg-white px-3 dark:border-dark-3 dark:bg-gray-dark"
                      >
                        <option value="">Unassigned</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {draft.mode === "main" && (
                      <label className="block text-sm text-dark dark:text-white">
                        Account
                        <select
                          value={edit.accountIdentifier || ""}
                          onChange={(e) =>
                            setEdit((old) => ({
                              ...old,
                              accountIdentifier: e.target.value,
                            }))
                          }
                          className="mt-1 min-h-11 w-full rounded border border-stroke bg-white px-3 dark:border-dark-3 dark:bg-gray-dark"
                        >
                          <option value="">Choose account</option>
                          {accounts.map((a) => (
                            <option
                              key={a.accountIdentifier}
                              value={a.accountIdentifier}
                            >
                              {a.accountIdentifier}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {draft.mode === "main" && (
                      <label className="flex items-center gap-2 text-sm text-dark dark:text-white">
                        <input
                          type="checkbox"
                          checked={edit.linkage?.type === "internal"}
                          onChange={(e) =>
                            setEdit((old) => ({
                              ...old,
                              linkage: e.target.checked
                                ? { type: "internal" }
                                : null,
                            }))
                          }
                        />
                        Internal transfer
                      </label>
                    )}
                    {edit.linkage && (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          setEdit((old) => ({ ...old, linkage: null }))
                        }
                      >
                        Clear reconciliation links
                      </Button>
                    )}
                    <div className="flex gap-2">
                      <Button
                        disabled={!!busy}
                        onClick={async () => {
                          setBusy(row.id);
                          try {
                            if (!edit.description?.trim())
                              throw new Error("Description is required");
                            await updateAgentDraftRow(draft.id, row.id, {
                              expectedVersion: row.version,
                              currentPayload: edit,
                              reviewStatus: "edited",
                            });
                            setEditing(null);
                            await refresh();
                          } catch (error) {
                            setMessage(
                              error instanceof Error
                                ? error.message
                                : "Save failed",
                            );
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        Save row
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
                {proposals.map((proposal) => (
                  <div
                    key={proposal.id}
                    className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3"
                  >
                    <div className="flex items-start gap-2">
                      <Bot className="mt-0.5 size-4 text-primary" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-dark dark:text-white">
                          Hermes proposal ·{" "}
                          {Math.round(Number(proposal.confidence) * 100)}% ·{" "}
                          {proposal.status}
                        </p>
                        <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                          {proposal.reason}
                        </p>
                        <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                          Label: {proposal.proposedLabel || "unchanged"} ·
                          Category:{" "}
                          {categories.find(
                            (c) => c.id === proposal.proposedCategoryId,
                          )?.name || "unchanged"}{" "}
                          · Trip: {proposal.proposedTripId || "none"} · Entry:{" "}
                          {proposal.proposedTripEntryType || "unchanged"}
                        </p>
                      </div>
                    </div>
                    {proposal.proposedLinkage && (
                      <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-dark dark:text-white">
                        {JSON.stringify(proposal.proposedLinkage, null, 2)}
                      </pre>
                    )}
                    {proposal.status === "proposed" && !closed && (
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          disabled={!!busy}
                          onClick={() => decide(proposal.id, "accept")}
                          isLoading={busy === proposal.id}
                          leftIcon={<Check className="size-3" />}
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => decide(proposal.id, "reject")}
                          disabled={!!busy}
                          leftIcon={<X className="size-3" />}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
