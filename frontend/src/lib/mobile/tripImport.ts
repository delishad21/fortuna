import { buildTripImportPayload } from "@/components/trips/tripImportPayload";
import type { Transaction } from "@/components/transaction-table/types";

// Reuse the web import normalization, preserving top-ups, fees and transfer metadata.
export function prepareReviewedTripRows(
  rows: Record<string, any>[],
  selected: number[],
) {
  if (
    !Array.isArray(rows) ||
    !Array.isArray(selected) ||
    !selected.length ||
    new Set(selected).size !== selected.length
  )
    throw new Error("Select valid rows to import");
  const remap = new Map(selected.map((index, position) => [index, position]));
  return selected.map((index) => {
    if (!Number.isInteger(index) || index < 0 || index >= rows.length)
      throw new Error("Invalid selected row");
    const row = rows[index];
    const payload = buildTripImportPayload({
      ...row,
      entryTypeOverride: row.entryType || row.entryTypeOverride,
    } as Transaction);
    if (payload.linkage?.reimbursesAllocations)
      payload.linkage.reimbursesAllocations =
        payload.linkage.reimbursesAllocations.map((allocation) => {
          if (allocation.pendingBatchIndex === undefined) return allocation;
          const mapped = remap.get(allocation.pendingBatchIndex);
          if (mapped === undefined)
            throw new Error(
              "A reimbursement links to an unselected row. Select the linked expense or remove its allocation.",
            );
          return { ...allocation, pendingBatchIndex: mapped };
        });
    return payload;
  });
}
