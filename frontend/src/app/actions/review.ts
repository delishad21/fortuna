"use server";

import { auth } from "@/lib/actionAuth";
import { dataServiceRequest } from "@/lib/dataService";
import type { ReviewEntry, ReviewQueue, ReviewQueueFilters } from "@/lib/reviewTypes";

/**
 * The To review screen on web and phone. It calls data-service's
 * /api/agent/transactions/review routes (as the trusted frontend), the same
 * ones twee and the assistant use, so there is one queue and one audit trail.
 */

async function userId() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

const call = async <T>(path: string, body?: Record<string, unknown>) =>
  dataServiceRequest<T>(await userId(), `/api/agent/transactions/review${path}`, {
    method: body ? "POST" : "GET",
    ...(body ? { body } : {}),
  });

export async function getReviewQueue(filters: ReviewQueueFilters = {}): Promise<ReviewQueue> {
  const query = new URLSearchParams();
  query.set("status", filters.status || "to_review");
  if (filters.reasons?.length) query.set("reasons", filters.reasons.join(","));
  if (filters.entrySource?.length) query.set("entrySource", filters.entrySource.join(","));
  if (filters.account) query.set("account", filters.account);
  if (filters.dateFrom) query.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) query.set("dateTo", filters.dateTo);
  query.set("limit", String(filters.limit || 50));
  query.set("offset", String(filters.offset || 0));
  return call<ReviewQueue>(`?${query.toString()}`);
}

/**
 * Corrects category, account and/or label on up to 200 transactions and
 * marks them reviewed (unless markReviewed is false). With createRule, also
 * saves an enabled import rule matching descriptions that contain matchValue.
 */
export async function correctReviewEntries(input: {
  ids: string[];
  /** Category id or name. */
  category?: string;
  /** Account id, statement identifier or name of an existing account. */
  account?: string;
  label?: string | null;
  markReviewed?: boolean;
  createRule?: { matchValue: string; name?: string; accountOnly?: boolean };
}): Promise<{ transactions: ReviewEntry[]; rule?: { id: string; name: string } }> {
  const { createRule, ...rest } = input;
  return call("/correct", {
    ...rest,
    ...(createRule ? { createRule: { ...createRule, confirmed: true } } : {}),
  });
}

/** Marks entries reviewed, or puts them back in the queue. */
export async function setReviewEntriesStatus(ids: string[], status: "reviewed" | "to_review" = "reviewed") {
  return call<{ transactions: ReviewEntry[] }>("/status", { ids, status });
}

/** Keeps an account Fortuna created; its entries lose the New account reason. A name renames it. */
export async function confirmReviewAccount(accountId: string, name?: string) {
  return call<{ account: { id: string; label: string }; entriesUpdated: number }>(
    `/accounts/${encodeURIComponent(accountId)}/confirm`,
    name ? { label: name } : {},
  );
}

/** Merges an account Fortuna created into an existing account; its cards, identifiers and entries move. */
export async function mergeReviewAccount(accountId: string, intoAccountId: string) {
  return call<{ merged: { from: string; into: string }; transactionsMoved: number }>(
    `/accounts/${encodeURIComponent(accountId)}/merge`,
    { into: intoAccountId, confirmed: true },
  );
}
