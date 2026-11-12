import { test, expect } from "@playwright/test";
test("phone chat: cancel a review from its card, and close or hide the approvals bar", async ({
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
  const review = {
    id: "review1",
    conversationId: "c1",
    title: "October bus and train trips",
    instructions: "",
    status: "pending",
    version: 2,
    decidedAt: null as string | null,
    categories: [{ id: "cat1", name: "Transport", color: "#5750F1" }],
    accounts: [{ id: "acct1", accountIdentifier: "DBS", color: "#5750F1" }],
    rows: [
      {
        id: "t1",
        version: 1,
        source: { transactionId: "t1" },
        original: {},
        value: {
          date: "2026-10-03T00:00:00.000Z",
          description: "BUS/MRT 123",
          label: "Commute",
          categoryId: "cat1",
          accountIdentifier: "DBS",
          amountOut: 2.09,
          currency: "SGD",
        },
      },
    ],
  };
  let proposals = [
    {
      id: "p1",
      kind: "create_account",
      status: "pending",
      expiresAt: "2099-01-01T00:00:00Z",
      preview: {
        title: "Create bank account",
        before: null,
        after: { kind: "create_account", accountIdentifier: "SimplyGo" },
      },
    },
  ];
  let extra = false;
  const cancelled: any[] = [],
    rejected: string[] = [];
  await page.route(`${server}/api/chat/**`, async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname.replace("/api/chat", "");
    let data: any = {};
    if (path === "/conversations")
      data = [{ id: "c1", title: "October spending", updatedAt: "2026-11-12" }];
    else if (path === "/conversations/c1")
      data = {
        id: "c1",
        title: "October spending",
        attachments: [],
        queue: [],
        messages: [
          {
            id: "a1",
            role: "assistant",
            blocks: [
              { type: "text", text: "Please check these trips first." },
              { type: "review", id: "review1", title: review.title },
            ],
          },
        ],
        runs: [
          {
            id: "r1",
            status: "completed",
            proposals,
            reviews: [
              {
                id: review.id,
                title: review.title,
                status: review.status,
                version: review.version,
                decidedAt: review.decidedAt,
              },
              ...(extra
                ? [{ id: "review2", title: "November groceries", status: "pending", version: 1 }]
                : []),
            ],
          },
        ],
      };
    else if (path === "/reviews/review1") data = review;
    else if (path === "/reviews/review1/cancel") {
      cancelled.push(request.postDataJSON());
      review.status = "cancelled";
      review.decidedAt = "2026-11-12T08:00:00Z";
      data = review;
    } else if (path === "/proposals/p1/reject") {
      rejected.push("p1");
      proposals = [];
      data = { status: "rejected" };
    }
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("tab", { name: /Chat/ }).click();
  await page
    .getByRole("button", { name: "Toggle chat history", exact: true })
    .click();
  await page
    .getByRole("button", { name: "October spending", exact: true })
    .click();
  const bar = page.getByLabel("Pending approvals");
  await expect(bar).toContainText("1 change and 1 review waiting for your approval");
  await bar.getByRole("button", { name: /Show the list/ }).click();
  await expect(bar.getByText("Create bank account")).toBeVisible();
  const shots = process.env.CANCEL_SHOTS;
  if (shots) {
    await expect(page.getByText("Conversations", { exact: true })).toBeHidden();
    await page.screenshot({ path: `${shots}/phone-app-bar.png` });
  }
  await bar.getByRole("button", { name: "Reject" }).click();
  await expect(bar).toContainText("1 review waiting for you");
  expect(rejected).toEqual(["p1"]);
  const cancel = page.getByRole("button", { name: "Cancel review", exact: true });
  await cancel.scrollIntoViewIfNeeded();
  if (shots) await page.screenshot({ path: `${shots}/phone-app-review-card.png` });
  // ✕ hides the bar until something new is waiting.
  await bar
    .getByRole("button", { name: "Hide until something new needs your approval" })
    .click();
  await expect(bar).toHaveCount(0);
  extra = true;
  await expect(bar).toContainText("2 reviews waiting for you", { timeout: 15000 });
  // Cancel on the card asks first.
  page.once("dialog", (d) => {
    expect(d.message()).toContain(
      "Close this review without applying its suggestions?",
    );
    void d.accept();
  });
  await cancel.click();
  await expect.poll(() => cancelled).toEqual([{ version: 2 }]);
  await expect(page.getByText("Cancelled by you")).toBeVisible();
  await expect(bar).toContainText("1 review waiting for you");
});
