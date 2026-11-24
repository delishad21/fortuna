import { test, expect } from "@playwright/test";
test("phone review cards show category colours, and a category edit clears the internal mark", async ({
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
  await page.route(`${server}/api/mobile/**`, (route) =>
    route.fulfill({
      json: {
        data:
          route.request().postDataJSON()?.operation === "getCurrentUser"
            ? { name: "Chat QA", username: "qa", baseCurrency: "SGD" }
            : null,
      },
    }),
  );
  const row = (id: string, description: string, categoryId: string, linkage: any) => ({
    id,
    version: 1,
    source: { transactionId: id },
    original: {},
    value: {
      date: "2026-05-04T00:00:00.000Z",
      description,
      label: null,
      categoryId,
      accountIdentifier: "111-sample",
      amountIn: null,
      amountOut: 6.5,
      balance: null,
      currency: "SGD",
      linkage,
    } as any,
  });
  const review = {
    id: "review1",
    conversationId: "c1",
    title: "May wallet payments",
    instructions: "",
    status: "pending",
    version: 1,
    categories: [
      { id: "dining", name: "Dining", color: "#ff9800" },
      { id: "plain", name: "Plain", color: null },
      { id: "internal", name: "Internal", color: "#9ca3af" },
    ],
    accounts: [{ id: "a1", accountIdentifier: "111-sample", color: "#2196f3" }],
    rows: [
      row("t1", "SAMPLE NOODLE BAR", "dining", null),
      row("t2", "SAMPLE KIOSK", "plain", null),
      row("t3", "SAMPLE TRANSFER", "internal", { type: "internal", autoDetected: true }),
    ],
  };
  const patches: any[] = [];
  await page.route(`${server}/api/chat/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/chat", "");
    let data: any = {};
    if (path === "/conversations")
      data = [{ id: "c1", title: "Wallet payments", updatedAt: "2026-06-01" }];
    else if (path === "/conversations/c1")
      data = {
        id: "c1",
        title: "Wallet payments",
        attachments: [],
        queue: [],
        messages: [
          {
            id: "a1",
            role: "assistant",
            blocks: [{ type: "review", id: "review1", title: review.title }],
          },
        ],
        runs: [],
      };
    else if (path === "/reviews/review1") {
      if (route.request().method() === "PUT") {
        const { rowId, patch } = route.request().postDataJSON();
        patches.push(patch);
        const target = review.rows.find((r) => r.id === rowId)!;
        target.value = { ...target.value, ...patch };
        target.version++;
      }
      data = review;
    }
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("tab", { name: /Chat/ }).click();
  await page
    .getByRole("button", { name: "Toggle chat history", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Wallet payments", exact: true })
    .click();
  const dot = (name: string) =>
    page
      .getByText(name, { exact: true })
      .first()
      .evaluate((e) =>
        getComputedStyle(e.previousElementSibling!).backgroundColor,
      );
  await expect(page.getByText("Dining", { exact: true })).toBeVisible();
  expect(await dot("Dining")).toBe("rgb(255, 152, 0)");
  expect(await dot("Plain")).toBe("rgb(156, 163, 175)");
  expect(await dot("Internal")).toBe("rgb(156, 163, 175)");
  await expect(page.getByText("Conversations", { exact: true })).toBeHidden();
  if (process.env.REVIEW_SHOTS)
    await page.screenshot({ path: `${process.env.REVIEW_SHOTS}/review-phone.png` });
  await page.getByRole("button", { name: "Edit SAMPLE TRANSFER" }).click();
  await page.getByRole("button", { name: "Category", exact: true }).click();
  await page.getByText("Dining", { exact: true }).last().click();
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect
    .poll(() => patches)
    .toEqual([{ categoryId: "dining", linkage: null }]);
  await expect(page.getByText("Internal", { exact: true })).toHaveCount(0);
});
