import { Prisma, PrismaClient } from "@prisma/client";
import type { ReviewRow } from "./reviews.service";
import { stateHash } from "./tools/transactions";
/**
 * A row marked internal is left out of spending whatever its category, so a category edit
 * has to keep the mark in step: another category clears it, Internal sets it.
 */
type Linkage = { type?: string; autoDetected?: boolean } | null | undefined;
type Values = { categoryId?: string | null; linkage?: unknown };
const isInternal = (linkage: unknown) =>
  (linkage as Linkage)?.type === "internal";
/** Marked by an import rule or parser, not by the user. */
const isAutoInternal = (linkage: unknown) =>
  isInternal(linkage) && (linkage as Linkage)?.autoDetected === true;
/** The user's Internal category, as a list so a differently cased duplicate also counts. */
export async function internalCategoryIds(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
) {
  const found = await db.category.findMany({
    where: { userId, name: { equals: "Internal", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  return found
    .sort((a, b) => Number(b.name === "Internal") - Number(a.name === "Internal"))
    .map((c) => c.id);
}
/**
 * A category the assistant suggests, with the linkage it implies. Only an automatic internal
 * mark is cleared; a mark the user set and reimbursement links stay. `linked` rows take part
 * in a reimbursement, which marking them internal would remove.
 */
export function withSuggestedLinkage<T extends Values>(
  current: Values,
  patch: T,
  internalIds: string[],
  mark: Record<string, unknown>,
  linked = false,
): T {
  if (!patch.categoryId || patch.linkage !== undefined) return patch;
  if (!internalIds.includes(patch.categoryId))
    return isAutoInternal(current.linkage) ? { ...patch, linkage: null } : patch;
  return current.linkage || linked ? patch : { ...patch, linkage: mark };
}
/** The user's own edit of a review row: their category or type choice always wins. */
export function withChosenLinkage<T extends Values>(
  current: Values,
  patch: T,
  internalIds: string[],
): T {
  if (patch.linkage !== undefined) {
    const categoryId =
      patch.categoryId !== undefined ? patch.categoryId : current.categoryId;
    const internal = !!categoryId && internalIds.includes(categoryId);
    if (isInternal(patch.linkage) && !internal && internalIds.length)
      return { ...patch, categoryId: internalIds[0] };
    if (patch.linkage === null && internal && patch.categoryId === undefined)
      return { ...patch, categoryId: null };
    return patch;
  }
  if (!patch.categoryId) return patch;
  if (internalIds.includes(patch.categoryId))
    return current.linkage
      ? patch
      : { ...patch, linkage: { type: "internal", autoDetected: false } };
  return isInternal(current.linkage) ? { ...patch, linkage: null } : patch;
}
/**
 * Saved rows of reviews opened before suggested categories cleared the automatic mark: the
 * mark is cleared where the category moved off Internal, and a mark the user set keeps the
 * Internal category. Row versions stay as they are, so an open editor can keep saving.
 */
export function alignReviewRows(rows: ReviewRow[], internalIds: string[]) {
  return rows.map((row) => {
    if (!row.source.transactionId || !isInternal(row.value?.linkage)) return row;
    const { categoryId, linkage } = row.value;
    if (!categoryId || internalIds.includes(categoryId)) return row;
    const untouched =
      stateHash(linkage) === stateHash(row.original?.linkage ?? null);
    if (untouched)
      return isAutoInternal(linkage) && categoryId !== row.original?.categoryId
        ? { ...row, value: { ...row.value, linkage: null } }
        : row;
    return internalIds.length
      ? { ...row, value: { ...row.value, categoryId: internalIds[0] } }
      : row;
  });
}
