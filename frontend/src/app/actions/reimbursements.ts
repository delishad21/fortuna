"use server";

import { auth } from "@/lib/actionAuth";

const DATA_SERVICE_URL =
  process.env.DATA_SERVICE_URL || "http://localhost:4001";

export type LinkEnd = { transactionId: string } | { draftRowId: string };

export type ReimbursementCandidate = {
  key: string;
  transactionId?: string;
  draftId?: string;
  rowId?: string;
  rowIndex?: number;
  filename?: string;
  date: string | null;
  description: string;
  label: string | null;
  amount: number;
  linkedToSubject: number;
  otherLinked: number;
  pending: Array<{ amount: number; filename: string }>;
  available: number;
  fullyAllocated: boolean;
  categoryId: string | null;
  accountIdentifier: string | null;
};

export type ReimbursementCandidates = {
  subject: {
    key: string;
    role: "reimbursement" | "expense";
    roleProblem: string | null;
    amount: number;
    linked: Array<{
      key: string;
      amount: number;
      description: string;
      label: string | null;
      date: string | null;
      filename?: string;
    }>;
    linkedAmount: number;
    pending: Array<{ amount: number; filename: string }>;
    available: number;
  };
  saved: { items: ReimbursementCandidate[]; total: number };
  staged: ReimbursementCandidate[];
};

async function userId() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id;
}

/**
 * What a transaction or staged row can be linked to. `lookingFor` is the role
 * of the candidates: "reimbursement" when an expense picks what paid it back,
 * "expense" when a reimbursement picks what it pays back.
 */
export async function getReimbursementCandidates(input: {
  subject: LinkEnd;
  lookingFor: "reimbursement" | "expense";
  query?: string;
  limit?: number;
  offset?: number;
  contextDraftIds?: string[];
  /** "" means uncategorized; omit for every category. */
  categoryId?: string;
  dateFrom?: string;
  dateTo?: string;
  amountEquals?: number;
}): Promise<ReimbursementCandidates> {
  const params = new URLSearchParams({
    userId: await userId(),
    lookingFor: input.lookingFor,
    ...("transactionId" in input.subject
      ? { transactionId: input.subject.transactionId }
      : { draftRowId: input.subject.draftRowId }),
    ...(input.query?.trim() ? { query: input.query.trim() } : {}),
    ...(input.limit ? { limit: String(input.limit) } : {}),
    ...(input.offset ? { offset: String(input.offset) } : {}),
    ...(input.contextDraftIds?.length
      ? { contextDraftIds: input.contextDraftIds.join(",") }
      : {}),
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
    ...(input.dateFrom ? { dateFrom: input.dateFrom } : {}),
    ...(input.dateTo ? { dateTo: input.dateTo } : {}),
    ...(input.amountEquals ? { amountEquals: String(input.amountEquals) } : {}),
  });
  const response = await fetch(
    `${DATA_SERVICE_URL}/api/reimbursements/candidates?${params}`,
    { cache: "no-store" },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Failed to load candidates");
  return body;
}

/**
 * Replace every link the subject holds in `role`. Returns warnings about
 * amounts also claimed by other staged imports.
 */
export async function setReimbursementLinks(input: {
  subject: LinkEnd;
  role: "reimbursement" | "expense";
  links: Array<{ other: LinkEnd; amount: number }>;
  leftoverCategoryId?: string | null;
  contextDraftIds?: string[];
}): Promise<{ success: boolean; warnings: string[] }> {
  const response = await fetch(`${DATA_SERVICE_URL}/api/reimbursements/links`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: await userId(), ...input }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Failed to save reimbursement links");
  return body;
}
