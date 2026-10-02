"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getAgentDraft } from "@/app/actions/agentDrafts";
import { AgentDraftReviewClient } from "@/components/import/AgentDraftReviewClient";

/** A staged import opened over the whole chat area, sliding in from the right. */
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
    [shown, setShown] = useState(false),
    // Once slid in, drop the transform: a transformed ancestor becomes the containing block
    // for position:fixed menus (like the category picker) and pushes them out of view.
    [settled, setSettled] = useState(false);
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Escape in a field or open picker belongs to that control, not the panel.
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]"))
        return;
      close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);
  return (
    <div className="absolute inset-0 z-40 overflow-hidden">
      <section
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Staged import"
        onTransitionEnd={() => shown && setSettled(true)}
        className={`flex h-full w-full flex-col bg-white outline-none transition-transform duration-200 ease-out dark:bg-gray-dark ${settled ? "" : shown ? "translate-x-0" : "translate-x-full"}`}
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-stroke px-3 py-1.5 text-sm font-medium hover:bg-gray-2 dark:border-stroke-dark dark:hover:bg-dark-3"
          >
            <ArrowLeft size={15} aria-hidden />
            Back to chat
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
