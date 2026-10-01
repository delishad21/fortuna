/** Public chat wire types shared by Next and Expo. Contains no server dependencies. */
export type Block =
  | { type: "review"; id: string; title: string }
  | { type: "text"; text: string }
  | {
      type: "attachment";
      id: string;
      filename: string;
      mediaType?: "image" | "statement";
    }
  | {
      type: "link";
      kind: "draft" | "transaction" | "proposal";
      id: string;
      label: string;
    }
  | { type: "data"; title: string; data: any }
  | ComponentBlock;
export type ComponentRow = {
  id: string;
  date: string;
  description: string;
  label: string | null;
  amountIn: string | null;
  amountOut: string | null;
  currency: string | null;
  accountIdentifier: string | null;
  category: { id: string; name: string; color?: string | null } | null;
  linkage: any;
};
type Totals = { expense: string; income: string; net: string; count: number };
/** Rich components chosen by the assistant. Amounts are decimal strings; currencies are never mixed. */
export type ComponentBlock =
  | {
      type: "component";
      component: "transaction_list";
      title: string;
      query: Record<string, unknown>;
      total: number;
      rows: ComponentRow[];
    }
  | {
      type: "component";
      component: "summary_tiles";
      title: string;
      query: Record<string, unknown>;
      previousRange?: { dateFrom: string; dateTo: string };
      currencies: Array<{ currency: string; previous?: Totals } & Totals>;
    }
  | {
      type: "component";
      component: "breakdown";
      title: string;
      query: Record<string, unknown>;
      groupBy: "category" | "merchant" | "account";
      series: Array<{
        currency: string;
        total: string;
        items: Array<{
          name: string;
          amount: string;
          count: number;
          color?: string;
          other?: boolean;
        }>;
      }>;
    }
  | {
      type: "component";
      component: "trend";
      title: string;
      query: Record<string, unknown>;
      interval: "day" | "week" | "month";
      series: Array<{
        currency: string;
        points: Array<{ period: string; expense: string; income: string }>;
      }>;
    };
/** A file attached to the message being composed. */
export type PendingAttachment = {
  attachmentId: string;
  filename: string;
  kind: "image" | "statement";
  preview?: string;
};
export const IMAGE_UPLOAD_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
export const IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
export const attachmentContentPath = (id: string) =>
  `/api/chat/attachments/${encodeURIComponent(id)}/content`;
export const TRANSACTION_PAGE_SIZE = 50;
export const fetchTransactionPage = (
  request: ChatRequest,
  query: Record<string, unknown>,
  offset: number,
) =>
  request<{ rows: ComponentRow[]; total: number }>("/components/transactions", {
    method: "POST",
    body: { query, offset, limit: TRANSACTION_PAGE_SIZE },
  });
export const formatMoney = (amount: string | number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(Number(amount));
  } catch {
    return `${currency} ${Number(amount).toFixed(2)}`;
  }
};
/** "+12% vs previous period", or null when there is no meaningful baseline. */
export const changeLabel = (current: string, previous?: string) => {
  if (previous === undefined || Number(previous) === 0) return null;
  const change =
    (Number(current) - Number(previous)) / Math.abs(Number(previous));
  return `${change >= 0 ? "+" : "−"}${Math.abs(change * 100).toFixed(0)}% vs previous period`;
};
export const periodLabel = (
  period: string,
  interval: "day" | "week" | "month",
) =>
  interval === "month"
    ? new Date(period + "-01T00:00:00Z").toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
        timeZone: "UTC",
      })
    : (interval === "week" ? "Wk " : "") +
      new Date(period + "T00:00:00Z").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
export const groupLabel = {
  category: "Category",
  merchant: "Merchant",
  account: "Account",
};
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

export type ReviewRow = {
  id: string;
  version: number;
  source: { transactionId?: string; draftId?: string; rowId?: string };
  original: Record<string, any>;
  value: Record<string, any>;
};
export type TransactionReview = {
  id: string;
  conversationId: string;
  title: string;
  instructions: string;
  status: string;
  version: number;
  rows: ReviewRow[];
  categories: { id: string; name: string; color?: string }[];
  accounts: { id: string; accountIdentifier: string; color?: string }[];
};
export const generatingRun = (run?: Run) =>
  !!run && ["queued", "running"].includes(run.status);
