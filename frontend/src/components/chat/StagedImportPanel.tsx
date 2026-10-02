"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, X } from "lucide-react";
import { getAgentDraft } from "@/app/actions/agentDrafts";
import { AgentDraftReviewClient } from "@/components/import/AgentDraftReviewClient";

/** A staged import opened beside the conversation, sliding in from the right. */
export function StagedImportPanel({
  draftId,
  returnTo,
  onClose,
  onCommitted,
}: {
  draftId: string;
  returnTo: string;
  onClose: () => void;
  onCommitted: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, any> | null>(null),
    [error, setError] = useState(""),
    [shown, setShown] = useState(false);
  const panel = useRef<HTMLElement>(null);
  // The chat re-renders while polling; keep focus and listeners stable across those renders.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    let live = true;
    setDraft(null);
    setError("");
    getAgentDraft(draftId)
      .then((v) => live && setDraft(v.draft))
      .catch(
        (e) => live && setError(e.message || "Could not load this import"),
      );
    return () => {
      live = false;
    };
  }, [draftId]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);
  return (
    <div className="absolute inset-0 z-40 flex justify-end">
      <button
        aria-label="Close staged import"
        onClick={onClose}
        className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`}
      />
      <section
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Staged import"
        className={`relative flex h-full w-full max-w-[min(1100px,92%)] flex-col border-l border-stroke bg-white shadow-xl outline-none transition-transform duration-200 ease-out dark:border-stroke-dark dark:bg-gray-dark ${shown ? "translate-x-0" : "translate-x-full"}`}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-stroke px-4 py-3 dark:border-stroke-dark">
          <h2 className="min-w-0 flex-1 truncate font-semibold">
            {draft?.sourceFilename || "Staged import"}
          </h2>
          <Link
            href={`/imports/drafts/${encodeURIComponent(draftId)}?returnTo=${encodeURIComponent(returnTo)}`}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-primary hover:bg-gray-2 dark:hover:bg-dark-3"
          >
            <ExternalLink size={14} aria-hidden />
            Full page
          </Link>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 hover:bg-gray-2 dark:hover:bg-dark-3"
          >
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden p-4">
          {error ? (
            <p role="alert" className="text-sm text-red">
              {error}
            </p>
          ) : draft ? (
            <AgentDraftReviewClient
              initialDraft={draft as any}
              embedded
              fill
              onCommitted={onCommitted}
            />
          ) : (
            <p role="status" className="text-sm text-dark-5">
              Loading staged import…
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
