/** Public chat wire types shared by Next and Expo. Contains no server dependencies. */
export type Block =
  | { type: "text"; text: string }
  | { type: "attachment"; id: string; filename: string }
  | {
      type: "link";
      kind: "draft" | "transaction" | "proposal";
      id: string;
      label: string;
    }
  | { type: "data"; title: string; data: any };
export type Proposal = {
  id: string;
  kind: string;
  status: string;
  preview: any;
  expiresAt: string;
};
export type Run = {
  id: string;
  status: string;
  error?: string | null;
  proposals: Proposal[];
};
export type Conversation = {
  id: string;
  title: string;
  messages: Array<{ id: string; role: string; blocks: Block[] }>;
  runs: Run[];
  attachments: Array<{
    id: string;
    statementFile: {
      filename: string;
      expiresAt: string;
      deletedAt: string | null;
    };
  }>;
};
export type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
};
export type Connection = {
  provider: "codex" | "openrouter";
  selected: boolean;
  status: string;
  keyHint: string | null;
};
export type DeviceLogin = {
  loginId: string;
  verificationUrl: string;
  userCode: string;
  expiresAt: string;
  status: string;
};
export type ChatEvent = {
  sequence: number;
  payload: {
    type: string;
    text?: string;
    name?: string;
    result?: { blocks: Block[] };
  };
};
export type Stream = {
  cursor: number;
  text: string;
  activity: string;
  blocks: Block[];
  pending: ChatEvent[];
};
export const emptyStream = (): Stream => ({
  cursor: 0,
  text: "",
  activity: "Waiting for the assistant",
  blocks: [],
  pending: [],
});
export function mergeEvents(state: Stream, events: ChatEvent[]): Stream {
  const next = {
    ...state,
    pending: [...state.pending, ...events]
      .filter((e) => e.sequence > state.cursor)
      .sort((a, b) => a.sequence - b.sequence),
    blocks: [...state.blocks],
  };
  while (next.pending.length) {
    const event = next.pending[0];
    if (event.sequence <= next.cursor) {
      next.pending.shift();
      continue;
    }
    if (event.sequence !== next.cursor + 1) break;
    next.pending.shift();
    next.cursor = event.sequence;
    const p = event.payload;
    if (p.type === "reset") {
      next.text = "";
      next.blocks = [];
    }
    if (p.type === "text_delta") next.text += p.text || "";
    if (p.type === "tool_call")
      next.activity = (p.name || "Working").replace(/_/g, " ");
    if (p.type === "tool_result") next.blocks.push(...(p.result?.blocks || []));
  }
  return next;
}
export const activeRun = (run?: Run) =>
  !!run && ["queued", "running", "awaiting_confirmation"].includes(run.status);
export const changedFields = (
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) =>
  Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
export const fieldLabel = (key: string) =>
  key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
export const displayValue = (value: unknown): string =>
  value === null || value === undefined
    ? "None"
    : typeof value === "object"
      ? JSON.stringify(value, null, 2)
      : String(value);
export type ChatRequest = <T = any>(
  path: string,
  options?: { method?: string; body?: unknown; signal?: AbortSignal },
) => Promise<T>;
export function createChatRequest(
  base: string,
  token?: string,
  onUnauthorized?: () => void,
): ChatRequest {
  return async <T>(
    path: string,
    options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
  ) => {
    const form =
      typeof FormData !== "undefined" && options.body instanceof FormData;
    const response = await fetch(`${base}/api/chat${path}`, {
      method: options.method || "GET",
      credentials: token ? "omit" : "same-origin",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(!form && options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body:
        options.body === undefined
          ? undefined
          : form
            ? (options.body as FormData)
            : JSON.stringify(options.body),
      signal: options.signal,
    });
    const value = await response
      .json()
      .catch(() => ({ error: "The server returned an unreadable response" }));
    if (response.status === 401) onUnauthorized?.();
    if (!response.ok)
      throw new Error(value.error || "Unable to connect to Fortuna");
    return value as T;
  };
}
