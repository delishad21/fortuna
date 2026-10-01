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
