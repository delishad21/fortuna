import { createHash } from "node:crypto";

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashValue(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function sanitizeStatementFilename(value: string) {
  const filename = value.replace(/\\/g, "/").split("/").pop()?.trim() || "statement";
  const safe = filename.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 180);
  return safe || "statement";
}

export function proposalCanAutoApply(input: {
  confidence: number;
  proposedLabel?: string | null;
  proposedCategoryId?: string | null;
  proposedLinkage?: unknown;
  proposedTripId?: string | null;
  proposedTripEntryType?: string | null;
}) {
  if (input.proposedLinkage || input.proposedTripEntryType === "reimbursement") return false;
  if (input.proposedTripEntryType === "funding_in" || input.proposedTripEntryType === "funding_out") {
    return false;
  }
  if (input.proposedTripId && input.confidence < 0.95) return false;
  if (input.proposedCategoryId && input.confidence < 0.9) return false;
  if (input.proposedLabel && input.confidence < 0.85) return false;
  return Boolean(input.proposedLabel || input.proposedCategoryId || input.proposedTripId);
}

export function applyProposalPayload(
  current: Record<string, unknown>,
  proposal: {
    proposedLabel?: string | null;
    proposedCategoryId?: string | null;
    proposedLinkage?: unknown;
    proposedTripId?: string | null;
    proposedTripEntryType?: string | null;
    proposedWalletId?: string | null;
  },
) {
  return {
    ...current,
    ...(proposal.proposedLabel !== undefined && proposal.proposedLabel !== null
      ? { label: proposal.proposedLabel }
      : {}),
    ...(proposal.proposedCategoryId !== undefined && proposal.proposedCategoryId !== null
      ? { categoryId: proposal.proposedCategoryId }
      : {}),
    ...(proposal.proposedLinkage !== undefined && proposal.proposedLinkage !== null
      ? { linkage: proposal.proposedLinkage }
      : {}),
    ...(proposal.proposedTripId ? { tripId: proposal.proposedTripId } : {}),
    ...(proposal.proposedTripEntryType
      ? { entryType: proposal.proposedTripEntryType }
      : {}),
    ...(proposal.proposedWalletId ? { walletId: proposal.proposedWalletId } : {}),
  };
}

export function validateDraftTransaction(value: Record<string, unknown>) {
  const errors: string[] = [];
  const date = new Date(String(value.date || ""));
  const amountIn = Number(value.amountIn || 0);
  const amountOut = Number(value.amountOut || 0);
  if (Number.isNaN(date.getTime())) errors.push("invalid date");
  if (!String(value.description || "").trim()) errors.push("missing description");
  if (amountIn <= 0 && amountOut <= 0) errors.push("missing positive amount");
  if (amountIn > 0 && amountOut > 0) errors.push("both amountIn and amountOut are positive");
  return errors;
}

export function validateDraftAccountAssignment(
  mode: string,
  value: Record<string, unknown>,
  knownAccountIdentifiers: ReadonlySet<string>,
) {
  if (mode !== "main") return [];
  const accountIdentifier = String(value.accountIdentifier || "").trim();
  if (!accountIdentifier) {
    return ["missing accountIdentifier; inspect the statement and assign an existing account before commit"];
  }
  if (!knownAccountIdentifiers.has(accountIdentifier)) {
    return [`unknown accountIdentifier: ${accountIdentifier}; create the account before commit`];
  }
  return [];
}

export function materializeDraftTransaction(value: Record<string, unknown>) {
  return {
    ...value,
    date: new Date(String(value.date || "")),
  };
}
