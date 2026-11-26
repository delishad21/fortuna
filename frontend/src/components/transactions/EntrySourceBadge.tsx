import { CheckCircle2, Circle } from "lucide-react";
import { entrySourceLabel, reconciledLabel } from "@/lib/entrySource";

/** Where a transaction came from, with a tick once a statement has confirmed it. */
export function EntrySourceBadge({
  entrySource,
  reconciled,
}: {
  entrySource: string;
  reconciled?: boolean | null;
}) {
  const state = reconciledLabel(reconciled);
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded border border-stroke dark:border-dark-3 px-1.5 py-px text-[11px] text-dark-5 dark:text-dark-6"
      title={`${entrySourceLabel(entrySource)} · ${state}`}
    >
      {entrySourceLabel(entrySource)}
      {reconciled ? (
        <CheckCircle2 className="h-3 w-3 text-green" aria-label={state} />
      ) : (
        <Circle className="h-3 w-3" aria-label={state} />
      )}
    </span>
  );
}
