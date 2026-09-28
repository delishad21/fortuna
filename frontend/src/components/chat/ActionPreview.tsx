"use client";
import { useEffect, useRef, useState } from "react";
import {
  Proposal,
  changedFields,
  displayValue,
  fieldLabel,
} from "@/lib/chat/client";
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
  const pending =
    proposal.status === "pending" && new Date(proposal.expiresAt) > new Date();
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
        <h2 id="approval-title" className="text-xl font-semibold">
          {preview.title || "Review changes"}
        </h2>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="space-y-5 p-5">
        <p className="text-sm">
          Only these changes will be applied. If the underlying records have
          changed, you’ll need a fresh preview.
        </p>
        {preview.changes?.map((change: any) => (
          <section
            key={change.id}
            className="overflow-hidden rounded-lg border border-stroke dark:border-stroke-dark"
          >
            <h3 className="bg-gray-2 p-3 font-medium dark:bg-dark-3">
              {change.before.description || change.id}
            </h3>
            <table className="w-full table-fixed text-left text-sm">
              <thead>
                <tr>
                  <th className="p-3">Field</th>
                  <th className="p-3">Before</th>
                  <th className="p-3">After</th>
                </tr>
              </thead>
              <tbody>
                {changedFields(change.before, change.after).map((key) => (
                  <tr
                    key={key}
                    className="border-t border-stroke align-top dark:border-stroke-dark"
                  >
                    <th className="break-words p-3 capitalize font-medium">
                      {fieldLabel(key)}
                    </th>
                    <td className="break-words whitespace-pre-wrap p-3">
                      {displayValue(change.before[key])}
                    </td>
                    <td className="break-words whitespace-pre-wrap bg-primary/5 p-3">
                      {displayValue(change.after[key])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {!preview.changes && <DataDetails value={preview} />}
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
          <p role="status">
            This proposal is{" "}
            {proposal.status === "pending" ? "expired" : proposal.status}. Ask
            for a fresh preview if needed.
          </p>
        )}
      </div>
      <div className="sticky bottom-0 flex justify-end gap-3 border-t border-stroke bg-white p-5 dark:border-stroke-dark dark:bg-gray-dark">
        {!pending && ["pending", "stale"].includes(proposal.status) && (
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
        <Button
          variant="secondary"
          disabled={busy || !pending}
          onClick={() => void decide("reject")}
        >
          Reject
        </Button>
        <Button
          disabled={
            busy ||
            !pending ||
            preview.valid === false ||
            (duplicates && !override)
          }
          isLoading={busy}
          onClick={() => void decide("approve")}
        >
          Confirm changes
        </Button>
      </div>
    </dialog>
  );
}
