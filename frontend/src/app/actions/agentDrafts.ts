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
      ...(typeof init?.body === "string" ? { "Content-Type": "application/json" } : {}),
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

/**
 * Stage an uploaded bank statement for review: store the file, open a draft and parse it.
 * Re-uploading a statement that is still staged returns that draft without discarding its edits.
 */
export async function stageStatementImport(formData: FormData) {
  const file = formData.get("file");
  const parserId = String(formData.get("parserId") || "");
  if (!(file instanceof File) || !parserId) throw new Error("A statement file and parser are required");
  const upload = new FormData();
  upload.append("file", file, file.name);
  const { statement } = await request<{ statement: { id: string } }>("/api/agent/statements", {
    method: "POST",
    body: upload,
  });
  const { draft } = await request<{ draft: Record<string, any> & { duplicate?: boolean } }>("/api/agent/drafts", {
    method: "POST",
    body: JSON.stringify({ fileRef: statement.id, mode: "main", parserId }),
  });
  if (draft.duplicate && draft.rows?.length) return { draft, resumed: true };
  const parsed = await request<{ draft: Record<string, any> }>(
    `/api/agent/drafts/${encodeURIComponent(draft.id)}/parse`,
    { method: "POST", body: JSON.stringify({ parserId }) },
  );
  return { draft: parsed.draft, resumed: false };
}

export async function getStagedReimbursementTargets() {
  const { drafts } = await getAgentDrafts();
  const active = drafts.filter(
    (draft) =>
      draft.mode === "main" &&
      !["committed", "discarded", "expired"].includes(String(draft.status)),
  );
  const detailed = await Promise.all(
    active.map((draft) => getAgentDraft(String(draft.id)).then((result) => result.draft)),
  );
  const allocatedByTarget = new Map<string, number>();
  detailed.forEach((draft) => {
    (draft.rows || []).forEach((row: Record<string, any>) => {
      const linkage = row.currentPayload?.linkage;
      if (linkage?.type !== "reimbursement") return;
      (linkage.reimbursesAllocations || []).forEach((allocation: Record<string, any>) => {
        if (!allocation.stagedDraftId || !allocation.stagedRowId) return;
        const key = `${allocation.stagedDraftId}:${allocation.stagedRowId}`;
        allocatedByTarget.set(
          key,
          (allocatedByTarget.get(key) || 0) + Number(allocation.amount || 0),
        );
      });
    });
  });
  return {
    transactions: detailed.flatMap((draft) =>
      (draft.rows || []).flatMap((row: Record<string, any>) => {
        const payload = row.currentPayload || {};
        const amount = Number(payload.amountOut || payload.amountIn || 0);
        if (!row.selected || !(amount > 0) || payload.linkage?.type === "reimbursement") {
          return [];
        }
        const key = `${draft.id}:${row.id}`;
        return [
          {
            id: key,
            stagedDraftId: draft.id,
            stagedRowId: row.id,
            sourceFilename: draft.sourceFilename,
            date: payload.date,
            description: payload.description,
            label: payload.label || null,
            amountIn: payload.amountIn ?? null,
            amountOut: payload.amountOut ?? null,
            categoryId: payload.categoryId || null,
            remainingAmount: Math.max(
              amount - (allocatedByTarget.get(key) || 0),
              0,
            ),
          },
        ];
      }),
    ),
  };
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

export async function validateAgentDraftSelection(draftIds: string[]) {
  return request<Record<string, any>>("/api/agent/drafts/validate-selection", {
    method: "POST",
    body: JSON.stringify({ draftIds }),
  });
}

export async function commitAgentDraft(draftId: string, confirmationToken: string) {
  return request<Record<string, any>>(`/api/agent/drafts/${encodeURIComponent(draftId)}/commit`, {
    method: "POST",
    body: JSON.stringify({ confirmationToken, confirmed: true }),
  });
}
