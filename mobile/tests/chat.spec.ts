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
          before: { description: "Lunch", label: "Cafe" },
          after: { description: "Lunch", label: "Work lunch" },
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
  await expect(page.getByText("Before", { exact: true })).toBeVisible();
  await expect(page.getByText("Work lunch", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/fortuna-chat-phone-approval.png" });
  await page.getByRole("button", { name: "Confirm changes" }).click();
  await expect(
    page.getByText("Changes applied", { exact: true }),
  ).toBeVisible();
});
