import { test, expect } from "@playwright/test";

test("a review's categories keep their own colours, also after an edit", async ({
  page,
  request,
}) => {
  const username = `chat_colors_${Date.now()}`,
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
  const auto = { type: "internal", autoDetected: true };
  const row = (id: string, description: string, categoryId: string, linkage: any = null) => {
    const original = {
      date: "2026-05-04T00:00:00.000Z",
      description,
      label: "",
      categoryId: "internal",
      accountIdentifier: "111-sample",
      amountIn: null,
      amountOut: 6.5,
      balance: null,
      currency: "SGD",
      linkage: auto,
    };
    return {
      id,
      version: 1,
      source: { transactionId: id },
      original,
      value: { ...original, categoryId, linkage } as any,
    };
  };
  const review = {
    id: "rv1",
    conversationId: "c1",
    title: "May wallet payments",
    instructions: "",
    status: "pending",
    version: 1,
    categories: [
      { id: "dining", name: "Dining", color: "#ff9800" },
      { id: "shopping", name: "Shopping", color: "#e91e63" },
      { id: "books", name: "Books", color: "#4caf50" },
      { id: "plain", name: "Plain", color: null },
      { id: "internal", name: "Internal", color: "#9ca3af" },
    ],
    accounts: [{ id: "a1", accountIdentifier: "111-sample", color: "#2196f3" }],
    rows: [
      row("t1", "SAMPLE NOODLE BAR", "dining"),
      row("t2", "SAMPLE GADGET SHOP", "shopping"),
      row("t3", "SAMPLE BOOKSTORE", "books"),
      row("t4", "SAMPLE KIOSK", "plain"),
      row("t5", "SAMPLE OWN TRANSFER", "internal", { type: "internal", autoDetected: false }),
    ],
  };
  const patches: any[] = [];
  await page.route("**/api/chat/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/chat", "");
    let body: any = {};
    if (path === "/conversations")
      body = [{ id: "c1", title: "Wallet payments", updatedAt: "2026-06-01" }];
    else if (path === "/reviews/rv1") {
      if (route.request().method() === "PUT") {
        const { rowId, patch } = route.request().postDataJSON();
        patches.push(patch);
        const target = review.rows.find((r) => r.id === rowId)!;
        target.value = { ...target.value, ...patch };
        target.version++;
        review.version++;
      }
      body = review;
    } else if (path === "/conversations/c1")
      body = {
        id: "c1",
        title: "Wallet payments",
        attachments: [],
        runs: [{ id: "r1", status: "awaiting_confirmation", proposals: [] }],
        messages: [
          {
            id: "a1",
            role: "assistant",
            blocks: [
              { type: "text", text: "Please check these payments." },
              { type: "review", id: "rv1", title: review.title },
            ],
          },
        ],
      };
    await route.fulfill({ json: body });
  });
  await page.goto("/chat?conversation=c1");
  const sheet = page.getByLabel("Transaction review spreadsheet");
  await expect(sheet.getByText("Dining", { exact: true })).toBeVisible();
  const colors = () =>
    sheet
      .locator('[data-col="category"]')
      .evaluateAll((cells) =>
        cells.map((cell) => {
          const dot = [cell, ...cell.querySelectorAll("*")].find((e) =>
            (e as HTMLElement).style.backgroundColor,
          ) as HTMLElement | undefined;
          return dot?.style.backgroundColor;
        }),
      );
  const orange = "rgb(255, 152, 0)",
    pink = "rgb(233, 30, 99)",
    green = "rgb(76, 175, 80)",
    neutral = "rgb(156, 163, 175)";
  await expect.poll(colors).toEqual([orange, pink, green, neutral, neutral]);
  const shots = process.env.REVIEW_SHOTS;
  if (shots)
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle("dark", dark),
        theme === "dark",
      );
      await expect.poll(colors).toEqual([orange, pink, green, neutral, neutral]);
      // Let the colour transitions finish.
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${shots}/review-${theme}.png` });
    }
  // Picking a category on the internal row clears its mark; the colours stay.
  await sheet.locator('[data-col="category"]').nth(4).click();
  await page.getByText("Books", { exact: true }).last().click();
  await expect.poll(() => patches).toEqual([{ linkage: null, categoryId: "books" }]);
  await expect.poll(colors).toEqual([orange, pink, green, neutral, green]);
});
