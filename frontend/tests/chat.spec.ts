import { test, expect } from "@playwright/test";
test("chat preserves failed messages, resumes events, reviews diffs and opens provider settings", async ({
  page,
  request,
}) => {
  const username = `chat_web_${Date.now()}`,
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
  let fail = true,
    started = false,
    approved = false;
  const review = {
    id: "review1",
    conversationId: "c1",
    title: "Check these transactions",
    instructions: "Correct the label before sending.",
    status: "pending",
    version: 1,
    categories: [{ id: "cat1", name: "Food", color: "#5750F1" }],
    accounts: [{ id: "acct1", accountIdentifier: "DBS", color: "#5750F1" }],
    rows: [
      {
        id: "t1",
        version: 1,
        source: { transactionId: "t1" },
        original: {},
        value: {
          date: "2026-09-01T00:00:00.000Z",
          description: "Lunch",
          label: "Cafe",
          categoryId: "cat1",
          accountIdentifier: "DBS",
          amountOut: 15,
          currency: "SGD",
          metadata: {},
        },
      },
    ],
  };
  const proposal = {
    id: "proposal1",
    kind: "edit_transactions",
    status: "pending",
    expiresAt: "2099-01-01",
    preview: {
      title: "Edit saved transactions",
      changes: [
        {
          id: "t1",
          before: { description: "Lunch", label: "Cafe" },
          after: { description: "Lunch", label: "Work lunch" },
        },
      ],
    },
  };
  const conversation = () => ({
    id: "c1",
    title: "Spending review",
    attachments: [],
    messages: started
      ? [
          {
            id: "u1",
            role: "user",
            blocks: [{ type: "text", text: "Review lunch" }],
          },
          {
            id: "a1",
            role: "assistant",
            blocks: [
              { type: "text", text: "Ready for review" },
              {
                type: "review",
                id: "review1",
                title: "Check these transactions",
              },
              {
                type: "link",
                kind: "proposal",
                id: "proposal1",
                label: "Review changes",
              },
            ],
          },
        ]
      : [],
    runs: started
      ? [
          {
            id: "r1",
            status: approved ? "completed" : "awaiting_confirmation",
            proposals: [
              { ...proposal, status: approved ? "applied" : "pending" },
            ],
          },
        ]
      : [],
  });
  await page.route("**/api/chat/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.replace("/api/chat", "");
    let body: any = {};
    if (path === "/conversations")
      body =
        route.request().method() === "POST"
          ? { id: "c1" }
          : [{ id: "c1", title: "Spending review", updatedAt: "2026-09-28" }];
    else if (path === "/reviews/review1") {
      if (route.request().method() === "PUT") {
        const update = route.request().postDataJSON();
        expect(update.version).toBe(review.rows[0].version);
        review.rows[0].value = { ...review.rows[0].value, ...update.patch };
        review.rows[0].version++;
        review.version++;
      }
      body = review;
    } else if (path === "/conversations/c1") body = conversation();
    else if (path.endsWith("/messages")) {
      if (fail) {
        fail = false;
        return route.fulfill({
          status: 503,
          json: { error: "Connection interrupted" },
        });
      }
      started = true;
      body = { runId: "r1" };
    } else if (path.endsWith("/approve")) {
      approved = true;
      body = { status: "applied" };
    } else if (path === "/settings") body = [];
    await route.fulfill({ json: body });
  });
  await page.goto("/chat");
  await expect(page.getByRole("heading", { name: "Conversations", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New chat", exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Spending review", exact: true })
    .click();
  await page.getByLabel("Message", { exact: true }).fill("Review lunch");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("Connection interrupted", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "Review lunch",
  );
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByLabel("Message", { exact: true }).fill("New task");
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeEnabled();
  await page.getByLabel("Message", { exact: true }).fill("");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  const label = page.locator('input[data-col="label"]');
  await label.fill("Team lunch");
  await label.blur();
  await expect.poll(() => review.rows[0].value.label).toBe("Team lunch");
  await expect(page.getByText("Invalid Date", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Chat", exact: true })).toHaveCSS(
    "color",
    "rgb(255, 255, 255)",
  );
  await label
    .locator("xpath=ancestor::tr")
    .locator("td")
    .nth(1)
    .getByRole("button")
    .click();
  const balance = page.getByLabel("Balance for row 1", { exact: true });
  await expect(balance).toBeVisible();
  await balance.fill("33");
  await balance.blur();
  await expect.poll(() => (review.rows[0].value as any).balance).toBe(33);
  await expect(balance).toBeEnabled();
  await page.getByLabel("Message", { exact: true }).focus();
  (review.rows[0].value as any).balance = 55;
  review.rows[0].version++;
  review.version++;
  await expect(balance).toHaveValue("55", { timeout: 6000 });
  const versionBefore = review.version;
  await balance.focus();
  await balance.blur();
  await page.waitForTimeout(100);
  expect(review.version).toBe(versionBefore);
  await label
    .locator("xpath=ancestor::tr")
    .locator("td")
    .nth(1)
    .getByRole("button")
    .click();
  await page.screenshot({ path: "/tmp/fortuna-chat-workspace.png" });
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByRole("dialog")).toContainText("Before");
  await expect(page.getByRole("dialog")).toContainText("Work lunch");
  await page.screenshot({ path: "/tmp/fortuna-chat-web-approval.png" });
  await page
    .getByRole("button", { name: "Confirm changes", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Changes applied" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Toggle chat history", exact: true })
    .click();
  await page.getByRole("link", { name: "AI connection", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "AI connection" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in with Codex" }),
  ).toBeVisible();
});

test("chat shows transaction cards in saved and streaming responses on desktop and mobile", async ({ page, request }) => {
  const username = `chat_cards_${Date.now()}`, password = "chat-test-temporary-password";
  const registered = await request.post("/api/auth/register", {
    data: { username, password, name: "Chat QA", baseCurrency: "SGD" },
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 30000 });
  const transactions = [
    { id: "lunch", date: "2026-09-01T00:00:00.000Z", description: "CARD PAYMENT CAFE", label: "Team lunch", amountIn: null, amountOut: "15.50", currency: "SGD", category: { id: "food", name: "Food", color: "#5750F1" }, accountIdentifier: "DBS", linkage: null },
    { id: "salary", date: "2026-09-01T00:00:00.000Z", description: "Salary", label: null, amountIn: "2500", amountOut: null, currency: "SGD", category: null, accountIdentifier: "DBS", linkage: null },
  ];
  let streaming = false;
  const sent: string[] = [];
  await page.route("**/api/chat/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/chat", "");
    let body: any = {};
    if (path === "/conversations/new/messages") sent.push(route.request().postDataJSON().text);
    if (path === "/conversations") body = route.request().method() === "POST" ? { id: "new" } : [{ id: "c1", title: "September spending", updatedAt: "2026-09-28" }];
    else if (path === "/conversations/new") body = { id: "new", title: "New chat", messages: [], runs: [], attachments: [] };
    else if (path === "/conversations/c1") body = {
      id: "c1", title: "September spending", attachments: [],
      messages: streaming ? [] : [{ id: "a1", role: "assistant", blocks: [{ type: "data", title: "Transactions", data: transactions }] }],
      runs: streaming ? [{ id: "r1", status: "running", proposals: [] }] : [],
    };
    else if (path.startsWith("/runs/r1/events")) body = { status: "running", events: [{ sequence: 1, payload: { type: "tool_result", result: { blocks: [{ type: "data", title: "Transactions", data: transactions }] } } }] };
    await route.fulfill({ json: body });
  });
  await page.goto("/chat?conversation=c1");
  await expect(page.getByRole("heading", { name: "Transactions", exact: true })).toBeVisible();
  const lunch = page.getByText("Team lunch", { exact: true }).first();
  await expect(lunch).toBeVisible();
  await expect(page.getByText("-SGD 15.50", { exact: true })).toBeVisible();
  await expect(page.getByText("+SGD 2,500.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Food", { exact: true }).first()).toBeVisible();
  await lunch.click();
  await expect(page.getByText("CARD PAYMENT CAFE", { exact: true }).last()).toBeVisible();
  await page.screenshot({ path: "/tmp/fortuna-chat-transactions-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(lunch).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: "/tmp/fortuna-chat-transactions-mobile.png" });
  await page.goto("/chat");
  await page.getByRole("button", { name: "September spending", exact: true }).click();
  await expect(lunch).toBeVisible();
  await page.goto("/chat");
  await page.screenshot({ path: "/tmp/fortuna-chat-conversations-mobile.png" });
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/conversation=new/);
  const message = page.getByLabel("Message", { exact: true });
  await message.fill("first line");
  await message.press("Shift+Enter");
  await message.pressSequentially("second line");
  await expect(message).toHaveValue("first line\nsecond line");
  expect(sent).toEqual([]);
  await message.press("Enter");
  await expect.poll(() => sent).toEqual(["first line\nsecond line"]);
  streaming = true;
  await page.goto("/chat?conversation=c1");
  await expect(page.getByRole("article", { name: "Assistant response" }).getByText("Team lunch", { exact: true }).first()).toBeVisible();
});

test("chat renders assistant components and pages large transaction lists", async ({ page, request }) => {
  const username = `chat_components_${Date.now()}`, password = "chat-test-temporary-password";
  const registered = await request.post("/api/auth/register", {
    data: { username, password, name: "Chat QA", baseCurrency: "SGD" },
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 30000 });
  const query = { dateFrom: "2026-08-01T00:00:00Z", dateTo: "2026-09-01T00:00:00Z" };
  // The real paging endpoint is reachable through the authenticated proxy and scoped to this user.
  const real = await page.evaluate(async (query) => {
    const response = await fetch("/api/chat/components/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, offset: 0, limit: 50 }),
    });
    return { status: response.status, body: await response.json() };
  }, query);
  expect(real).toEqual({ status: 200, body: { rows: [], total: 0 } });
  const row = (i: number) => ({
    id: `t${i}`, date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    description: `CARD ${i}`, label: `Coffee ${i}`, amountIn: null, amountOut: "4.50",
    currency: "SGD", accountIdentifier: "DBS", category: { id: "food", name: "Food", color: "#5750F1" }, linkage: null,
  });
  const blocks = [
    { type: "component", component: "summary_tiles", title: "August at a glance", query,
      currencies: [{ currency: "SGD", expense: "270.00", income: "500.00", net: "230.00", count: 60,
        previous: { expense: "200.00", income: "500.00", net: "300.00", count: 40 } }] },
    { type: "component", component: "breakdown", title: "Where it went", query, groupBy: "category",
      series: [{ currency: "SGD", total: "270.00", items: [
        { name: "Food", amount: "200.00", count: 40, color: "#5750F1" },
        { name: "Other (3)", amount: "70.00", count: 20, other: true }] }] },
    { type: "component", component: "trend", title: "Weekly spending", query, interval: "week",
      series: [{ currency: "SGD", points: [
        { period: "2026-07-27", expense: "20.00", income: "0.00" },
        { period: "2026-08-03", expense: "250.00", income: "500.00" }] }] },
    { type: "component", component: "transaction_list", title: "August coffee", query, total: 60,
      rows: Array.from({ length: 25 }, (_, i) => row(i)) },
  ];
  const pages: number[] = [];
  await page.route("**/api/chat/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/chat", "");
    let body: any = {};
    if (path === "/conversations") body = [{ id: "c1", title: "August", updatedAt: "2026-09-28" }];
    else if (path === "/conversations/c1") body = {
      id: "c1", title: "August", attachments: [], runs: [],
      messages: [{ id: "a1", role: "assistant", blocks: [{ type: "text", text: "Here is August." }, ...blocks] }],
    };
    else if (path === "/components/transactions") {
      const { offset, limit, query: sent } = route.request().postDataJSON();
      expect(sent).toEqual(query);
      pages.push(offset);
      body = { rows: Array.from({ length: Math.min(limit, 60 - offset) }, (_, i) => row(offset + i)), total: 60 };
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/chat?conversation=c1");
  await expect(page.getByRole("heading", { name: "August at a glance" })).toBeVisible();
  await expect(page.getByText("SGD 270.00", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("+35% vs previous period")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Where it went" })).toBeVisible();
  await expect(page.getByText("74%")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Weekly spending" })).toBeVisible();
  await page.getByRole("heading", { name: "August at a glance" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/fortuna-chat-components-top.png" });
  const trend = page.locator("section.rounded-lg").filter({ has: page.getByRole("heading", { name: "Weekly spending" }) });
  await trend.scrollIntoViewIfNeeded();
  await trend.locator(".recharts-bar-rectangle").last().hover();
  await expect(trend.getByText("Spent SGD 250.00")).toBeVisible();
  await trend.screenshot({ path: "/tmp/fortuna-chat-trend.png" });
  await page.getByText("View as table").click();
  await expect(page.getByRole("cell", { name: "Wk Aug 3" })).toBeVisible();
  await expect(page.getByText("60 transactions")).toBeVisible();
  await expect(page.getByText("Coffee 24", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Coffee 25", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Load 35 more of 35 remaining" }).click();
  await expect(page.getByText("Coffee 59", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Load .* more/ })).toHaveCount(0);
  expect(pages).toEqual([25]);
  await page.screenshot({ path: "/tmp/fortuna-chat-components-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("chat accepts screenshots, previews them and shows them in history", async ({ page, request }) => {
  const username = `chat_media_${Date.now()}`, password = "chat-test-temporary-password";
  const registered = await request.post("/api/auth/register", {
    data: { username, password, name: "Chat QA", baseCurrency: "SGD" },
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 30000 });
  // Real round trip through the authenticated proxy: upload, then read back the stored image.
  const real = await page.evaluate(async (png) => {
    const conversation = await fetch("/api/chat/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).then((r) => r.json());
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const form = new FormData();
    form.append("conversationId", conversation.id);
    form.append("file", new Blob([bytes], { type: "image/png" }), "pay.png");
    const uploaded = await fetch("/api/chat/files", { method: "POST", body: form }).then((r) => r.json());
    const content = await fetch(`/api/chat/attachments/${uploaded.attachmentId}/content`);
    const back = new Uint8Array(await content.arrayBuffer());
    return { kind: uploaded.kind, status: content.status, type: content.headers.get("content-type"), same: back.length === bytes.length && back.every((b, i) => b === bytes[i]) };
  }, PNG_1PX);
  expect(real).toEqual({ kind: "image", status: 200, type: "image/png", same: true });

  let sent: any = null;
  await page.route("**/api/chat/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/chat", "");
    if (path === "/attachments/img1/content")
      return route.fulfill({ contentType: "image/png", body: Buffer.from(PNG_1PX, "base64") });
    let body: any = {};
    if (path === "/conversations") body = [{ id: "c1", title: "Apple Pay", updatedAt: "2026-10-01" }];
    else if (path === "/files") body = { attachmentId: "img1", filename: "applepay.png", kind: "image" };
    else if (path === "/conversations/c1/messages") { sent = route.request().postDataJSON(); body = { runId: "r1" }; }
    else if (path === "/conversations/c1") body = {
      id: "c1", title: "Apple Pay", attachments: [], runs: [],
      messages: sent ? [{ id: "u1", role: "user", blocks: [
        { type: "text", text: "Which of these are Apple Pay?" },
        { type: "attachment", id: "img1", filename: "applepay.png", mediaType: "image" }] }] : [],
    };
    await route.fulfill({ json: body });
  });
  await page.goto("/chat?conversation=c1");
  await expect(page.getByRole("button", { name: "Attach file" })).toBeVisible();
  await page.getByLabel("Attach files").setInputFiles({
    name: "applepay.png", mimeType: "image/png", buffer: Buffer.from(PNG_1PX, "base64"),
  });
  await expect(page.getByRole("list", { name: "Attached images" }).getByRole("img", { name: "applepay.png" })).toBeVisible();
  await page.getByLabel("Message", { exact: true }).fill("Which of these are Apple Pay?");
  await page.getByLabel("Message", { exact: true }).press("Enter");
  await expect.poll(() => sent?.attachmentIds).toEqual(["img1"]);
  await expect(page.getByRole("list", { name: "Attached images" })).toHaveCount(0);
  const shown = page.getByRole("article").getByRole("img", { name: "applepay.png" });
  await expect(shown).toBeVisible();
  await expect.poll(() => shown.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await page.getByLabel("Attach files").setInputFiles({
    name: "photo.heic", mimeType: "image/heic", buffer: Buffer.from("heic"),
  });
  await expect(page.getByText(/HEIC photos aren't supported yet/)).toBeVisible();
});

test("approval previews are readable for bulk edits, reimbursements and rules", async ({ page, request }) => {
  const username = `chat_preview_${Date.now()}`, password = "chat-test-temporary-password";
  const registered = await request.post("/api/auth/register", {
    data: { username, password, name: "Chat QA", baseCurrency: "SGD" },
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 30000 });
  const transport = { id: "c-transport", name: "Transportation", color: "#2196f3" };
  const internal = { id: "c-internal", name: "Internal", color: "#9e9e9e" };
  const bus = (id: string, amount: string) => ({
    id, date: "2026-08-24T00:00:00.000Z", description: `BUS/MRT ${id} SINGAPORE`, label: "BUS/MRT",
    amountIn: null, amountOut: amount, balance: null, currency: "SGD", accountIdentifier: "4265-****-****-4591",
  });
  const edit = {
    id: "p1", kind: "edit_transactions", status: "pending", expiresAt: "2099-01-01T00:00:00Z",
    preview: {
      title: "Edit saved transactions",
      changes: [
        ...["t1", "t2"].map((id, i) => ({
          id,
          before: { ...bus(id, `4.${i}0`), category: transport, linkage: null },
          after: { ...bus(id, `4.${i}0`), category: internal, linkage: { type: "internal" } },
        })),
        {
          id: "r1",
          before: { id: "r1", date: "2026-08-30T00:00:00.000Z", description: "PAYNOW FROM ALEX", label: null, amountIn: "30.00", amountOut: null, currency: "SGD", accountIdentifier: "DBS", category: null, linkage: null },
          after: { id: "r1", date: "2026-08-30T00:00:00.000Z", description: "PAYNOW FROM ALEX", label: null, amountIn: "30.00", amountOut: null, currency: "SGD", accountIdentifier: "DBS", category: null,
            linkage: { type: "reimbursement", reimbursesAllocations: [{ transactionId: "d1", amount: 25 }], leftoverCategoryId: "c-gift" } },
        },
      ],
      references: {
        transactions: { d1: { id: "d1", date: "2026-08-28T00:00:00.000Z", description: "SUSHI EXPRESS", label: "Team dinner", amountIn: null, amountOut: "50.00", currency: "SGD" } },
        categories: { "c-gift": { name: "Gifts", color: "#ff9800" } },
        accounts: { "4265-****-****-4591": "#e91e63", DBS: "#3f51b5" },
      },
    },
  };
  const rule = {
    id: "p2", kind: "update_import_rule", status: "pending", expiresAt: "2099-01-01T00:00:00Z",
    preview: { title: "Change fixed import rule", before: null, after: {
      kind: "update_import_rule", name: "Partner bus rides", accountIdentifier: "4265-****-****-4591",
      parserId: "uob_one_credit_card_pdf", matchType: "description_contains", matchValue: "BUS/MRT", markInternal: true } },
  };
  await page.route("**/api/chat/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/chat", "");
    let body: any = {};
    if (path === "/conversations") body = [{ id: "c1", title: "Bus rides", updatedAt: "2026-10-02" }];
    else if (path === "/conversations/c1") body = {
      id: "c1", title: "Bus rides", attachments: [],
      runs: [{ id: "r1", status: "awaiting_confirmation", proposals: [edit, rule] }],
      messages: [{ id: "a1", role: "assistant", blocks: [
        { type: "text", text: "Prepared the changes." },
        { type: "data", title: "list parsers", data: { parsers: [{ id: "generic_csv" }] } },
        { type: "link", kind: "proposal", id: "p1", label: "Review 3 transaction changes" },
        { type: "link", kind: "proposal", id: "p2", label: "Review: Change fixed import rule" },
      ] }],
    };
    await route.fulfill({ json: body });
  });
  await page.goto("/chat?conversation=c1");
  await expect(page.getByText("Prepared the changes.")).toBeVisible();
  await expect(page.getByText("list parsers")).toHaveCount(0);
  await expect(page.getByText("generic_csv")).toHaveCount(0);

  await page.getByRole("button", { name: "Review 3 transaction changes" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "2 transactions" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "1 transaction" })).toBeVisible();
  const bulk = dialog.getByRole("region", { name: "Change 1" });
  await expect(bulk.getByText("Transportation")).toBeVisible();
  await expect(bulk.getByText("Internal", { exact: true })).toBeVisible();
  await expect(bulk.getByText("Internal transfer")).toBeVisible();
  await expect(bulk.getByRole("list", { name: "Affected transactions" }).getByRole("listitem")).toHaveCount(2);
  const dot = bulk.locator("span[aria-hidden]").filter({ hasText: "" }).first();
  await expect(dot).toHaveCSS("background-color", "rgb(33, 150, 243)");
  const reimbursement = dialog.getByRole("region", { name: "Change 2" });
  await expect(reimbursement.getByText("Reimbursement", { exact: true })).toBeVisible();
  await expect(reimbursement.getByText("Pays back")).toBeVisible();
  await expect(reimbursement.getByText("Team dinner")).toBeVisible();
  await expect(reimbursement.getByText("SGD 25.00")).toBeVisible();
  await expect(reimbursement.getByText("Gifts")).toBeVisible();
  expect(await dialog.textContent()).not.toMatch(/[{}]|"type"/);
  await page.screenshot({ path: "/tmp/fortuna-approval-edits.png" });
  await dialog.getByRole("button", { name: "Close" }).first().click();

  await page.getByRole("button", { name: "Review: Change fixed import rule" }).click();
  await expect(dialog.getByText("Partner bus rides")).toBeVisible();
  await expect(dialog.getByText("Description contains “BUS/MRT”")).toBeVisible();
  await expect(dialog.getByText("Account 4265-****-****-4591")).toBeVisible();
  await expect(dialog.getByText("Mark as internal transfer")).toBeVisible();
  expect(await dialog.textContent()).not.toMatch(/[{}]/);
  await page.screenshot({ path: "/tmp/fortuna-approval-rule.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
