import { config } from "./config.js";

export interface AccountIdentity {
  user: {
    id: string;
    username: string;
    name: string | null;
  };
  token: {
    id: string;
    scopes: string[];
  };
}

async function parseResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

export async function dataServiceRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(new URL(path, config.dataServiceUrl), {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.financeApiToken}`,
      ...(init?.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await parseResponse(response);
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Data service request failed with ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export async function parserServiceRequest<T>(path: string): Promise<T> {
  const response = await fetch(new URL(path, config.parserServiceUrl), {
    headers: { Accept: "application/json", Authorization: `Bearer ${config.financeApiToken}` },
  });
  const body = await parseResponse(response);
  if (!response.ok) throw new Error(`Parser service request failed with ${response.status}`);
  return body as T;
}

export function resolveAccountIdentity() {
  return dataServiceRequest<AccountIdentity>("/api/auth/whoami");
}

export async function uploadStatement(input: {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([Uint8Array.from(input.bytes).buffer], { type: input.contentType }),
    input.filename,
  );
  return dataServiceRequest<{ statement: Record<string, unknown> }>("/api/agent/statements", {
    method: "POST",
    body: form,
    headers: {},
  });
}
