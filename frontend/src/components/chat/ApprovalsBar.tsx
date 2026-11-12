"use client";
import { useEffect, useState } from "react";
import { ChevronDown, CircleAlert, X } from "lucide-react";
import {
  approvalsBarDismissed,
  approvalsDismissedKey,
  CANCEL_REVIEW_CONFIRM,
  Proposal,
  proposalSummary,
  RunReview,
  waitingForUser,
  waitingIds,
  waitingText,
} from "@/lib/chat/client";

const readDismissed = (conversationId: string): string[] | null => {
  try {
    const stored = JSON.parse(
      localStorage.getItem(approvalsDismissedKey(conversationId)) || "null",
    );
    return Array.isArray(stored) ? stored : null;
  } catch {
    return null;
  }
};

/**
 * The bar above the composer while proposals or reviews wait. Review scrolls to the first
 * one; the list closes each on the spot; ✕ hides the bar until something new is waiting.
 * Render it only once the conversation has loaded: an empty `waiting` forgets the ✕.
 */
export function ApprovalsBar({
  conversationId,
  waiting,
  disabled,
  onReview,
  onReject,
  onCancelReview,
}: {
  conversationId: string;
  waiting: ReturnType<typeof waitingForUser>;
  disabled: boolean;
  onReview: () => void;
  onReject: (proposal: Proposal) => void;
  onCancelReview: (review: RunReview) => void;
}) {
  const [dismissed, setDismissed] = useState<{
    conversationId: string;
    ids: string[] | null;
  } | null>(null);
  const [open, setOpen] = useState(false);
  const ids = waitingIds(waiting);
  const line = waitingText(waiting.proposals.length, waiting.reviews.length);
  useEffect(() => {
    setDismissed({ conversationId, ids: readDismissed(conversationId) });
    setOpen(false);
  }, [conversationId]);
  const stored = dismissed?.conversationId === conversationId;
  useEffect(() => {
    // Nothing waits any more: forget the dismissal, so the next item shows the bar.
    if (stored && !ids.length && dismissed?.ids) {
      localStorage.removeItem(approvalsDismissedKey(conversationId));
      setDismissed({ conversationId, ids: null });
    }
  }, [stored, ids.length, dismissed?.ids, conversationId]);
  if (!line || !stored || approvalsBarDismissed(dismissed?.ids, ids))
    return null;
  const hide = () => {
    localStorage.setItem(
      approvalsDismissedKey(conversationId),
      JSON.stringify(ids),
    );
    setDismissed({ conversationId, ids });
    setOpen(false);
  };
  const itemButton =
    "shrink-0 rounded-md border border-stroke bg-white px-2 py-1 text-xs font-medium hover:bg-gray-2 disabled:opacity-50 dark:border-stroke-dark dark:bg-dark-2 dark:hover:bg-dark-3";
  return (
    <div
      aria-label="Pending approvals"
      role="region"
      className="rounded-lg border border-primary bg-primary/10 text-sm text-dark dark:text-white"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <CircleAlert size={16} aria-hidden className="shrink-0 text-primary" />
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1 text-left font-medium"
        >
          <span className="min-w-0 truncate">{line}</span>
          <ChevronDown
            size={15}
            aria-hidden
            className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        <button
          type="button"
          onClick={onReview}
          className="shrink-0 font-semibold text-primary"
        >
          Review
        </button>
        <button
          type="button"
          aria-label="Hide until something new needs your approval"
          title="Hide until something new needs your approval"
          onClick={hide}
          className="-mr-1 shrink-0 rounded p-1 text-dark-5 hover:bg-primary/15 dark:text-dark-6"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      {open && (
        <ul className="max-h-48 space-y-1 overflow-y-auto border-t border-primary/30 px-3 py-2">
          {waiting.proposals.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">
                <span className="text-dark-5 dark:text-dark-6">Change · </span>
                {proposalSummary(p).title}
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onReject(p)}
                className={itemButton}
              >
                Reject
              </button>
            </li>
          ))}
          {waiting.reviews.map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">
                <span className="text-dark-5 dark:text-dark-6">Review · </span>
                {r.title}
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (window.confirm(CANCEL_REVIEW_CONFIRM)) onCancelReview(r);
                }}
                className={itemButton}
              >
                Cancel
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
