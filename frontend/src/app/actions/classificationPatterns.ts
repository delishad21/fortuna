"use server";

import { auth } from "@/lib/auth";

const DATA_SERVICE_URL =
  process.env.DATA_SERVICE_URL || "http://localhost:4001";

export type ClassificationPatternStatus =
  | "auto_apply"
  | "disabled"
  | "unresolved";

export interface ClassificationPattern {
  id: string;
  patternType: "description_exact" | "merchant_stem" | "label_alias" | "unresolved";
  patternValue: string;
  parserId?: string | null;
  direction?: string | null;
  label?: string | null;
  categoryId?: string | null;
  markInternal: boolean;
  confidence: number | string;
  supportCount: number;
  matchCount: number;
  conflictCount: number;
  appliedCount: number;
  status: ClassificationPatternStatus;
  lastSeenAt?: string | Date | null;
  category?: { id: string; name: string; color: string } | null;
}

export interface AppliedClassificationSummaryItem {
  id: string;
  type: "fixed" | "learned";
  name: string;
  patternValue?: string | null;
  appliedCount: number;
  lastAppliedAt: string | null;
  exampleDescription: string;
}

async function requireUserId() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id;
}

export async function getClassificationPatterns(): Promise<ClassificationPattern[]> {
  const userId = await requireUserId();
  const response = await fetch(
    `${DATA_SERVICE_URL}/api/transactions/classification-patterns?userId=${userId}`,
    { cache: "no-store" },
  );
  if (!response.ok) return [];
  const data = await response.json().catch(() => ({ patterns: [] }));
  return data.patterns || [];
}

export async function rebuildClassificationPatterns(): Promise<{
  rebuiltCount: number;
  patterns: ClassificationPattern[];
}> {
  const userId = await requireUserId();
  const response = await fetch(
    `${DATA_SERVICE_URL}/api/transactions/classification-patterns/rebuild`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    },
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to rebuild learned rules");
  }
  return response.json();
}

export async function updateClassificationPattern(
  patternId: string,
  pattern: Partial<Pick<ClassificationPattern, "status" | "label" | "categoryId" | "markInternal">>,
): Promise<ClassificationPattern> {
  const userId = await requireUserId();
  const response = await fetch(
    `${DATA_SERVICE_URL}/api/transactions/classification-patterns/${patternId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, pattern }),
    },
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to update learned rule");
  }
  const data = await response.json();
  return data.pattern;
}

export async function getAppliedClassificationSummary(): Promise<
  AppliedClassificationSummaryItem[]
> {
  const userId = await requireUserId();
  const response = await fetch(
    `${DATA_SERVICE_URL}/api/transactions/classification-patterns/applied-summary?userId=${userId}`,
    { cache: "no-store" },
  );
  if (!response.ok) return [];
  const data = await response.json().catch(() => ({ summary: [] }));
  return data.summary || [];
}
