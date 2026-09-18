"use server";

import { auth } from "@/lib/actionAuth";

const DATA_SERVICE_URL =
  process.env.DATA_SERVICE_URL || "http://localhost:4001";

export interface ImportRule {
  id: string;
  name: string;
  parserId?: string | null;
  matchType: "always" | "description_contains";
  matchValue?: string | null;
  caseSensitive: boolean;
  enabled: boolean;
  setLabel?: string | null;
  setCategoryName?: string | null;
  markInternal: boolean;
  sortOrder: number;
}

export interface ImportRulePayload {
  name: string;
  parserId?: string | null;
  matchType?: "always" | "description_contains";
  matchValue?: string | null;
  caseSensitive?: boolean;
  enabled?: boolean;
  setLabel?: string | null;
  setCategoryName?: string | null;
  markInternal?: boolean;
  sortOrder?: number;
}

export interface PaylahInternalPreferenceState {
  shouldPrompt: boolean;
  enabled: boolean;
}

export async function bootstrapDefaultImportRules() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/transactions/import-rules/bootstrap`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: session.user.id }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    try {
      const error = await response.json();
      console.error("Failed to bootstrap import rules:", error?.error || error);
    } catch {
      console.error("Failed to bootstrap import rules");
    }
    return { success: false };
  }

  return response.json().catch(() => ({ success: true }));
}

export async function getImportRules(): Promise<ImportRule[]> {
  const session = await auth();
  if (!session?.user?.id) return [];

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/transactions/import-rules?userId=${session.user.id}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    try {
      const error = await response.json();
      console.error("Failed to fetch import rules:", error?.error || error);
    } catch {
      console.error("Failed to fetch import rules");
    }
    return [];
  }

  const data = await response.json().catch(() => ({ rules: [] }));
  return data.rules || [];
}

export async function createImportRule(payload: ImportRulePayload) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const response = await fetch(`${DATA_SERVICE_URL}/api/transactions/import-rules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: session.user.id, rule: payload }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to create import rule");
  }

  const data = await response.json();
  return data.rule as ImportRule;
}

export async function updateImportRule(
  ruleId: string,
  payload: Partial<ImportRulePayload>,
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/transactions/import-rules/${ruleId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: session.user.id, rule: payload }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to update import rule");
  }

  const data = await response.json();
  return data.rule as ImportRule;
}

export async function deleteImportRule(ruleId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/transactions/import-rules/${ruleId}?userId=${session.user.id}`,
    { method: "DELETE" },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to delete import rule");
  }

  return response.json();
}

export async function getPaylahInternalPreferenceState(): Promise<PaylahInternalPreferenceState> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/transactions/import-rules/paylah-internal-preference?userId=${session.user.id}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      error.error || "Failed to fetch PayLah internal preference state",
    );
  }

  const data = await response.json();
  return {
    shouldPrompt: Boolean(data?.shouldPrompt),
    enabled: Boolean(data?.enabled),
  };
}

export async function setPaylahInternalPreference(enabled: boolean): Promise<{
  enabled: boolean;
  updatedCount: number;
}> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/transactions/import-rules/paylah-internal-preference`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: session.user.id, enabled }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to save PayLah internal preference");
  }

  const data = await response.json();
  return {
    enabled: Boolean(data?.enabled),
    updatedCount: Number(data?.updatedCount || 0),
  };
}
