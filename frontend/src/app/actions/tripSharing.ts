"use server";

import { auth } from "@/lib/actionAuth";
import type {
  TripActionResult,
  TripEntry,
  TripFundingOutInput,
} from "@/app/actions/trips";

const DATA_SERVICE_URL =
  process.env.DATA_SERVICE_URL || "http://localhost:4001";

/**
 * People (IOUs and settlements) and shared-trip actions. Like the trip mutations,
 * every action returns a TripActionResult so the data-service message survives
 * production builds. Call them through `@/lib/tripSharingMutations`, which throws
 * it again on the caller's side.
 */
async function settle<T>(run: () => Promise<T>): Promise<TripActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Something went wrong.",
    };
  }
}

export type TripRole = "owner" | "editor" | "viewer";

/** Set on a trip from GET /api/trips when it's shared. */
export interface TripSharingSummary {
  groupId: string;
  role: TripRole;
  memberCount: number;
}

export interface TripParticipant {
  id: string;
  name: string;
  /** Set when the person is a Fortuna member of a shared trip. */
  userId: string | null;
}

export interface TripPersonBalance {
  participantId: string;
  name: string;
  /** What settlements have paid this person, in the trip's base currency. */
  paidBase: number;
  /** What's still owed, at the IOUs' estimate rates. */
  openBase: number;
  currencies: Array<{
    currency: string;
    owed: number;
    settled: number;
    open: number;
  }>;
}

export interface TripBalances {
  baseCurrency: string;
  people: TripPersonBalance[];
}

/** A trip entry with the IOU and settlement fields the entries endpoint adds. */
export type TripPeopleEntry = Omit<TripEntry, "type"> & {
  type: TripEntry["type"] | "settlement";
  counterparty?: { id: string; name: string } | null;
  isIou?: boolean;
};

export interface TripMember {
  memberId: string;
  userId: string;
  name: string;
  role: TripRole;
  status: "active" | "invited";
  isMe: boolean;
}

export interface TripInvitation {
  memberId: string;
  role: TripRole;
  tripName: string;
  startDate: string;
  endDate: string | null;
  invitedBy: string | null;
}

export interface TripSharedMemberTotals {
  userId: string;
  name: string;
  paid: number;
  sharesGiven: number;
  sharesReceived: number;
  reimbursed: number;
  net: number;
}

export interface TripSharedEntry {
  id: string;
  member: { userId: string; name: string };
  type: "spending" | "reimbursement";
  date: string;
  title: string;
  localCurrency: string;
  localAmount: number;
  baseAmount: number;
  category: { name: string; color: string | null } | null;
  /** This entry is someone's share of another member's spending. */
  isShare: boolean;
  /** For IOUs: the person who paid. */
  owedTo: string | null;
  shares: Array<{ userId: string; name: string; baseAmount: number }>;
}

export interface TripSharedOverview {
  groupId: string;
  role: TripRole;
  baseCurrency: string;
  members: TripMember[];
  totals: {
    combinedSpent: number;
    combinedReimbursed: number;
    combinedNet: number;
    members: TripSharedMemberTotals[];
  };
  settleUp: Array<{
    from: { userId: string; name: string };
    to: { userId: string; name: string };
    amountBase: number;
  }>;
  entries: TripSharedEntry[];
}

async function requireUserId() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

async function request<T>(
  path: string,
  init: { method?: string; body?: Record<string, unknown> },
  fallbackError: string,
): Promise<T> {
  const response = await fetch(`${DATA_SERVICE_URL}${path}`, {
    method: init.method ?? "GET",
    cache: "no-store",
    ...(init.body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(init.body),
        }
      : {}),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || fallbackError);
  }
  return response.json();
}

const withUser = (path: string, userId: string) =>
  `${path}${path.includes("?") ? "&" : "?"}userId=${encodeURIComponent(userId)}`;

// People and IOUs

export async function getTripParticipants(tripId: string) {
  return settle(async () => {
    const userId = await requireUserId();
    const data = await request<{ participants: TripParticipant[] }>(
      withUser(`/api/trips/${tripId}/participants`, userId),
      {},
      "Failed to load people",
    );
    return data.participants || [];
  });
}

export async function createTripParticipant(tripId: string, name: string) {
  return settle(async () => {
    const userId = await requireUserId();
    const data = await request<{ participant: TripParticipant }>(
      `/api/trips/${tripId}/participants`,
      { method: "POST", body: { userId, name } },
      "Failed to add person",
    );
    return data.participant;
  });
}

export async function renameTripParticipant(
  tripId: string,
  participantId: string,
  name: string,
) {
  return settle(async () => {
    const userId = await requireUserId();
    const data = await request<{ participant: TripParticipant }>(
      `/api/trips/${tripId}/participants/${participantId}`,
      { method: "PATCH", body: { userId, name } },
      "Failed to rename person",
    );
    return data.participant;
  });
}

export async function deleteTripParticipant(tripId: string, participantId: string) {
  return settle(async () => {
    const userId = await requireUserId();
    return request<{ success: boolean }>(
      `/api/trips/${tripId}/participants/${participantId}`,
      { method: "DELETE", body: { userId } },
      "Failed to remove person",
    );
  });
}

export async function getTripBalances(tripId: string) {
  return settle(async () => {
    const userId = await requireUserId();
    return request<TripBalances>(
      withUser(`/api/trips/${tripId}/balances`, userId),
      {},
      "Failed to load balances",
    );
  });
}

/** Chooses which IOUs a settlement pays off, and how much of each (in the IOU's currency). */
export async function setTripSettlementAllocations(
  tripId: string,
  settlementEntryId: string,
  items: Array<{ iouEntryId: string; localAmount: number }>,
) {
  return settle(async () => {
    const userId = await requireUserId();
    return request<TripBalances>(
      `/api/trips/${tripId}/settlements/${settlementEntryId}/allocations`,
      { method: "PUT", body: { userId, items } },
      "Failed to update the settlement",
    );
  });
}

/**
 * Creates a trip entry that may involve someone else: spending they paid for
 * (`paidByParticipantId`, no wallet) or a settlement paying them back
 * (`type: "settlement"` with `counterpartyId`).
 */
export async function createTripPeopleEntry(
  tripId: string,
  payload: {
    walletId?: string | null;
    type: "spending" | "reimbursement" | "funding_out" | "settlement";
    paidByParticipantId?: string | null;
    counterpartyId?: string | null;
    date: string;
    description: string;
    label?: string | null;
    categoryId?: string | null;
    localCurrency: string;
    localAmount: number;
    baseAmount?: number | null;
    fxRate?: number | null;
    fundingOut?: TripFundingOutInput | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  return settle(async () => {
    const userId = await requireUserId();
    return request<{ entry: { id: string } }>(
      `/api/trips/${tripId}/entries`,
      { method: "POST", body: { userId, ...payload } },
      "Failed to create trip entry",
    );
  });
}

/** Adds bank payments (e.g. a PayNow to a friend) as settlements paying that person back. */
export async function addBankSettlements(
  tripId: string,
  payload: { transactionIds: string[]; counterpartyId: string },
) {
  return settle(async () => {
    const userId = await requireUserId();
    return request<{ created: number }>(
      `/api/trips/${tripId}/entries/from-main`,
      {
        method: "POST",
        body: {
          userId,
          transactionIds: payload.transactionIds,
          entryType: "settlement",
          counterpartyId: payload.counterpartyId,
        },
      },
      "Failed to add the settlement",
    );
  });
}

/** Every IOU and settlement in the trip (entries with a counterparty). */
export async function getTripPeopleEntries(tripId: string) {
  return settle(async () => {
    const userId = await requireUserId();
    const pageSize = 200;
    const found: TripPeopleEntry[] = [];
    for (let offset = 0; offset < 10_000; offset += pageSize) {
      const params = new URLSearchParams({
        userId,
        limit: String(pageSize),
        offset: String(offset),
      });
      const data = await request<{ items: TripPeopleEntry[]; total: number }>(
        `/api/trips/${tripId}/entries?${params}`,
        {},
        "Failed to load trip transactions",
      );
      found.push(...(data.items || []).filter((entry) => !!entry.counterparty));
      if ((data.items || []).length < pageSize || offset + pageSize >= data.total) break;
    }
    return found;
  });
}

// Shared trips

export async function inviteTripMember(
  tripId: string,
  input: { usernameOrEmail: string; role: "editor" | "viewer" },
) {
  return settle(async () => {
    const userId = await requireUserId();
    return request<{ groupId: string; memberId: string }>(
      `/api/trips/${tripId}/share/invite`,
      { method: "POST", body: { userId, ...input } },
      "Failed to invite",
    );
  });
}

export async function getTripMembers(tripId: string) {
  return settle(async () => {
    const userId = await requireUserId();
    const data = await request<{ members: TripMember[] }>(
      withUser(`/api/trips/${tripId}/members`, userId),
      {},
      "Failed to load members",
    );
    return data.members || [];
  });
}

export async function updateTripMemberRole(
  tripId: string,
  memberUserId: string,
  role: "editor" | "viewer",
) {
  return settle(async () => {
    const userId = await requireUserId();
    return request<{ success: boolean }>(
      `/api/trips/${tripId}/members/${memberUserId}`,
      { method: "PATCH", body: { userId, role } },
      "Failed to change role",
    );
  });
}

export async function removeTripMember(tripId: string, memberUserId: string) {
  return settle(async () => {
    const userId = await requireUserId();
    return request<{ success: boolean }>(
      `/api/trips/${tripId}/members/${memberUserId}`,
      { method: "DELETE", body: { userId } },
      "Failed to remove member",
    );
  });
}

export async function leaveSharedTrip(tripId: string) {
  return settle(async () => {
    const userId = await requireUserId();
    return request<{ success: boolean; tripId: string }>(
      `/api/trips/${tripId}/leave`,
      { method: "POST", body: { userId } },
      "Failed to leave the trip",
    );
  });
}

export async function getTripInvitations() {
  return settle(async () => {
    const userId = await requireUserId();
    const data = await request<{ invitations: TripInvitation[] }>(
      withUser(`/api/trip-invitations`, userId),
      {},
      "Failed to load invitations",
    );
    return data.invitations || [];
  });
}

export async function acceptTripInvitation(memberId: string) {
  return settle(async () => {
    const userId = await requireUserId();
    return request<{ tripId: string }>(
      `/api/trip-invitations/${memberId}/accept`,
      { method: "POST", body: { userId } },
      "Failed to accept the invitation",
    );
  });
}

export async function declineTripInvitation(memberId: string) {
  return settle(async () => {
    const userId = await requireUserId();
    return request<{ success: boolean }>(
      `/api/trip-invitations/${memberId}/decline`,
      { method: "POST", body: { userId } },
      "Failed to decline the invitation",
    );
  });
}

export async function getTripSharedOverview(tripId: string) {
  return settle(async () => {
    const userId = await requireUserId();
    return request<TripSharedOverview>(
      withUser(`/api/trips/${tripId}/shared`, userId),
      {},
      "Failed to load the shared trip",
    );
  });
}

/** Splits one of my entries with other members; each share becomes an IOU in their trip. */
export async function setTripEntryShares(
  tripId: string,
  entryId: string,
  shares: Array<{ userId: string; localAmount: number }>,
) {
  return settle(async () => {
    const userId = await requireUserId();
    return request<TripSharedOverview>(
      `/api/trips/${tripId}/entries/${entryId}/shares`,
      { method: "PUT", body: { userId, shares } },
      "Failed to share the cost",
    );
  });
}
