"use server";

import { auth } from "@/lib/auth";

const DATA_SERVICE_URL =
  process.env.DATA_SERVICE_URL || "http://localhost:4001";

export interface TransactionLinkage {
  type: "internal" | "reimbursement" | "reimbursed";
  reimbursesAllocations?: Array<{
    transactionId?: string;
    pendingBatchIndex?: number;
    amount: number;
  }>;
  reimbursedByAllocations?: Array<{
    transactionId: string;
    amount: number;
  }>;
  leftoverAmount?: number;
  leftoverCategoryId?: string | null;
  autoDetected?: boolean;
  detectionReason?: string;
}

export interface ImportTransaction {
  date: Date | string;
  description: string;
  label?: string;
  categoryId?: string | null;
  amountIn?: number;
  amountOut?: number;
  balance?: number;
  currency?: string;
  accountIdentifier?: string;
  source?: string;
  metadata?: any;
  linkage?: TransactionLinkage | null;
}

export interface DuplicateMatch {
  transaction: {
    id: string;
    date: Date;
    description: string;
    amountIn: number | null;
    amountOut: number | null;
    category?: {
      name: string;
      color: string;
    };
  };
  matchScore: number;
  matchReasons: string[];
}

export interface CheckImportResult {
  duplicates: Array<{
    index: number;
    matches: DuplicateMatch[];
  }>;
  cleanCount: number;
}

export interface CommitImportResult {
  success: boolean;
  importedCount?: number;
  batchId?: string;
  error?: string;
}

/**
 * Check import for duplicates without committing
 */
export async function checkImportDuplicates(
  transactions: ImportTransaction[],
): Promise<CheckImportResult> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/transactions/check-import`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: session.user.id,
        transactions,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to check duplicates");
  }

  return response.json();
}

/**
 * Commit selected transactions to database
 */
export async function commitImport(
  transactions: ImportTransaction[],
  selectedIndices: number[],
  batchInfo?: {
    filename: string;
    fileType: string;
    parserId: string;
  },
): Promise<CommitImportResult> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/transactions/commit-import`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: session.user.id,
        transactions,
        selectedIndices,
        batchInfo,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to commit import");
  }

  return response.json();
}

/**
 * Get transactions with filters
 */
export async function getTransactions(filters?: {
  dateFrom?: Date;
  dateTo?: Date;
  categoryIds?: string[];
  search?: string;
  minAmount?: number;
  maxAmount?: number;
  transactionType?: "income" | "expense";
  dateOrder?: "asc" | "desc";
  accountIdentifier?: string;
  limit?: number;
  offset?: number;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const params = new URLSearchParams({
    userId: session.user.id,
    ...(filters?.dateFrom && { dateFrom: filters.dateFrom.toISOString() }),
    ...(filters?.dateTo && { dateTo: filters.dateTo.toISOString() }),
    ...(filters?.categoryIds && {
      categoryIds: filters.categoryIds.join(","),
    }),
    ...(filters?.search && { search: filters.search }),
    ...(filters?.minAmount !== undefined && {
      minAmount: filters.minAmount.toString(),
    }),
    ...(filters?.maxAmount !== undefined && {
      maxAmount: filters.maxAmount.toString(),
    }),
    ...(filters?.transactionType && { transactionType: filters.transactionType }),
    ...(filters?.dateOrder && { dateOrder: filters.dateOrder }),
    ...(filters?.accountIdentifier && {
      accountIdentifier: filters.accountIdentifier,
    }),
    ...(filters?.limit && { limit: filters.limit.toString() }),
    ...(filters?.offset && { offset: filters.offset.toString() }),
  });

  const response = await fetch(`${DATA_SERVICE_URL}/api/transactions?${params}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to fetch transactions");
  }

  return response.json();
}

export async function getTransactionYears(): Promise<number[]> {
  const session = await auth();
  if (!session?.user?.id) {
    return [];
  }

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/transactions/years?userId=${session.user.id}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  return data.years || [];
}

/**
 * Delete a transaction
 */
export async function deleteTransaction(id: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/transactions/${id}?userId=${session.user.id}`,
    {
      method: "DELETE",
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to delete transaction");
  }

  return response.json();
}

/**
 * Update a transaction
 */
export async function updateTransaction(
  id: string,
  data: Partial<ImportTransaction>,
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const response = await fetch(`${DATA_SERVICE_URL}/api/transactions/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId: session.user.id,
      ...data,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to update transaction");
  }

  return response.json();
}

export async function splitTransaction(
  id: string,
  children: Array<{
    description: string;
    label?: string;
    categoryId?: string | null;
    amountIn?: number | null;
    amountOut?: number | null;
  }>,
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/transactions/${id}/split`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: session.user.id,
        children,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to split transaction");
  }

  return response.json();
}

export interface TransactionFilterPayload {
  dateFrom?: Date;
  dateTo?: Date;
  categoryIds?: string[];
  search?: string;
  minAmount?: number;
  maxAmount?: number;
  transactionType?: "income" | "expense";
  dateOrder?: "asc" | "desc";
  accountIdentifier?: string;
}

export async function bulkUpdateTransactionsByIds(
  ids: string[],
  updates: Partial<ImportTransaction>,
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const response = await fetch(`${DATA_SERVICE_URL}/api/transactions/bulk`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId: session.user.id,
      ids,
      updates,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to update transactions");
  }

  return response.json();
}

export async function bulkUpdateTransactionsByFilter(
  filters: TransactionFilterPayload,
  excludeIds: string[] | undefined,
  updates: Partial<ImportTransaction>,
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/transactions/bulk-by-filter`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
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
    throw new Error(error.error || "Failed to update transactions");
  }

  return response.json();
}

export async function bulkDeleteTransactionsByIds(ids: string[]) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const response = await fetch(`${DATA_SERVICE_URL}/api/transactions/bulk`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId: session.user.id,
      ids,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to delete transactions");
  }

  return response.json();
}

export async function bulkDeleteTransactionsByFilter(
  filters: TransactionFilterPayload,
  excludeIds: string[] | undefined,
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/transactions/bulk-by-filter`,
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
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
    throw new Error(error.error || "Failed to delete transactions");
  }

  return response.json();
}

export async function exportTransactionsCsv(
  params:
    | { ids: string[]; filters?: undefined; excludeIds?: undefined }
    | { ids?: undefined; filters: TransactionFilterPayload; excludeIds?: string[] },
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/transactions/export`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: session.user.id,
        ids: params.ids,
        filters: params.filters
          ? {
              ...params.filters,
              dateFrom: params.filters.dateFrom?.toISOString(),
              dateTo: params.filters.dateTo?.toISOString(),
            }
          : undefined,
        excludeIds: params.excludeIds,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to export transactions");
  }

  return response.text();
}

/**
 * Search transactions for reimbursement linking
 */
export async function searchTransactionsForReimbursement(
  query?: string,
  limit: number = 20,
  offset: number = 0,
  filters?: {
    transactionType?: "all" | "in" | "out";
    categoryId?: string;
    dateFrom?: string;
    dateTo?: string;
    amountEquals?: number;
  },
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const params = new URLSearchParams({
    userId: session.user.id,
    limit: limit.toString(),
    offset: offset.toString(),
    ...(query?.trim() ? { query: query.trim() } : {}),
    ...(filters?.transactionType && filters.transactionType !== "all"
      ? { transactionType: filters.transactionType }
      : {}),
    ...(filters?.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters?.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters?.dateTo ? { dateTo: filters.dateTo } : {}),
    ...(typeof filters?.amountEquals === "number"
      ? { amountEquals: String(filters.amountEquals) }
      : {}),
  });

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/transactions/search-reimbursement?${params}`,
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to search transactions");
  }

  return response.json();
}

/**
 * Get linked transactions for a transaction
 */
export async function getLinkedTransactions(id: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const params = new URLSearchParams({
    userId: session.user.id,
  });

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/transactions/${id}/linked?${params}`,
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to get linked transactions");
  }

  return response.json();
}
