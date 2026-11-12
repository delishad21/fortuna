"use client";
import { useEffect, useRef, useState } from "react";
import {
  NEEDS_APPROVAL,
  Proposal,
  displayValue,
  fieldLabel,
  previewHasChanges,
  proposalState,
  timeLeft,
} from "@/lib/chat/client";
import { ProposalView } from "./ProposalView";
import { Button } from "@/components/ui/Button";
export function DataDetails({ value }: { value: unknown }) {
  if (Array.isArray(value))
    return (
      <div className="space-y-3">
        {value.map((item, i) => (
          <div
            key={i}
            className="border-l-2 border-stroke pl-3 dark:border-stroke-dark"
          >
            <DataDetails value={item} />
          </div>
        ))}
      </div>
    );
  if (value && typeof value === "object")
    return (
      <dl className="space-y-2">
        {Object.entries(value).map(([key, item]) => (
          <div key={key} className="min-w-0">
            <dt className="text-xs font-medium capitalize text-dark-5 dark:text-dark-6">
              {fieldLabel(key)}
            </dt>
            <dd className="break-words whitespace-pre-wrap text-sm">
              <DataDetails value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return <>{displayValue(value)}</>;
}
export function ActionPreview({
  proposal,
  onClose,
  onDecide,
  onRefresh,
}: {
  proposal: Proposal;
  onClose: () => void;
  onDecide: (
    decision: "approve" | "reject",
    override: boolean,
  ) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [busy, setBusy] = useState(false),
    [override, setOverride] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    const previous = document.activeElement as HTMLElement;
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  const preview = proposal.preview || {},
    duplicates =
      Array.isArray(preview.duplicates) && preview.duplicates.length > 0;
  const state = proposalState(proposal),
    pending = state.pending;
  async function decide(value: "approve" | "reject") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onDecide(value, override);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="approval-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
      className="m-auto max-h-[90dvh] w-[min(96vw,850px)] rounded-xl bg-white p-0 text-dark shadow-xl backdrop:bg-black/50 dark:bg-gray-dark dark:text-white"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-stroke bg-white p-5 dark:border-stroke-dark dark:bg-gray-dark">
        <div className="min-w-0">
          <h2 id="approval-title" className="text-xl font-semibold">
            {preview.title || "Review changes"}
          </h2>
          <p
            className={`mt-1 text-xs font-medium ${pending ? "text-primary" : "text-dark-5 dark:text-dark-6"}`}
          >
            {pending
              ? [NEEDS_APPROVAL, timeLeft(proposal.expiresAt)]
                  .filter(Boolean)
                  .join(" · ")
              : state.label}
          </p>
        </div>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="space-y-5 p-5">
        {pending && (
          <p className="text-sm text-dark-5 dark:text-dark-6">
            Only these changes will be applied. If the records change before you
            confirm, you’ll be asked for a fresh preview.
          </p>
        )}
        <ProposalView proposal={proposal} />
        {duplicates && (
          <label className="flex gap-3 rounded-lg border border-orange p-4">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
            />
            I reviewed the duplicate matches and want to commit them anyway.
          </label>
        )}
        {error && (
          <p role="alert" className="text-red">
            {error}
          </p>
        )}
        {!pending && (
          <p
            role="status"
            className="rounded-lg bg-gray-2 px-3 py-2 text-sm dark:bg-dark-3"
          >
            {state.label}.
            {["expired", "stale"].includes(state.status) &&
              " Refresh the preview or ask Fortuna for a new one."}
          </p>
        )}
      </div>
      {(pending || ["expired", "stale"].includes(state.status)) && (
        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-stroke bg-white p-5 dark:border-stroke-dark dark:bg-gray-dark">
          {["expired", "stale"].includes(state.status) && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void onRefresh()
                  .catch((e) => setError(e.message))
                  .finally(() => {
                    setBusy(false);
                    setOverride(false);
                  });
              }}
            >
              Refresh preview
            </Button>
          )}
          {pending && (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void decide("reject")}
              >
                Reject
              </Button>
              <Button
                disabled={
                  busy ||
                  preview.valid === false ||
                  !previewHasChanges(proposal) ||
                  (duplicates && !override)
                }
                isLoading={busy}
                onClick={() => void decide("approve")}
              >
                Confirm changes
              </Button>
            </>
          )}
        </div>
      )}
    </dialog>
  );
}
