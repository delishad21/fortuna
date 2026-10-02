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
  await expect(
    page.getByRole("heading", { name: "Conversations", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New chat", exact: true }),
  ).toBeVisible();
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

test("chat shows transaction cards in saved and streaming responses on desktop and mobile", async ({
  page,
  request,
}) => {
  const username = `chat_cards_${Date.now()}`,
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
  const transactions = [
    {
      id: "lunch",
      date: "2026-09-01T00:00:00.000Z",
      description: "CARD PAYMENT CAFE",
      label: "Team lunch",
      amountIn: null,
      amountOut: "15.50",
      currency: "SGD",
      category: { id: "food", name: "Food", color: "#5750F1" },
      accountIdentifier: "DBS",
      linkage: null,
    },
    {
      id: "salary",
      date: "2026-09-01T00:00:00.000Z",
      description: "Salary",
      label: null,
      amountIn: "2500",
      amountOut: null,
      currency: "SGD",
      category: null,
      accountIdentifier: "DBS",
      linkage: null,
    },
  ];
  let streaming = false;
  const sent: string[] = [];
  await page.route("**/api/chat/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/chat",
      "",
    );
    let body: any = {};
    if (path === "/conversations/new/messages")
      sent.push(route.request().postDataJSON().text);
    if (path === "/conversations")
      body =
        route.request().method() === "POST"
          ? { id: "new" }
          : [
              {
                id: "c1",
                title: "September spending",
                updatedAt: "2026-09-28",
              },
            ];
    else if (path === "/conversations/new")
      body = {
        id: "new",
        title: "New chat",
        messages: [],
        runs: [],
        attachments: [],
      };
    else if (path === "/conversations/c1")
      body = {
        id: "c1",
        title: "September spending",
        attachments: [],
        messages: streaming
          ? []
          : [
              {
                id: "a1",
                role: "assistant",
                blocks: [
                  { type: "data", title: "Transactions", data: transactions },
                ],
              },
            ],
        runs: streaming ? [{ id: "r1", status: "running", proposals: [] }] : [],
      };
    else if (path.startsWith("/runs/r1/events"))
      body = {
        status: "running",
        events: [
          {
            sequence: 1,
            payload: {
              type: "tool_result",
              result: {
                blocks: [
                  { type: "data", title: "Transactions", data: transactions },
                ],
              },
            },
          },
        ],
      };
    await route.fulfill({ json: body });
  });
  await page.goto("/chat?conversation=c1");
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  const lunch = page.getByText("Team lunch", { exact: true }).first();
  await expect(lunch).toBeVisible();
  await expect(page.getByText("-SGD 15.50", { exact: true })).toBeVisible();
  await expect(page.getByText("+SGD 2,500.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Food", { exact: true }).first()).toBeVisible();
  await lunch.click();
  await expect(
    page.getByText("CARD PAYMENT CAFE", { exact: true }).last(),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/fortuna-chat-transactions-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(lunch).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "/tmp/fortuna-chat-transactions-mobile.png" });
  await page.goto("/chat");
  await page
    .getByRole("button", { name: "September spending", exact: true })
    .click();
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
  await expect(
    page
      .getByRole("article", { name: "Assistant response" })
      .getByText("Team lunch", { exact: true })
      .first(),
  ).toBeVisible();
});

test("chat renders assistant components and pages large transaction lists", async ({
  page,
  request,
}) => {
  const username = `chat_components_${Date.now()}`,
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
  const query = {
    dateFrom: "2026-08-01T00:00:00Z",
    dateTo: "2026-09-01T00:00:00Z",
  };
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
    id: `t${i}`,
    date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    description: `CARD ${i}`,
    label: `Coffee ${i}`,
    amountIn: null,
    amountOut: "4.50",
    currency: "SGD",
    accountIdentifier: "DBS",
    category: { id: "food", name: "Food", color: "#5750F1" },
    linkage: null,
  });
  const blocks = [
    {
      type: "component",
      component: "summary_tiles",
      title: "August at a glance",
      query,
      currencies: [
        {
          currency: "SGD",
          expense: "270.00",
          income: "500.00",
          net: "230.00",
          count: 60,
          previous: {
            expense: "200.00",
            income: "500.00",
            net: "300.00",
            count: 40,
          },
        },
      ],
    },
    {
      type: "component",
      component: "breakdown",
      title: "Where it went",
      query,
      groupBy: "category",
      series: [
        {
          currency: "SGD",
          total: "270.00",
          items: [
            { name: "Food", amount: "200.00", count: 40, color: "#5750F1" },
            { name: "Other (3)", amount: "70.00", count: 20, other: true },
          ],
        },
      ],
    },
    {
      type: "component",
      component: "trend",
      title: "Weekly spending",
      query,
      interval: "week",
      series: [
        {
          currency: "SGD",
          points: [
            { period: "2026-07-27", expense: "20.00", income: "0.00" },
            { period: "2026-08-03", expense: "250.00", income: "500.00" },
          ],
        },
      ],
    },
    {
      type: "component",
      component: "transaction_list",
      title: "August coffee",
      query,
      total: 60,
      rows: Array.from({ length: 25 }, (_, i) => row(i)),
    },
  ];
  const pages: number[] = [];
  await page.route("**/api/chat/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/chat",
      "",
    );
    let body: any = {};
    if (path === "/conversations")
      body = [{ id: "c1", title: "August", updatedAt: "2026-09-28" }];
    else if (path === "/conversations/c1")
      body = {
        id: "c1",
        title: "August",
        attachments: [],
        runs: [],
        messages: [
          {
            id: "a1",
            role: "assistant",
            blocks: [{ type: "text", text: "Here is August." }, ...blocks],
          },
        ],
      };
    else if (path === "/components/transactions") {
      const { offset, limit, query: sent } = route.request().postDataJSON();
      expect(sent).toEqual(query);
      pages.push(offset);
      body = {
        rows: Array.from({ length: Math.min(limit, 60 - offset) }, (_, i) =>
          row(offset + i),
        ),
        total: 60,
      };
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/chat?conversation=c1");
  await expect(
    page.getByRole("heading", { name: "August at a glance" }),
  ).toBeVisible();
  await expect(
    page.getByText("SGD 270.00", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("+35% vs previous period")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Where it went" }),
  ).toBeVisible();
  await expect(page.getByText("74%")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Weekly spending" }),
  ).toBeVisible();
  await page
    .getByRole("heading", { name: "August at a glance" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/fortuna-chat-components-top.png" });
  const trend = page
    .locator("section.rounded-lg")
    .filter({ has: page.getByRole("heading", { name: "Weekly spending" }) });
  await trend.scrollIntoViewIfNeeded();
  await trend.locator(".recharts-bar-rectangle").last().hover();
  await expect(trend.getByText("Spent SGD 250.00")).toBeVisible();
  await trend.screenshot({ path: "/tmp/fortuna-chat-trend.png" });
  await page.getByText("View as table").click();
  await expect(page.getByRole("cell", { name: "Wk Aug 3" })).toBeVisible();
  await expect(page.getByText("60 transactions")).toBeVisible();
  await expect(
    page.getByText("Coffee 24", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Coffee 25", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Load 35 more of 35 remaining" })
    .click();
  await expect(
    page.getByText("Coffee 59", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Load .* more/ })).toHaveCount(
    0,
  );
  expect(pages).toEqual([25]);
  await page.screenshot({
    path: "/tmp/fortuna-chat-components-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("chat accepts screenshots, previews them and shows them in history", async ({
  page,
  request,
}) => {
  const username = `chat_media_${Date.now()}`,
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
    const uploaded = await fetch("/api/chat/files", {
      method: "POST",
      body: form,
    }).then((r) => r.json());
    const content = await fetch(
      `/api/chat/attachments/${uploaded.attachmentId}/content`,
    );
    const back = new Uint8Array(await content.arrayBuffer());
    return {
      kind: uploaded.kind,
      status: content.status,
      type: content.headers.get("content-type"),
      same:
        back.length === bytes.length && back.every((b, i) => b === bytes[i]),
    };
  }, PNG_1PX);
  expect(real).toEqual({
    kind: "image",
    status: 200,
    type: "image/png",
    same: true,
  });

  let sent: any = null;
  await page.route("**/api/chat/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/chat",
      "",
    );
    if (path === "/attachments/img1/content")
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(PNG_1PX, "base64"),
      });
    let body: any = {};
    if (path === "/conversations")
      body = [{ id: "c1", title: "Apple Pay", updatedAt: "2026-10-01" }];
    else if (path === "/files")
      body = { attachmentId: "img1", filename: "applepay.png", kind: "image" };
    else if (path === "/conversations/c1/messages") {
      sent = route.request().postDataJSON();
      body = { runId: "r1" };
    } else if (path === "/conversations/c1")
      body = {
        id: "c1",
        title: "Apple Pay",
        attachments: [],
        runs: [],
        messages: sent
          ? [
              {
                id: "u1",
                role: "user",
                blocks: [
                  { type: "text", text: "Which of these are Apple Pay?" },
                  {
                    type: "attachment",
                    id: "img1",
                    filename: "applepay.png",
                    mediaType: "image",
                  },
                ],
              },
            ]
          : [],
      };
    await route.fulfill({ json: body });
  });
  await page.goto("/chat?conversation=c1");
  await expect(page.getByRole("button", { name: "Attach file" })).toBeVisible();
  await page.getByLabel("Attach files").setInputFiles({
    name: "applepay.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1PX, "base64"),
  });
  await expect(
    page
      .getByRole("list", { name: "Attached images" })
      .getByRole("img", { name: "applepay.png" }),
  ).toBeVisible();
  await page
    .getByLabel("Message", { exact: true })
    .fill("Which of these are Apple Pay?");
  await page.getByLabel("Message", { exact: true }).press("Enter");
  await expect.poll(() => sent?.attachmentIds).toEqual(["img1"]);
  await expect(page.getByRole("list", { name: "Attached images" })).toHaveCount(
    0,
  );
  const shown = page
    .getByRole("article")
    .getByRole("img", { name: "applepay.png" });
  await expect(shown).toBeVisible();
  await expect
    .poll(() => shown.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(1);
  await page.getByLabel("Attach files").setInputFiles({
    name: "photo.heic",
    mimeType: "image/heic",
    buffer: Buffer.from("heic"),
  });
  await expect(
    page.getByText(/HEIC photos aren't supported yet/),
  ).toBeVisible();
});

test("approval previews are readable for bulk edits, reimbursements and rules", async ({
  page,
  request,
}) => {
  const username = `chat_preview_${Date.now()}`,
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
  const transport = {
    id: "c-transport",
    name: "Transportation",
    color: "#2196f3",
  };
  const internal = { id: "c-internal", name: "Internal", color: "#9e9e9e" };
  const bus = (id: string, amount: string) => ({
    id,
    date: "2026-08-24T00:00:00.000Z",
    description: `BUS/MRT ${id} SINGAPORE`,
    label: "BUS/MRT",
    amountIn: null,
    amountOut: amount,
    balance: null,
    currency: "SGD",
    accountIdentifier: "4265-****-****-4591",
  });
  const edit = {
    id: "p1",
    kind: "edit_transactions",
    status: "pending",
    expiresAt: "2099-01-01T00:00:00Z",
    preview: {
      title: "Edit saved transactions",
      changes: [
        ...["t1", "t2"].map((id, i) => ({
          id,
          before: { ...bus(id, `4.${i}0`), category: transport, linkage: null },
          after: {
            ...bus(id, `4.${i}0`),
            category: internal,
            linkage: { type: "internal" },
          },
        })),
        {
          id: "r1",
          before: {
            id: "r1",
            date: "2026-08-30T00:00:00.000Z",
            description: "PAYNOW FROM ALEX",
            label: null,
            amountIn: "30.00",
            amountOut: null,
            currency: "SGD",
            accountIdentifier: "DBS",
            category: null,
            linkage: null,
          },
          after: {
            id: "r1",
            date: "2026-08-30T00:00:00.000Z",
            description: "PAYNOW FROM ALEX",
            label: null,
            amountIn: "30.00",
            amountOut: null,
            currency: "SGD",
            accountIdentifier: "DBS",
            category: null,
            linkage: {
              type: "reimbursement",
              reimbursesAllocations: [{ transactionId: "d1", amount: 25 }],
              leftoverCategoryId: "c-gift",
            },
          },
        },
      ],
      references: {
        transactions: {
          d1: {
            id: "d1",
            date: "2026-08-28T00:00:00.000Z",
            description: "SUSHI EXPRESS",
            label: "Team dinner",
            amountIn: null,
            amountOut: "50.00",
            currency: "SGD",
          },
        },
        categories: { "c-gift": { name: "Gifts", color: "#ff9800" } },
        accounts: { "4265-****-****-4591": "#e91e63", DBS: "#3f51b5" },
      },
    },
  };
  const rule = {
    id: "p2",
    kind: "update_import_rule",
    status: "pending",
    expiresAt: "2099-01-01T00:00:00Z",
    preview: {
      title: "Change fixed import rule",
      before: null,
      after: {
        kind: "update_import_rule",
        name: "Partner bus rides",
        accountIdentifier: "4265-****-****-4591",
        parserId: "uob_one_credit_card_pdf",
        matchType: "description_contains",
        matchValue: "BUS/MRT",
        markInternal: true,
      },
    },
  };
  await page.route("**/api/chat/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/chat",
      "",
    );
    let body: any = {};
    if (path === "/conversations")
      body = [{ id: "c1", title: "Bus rides", updatedAt: "2026-10-02" }];
    else if (path === "/conversations/c1")
      body = {
        id: "c1",
        title: "Bus rides",
        attachments: [],
        runs: [
          {
            id: "r1",
            status: "awaiting_confirmation",
            proposals: [edit, rule],
          },
        ],
        messages: [
          {
            id: "a1",
            role: "assistant",
            blocks: [
              { type: "text", text: "Prepared the changes." },
              {
                type: "data",
                title: "list parsers",
                data: { parsers: [{ id: "generic_csv" }] },
              },
              {
                type: "link",
                kind: "proposal",
                id: "p1",
                label: "Review 3 transaction changes",
              },
              {
                type: "link",
                kind: "proposal",
                id: "p2",
                label: "Review: Change fixed import rule",
              },
            ],
          },
        ],
      };
    await route.fulfill({ json: body });
  });
  await page.goto("/chat?conversation=c1");
  await expect(page.getByText("Prepared the changes.")).toBeVisible();
  await expect(page.getByText("list parsers")).toHaveCount(0);
  await expect(page.getByText("generic_csv")).toHaveCount(0);
  await page.getByRole("article", { name: "Fortuna" }).screenshot({ path: "/tmp/fortuna-action-cards.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.waitForTimeout(400); // let colour transitions finish before capturing
  await page.getByRole("article", { name: "Fortuna" }).screenshot({ path: "/tmp/fortuna-action-cards-dark.png" });
  await page.evaluate(() => document.documentElement.classList.remove("dark"));

  await page
    .getByRole("button", { name: "Review 3 transaction changes" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "2 transactions" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "1 transaction" }),
  ).toBeVisible();
  const bulk = dialog.getByRole("region", { name: "Change 1" });
  await expect(bulk.getByText("Transportation")).toBeVisible();
  await expect(bulk.getByText("Internal", { exact: true })).toBeVisible();
  await expect(bulk.getByText("Internal transfer")).toBeVisible();
  await expect(
    bulk
      .getByRole("list", { name: "Affected transactions" })
      .getByRole("listitem"),
  ).toHaveCount(2);
  const dot = bulk.locator("span[aria-hidden]").filter({ hasText: "" }).first();
  await expect(dot).toHaveCSS("background-color", "rgb(33, 150, 243)");
  const reimbursement = dialog.getByRole("region", { name: "Change 2" });
  await expect(
    reimbursement.getByText("Reimbursement", { exact: true }),
  ).toBeVisible();
  await expect(reimbursement.getByText("Pays back")).toBeVisible();
  await expect(reimbursement.getByText("Team dinner")).toBeVisible();
  await expect(reimbursement.getByText("SGD 25.00")).toBeVisible();
  await expect(reimbursement.getByText("Gifts")).toBeVisible();
  expect(await dialog.textContent()).not.toMatch(/[{}]|"type"/);
  await page.screenshot({ path: "/tmp/fortuna-approval-edits.png" });
  await dialog.getByRole("button", { name: "Close" }).first().click();

  await page
    .getByRole("button", { name: "Review: Change fixed import rule" })
    .click();
  await expect(dialog.getByText("Partner bus rides")).toBeVisible();
  await expect(
    dialog.getByText("Description contains “BUS/MRT”"),
  ).toBeVisible();
  await expect(dialog.getByText("Account 4265-****-****-4591")).toBeVisible();
  await expect(dialog.getByText("Mark as internal transfer")).toBeVisible();
  expect(await dialog.textContent()).not.toMatch(/[{}]/);
  await page.screenshot({ path: "/tmp/fortuna-approval-rule.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});

test("reviews show pre-filled suggestions with a short header", async ({
  page,
  request,
}) => {
  const username = `chat_review_${Date.now()}`,
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
  const original = (id: string) => ({
    date: "2026-08-24T00:00:00.000Z",
    description: `BUS/MRT ${id}`,
    label: "BUS/MRT",
    categoryId: "transport",
    accountIdentifier: "4265-****-****-4591",
    amountIn: null,
    amountOut: 4.2,
    balance: null,
    currency: "SGD",
    linkage: null,
  });
  const review = {
    id: "rv1",
    conversationId: "c1",
    title: "BUS/MRT on card 4591",
    instructions: "",
    status: "pending",
    version: 1,
    categories: [
      { id: "transport", name: "Transportation", color: "#2196f3" },
      { id: "internal", name: "Internal", color: "#9e9e9e" },
    ],
    accounts: [
      { id: "a1", accountIdentifier: "4265-****-****-4591", color: "#e91e63" },
    ],
    rows: ["t1", "t2"].map((id) => ({
      id,
      version: 1,
      source: { transactionId: id },
      original: original(id),
      value: {
        ...original(id),
        categoryId: "internal",
        linkage: { type: "internal" },
      },
    })),
  };
  await page.route("**/api/chat/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/chat",
      "",
    );
    let body: any = {};
    if (path === "/conversations")
      body = [{ id: "c1", title: "Bus rides", updatedAt: "2026-10-02" }];
    else if (path === "/reviews/rv1") body = review;
    else if (path === "/conversations/c1")
      body = {
        id: "c1",
        title: "Bus rides",
        attachments: [],
        runs: [{ id: "r1", status: "awaiting_confirmation", proposals: [] }],
        messages: [
          {
            id: "a1",
            role: "assistant",
            blocks: [
              { type: "text", text: "I pre-filled the review." },
              { type: "review", id: "rv1", title: review.title },
            ],
          },
        ],
      };
    await route.fulfill({ json: body });
  });
  await page.goto("/chat?conversation=c1");
  await expect(
    page.getByRole("heading", { name: "BUS/MRT on card 4591" }),
  ).toBeVisible();
  await expect(page.getByText("Pre-filled · 2 of 2 rows")).toBeVisible();
  await expect(page.getByText("· Category → Internal")).toBeVisible();
  await expect(page.getByText("· Type → Internal transfer")).toBeVisible();
  await expect(page.getByText("Changes save automatically")).toBeVisible();
  await expect(page.getByText(/Edits save when you leave a cell/)).toHaveCount(
    0,
  );
  await page.screenshot({ path: "/tmp/fortuna-review-prefilled.png" });
});

test("saved notes, comparisons and unsure review rows work end to end", async ({
  page,
  request,
}) => {
  const username = `chat_generic_${Date.now()}`,
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

  // Real memory API through the authenticated proxy.
  const api = await page.evaluate(async () => {
    const call = (path: string, method = "GET", body?: unknown) =>
      fetch(`/api/chat${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const created = await call("/memories", "POST", {
      content: "Townsville journeys are hers",
    });
    const updated = await call(`/memories/${created.body.id}`, "PUT", {
      content: "Simei–Townsville journeys are hers",
    });
    const listed = await call("/memories");
    return {
      created: created.status,
      updated: updated.body.content,
      listed: listed.body.map((n: any) => n.content),
    };
  });
  expect(api).toEqual({
    created: 201,
    updated: "Simei–Townsville journeys are hers",
    listed: ["Simei–Townsville journeys are hers"],
  });

  // Settings panel lists, adds, edits and deletes notes.
  await page.goto("/settings?tab=ai");
  const panel = page.getByRole("region", { name: "Saved notes" });
  await expect(
    panel.getByText("Simei–Townsville journeys are hers"),
  ).toBeVisible();
  await panel
    .getByLabel("New note", { exact: true })
    .fill("She repays me at the end of each month");
  await panel.getByRole("button", { name: "Add note" }).click();
  await expect(
    panel.getByText("She repays me at the end of each month"),
  ).toBeVisible();
  await panel
    .getByRole("button", {
      name: "Edit note: She repays me at the end of each month",
    })
    .click();
  await panel
    .getByLabel("Edit note", { exact: true })
    .fill("She repays me monthly");
  await panel.getByRole("button", { name: "Save" }).click();
  await expect(panel.getByText("She repays me monthly")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await panel
    .getByRole("button", { name: "Delete note: She repays me monthly" })
    .click();
  await expect(panel.getByText("She repays me monthly")).toHaveCount(0);
  await page.screenshot({
    path: "/tmp/fortuna-saved-notes.png",
    fullPage: true,
  });

  const query = {
    dateFrom: "2026-08-01T00:00:00+08:00",
    dateTo: "2026-10-01T00:00:00+08:00",
  };
  const original = (id: string, description: string) => ({
    date: "2026-08-29T00:00:00.000Z",
    description,
    label: null,
    categoryId: null,
    accountIdentifier: "SimplyGo 4591",
    amountIn: null,
    amountOut: 1.28,
    balance: null,
    currency: "SGD",
    linkage: null,
  });
  const review = {
    id: "rv2",
    conversationId: "c1",
    title: "Whose journeys",
    instructions: "",
    status: "pending",
    version: 1,
    categories: [
      { id: "partner", name: "Partner transport", color: "#ff9800" },
    ],
    accounts: [
      { id: "a1", accountIdentifier: "SimplyGo 4591", color: "#e91e63" },
    ],
    rows: [
      {
        id: "j2",
        version: 1,
        source: { rowId: "j2", draftId: "d1" },
        original: original("j2", "Bus 9 Blk 233 - Bedok Mkt Pl"),
        value: {
          ...original("j2", "Bus 9 Blk 233 - Bedok Mkt Pl"),
          categoryId: "partner",
        },
        suggestion: {
          reason: "Same bus and minute as your ride, so one is hers",
          confidence: 0.5,
        },
      },
      {
        id: "j1",
        version: 1,
        source: { rowId: "j1", draftId: "d1" },
        original: original("j1", "Simei - Townsville Pr Sch"),
        value: {
          ...original("j1", "Simei - Townsville Pr Sch"),
          categoryId: "partner",
        },
        suggestion: { reason: "Her weekday school commute", confidence: 0.95 },
      },
    ],
  };
  await page.route("**/api/chat/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/chat",
      "",
    );
    let body: any = {};
    if (path === "/conversations")
      body = [{ id: "c1", title: "August transit", updatedAt: "2026-10-02" }];
    else if (path === "/reviews/rv2") body = review;
    else if (path === "/conversations/c1")
      body = {
        id: "c1",
        title: "August transit",
        attachments: [],
        runs: [{ id: "r1", status: "awaiting_confirmation", proposals: [] }],
        messages: [
          {
            id: "a1",
            role: "assistant",
            blocks: [
              { type: "text", text: "Staged August and split the journeys." },
              {
                type: "memory",
                id: "m1",
                content: "Simei–Townsville journeys are hers",
                action: "saved",
              },
              {
                type: "component",
                component: "comparison",
                title: "SimplyGo vs card charges",
                metric: "expense",
                series: [
                  { label: "SimplyGo journeys", query },
                  { label: "Card BUS/MRT charges", query },
                ],
                currencies: [
                  {
                    currency: "SGD",
                    totals: ["55.80", "52.30"],
                    difference: "3.50",
                  },
                ],
                months: [
                  {
                    period: "2026-08",
                    currency: "SGD",
                    values: ["55.80", "48.10"],
                    difference: "7.70",
                    cumulative: "7.70",
                  },
                  {
                    period: "2026-09",
                    currency: "SGD",
                    values: ["0.00", "4.20"],
                    difference: "-4.20",
                    cumulative: "3.50",
                  },
                ],
              },
              { type: "review", id: "rv2", title: review.title },
            ],
          },
        ],
      };
    await route.fulfill({ json: body });
  });
  await page.goto("/chat?conversation=c1");
  await expect(page.getByText("Remembered:")).toBeVisible();
  await expect(
    page.getByText("Simei–Townsville journeys are hers"),
  ).toBeVisible();
  const comparison = page
    .locator("section.rounded-lg")
    .filter({
      has: page.getByRole("heading", { name: "SimplyGo vs card charges" }),
    });
  await expect(comparison.getByText("SGD 55.80").first()).toBeVisible();
  await expect(
    comparison.getByText(
      "Difference (SimplyGo journeys − Card BUS/MRT charges)",
    ),
  ).toBeVisible();
  await expect(comparison.getByText("SGD 3.50").first()).toBeVisible();
  await expect(
    comparison.getByRole("cell", { name: "-SGD 4.20" }),
  ).toBeVisible();
  await expect(
    page.getByText("Fortuna wasn’t sure about 1 row. Please check it:"),
  ).toBeVisible();
  await expect(
    page.getByText(/Same bus and minute as your ride, so one is hers/),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/fortuna-generic-tools.png",
    fullPage: true,
  });
});

test("chat accepts dropped files, starts from the landing composer and shows steps", async ({
  page,
  request,
}) => {
  const username = `chat_layout_${Date.now()}`,
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
  let created = 0,
    uploaded: string[] = [],
    sent: any = null,
    running = false;
  await page.route("**/api/chat/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/chat",
      "",
    );
    const method = route.request().method();
    let body: any = {};
    if (path === "/conversations" && method === "POST") {
      created++;
      body = { id: "c9" };
    } else if (path === "/conversations")
      body = created
        ? [{ id: "c9", title: "SimplyGo August", updatedAt: "2026-10-02" }]
        : [];
    else if (path === "/files") {
      const form = route.request().postData() || "";
      expect(form).toContain('name="conversationId"');
      expect(form).toContain("c9");
      uploaded.push("simplygo.pdf");
      body = {
        attachmentId: "f1",
        filename: "SimplyGo Statement_Aug_2026.pdf",
        kind: "statement",
      };
    } else if (path === "/conversations/c9/messages") {
      sent = route.request().postDataJSON();
      running = true;
      body = { runId: "r9" };
    } else if (path === "/conversations/c9")
      body = {
        id: "c9",
        title: "SimplyGo August",
        attachments: [],
        runs: running
          ? [{ id: "r9", status: "running", proposals: [] }]
          : [{ id: "r8", status: "completed", proposals: [] }],
        messages: [
          {
            id: "u0",
            role: "user",
            blocks: [{ type: "text", text: "Earlier question" }],
          },
          {
            id: "a0",
            role: "assistant",
            blocks: [
              {
                type: "activity",
                steps: [
                  { name: "read_attachment", ok: true },
                  { name: "stage_rows", ok: true },
                  { name: "find_transactions", ok: false },
                ],
              },
              {
                type: "text",
                text: "Staged **54 journeys** for card 4265-****-****-4591.\n\n- Mine: 30\n- Hers: 24",
              },
            ],
          },
        ],
      };
    else if (path.startsWith("/runs/r9/events"))
      body = {
        status: "running",
        events: [
          {
            sequence: 1,
            payload: { type: "tool_call", name: "read_attachment" },
          },
          {
            sequence: 2,
            payload: {
              type: "tool_result",
              name: "read_attachment",
              result: { blocks: [] },
            },
          },
          { sequence: 3, payload: { type: "tool_call", name: "stage_rows" } },
        ],
      };
    await route.fulfill({ json: body });
  });
  await page.goto("/chat");
  await expect(
    page.getByRole("heading", { name: "Conversations", exact: true }),
  ).toBeVisible();

  // Drop a statement anywhere on the conversation panel: a conversation starts and the file attaches.
  const panel = page.getByRole("region", { name: "Conversation" });
  const transfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(
      new File(["%PDF-1.4"], "SimplyGo Statement_Aug_2026.pdf", {
        type: "application/pdf",
      }),
    );
    return dt;
  });
  await panel.dispatchEvent("dragenter", { dataTransfer: transfer });
  await expect(
    page.getByText("Drop files to attach", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/fortuna-chat-drop.png" });
  await panel.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(
    page.getByText("Drop files to attach", { exact: true }),
  ).toHaveCount(0);
  await expect.poll(() => uploaded.length).toBe(1);
  expect(created).toBe(1);
  await expect(page).toHaveURL(/conversation=c9/);
  await expect(page.getByText("SimplyGo Statement_Aug_2026.pdf")).toBeVisible();

  // History shows the assistant's steps collapsed, with readable labels when expanded.
  const reply = page.getByRole("article", { name: "Fortuna" });
  await expect(
    reply.locator("strong", { hasText: "54 journeys" }),
  ).toBeVisible();
  await expect(
    reply.getByText("4265-****-****-4591", { exact: false }),
  ).toBeVisible();
  await expect(
    reply.getByRole("listitem").filter({ hasText: "Hers: 24" }),
  ).toBeVisible();
  await reply.getByRole("button", { name: /3 steps · 1 failed/ }).click();
  await expect(
    reply.getByRole("list", { name: "Assistant steps" }),
  ).toContainText("Read an attachment");
  await expect(
    reply.getByRole("list", { name: "Assistant steps" }),
  ).toContainText("Staged transactions");

  // The message keeps the attachment typed on the landing screen; live steps show while running.
  await page.getByLabel("Message", { exact: true }).fill("Split mine and hers");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => sent?.attachmentIds).toEqual(["f1"]);
  expect(sent.text).toBe("Split mine and hers");
  const live = page.getByRole("article", { name: "Assistant response" });
  await expect(
    live.getByRole("list", { name: "Assistant steps" }),
  ).toContainText("Read an attachment");
  await expect(live.getByText("Staged transactions…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  const working = page.getByRole("status").filter({ hasText: "Fortuna is working" });
  await expect(working).toContainText("Staged transactions");
  await expect(working).toContainText(/\d+:\d\d/);
  await expect(page.getByRole("button", { name: "Send message" })).toHaveCount(0);
  const draft = page.getByLabel("Message", { exact: true });
  await expect(draft).toHaveAttribute("placeholder", /draft your next message/);
  await draft.fill("Also check September");
  await draft.press("Enter");
  await expect(draft).toHaveValue("Also check September");
  await expect(page.getByText(/Your draft is kept/)).toBeVisible();
  await page.screenshot({ path: "/tmp/fortuna-chat-layout.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "/tmp/fortuna-chat-layout-mobile.png" });
});

test("pending proposals from a stopped run stay reachable", async ({ page, request }) => {
  const username = `chat_stopped_${Date.now()}`, password = "chat-test-temporary-password";
  const registered = await request.post("/api/auth/register", {
    data: { username, password, name: "Chat QA", baseCurrency: "SGD" },
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 30000 });
  const proposal = {
    id: "p-acct", kind: "create_account", status: "pending", expiresAt: "2099-01-01T00:00:00Z",
    preview: { title: "Create bank account", before: null, after: { kind: "create_account", accountIdentifier: "SimplyGo", color: "#0B3D91" } },
  };
  await page.route("**/api/chat/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/chat", "");
    let body: any = {};
    if (path === "/conversations") body = [{ id: "c1", title: "SimplyGo August", updatedAt: "2026-10-02" }];
    else if (path === "/conversations/c1") body = {
      id: "c1", title: "SimplyGo August", attachments: [],
      runs: [{ id: "r1", status: "failed", error: "Stopped after 10 minutes without progress.", proposals: [proposal] }],
      messages: [{ id: "a1", role: "assistant", blocks: [{ type: "text", text: "Conversation stopped or timed out. Saved data is preserved." }] }],
    };
    await route.fulfill({ json: body });
  });
  await page.goto("/chat?conversation=c1");
  const waiting = page.getByRole("region", { name: "Waiting for your approval" });
  await expect(waiting).toBeVisible();
  await waiting.getByRole("button", { name: "Review: Create bank account" }).click();
  await expect(page.getByRole("dialog")).toContainText("SimplyGo");
});

test("staged imports open beside the chat and return to it", async ({ page, request }) => {
  const { execFileSync } = await import("node:child_process");
  const username = `chat_panel_${Date.now()}`, password = "chat-test-temporary-password";
  const registered = await request.post("/api/auth/register", {
    data: { username, password, name: "Chat QA", baseCurrency: "SGD" },
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();
  // A real staged import for this user, so the panel loads it through the normal server action.
  const draftId = `draft_${Date.now()}`;
  const sql = `
    INSERT INTO import_drafts (id, user_id, mode, parser_id, source_filename, source_sha256, status, expires_at, updated_at)
      SELECT '${draftId}', id, 'main', 'assistant_rows', 'PayLah Sep 2026', '${draftId}', 'review', now() + interval '1 day', now()
      FROM users WHERE username = '${username}';
    INSERT INTO import_draft_rows (id, draft_id, row_index, parsed_payload, current_payload, review_status, updated_at) VALUES
      ('${draftId}_r1', '${draftId}', 0, '{}', '{"date":"2026-09-01T00:00:00.000Z","description":"PAYNOW JS FNB GRO BM","label":"Chicken rice","amountOut":6.5,"currency":"SGD","accountIdentifier":"8888880012044058"}', 'edited', now());`;
  execFileSync("docker", ["exec", "-i", "finance-postgres-dev", "psql", "-U", "financeuser", "-d", "personal_finance", "-v", "ON_ERROR_STOP=1"], { input: sql });

  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 30000 });
  await page.route("**/api/chat/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/chat", "");
    let body: any = {};
    if (path === "/conversations") body = [{ id: "c1", title: "PayLah September", updatedAt: "2026-10-03" }];
    else if (path === "/conversations/c1") body = {
      id: "c1", title: "PayLah September", attachments: [], runs: [],
      messages: [{ id: "a1", role: "assistant", blocks: [
        { type: "text", text: "Staged September." },
        { type: "link", kind: "draft", id: draftId, label: "Review staged import" },
      ] }],
    };
    await route.fulfill({ json: body });
  });
  await page.goto("/chat?conversation=c1");
  await page.getByRole("button", { name: /Review staged import/ }).click();
  const panel = page.getByRole("dialog", { name: "Staged import" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "PayLah Sep 2026" })).toBeVisible();
  await expect(panel.getByText("PAYNOW JS FNB GRO BM").first()).toBeVisible({ timeout: 15000 });
  await expect(page).toHaveURL(/\/chat\?conversation=c1/);
  await page.screenshot({ path: "/tmp/fortuna-staged-panel.png" });
  // The category picker opens in place inside the panel (fixed-position menus must not be offset).
  const cell = panel.getByText("Uncategorized").first();
  const cellBox = (await cell.boundingBox())!; // measure before the menu adds its own "Uncategorized"
  // Wait for the slide-in to finish; the panel then drops its transform.
  await expect(panel).toHaveCSS("translate", "none");
  await cell.click();
  const search = page.getByLabel("Search categories");
  await expect(search).toBeVisible();
  const menuBox = (await search.boundingBox())!;
  expect(Math.abs(menuBox.x - cellBox.x)).toBeLessThan(80);
  expect(menuBox.y).toBeGreaterThan(cellBox.y);
  expect(menuBox.y - cellBox.y).toBeLessThan(120);
  await page.screenshot({ path: "/tmp/fortuna-staged-panel-category.png" });
  // Escape in the picker's search box closes the picker, not the panel.
  await search.press("Escape");
  await expect(panel).toBeVisible();
  await panel.getByRole("heading", { name: "PayLah Sep 2026" }).click();
  const full = panel.getByRole("link", { name: "Full page" });
  await expect(full).toHaveAttribute("href", new RegExp(`/imports/drafts/${draftId}\\?returnTo=%2Fchat%3Fconversation%3Dc1`));
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: /Review staged import/ }).click();
  await panel.getByRole("button", { name: "Back to chat" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByText("Staged September.")).toBeVisible();
  // The full page links back to the chat it came from.
  await page.goto(`/imports/drafts/${draftId}?returnTo=${encodeURIComponent("/chat?conversation=c1")}`);
  await expect(page.getByRole("link", { name: "← Back to chat" })).toHaveAttribute("href", "/chat?conversation=c1");
  await page.goto(`/imports/drafts/${draftId}?returnTo=${encodeURIComponent("https://evil.example")}`);
  await expect(page.getByRole("link", { name: "← Imports" })).toBeVisible();
});
