/** Where a transaction came from, and whether a statement has confirmed it. Shared by web and mobile. */
export const ENTRY_SOURCES = ["assistant", "manual", "statement", "mobile"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export const ENTRY_SOURCE_LABELS: Record<EntrySource, string> = {
  assistant: "Assistant",
  manual: "Manual",
  statement: "Statement",
  mobile: "Mobile",
};

export const entrySourceLabel = (source: string | null | undefined) =>
  ENTRY_SOURCE_LABELS[source as EntrySource] ?? ENTRY_SOURCE_LABELS.manual;

/** Filter values for the reconciled state; "all" sends no filter. */
export type ReconciledFilter = "all" | "reconciled" | "unreconciled";

export const reconciledParam = (filter: ReconciledFilter | undefined) =>
  filter === "reconciled" ? true : filter === "unreconciled" ? false : undefined;

export const reconciledLabel = (reconciled: boolean | null | undefined) =>
  reconciled ? "Reconciled" : "Not reconciled";
