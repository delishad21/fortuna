import { createServer } from "node:http";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Import-table tests serve the staged import themselves: start the dev server with
 * DATA_SERVICE_URL=http://127.0.0.1:<port> and run the tests with FAKE_DATA_SERVICE_PORT=<port>.
 */
export const FAKE_DATA_SERVICE_PORT = Number(
  process.env.FAKE_DATA_SERVICE_PORT || 0,
);

export async function signIn(
  page: Page,
  request: APIRequestContext,
  prefix: string,
) {
  const username = `${prefix}_${Date.now()}`,
    password = "chat-test-temporary-password";
  const registered = await request.post("/api/auth/register", {
    data: { username, password, name: "Chat QA", baseCurrency: "SGD" },
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 30000 });
}

export const CATEGORIES = [
  { id: "dining", name: "Dining", color: "#ff9800" },
  { id: "shopping", name: "Shopping", color: "#e91e63" },
  { id: "books", name: "Books", color: "#4caf50" },
  { id: "internal", name: "Internal", color: "#9ca3af" },
];

const NAMES = [
  "NOODLE BAR",
  "GADGET SHOP",
  "BOOKSTORE",
  "KIOSK",
  "TEA HOUSE",
  "BAKERY",
];

export const sampleValue = (i: number) => ({
  date: `2026-05-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
  description: `SAMPLE ${NAMES[i % NAMES.length]} ${i + 1}`,
  label: "",
  categoryId: CATEGORIES[i % 3].id,
  accountIdentifier: "111-sample",
  amountIn: null as number | null,
  amountOut: (6.5 + i) as number | null,
  balance: null as number | null,
  currency: "SGD",
  linkage: null as any,
});

/** A chat whose one review is served in memory, with row versions checked as the server does. */
export async function stubReview(
  page: Page,
  { rows = 6, delay = 0, status = "pending" } = {},
) {
  const review = {
    id: "rv1",
    conversationId: "c1",
    title: "May wallet payments",
    instructions: "Check the sample rows.",
    status,
    version: 1,
    decidedAt: null as string | null,
    categories: CATEGORIES,
    accounts: [{ id: "a1", accountIdentifier: "111-sample", color: "#2196f3" }],
    rows: Array.from({ length: rows }, (_, i) => ({
      id: `t${i + 1}`,
      version: 1,
      source: { transactionId: `t${i + 1}` },
      original: { ...sampleValue(i), categoryId: null as string | null },
      value: sampleValue(i),
      ...(i < 3
        ? { suggestion: { reason: "Could be a gift", confidence: 0.4 } }
        : {}),
    })),
  };
  const stub = {
    review,
    delay,
    puts: [] as Array<{
      rowId: string;
      version: number;
      patch: any;
      status: number;
    }>,
    gets: 0,
    sent: [] as any[],
    /** Awaited before answering a GET of the review, to hold a poll open. */
    beforeGet: null as null | (() => Promise<void>),
  };
  await page.route("**/api/chat/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/chat",
      "",
    );
    const method = route.request().method();
    let body: any = {};
    if (path === "/conversations")
      body = [{ id: "c1", title: "Wallet payments", updatedAt: "2026-06-01" }];
    else if (path === "/reviews/rv1" && method === "PUT") {
      const { rowId, version, patch } = route.request().postDataJSON();
      await new Promise((r) => setTimeout(r, stub.delay));
      const row = review.rows.find((r) => r.id === rowId)!;
      const ok = row.version === version;
      stub.puts.push({ rowId, version, patch, status: ok ? 200 : 409 });
      if (!ok) {
        await route.fulfill({
          status: 409,
          json: {
            error:
              "This row changed on another device. Your edit was not saved. Reload the row and try again.",
          },
        });
        return;
      }
      row.value = { ...row.value, ...patch };
      row.version++;
      review.version++;
      body = review;
    } else if (path === "/reviews/rv1/cancel") {
      review.status = "cancelled";
      review.decidedAt = "2026-06-02T00:00:00Z";
      body = review;
    } else if (path === "/reviews/rv1") {
      stub.gets++;
      body = JSON.parse(JSON.stringify(review));
      await stub.beforeGet?.();
    } else if (path === "/conversations/c1/messages" && method === "POST") {
      stub.sent.push(route.request().postDataJSON());
      review.status = "submitted";
      body = { runId: "r2" };
    } else if (path === "/conversations/c1")
      body = {
        id: "c1",
        title: "Wallet payments",
        attachments: [],
        runs: [
          {
            id: "r1",
            status: "awaiting_confirmation",
            proposals: [],
            reviews: [
              {
                id: "rv1",
                title: review.title,
                status: review.status,
                version: review.version,
              },
            ],
          },
        ],
        messages: [
          {
            id: "a1",
            role: "assistant",
            blocks: [
              ...Array.from({ length: 12 }, (_, i) => ({
                type: "text",
                text: `Sample reply paragraph ${i + 1}.`,
              })),
              { type: "review", id: "rv1", title: review.title },
            ],
          },
        ],
      };
    await route.fulfill({ json: body });
  });
  return stub;
}

/** Serves one staged import where the dev server expects the data service. */
export async function serveDraft({ rows = 6, delay = 0 } = {}) {
  const draft = {
    id: "draft1",
    mode: "main",
    status: "review",
    sourceFilename: "sample.csv",
    rows: Array.from({ length: rows }, (_, i) => ({
      id: `d${i + 1}`,
      rowIndex: i,
      version: 1,
      selected: true,
      parsedPayload: {},
      currentPayload: sampleValue(i),
      reviewStatus: "parsed",
      proposals: [],
    })),
  };
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    const match = req.url!.match(/drafts\/draft1\/rows\/(\w+)/);
    if (match) {
      await new Promise((r) => setTimeout(r, delay));
      const row = draft.rows.find((r) => r.id === match[1])!;
      const input = JSON.parse(raw);
      if (input.expectedVersion !== row.version)
        return send(409, { error: "Draft row is stale" });
      if (input.currentPayload) row.currentPayload = input.currentPayload;
      row.version++;
      return send(200, { row });
    }
    send(200, req.url!.includes("/drafts/draft1") ? { draft } : {});
  });
  await new Promise<void>((resolve) =>
    server.listen(FAKE_DATA_SERVICE_PORT, "127.0.0.1", resolve),
  );
  return {
    draft,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

/** The focused cell as "row:column", or the tag when focus is elsewhere. */
export const focused = (page: Page) =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    return e?.dataset.col
      ? `${e.dataset.row}:${e.dataset.col}`
      : e?.tagName || "";
  });

/** Presses keys ("=text" types) and reports where focus settles after each. */
export async function walk(page: Page, keys: string[]) {
  const path: string[] = [];
  for (const key of keys) {
    if (key.startsWith("=")) await page.keyboard.type(key.slice(1));
    else await page.keyboard.press(key);
    await page.waitForTimeout(120);
    path.push(await focused(page));
  }
  return path;
}

export const cell = (page: Page, row: number, col: string) =>
  page.locator(`[data-row="${row}"][data-col="${col}"]`);
