"use server";

import { auth } from "@/lib/actionAuth";

const DATA_SERVICE_URL =
  process.env.DATA_SERVICE_URL || "http://localhost:4001";

/**
 * Next.js swaps a thrown server action error for a generic message in production,
 * so trip mutations return the data-service message instead. Call them through
 * `@/lib/tripMutations`, which throws it again on the caller's side.
 */
export type TripActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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

export type TripFundingSourceType =
  | "manual"
  | "transfer"
  | "bank_wallet_topup"
  | "opening_balance";

export interface TripFundingOutInput {
  // "wallet" moves money into another wallet of the same trip.
  destinationType?: "bank" | "trip" | "wallet" | "external";
  destinationTripId?: string | null;
  destinationWalletId?: string | null;
  bankTransactionId?: string | null;
  destinationCurrency?: string | null;
  destinationAmount?: number | null;
  fxRate?: number | null;
  feeAmount?: number | null;
  feeCurrency?: string | null;
}

export interface Trip {
  id: string;
  name: string;
  coverImageUrl?: string | null;
  baseCurrency: string;
  startDate: string;
  endDate?: string | null;
  status: string;
  notes?: string | null;
}

export interface Wallet {
  id: string;
  tripId: string;
  name: string;
  currency: string;
  color: string;
}

export interface WalletSummary {
  id: string;
  tripId: string;
  name: string;
  currency: string;
  color: string;
  intrinsicFxRate?: number | null;
  intrinsicBaseValue?: number | null;
  balances: Array<{
    currency: string;
    amount: number;
  }>;
}

export interface FundingCandidate {
  id: string;
  date: string;
  description: string;
  label?: string | null;
  amountIn: number | null;
  amountOut: number | null;
  category?: {
    id: string;
    name: string;
    color: string;
  } | null;
  accountIdentifier?: string | null;
}

export interface FundingCandidatesResponse {
  transactions: FundingCandidate[];
  total: number;
  limit: number;
  offset: number;
}

export interface TripEntry {
  id: string;
  type: "spending" | "reimbursement" | "funding_out" | "funding_in";
  date: string;
  label?: string | null;
  description: string;
  wallet: {
    id: string;
    name: string;
    currency: string;
    color: string;
  };
  category?: {
    id: string;
    name: string;
    color: string;
  } | null;
  localCurrency: string;
  localAmount: number;
  baseAmount: number;
  fxRate: number;
  feeAmount?: number | null;
  feeCurrency?: string | null;
  metadata?: Record<string, any> | null;
}

export interface TripReimbursementCandidate {
  id: string;
  date: string;
  description: string;
  label?: string | null;
  localAmount: number;
  localCurrency: string;
  baseAmount: number;
  alreadyAllocatedBase: number;
  remainingBase: number;
  wallet?: {
    id?: string | null;
    name?: string | null;
    currency?: string | null;
    color?: string | null;
  } | null;
  category?: {
    id?: string | null;
    name?: string | null;
    color?: string | null;
  } | null;
}

export interface TripEntryFilterPayload {
  search?: string;
  walletId?: string;
  categoryId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface SourceTransactionCandidate {
  id: string;
  date: string;
  description: string;
  label?: string | null;
  amountIn: number | null;
  amountOut: number | null;
  category?: {
    id: string;
    name: string;
    color: string;
  } | null;
  accountIdentifier?: string | null;
}

export interface SourceTransactionCandidatesResponse {
  transactions: SourceTransactionCandidate[];
  total: number;
  limit: number;
  offset: number;
}

export interface TripFunding {
  id: string;
  tripId: string;
  walletId?: string | null;
  entryId?: string | null;
  bankTransactionId?: string | null;
  sourceType: string;
  sourceCurrency: string;
  sourceAmount: number;
  destinationCurrency: string;
  destinationAmount: number;
  fxRate?: number | null;
  baseAmount?: number | null;
  feeAmount?: number | null;
  feeCurrency?: string | null;
  metadata?: Record<string, any> | null;
  createdAt?: string;
  bankTransaction?: {
    id: string;
    date: string;
    description: string;
    amountIn: number | null;
    amountOut: number | null;
    categoryId?: string | null;
  } | null;
  suggestedBankTransaction?: {
    id: string;
    date: string;
    description: string;
    amountIn: number | null;
    amountOut: number | null;
  } | null;
  wallet?: Wallet | null;
}

export interface TripPropagationTraceStep {
  phase: "recalculate_wallet" | "sync_linked_fundings";
  tripId: string;
  walletId: string;
  updatedEntryCount?: number;
  updatedFundingCount?: number;
  queuedWallets?: Array<{ tripId: string; walletId: string }>;
}

export interface TripPropagationTrace {
  startedAt: string;
  finishedAt: string;
  seedWallets: Array<{ tripId: string; walletId: string }>;
  totalWalletRecalculations: number;
  totalFundingRowsUpdated: number;
  steps: TripPropagationTraceStep[];
  truncated: boolean;
}

export interface TripFundingMutationResult {
  funding: TripFunding;
  propagationTrace: TripPropagationTrace | TripPropagationTrace[] | null;
}

export interface TripAnalytics {
  trip: {
    id: string;
    name: string;
    baseCurrency: string;
  };
  totals: {
    totalFunding: number;
    totalFundingIn: number;
    totalFundingOut: number;
    totalSpent: number;
    totalReimbursed: number;
    netTripCost: number;
  };
  highlights: {
    flights: number;
    accommodations: number;
    attractions: number;
  };
  highlightTransactions: {
    flights: Array<{
      id: string;
      date: string;
      label?: string | null;
      description: string;
      localCurrency: string;
      localAmount: number;
      baseAmount: number;
      walletName: string;
    }>;
    accommodations: Array<{
      id: string;
      date: string;
      label?: string | null;
      description: string;
      localCurrency: string;
      localAmount: number;
      baseAmount: number;
      walletName: string;
    }>;
    attractions: Array<{
      id: string;
      date: string;
      label?: string | null;
      description: string;
      localCurrency: string;
      localAmount: number;
      baseAmount: number;
      walletName: string;
    }>;
  };
  dailySeries: Array<{
    date: string;
    spending: number;
    reimbursement: number;
    net: number;
  }>;
  categoryBreakdown: Array<{
    category: { id: string; name: string; color: string } | null;
    totalOut: number;
  }>;
  recentEntries: Array<{
    id: string;
    type: "spending" | "reimbursement" | "funding_out" | "funding_in";
    date: string;
    label?: string | null;
    description: string;
    localCurrency: string;
    localAmount: number;
    baseAmount: number;
    walletName: string;
    category: { name: string; color: string };
  }>;
}

export interface TripImportResult {
  importedSpendings: number;
  importedReimbursements: number;
  importedFundings?: number;
  importedTransfers?: number;
  importedFees?: number;
  // Rows already in this trip from an earlier import.
  skippedDuplicates?: number;
  skipped: number;
}

export async function getTrips(): Promise<Trip[]> {
  const session = await auth();
  if (!session?.user?.id) return [];

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips?userId=${session.user.id}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch trips");
  }
  const data = await response.json();
  return data.trips || [];
}

async function createTripRequest(input: {
  name: string;
  coverImageUrl?: string | null;
  baseCurrency: string;
  startDate: string;
  endDate?: string | null;
  status?: string | null;
  notes?: string | null;
}): Promise<Trip> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(`${DATA_SERVICE_URL}/api/trips`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: session.user.id,
      name: input.name,
      ...(input.coverImageUrl ? { coverImageUrl: input.coverImageUrl } : {}),
      baseCurrency: input.baseCurrency,
      startDate: input.startDate,
      ...(input.endDate ? { endDate: input.endDate } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create trip");
  }

  const data = await response.json();
  return data.trip;
}

export async function getTrip(tripId: string): Promise<Trip> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}?userId=${session.user.id}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch trip");
  }

  const data = await response.json();
  return data.trip;
}

async function updateTripRequest(
  tripId: string,
  input: {
    name?: string;
    coverImageUrl?: string | null;
    baseCurrency?: string;
    startDate?: string;
    endDate?: string | null;
    status?: string;
    notes?: string | null;
  },
): Promise<Trip> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(`${DATA_SERVICE_URL}/api/trips/${tripId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: session.user.id,
      ...input,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to update trip");
  }

  const data = await response.json();
  return data.trip;
}

async function deleteTripRequest(tripId: string): Promise<{ success: boolean }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(`${DATA_SERVICE_URL}/api/trips/${tripId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: session.user.id,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to delete trip");
  }
  return response.json();
}

export async function getTripFundings(tripId: string): Promise<TripFunding[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/fundings?userId=${session.user.id}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch fundings");
  }

  const data = await response.json();
  return data.fundings || [];
}

async function createTripFundingRequest(tripId: string, input: {
  walletId?: string | null;
  bankTransactionId?: string | null;
  sourceType: TripFundingSourceType;
  sourceCurrency: string;
  sourceAmount: number;
  destinationCurrency: string;
  destinationAmount: number;
  fxRate?: number | null;
  feeAmount?: number | null;
  feeCurrency?: string | null;
  // Required when neither currency is the trip's base currency.
  baseAmount?: number | null;
  metadata?: Record<string, any> | null;
}): Promise<TripFundingMutationResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(`${DATA_SERVICE_URL}/api/trips/${tripId}/fundings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: session.user.id,
      ...input,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create funding");
  }

  const data = await response.json();
  return {
    funding: data.funding,
    propagationTrace: data.propagationTrace ?? null,
  };
}

async function reviewTripFundingMatchRequest(
  tripId: string,
  fundingId: string,
  input: {
    action: "accept" | "reject" | "replace";
    bankTransactionId?: string | null;
  },
): Promise<TripFunding> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/fundings/${fundingId}/match`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: session.user.id,
        action: input.action,
        bankTransactionId: input.bankTransactionId ?? null,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to review funding match");
  }

  const data = await response.json();
  return data.funding;
}

async function mergeTripFundingRequest(
  tripId: string,
  importedFundingId: string,
  targetFundingId: string,
): Promise<TripFunding> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/fundings/${importedFundingId}/merge`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: session.user.id,
        targetFundingId,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to merge funding");
  }

  const data = await response.json();
  return data.funding;
}

async function updateTripFundingRequest(
  tripId: string,
  fundingId: string,
  input: {
    walletId?: string | null;
    sourceCurrency?: string;
    sourceAmount?: number;
    destinationCurrency?: string;
    destinationAmount?: number;
    fxRate?: number | null;
    feeAmount?: number | null;
    feeCurrency?: string | null;
    baseAmount?: number | null;
    metadata?: Record<string, any> | null;
  },
): Promise<TripFundingMutationResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/fundings/${fundingId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: session.user.id,
        ...input,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to update funding");
  }

  const data = await response.json();
  return {
    funding: data.funding,
    propagationTrace: data.propagationTrace ?? null,
  };
}

async function deleteTripFundingRequest(
  tripId: string,
  fundingId: string,
): Promise<{ success: boolean; propagationTrace: TripPropagationTrace | null }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/fundings/${fundingId}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: session.user.id,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to delete funding");
  }
  const data = await response.json();
  return {
    success: true,
    propagationTrace: data.propagationTrace ?? null,
  };
}

export async function getWallets(tripId: string): Promise<Wallet[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/wallets?userId=${session.user.id}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch wallets");
  }

  const data = await response.json();
  return data.wallets || [];
}

async function createWalletRequest(
  tripId: string,
  input: { name: string; currency: string; color?: string | null },
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(`${DATA_SERVICE_URL}/api/trips/${tripId}/wallets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: session.user.id,
      name: input.name,
      currency: input.currency,
      color: input.color ?? null,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create wallet");
  }

  const data = await response.json();
  return data.wallet;
}

async function recalculateWalletEntriesToBaseRequest(
  tripId: string,
  walletId: string,
  input: {
    mode: "manual" | "weighted";
    fxRate?: number | null;
  },
): Promise<{
  walletId: string;
  walletCurrency: string;
  baseCurrency: string;
  fxRate: number;
  updatedCount: number;
  propagationTrace: TripPropagationTrace | null;
}> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/wallets/${walletId}/recalculate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: session.user.id,
        mode: input.mode,
        fxRate: input.fxRate ?? null,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to recalculate wallet entries");
  }
  const data = await response.json();
  return {
    walletId: data.walletId,
    walletCurrency: data.walletCurrency,
    baseCurrency: data.baseCurrency,
    fxRate: data.fxRate,
    updatedCount: data.updatedCount,
    propagationTrace: data.propagationTrace ?? null,
  };
}

async function importTripSpendingsRequest(
  tripId: string,
  options: {
    walletId?: string | null;
    parserId?: string | null;
  },
    transactions: Array<{
      date: string;
      description: string;
      label?: string;
      categoryId?: string;
      entryType?: "spending" | "reimbursement" | "funding_out" | "funding_in";
      linkage?: {
        type: "reimbursement";
        reimbursesAllocations?: Array<{
          transactionId?: string;
          pendingBatchIndex?: number;
          amountBase: number;
        }>;
        leftoverCategoryId?: string | null;
        reimbursementBaseAmount?: number | null;
        reimbursingFxRate?: number | null;
      } | null;
      amountIn?: number;
      amountOut?: number;
    // Statement imports can't move money into another wallet of the trip.
    fundingOut?: (TripFundingOutInput & {
      destinationType?: "bank" | "trip" | "external";
    }) | null;
    metadata?: Record<string, any>;
  }>,
): Promise<TripImportResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/spendings/import`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: session.user.id,
        walletId: options.walletId ?? null,
        parserId: options.parserId ?? null,
        transactions,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to import trip spendings");
  }

  return response.json();
}

export async function getFundingCandidates(
  tripId: string,
  options?: { search?: string; limit?: number; offset?: number },
): Promise<FundingCandidatesResponse> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const params = new URLSearchParams({
    userId: session.user.id,
    ...(options?.search ? { search: options.search } : {}),
    ...(options?.limit ? { limit: String(options.limit) } : {}),
    ...(options?.offset ? { offset: String(options.offset) } : {}),
  });

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/funding-candidates?${params}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch funding candidates");
  }
  const data = await response.json();
  return {
    transactions: data.transactions || [],
    total: data.total || 0,
    limit: data.limit || options?.limit || 100,
    offset: data.offset || options?.offset || 0,
  };
}

export async function getTripWalletSummaries(
  tripId: string,
): Promise<WalletSummary[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/wallet-summaries?userId=${session.user.id}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch wallet summaries");
  }
  const data = await response.json();
  return data.wallets || [];
}

export async function getTripEntries(
  tripId: string,
  filters?: {
    search?: string;
    walletId?: string;
    categoryId?: string;
    type?: "spending" | "reimbursement" | "funding_out" | "funding_in";
    dateFrom?: Date;
    dateTo?: Date;
    limit?: number;
    offset?: number;
  },
): Promise<{ items: TripEntry[]; total: number }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const params = new URLSearchParams({
    userId: session.user.id,
    ...(filters?.search ? { search: filters.search } : {}),
    ...(filters?.walletId ? { walletId: filters.walletId } : {}),
    ...(filters?.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters?.type ? { type: filters.type } : {}),
    ...(filters?.dateFrom ? { dateFrom: filters.dateFrom.toISOString() } : {}),
    ...(filters?.dateTo ? { dateTo: filters.dateTo.toISOString() } : {}),
    ...(filters?.limit ? { limit: String(filters.limit) } : {}),
    ...(filters?.offset ? { offset: String(filters.offset) } : {}),
  });

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/entries?${params}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch trip transactions");
  }
  return response.json();
}

export async function searchTripEntriesForReimbursement(
  tripId: string,
  options?: {
    search?: string;
    limit?: number;
    offset?: number;
    excludeEntryId?: string;
    walletId?: string;
    categoryId?: string;
    dateFrom?: string;
    dateTo?: string;
    amountBaseEquals?: number;
  },
): Promise<{
  transactions: TripReimbursementCandidate[];
  total: number;
  limit: number;
  offset: number;
}> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const params = new URLSearchParams({
    userId: session.user.id,
    ...(options?.search ? { search: options.search } : {}),
    ...(options?.limit ? { limit: String(options.limit) } : {}),
    ...(options?.offset ? { offset: String(options.offset) } : {}),
    ...(options?.excludeEntryId ? { excludeEntryId: options.excludeEntryId } : {}),
    ...(options?.walletId ? { walletId: options.walletId } : {}),
    ...(options?.categoryId ? { categoryId: options.categoryId } : {}),
    ...(options?.dateFrom ? { dateFrom: options.dateFrom } : {}),
    ...(options?.dateTo ? { dateTo: options.dateTo } : {}),
    ...(typeof options?.amountBaseEquals === "number"
      ? { amountBaseEquals: String(options.amountBaseEquals) }
      : {}),
  });

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/entries/search-reimbursement?${params}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to search reimbursement entries");
  }
  const data = await response.json();
  return {
    transactions: data.transactions || [],
    total: data.total || 0,
    limit: data.limit || options?.limit || 20,
    offset: data.offset || options?.offset || 0,
  };
}

async function createTripReimbursementLinkRequest(
  tripId: string,
  reimbursementEntryId: string,
  payload: {
    reimbursedAllocations: Array<{ transactionId: string; amountBase: number }>;
    leftoverCategoryId?: string | null;
    reimbursementBaseAmount?: number | null;
    reimbursingFxRate?: number | null;
    syncToBankLedger?: boolean;
  },
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/entries/${reimbursementEntryId}/link-reimbursement`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: session.user.id,
        ...payload,
      }),
    },
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to link reimbursement");
  }
  return response.json();
}

async function clearTripEntryLinkageRequest(
  tripId: string,
  entryId: string,
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/entries/${entryId}/linkage`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: session.user.id,
      }),
    },
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to clear linkage");
  }
  return response.json();
}

export async function getTripAnalytics(tripId: string): Promise<TripAnalytics> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/analytics?userId=${session.user.id}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch trip analytics");
  }

  return response.json();
}

export async function getSourceTransactionCandidates(
  tripId: string,
  options?: { search?: string; limit?: number; offset?: number },
): Promise<SourceTransactionCandidatesResponse> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const params = new URLSearchParams({
    userId: session.user.id,
    ...(options?.search ? { search: options.search } : {}),
    ...(options?.limit ? { limit: String(options.limit) } : {}),
    ...(options?.offset ? { offset: String(options.offset) } : {}),
  });

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/source-transactions?${params}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch source transactions");
  }
  const data = await response.json();
  return {
    transactions: data.transactions || [],
    total: data.total || 0,
    limit: data.limit || options?.limit || 100,
    offset: data.offset || options?.offset || 0,
  };
}

async function addEntriesFromSourceTransactionsRequest(
  tripId: string,
  payload: {
    transactionIds: string[];
    categoryId?: string | null;
    entryType?: "spending" | "reimbursement" | "funding_out";
    fundingOut?: TripFundingOutInput | null;
  },
): Promise<{ created: number }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/entries/from-main`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: session.user.id,
        ...payload,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to add transactions from bank ledger");
  }

  return response.json();
}

async function createTripEntryRequest(
  tripId: string,
  payload: {
    walletId?: string | null;
    type: "spending" | "reimbursement" | "funding_out";
    date: string;
    description: string;
    label?: string | null;
    categoryId?: string | null;
    localCurrency: string;
    localAmount: number;
    // Leave out on a wallet entry to value it at the wallet's average rate.
    baseAmount?: number | null;
    fxRate?: number | null;
    feeAmount?: number | null;
    feeCurrency?: string | null;
    fundingOut?: TripFundingOutInput | null;
    metadata?: Record<string, any> | null;
  },
): Promise<{ entry: { id: string } }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(`${DATA_SERVICE_URL}/api/trips/${tripId}/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: session.user.id,
      ...payload,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create trip entry");
  }

  return response.json();
}

/**
 * Funding-in entries are edited from the funding page. Entries taken from a bank
 * transaction keep its amount and currency. Leaving out baseAmount and fxRate on a
 * wallet entry values it at the wallet's average rate; giving either locks it.
 */
async function updateTripEntryRequest(
  tripId: string,
  entryId: string,
  changes: {
    date?: string;
    description?: string;
    label?: string | null;
    categoryId?: string | null;
    walletId?: string | null;
    localCurrency?: string;
    localAmount?: number;
    baseAmount?: number | null;
    fxRate?: number | null;
    fundingOut?: TripFundingOutInput | null;
  },
): Promise<{ id: string }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/entries/${entryId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: session.user.id,
        ...changes,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to update trip entry");
  }

  return response.json();
}

export async function getOutgoingFundingEntryCandidates(
  tripId: string,
  options?: {
    sourceTripId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  },
): Promise<FundingCandidatesResponse> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const params = new URLSearchParams({
    userId: session.user.id,
    ...(options?.sourceTripId ? { sourceTripId: options.sourceTripId } : {}),
    ...(options?.search ? { search: options.search } : {}),
    ...(options?.limit ? { limit: String(options.limit) } : {}),
    ...(options?.offset ? { offset: String(options.offset) } : {}),
  });

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/outgoing-funding-candidates?${params}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      error.error || "Failed to fetch outgoing funding candidates",
    );
  }

  const data = await response.json();
  return {
    transactions: data.transactions || [],
    total: data.total || 0,
    limit: data.limit || options?.limit || 100,
    offset: data.offset || options?.offset || 0,
  };
}

async function addFundingsFromOutgoingEntriesRequest(
  tripId: string,
  payload: { sourceEntryIds: string[]; walletId?: string | null },
): Promise<{ created: number }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/fundings/from-outgoing-entries`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: session.user.id,
        sourceEntryIds: payload.sourceEntryIds,
        walletId: payload.walletId ?? null,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      error.error || "Failed to import fundings from outgoing entries",
    );
  }

  return response.json();
}

async function bulkUpdateTripEntriesByIdsRequest(
  tripId: string,
  ids: string[],
  updates: { categoryId?: string | null; date?: string },
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/entries/bulk-by-ids`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: session.user.id,
        ids,
        updates,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to update trip entries");
  }

  return response.json();
}

async function bulkUpdateTripEntriesByFilterRequest(
  tripId: string,
  filters: TripEntryFilterPayload,
  excludeIds: string[] | undefined,
  updates: { categoryId?: string | null; date?: string },
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/entries/bulk-by-filter`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: session.user.id,
        filters: {
          ...filters,
          dateFrom: filters.dateFrom?.toISOString(),
          dateTo: filters.dateTo?.toISOString(),
        },
        excludeIds,
        updates,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to update trip entries");
  }

  return response.json();
}

async function bulkDeleteTripEntriesByIdsRequest(tripId: string, ids: string[]) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/entries/bulk-by-ids`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: session.user.id,
        ids,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to delete trip entries");
  }

  return response.json();
}

async function bulkDeleteTripEntriesByFilterRequest(
  tripId: string,
  filters: TripEntryFilterPayload,
  excludeIds: string[] | undefined,
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/trips/${tripId}/entries/bulk-by-filter`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: session.user.id,
        filters: {
          ...filters,
          dateFrom: filters.dateFrom?.toISOString(),
          dateTo: filters.dateTo?.toISOString(),
        },
        excludeIds,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to delete trip entries");
  }

  return response.json();
}

// Mutations return TripActionResult; see settle() above.

export async function createTrip(...args: Parameters<typeof createTripRequest>) {
  return settle(() => createTripRequest(...args));
}

export async function updateTrip(...args: Parameters<typeof updateTripRequest>) {
  return settle(() => updateTripRequest(...args));
}

export async function deleteTrip(...args: Parameters<typeof deleteTripRequest>) {
  return settle(() => deleteTripRequest(...args));
}

export async function createTripFunding(...args: Parameters<typeof createTripFundingRequest>) {
  return settle(() => createTripFundingRequest(...args));
}

export async function reviewTripFundingMatch(...args: Parameters<typeof reviewTripFundingMatchRequest>) {
  return settle(() => reviewTripFundingMatchRequest(...args));
}

export async function mergeTripFunding(...args: Parameters<typeof mergeTripFundingRequest>) {
  return settle(() => mergeTripFundingRequest(...args));
}

export async function updateTripFunding(...args: Parameters<typeof updateTripFundingRequest>) {
  return settle(() => updateTripFundingRequest(...args));
}

export async function deleteTripFunding(...args: Parameters<typeof deleteTripFundingRequest>) {
  return settle(() => deleteTripFundingRequest(...args));
}

export async function createWallet(...args: Parameters<typeof createWalletRequest>) {
  return settle(() => createWalletRequest(...args));
}

export async function recalculateWalletEntriesToBase(...args: Parameters<typeof recalculateWalletEntriesToBaseRequest>) {
  return settle(() => recalculateWalletEntriesToBaseRequest(...args));
}

export async function importTripSpendings(...args: Parameters<typeof importTripSpendingsRequest>) {
  return settle(() => importTripSpendingsRequest(...args));
}

export async function createTripReimbursementLink(...args: Parameters<typeof createTripReimbursementLinkRequest>) {
  return settle(() => createTripReimbursementLinkRequest(...args));
}

export async function clearTripEntryLinkage(...args: Parameters<typeof clearTripEntryLinkageRequest>) {
  return settle(() => clearTripEntryLinkageRequest(...args));
}

export async function addEntriesFromSourceTransactions(...args: Parameters<typeof addEntriesFromSourceTransactionsRequest>) {
  return settle(() => addEntriesFromSourceTransactionsRequest(...args));
}

export async function createTripEntry(...args: Parameters<typeof createTripEntryRequest>) {
  return settle(() => createTripEntryRequest(...args));
}

export async function updateTripEntry(...args: Parameters<typeof updateTripEntryRequest>) {
  return settle(() => updateTripEntryRequest(...args));
}

export async function addFundingsFromOutgoingEntries(...args: Parameters<typeof addFundingsFromOutgoingEntriesRequest>) {
  return settle(() => addFundingsFromOutgoingEntriesRequest(...args));
}

export async function bulkUpdateTripEntriesByIds(...args: Parameters<typeof bulkUpdateTripEntriesByIdsRequest>) {
  return settle(() => bulkUpdateTripEntriesByIdsRequest(...args));
}

export async function bulkUpdateTripEntriesByFilter(...args: Parameters<typeof bulkUpdateTripEntriesByFilterRequest>) {
  return settle(() => bulkUpdateTripEntriesByFilterRequest(...args));
}

export async function bulkDeleteTripEntriesByIds(...args: Parameters<typeof bulkDeleteTripEntriesByIdsRequest>) {
  return settle(() => bulkDeleteTripEntriesByIdsRequest(...args));
}

export async function bulkDeleteTripEntriesByFilter(...args: Parameters<typeof bulkDeleteTripEntriesByFilterRequest>) {
  return settle(() => bulkDeleteTripEntriesByFilterRequest(...args));
}
