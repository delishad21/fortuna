import { test, expect } from "@playwright/test";
test("phone chat uses configured server, preserves failed sends and shows approval fields", async ({
  page,
}) => {
  const server = "http://chat-fixture.local";
  await page.addInitScript(
    ({ server }) =>
      sessionStorage.setItem(
        "fortuna.mobile.session",
        JSON.stringify({ server, token: "qa-token", expiresAt: "2099-01-01" }),
      ),
    { server },
  );
  await page.route("http://chat-fixture.local/api/mobile/**", async (route) => {
    const operation = route.request().postDataJSON()?.operation;
    await route.fulfill({
      json: {
        data:
          operation === "getCurrentUser"
            ? { name: "Chat QA", username: "qa", baseCurrency: "SGD" }
            : null,
      },
    });
  });
  let sent = false,
    fail = true,
    applied = false;
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
    id: "p1",
    status: "pending",
    kind: "edit_transactions",
    expiresAt: "2099-01-01",
    preview: {
      title: "Edit saved transactions",
      changes: [
        {
          id: "t1",
          before: {
            description: "Lunch",
            label: "Cafe",
            category: { name: "Dining", color: "#ff9800" },
            linkage: null,
          },
          after: {
            description: "Lunch",
            label: "Work lunch",
            category: { name: "Internal", color: "#9e9e9e" },
            linkage: { type: "internal" },
          },
        },
      ],
    },
  };
  await page.route("http://chat-fixture.local/api/chat/**", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer qa-token");
    const path = new URL(route.request().url()).pathname.replace(
      "/api/chat",
      "",
    );
    let data: any = {};
    if (path === "/conversations")
      data =
        route.request().method() === "POST"
          ? { id: "c1" }
          : [{ id: "c1", title: "Phone review", updatedAt: "2026-09-28" }];
    else if (path === "/reviews/review1") {
      if (route.request().method() === "PUT") {
        const update = route.request().postDataJSON();
        expect(update.version).toBe(review.rows[0].version);
        review.rows[0].value = { ...review.rows[0].value, ...update.patch };
        review.rows[0].version++;
        review.version++;
      }
      data = review;
    } else if (path === "/conversations/c1")
      data = {
        id: "c1",
        title: "Phone review",
        attachments: [],
        messages: sent
          ? [
              {
                id: "m1",
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
                    id: "p1",
                    label: "Review changes",
                  },
                ],
              },
            ]
          : [],
        runs: sent
          ? [
              {
                id: "r1",
                status: applied ? "completed" : "awaiting_confirmation",
                proposals: [
                  { ...proposal, status: applied ? "applied" : "pending" },
                ],
              },
            ]
          : [],
      };
    else if (path.endsWith("/messages")) {
      if (fail) {
        fail = false;
        return route.fulfill({
          status: 503,
          json: { error: "Connection interrupted" },
        });
      }
      sent = true;
      data = { runId: "r1" };
    } else if (path.endsWith("/approve")) {
      applied = true;
      data = { status: "applied" };
    } else if (path === "/settings") data = [];
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("tab", { name: /Chat/ }).click();
  await expect(page.getByRole("tab")).toHaveCount(5);
  await page
    .getByRole("button", { name: "Toggle chat history", exact: true })
    .click();
  await page.getByRole("button", { name: "Phone review", exact: true }).click();
  await page.getByLabel("Message", { exact: true }).fill("Review lunch");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("Connection interrupted", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "Review lunch",
  );
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByRole("button", { name: "Edit Lunch", exact: true }).click();
  await page.getByLabel("label", { exact: true }).fill("Team lunch");
  await page
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await expect.poll(() => review.rows[0].value.label).toBe("Team lunch");
  await expect(
    page.getByRole("button", { name: "Save transaction", exact: true }),
  ).toHaveCount(0);
  await page
    .getByText("Check these transactions", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/fortuna-chat-phone-cards.png" });
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByText("1 transaction", { exact: true })).toBeVisible();
  await expect(page.getByText("Cafe", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Work lunch", { exact: true })).toBeVisible();
  await expect(page.getByText("Dining", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Internal transfer", { exact: true }),
  ).toBeVisible();
  expect(await page.locator("body").textContent()).not.toMatch(/[{}]/);
  await page.screenshot({ path: "/tmp/fortuna-chat-phone-approval.png" });
  await page.getByRole("button", { name: "Confirm changes" }).click();
  await expect(
    page.getByText("Changes applied", { exact: true }),
  ).toBeVisible();
});

test("phone chat renders assistant components and pages transaction lists", async ({
  page,
}) => {
  const server = "http://chat-fixture.local";
  await page.addInitScript(
    ({ server }) =>
      sessionStorage.setItem(
        "fortuna.mobile.session",
        JSON.stringify({ server, token: "qa-token", expiresAt: "2099-01-01" }),
      ),
    { server },
  );
  await page.route("http://chat-fixture.local/api/mobile/**", (route) =>
    route.fulfill({
      json: {
        data:
          route.request().postDataJSON()?.operation === "getCurrentUser"
            ? { name: "Chat QA", username: "qa", baseCurrency: "SGD" }
            : null,
      },
    }),
  );
  const query = {
    dateFrom: "2026-08-01T00:00:00+08:00",
    dateTo: "2026-09-01T00:00:00+08:00",
  };
  const row = (i: number) => ({
    id: `t${i}`,
    date: "2026-08-10T00:00:00.000Z",
    description: `CARD ${i}`,
    label: `Coffee ${i}`,
    amountIn: null,
    amountOut: "4.50",
    currency: "SGD",
    accountIdentifier: "DBS",
    category: { id: "food", name: "Food", color: "#5750F1" },
    linkage: null,
  });
  const pages: number[] = [];
  await page.route("http://chat-fixture.local/api/chat/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/chat",
      "",
    );
    let data: any = {};
    if (path === "/conversations")
      data = [{ id: "c1", title: "August", updatedAt: "2026-09-28" }];
    else if (path === "/conversations/c1")
      data = {
        id: "c1",
        title: "August",
        attachments: [],
        runs: [],
        messages: [
          {
            id: "m1",
            role: "assistant",
            blocks: [
              { type: "text", text: "Here is August." },
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
                      { name: "Food", amount: "200.00", count: 40 },
                      {
                        name: "Other (3)",
                        amount: "70.00",
                        count: 20,
                        other: true,
                      },
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
                      {
                        period: "2026-07-27",
                        expense: "20.00",
                        income: "0.00",
                      },
                      {
                        period: "2026-08-03",
                        expense: "250.00",
                        income: "500.00",
                      },
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
            ],
          },
        ],
      };
    else if (path === "/components/transactions") {
      const { offset, limit } = route.request().postDataJSON();
      pages.push(offset);
      data = {
        rows: Array.from({ length: Math.min(limit, 60 - offset) }, (_, i) =>
          row(offset + i),
        ),
        total: 60,
      };
    } else if (path === "/settings") data = [];
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("tab", { name: /Chat/ }).click();
  await page
    .getByRole("button", { name: "Toggle chat history", exact: true })
    .click();
  await page.getByRole("button", { name: "August", exact: true }).click();
  await expect(page.getByText("August at a glance")).toBeVisible();
  await expect(page.getByText("+35% vs previous period")).toBeVisible();
  await expect(page.getByText("Food, SGD 200.00, 74 percent")).toHaveCount(0);
  await expect(page.getByLabel("Food, SGD 200.00, 74 percent")).toBeVisible();
  await page
    .getByRole("button", { name: "Wk Jul 27, spent SGD 20.00" })
    .click();
  await expect(
    page.getByText("Spent SGD 20.00", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Conversations", { exact: true })).toBeHidden();
  await page.getByText("Weekly spending").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/fortuna-mobile-chat-components.png" });
  await expect(page.getByText("60 transactions")).toBeVisible();
  await page.getByRole("button", { name: "Load 35 more of 35" }).click();
  await expect(page.getByText("Coffee 59", { exact: true })).toBeVisible();
  expect(pages).toEqual([25]);
});

test("phone chat attaches photos and shows sent images", async ({ page }) => {
  const server = "http://chat-fixture.local";
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.addInitScript(
    ({ server }) =>
      sessionStorage.setItem(
        "fortuna.mobile.session",
        JSON.stringify({ server, token: "qa-token", expiresAt: "2099-01-01" }),
      ),
    { server },
  );
  await page.route("http://chat-fixture.local/api/mobile/**", (route) =>
    route.fulfill({
      json: {
        data:
          route.request().postDataJSON()?.operation === "getCurrentUser"
            ? { name: "Chat QA", username: "qa", baseCurrency: "SGD" }
            : null,
      },
    }),
  );
  let sent: any = null;
  const imageAuth: string[] = [];
  await page.route("http://chat-fixture.local/api/chat/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/chat",
      "",
    );
    if (path === "/attachments/img1/content") {
      imageAuth.push(route.request().headers().authorization);
      return route.fulfill({ contentType: "image/png", body: png });
    }
    let data: any = {};
    if (path === "/conversations")
      data = [{ id: "c1", title: "Bus rides", updatedAt: "2026-10-01" }];
    else if (path === "/files")
      data = {
        attachmentId: "img1",
        filename: "samsungpay.png",
        kind: "image",
      };
    else if (path === "/conversations/c1/messages") {
      sent = route.request().postDataJSON();
      data = { runId: "r1" };
    } else if (path === "/conversations/c1")
      data = {
        id: "c1",
        title: "Bus rides",
        attachments: [],
        runs: [],
        messages: sent
          ? [
              {
                id: "u1",
                role: "user",
                blocks: [
                  { type: "text", text: "Which rides were mine?" },
                  {
                    type: "attachment",
                    id: "img1",
                    filename: "samsungpay.png",
                    mediaType: "image",
                  },
                ],
              },
            ]
          : [],
      };
    else if (path === "/settings") data = [];
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("tab", { name: /Chat/ }).click();
  await page
    .getByRole("button", { name: "Toggle chat history", exact: true })
    .click();
  await page.getByRole("button", { name: "Bus rides", exact: true }).click();
  await expect(page.getByText("Conversations", { exact: true })).toBeHidden();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Photos", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "samsungpay.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(
    page.getByRole("button", { name: "Remove samsungpay.png" }),
  ).toBeVisible();
  await page
    .getByLabel("Message", { exact: true })
    .fill("Which rides were mine?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => sent?.attachmentIds).toEqual(["img1"]);
  await expect(page.getByLabel("samsungpay.png").last()).toBeVisible();
  await expect.poll(() => imageAuth).toContain("Bearer qa-token");
  await page.screenshot({ path: "/tmp/fortuna-mobile-chat-image.png" });
});
