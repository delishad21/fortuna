"use server";

import { auth } from "@/lib/actionAuth";
import type { Trip, TripActionResult, Wallet } from "@/app/actions/trips";

const DATA_SERVICE_URL =
  process.env.DATA_SERVICE_URL || "http://localhost:4001";

/**
 * Wallet and wallet-account actions. Like the trip mutations, every action returns
 * a TripActionResult so the data-service message survives production builds. Call
 * them through `@/lib/tripWalletMutations`, which throws it again on the caller's side.
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

export interface TripWallet extends Wallet {
  accountId: string | null;
  accountName: string | null;
}

export interface WalletAccount {
  id: string;
  name: string;
  provider: string | null;
  color: string;
  archivedAt: string | null;
  walletCount: number;
}

export interface CarryOverCandidate {
  sourceWalletId: string;
  name: string;
  accountId: string | null;
  currency: string;
  balance: number;
  fxRate: number | null;
  baseValue: number | null;
  destinationWalletId: string | null;
}

export interface CarryOverCandidatesResponse {
  sameBaseCurrency: boolean;
  candidates: CarryOverCandidate[];
}

export interface CarryOverSource {
  trip: Trip;
  candidates: CarryOverCandidate[];
}

export interface CarryOverItem {
  sourceWalletId: string;
  amount?: number | null;
  destinationWalletId?: string | null;
  fxRate?: number | null;
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

export async function getTripWallets(tripId: string) {
  return settle(async () => {
    const userId = await requireUserId();
    const data = await request<{ wallets: TripWallet[] }>(
      `/api/trips/${tripId}/wallets?userId=${encodeURIComponent(userId)}`,
      {},
      "Failed to fetch wallets",
    );
    return data.wallets || [];
  });
}

export async function updateTripWallet(
  tripId: string,
  walletId: string,
  input: { name?: string; color?: string; accountId?: string | null },
) {
  return settle(async () => {
    const userId = await requireUserId();
    const data = await request<{ wallet: TripWallet }>(
      `/api/trips/${tripId}/wallets/${walletId}`,
      { method: "PATCH", body: { userId, ...input } },
      "Failed to update wallet",
    );
    return data.wallet;
  });
}

export async function deleteTripWallet(tripId: string, walletId: string) {
  return settle(async () => {
    const userId = await requireUserId();
    return request<{ success: boolean }>(
      `/api/trips/${tripId}/wallets/${walletId}`,
      { method: "DELETE", body: { userId } },
      "Failed to delete wallet",
    );
  });
}

export async function mergeTripWallet(
  tripId: string,
  walletId: string,
  targetWalletId: string,
) {
  return settle(async () => {
    const userId = await requireUserId();
    const data = await request<{ wallet: TripWallet }>(
      `/api/trips/${tripId}/wallets/${walletId}/merge`,
      { method: "POST", body: { userId, targetWalletId } },
      "Failed to merge wallets",
    );
    return data.wallet;
  });
}

export async function getWalletAccounts() {
  return settle(async () => {
    const userId = await requireUserId();
    const data = await request<{ accounts: WalletAccount[] }>(
      `/api/wallet-accounts?userId=${encodeURIComponent(userId)}`,
      {},
      "Failed to load wallet accounts",
    );
    return data.accounts || [];
  });
}

export async function createWalletAccount(input: {
  name: string;
  color?: string | null;
}) {
  return settle(async () => {
    const userId = await requireUserId();
    const data = await request<{ account: WalletAccount }>(
      `/api/wallet-accounts`,
      { method: "POST", body: { userId, ...input } },
      "Failed to create wallet account",
    );
    return data.account;
  });
}

export async function updateWalletAccount(
  accountId: string,
  input: { name?: string; color?: string; archived?: boolean },
) {
  return settle(async () => {
    const userId = await requireUserId();
    const data = await request<{ account: WalletAccount }>(
      `/api/wallet-accounts/${accountId}`,
      { method: "PATCH", body: { userId, ...input } },
      "Failed to update wallet account",
    );
    return data.account;
  });
}

async function fetchCarryOverCandidates(
  userId: string,
  tripId: string,
  sourceTripId: string,
) {
  const params = new URLSearchParams({ userId, sourceTripId });
  return request<CarryOverCandidatesResponse>(
    `/api/trips/${tripId}/carry-over/candidates?${params}`,
    {},
    "Failed to load carry-over candidates",
  );
}

export async function getCarryOverCandidates(
  tripId: string,
  sourceTripId: string,
) {
  return settle(async () => {
    const userId = await requireUserId();
    return fetchCarryOverCandidates(userId, tripId, sourceTripId);
  });
}

/** The user's other trips that share this trip's base currency and still hold money. */
export async function getCarryOverSources(tripId: string) {
  return settle(async () => {
    const userId = await requireUserId();
    const { trips } = await request<{ trips: Trip[] }>(
      `/api/trips?userId=${encodeURIComponent(userId)}`,
      {},
      "Failed to fetch trips",
    );
    const destination = trips.find((trip) => trip.id === tripId);
    if (!destination) return [];
    const others = trips.filter(
      (trip) =>
        trip.id !== tripId &&
        trip.baseCurrency.toUpperCase() === destination.baseCurrency.toUpperCase(),
    );
    const results = await Promise.all(
      others.map(async (trip): Promise<CarryOverSource | null> => {
        const response = await fetchCarryOverCandidates(userId, tripId, trip.id).catch(
          () => null,
        );
        if (!response?.sameBaseCurrency || response.candidates.length === 0) return null;
        return { trip, candidates: response.candidates };
      }),
    );
    return results.filter((item): item is CarryOverSource => item !== null);
  });
}

export async function carryOverWallets(
  tripId: string,
  input: { sourceTripId: string; date?: string | null; items: CarryOverItem[] },
) {
  return settle(async () => {
    const userId = await requireUserId();
    return request<{ created: Array<{ sourceWalletId: string; entryId: string }> }>(
      `/api/trips/${tripId}/carry-over`,
      {
        method: "POST",
        body: {
          userId,
          sourceTripId: input.sourceTripId,
          ...(input.date ? { date: input.date } : {}),
          items: input.items,
        },
      },
      "Failed to carry money over",
    );
  });
}
