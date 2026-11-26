"use server";

import { auth } from "@/lib/actionAuth";
import { dataServiceRequest } from "@/lib/dataService";
import type {
  BackfillProposal,
  OutstandingReimbursements,
  PersonBalance,
  ReimbursableShareInput,
  ReimbursementPerson,
  RepaymentProposalWithRepayment,
} from "@/lib/reimbursables";

/**
 * Reimbursable spending on web and phone: data-service's
 * /api/agent/reimbursables routes (as the trusted frontend), the same ones
 * twee uses through finance-mcp.
 */

async function userId() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

const call = async <T>(path: string, method = "GET", body?: unknown) =>
  dataServiceRequest<T>(await userId(), `/api/agent/reimbursables${path}`, {
    method,
    ...(body !== undefined ? { body } : {}),
  });

const query = (values: Record<string, string | number | boolean | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
};

export async function getReimbursementPeople(includeArchived = false) {
  return call<{ people: PersonBalance[]; outstanding: number }>(`/people${query({ includeArchived })}`);
}

export async function createReimbursementPerson(name: string, aliases?: string[]) {
  return call<{ person: ReimbursementPerson }>("/people", "POST", { name, ...(aliases ? { aliases } : {}) });
}

export async function updateReimbursementPerson(
  personId: string,
  input: { name?: string; aliases?: string[]; archived?: boolean },
) {
  return call<{ person: ReimbursementPerson }>(`/people/${encodeURIComponent(personId)}`, "PATCH", input);
}

export async function deleteReimbursementPerson(personId: string) {
  return call<{ deleted: string }>(`/people/${encodeURIComponent(personId)}`, "DELETE");
}

/** What each person owes (or one), in total and per month, with open items (or all, or none). */
export async function getOutstandingReimbursements(
  filters: { person?: string; from?: string; to?: string; items?: "open" | "all" | "none" } = {},
) {
  return call<OutstandingReimbursements>(`/outstanding${query(filters)}`);
}

/** Marks transactions reimbursable to a person (in full unless a share is given). */
export async function setTransactionsReimbursable(input: {
  ids: string[];
  person: string;
  createPerson?: boolean;
  share?: ReimbursableShareInput;
  note?: string | null;
}) {
  return call<{ owed: number; skipped: Array<{ id: string; description: string; reason: string }> }>("/set", "POST", input);
}

export async function clearTransactionsReimbursable(ids: string[]) {
  return call<{ transactions: unknown[] }>("/clear", "POST", { ids });
}

/** Recent money in that looks like a repayment, with the items it would pay back. */
export async function getRepaymentProposals(filters: { person?: string; transactionId?: string; days?: number } = {}) {
  return call<{ proposals: RepaymentProposalWithRepayment[] }>(`/proposals${query(filters)}`);
}

/** Links a repayment to the items it pays back (and marks it reviewed unless told not to). */
export async function confirmRepaymentLinks(
  transactionId: string,
  links: Array<{ transactionId: string; amount: number }>,
  markReviewed = true,
) {
  return call<{ warnings: string[] }>("/proposals/confirm", "POST", { transactionId, links, markReviewed });
}

/** The backfill for a person: read-only until applyReimbursableBackfill. */
export async function getReimbursableBackfill(person: string) {
  return call<BackfillProposal>(`/backfill${query({ person })}`);
}

export async function applyReimbursableBackfill(input: {
  person: string;
  items: Array<{ transactionId: string; share?: ReimbursableShareInput; note?: string | null }>;
  links?: Array<{ repaymentId: string; links: Array<{ transactionId: string; amount: number }> }>;
}) {
  return call<{ person: ReimbursementPerson; marked: number; linked: number; warnings: string[] }>(
    "/backfill/apply",
    "POST",
    input,
  );
}
