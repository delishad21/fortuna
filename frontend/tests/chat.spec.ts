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
  await page
    .getByRole("button", { name: "Toggle chat history", exact: true })
    .click();
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
