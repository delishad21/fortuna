"use server";

import { auth } from "@/lib/actionAuth";
import { dataServiceRequest } from "@/lib/dataService";
import type { SourceInput, SourceSuggestion, TransactionSource } from "@/lib/sourceTypes";

/**
 * Sources (how each account's or card's transactions reach the assistant) for
 * the web and mobile apps, through data-service's /api/agent/sources: the
 * same implementation and audit trail as the API.
 */

async function userId() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

const call = async <T>(path: string, method = "GET", body?: Record<string, unknown>) =>
  dataServiceRequest<T>(await userId(), `/api/agent/sources${path}`, {
    method,
    ...(method === "GET" ? {} : { body: { ...body, confirmed: true } }),
  });
const id = (value: string) => encodeURIComponent(value);

export async function getSources(): Promise<TransactionSource[]> {
  const session = await auth();
  if (!session?.user?.id) return [];
  return (await call<{ sources: TransactionSource[] }>("")).sources;
}

/** Sources Fortuna can tell from imports, e.g. PayLah alert emails. Never added by themselves. */
export async function getSourceSuggestions(): Promise<SourceSuggestion[]> {
  return (await call<{ suggestions: SourceSuggestion[] }>("/suggestions")).suggestions;
}

export async function createSource(input: SourceInput): Promise<TransactionSource> {
  return (await call<{ source: TransactionSource }>("", "POST", { ...input })).source;
}

export async function updateSource(sourceId: string, input: Partial<SourceInput>): Promise<TransactionSource> {
  return (await call<{ source: TransactionSource }>(`/${id(sourceId)}`, "PATCH", { ...input })).source;
}

export async function deleteSource(sourceId: string): Promise<void> {
  await call(`/${id(sourceId)}`, "DELETE");
}
