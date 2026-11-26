import { reviewReasonsText } from "@/lib/entrySource";

/** Shown while an assistant entry waits for review, with its reasons on hover. */
export function ReviewBadge({ reasons }: { reasons?: string[] | null }) {
  const why = reviewReasonsText(reasons);
  return (
    <span
      className="inline-flex shrink-0 items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[11px] text-amber-700 dark:text-amber-300"
      title={why ? `To review: ${why}` : "To review"}
    >
      To review
    </span>
  );
}
