"use server";

import { auth } from "@/lib/actionAuth";

const DATA_SERVICE_URL = process.env.DATA_SERVICE_URL || "http://data-service:4001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  const serviceToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!serviceToken) throw new Error("Internal data-service authentication is not configured");
  const response = await fetch(new URL(path, DATA_SERVICE_URL), {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "X-Internal-Service-Token": serviceToken,
      "X-Authenticated-User-Id": session.user.id,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Data service returned ${response.status}`);
  return body as T;
}

export async function getAgentDrafts() {
  return request<{ drafts: Array<Record<string, any>> }>("/api/agent/drafts");
}

export async function getAgentDraft(draftId: string) {
  return request<{ draft: Record<string, any> }>(`/api/agent/drafts/${encodeURIComponent(draftId)}`);
}

export async function decideAgentProposal(proposalId: string, decision: "accept" | "reject") {
  return request<{ proposal: Record<string, any> }>(`/api/agent/proposals/${encodeURIComponent(proposalId)}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}

export async function updateAgentDraftRow(
  draftId: string,
  rowId: string,
  input: { expectedVersion: number; currentPayload?: Record<string, unknown>; selected?: boolean; reviewStatus?: "edited" },
) {
  return request<{ row: Record<string, any> }>(
    `/api/agent/drafts/${encodeURIComponent(draftId)}/rows/${encodeURIComponent(rowId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export async function validateAgentDraft(draftId: string) {
  return request<Record<string, any>>(`/api/agent/drafts/${encodeURIComponent(draftId)}/validate`, {
    method: "POST",
    body: "{}",
  });
}

export async function commitAgentDraft(draftId: string, confirmationToken: string) {
  return request<Record<string, any>>(`/api/agent/drafts/${encodeURIComponent(draftId)}/commit`, {
    method: "POST",
    body: JSON.stringify({ confirmationToken, confirmed: true }),
  });
}
