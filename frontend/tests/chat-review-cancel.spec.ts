import { test, expect, Page } from "@playwright/test";
/** A conversation with a pending review and a pending proposal waiting for the user. */
function fixture() {
  const state = {
    cancelled: [] as any[],
    rejected: [] as string[],
    proposals: [
      {
        id: "p1",
        kind: "create_account",
        status: "pending",
        expiresAt: "2099-01-01T00:00:00Z",
        preview: {
          title: "Create bank account",
          before: null,
          after: {
            kind: "create_account",
            accountIdentifier: "SimplyGo",
            color: "#0B3D91",
          },
        },
      },
    ],
    extraReview: false,
  };
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
          metadata: {},
        },
      },
    ],
  };
  const second = {
    ...review,
    id: "review2",
    title: "November groceries",
    version: 1,
  };
  const conversation = () => ({
    id: "c1",
    title: "October spending",
    attachments: [],
    queue: [],
    messages: [
      {
        id: "u1",
        role: "user",
        blocks: [{ type: "text", text: "How much did I spend on transport?" }],
      },
      {
        id: "a1",
        role: "assistant",
        blocks: [
          { type: "text", text: "Please check these trips first." },
          { type: "review", id: "review1", title: review.title },
        ],
      },
      ...(state.extraReview
        ? [
            {
              id: "a2",
              role: "assistant",
              blocks: [{ type: "review", id: "review2", title: second.title }],
            },
          ]
        : []),
    ],
    runs: [
      {
        id: "r1",
        status: "completed",
        proposals: state.proposals,
        reviews: [
          {
            id: review.id,
            title: review.title,
            status: review.status,
            version: review.version,
            decidedAt: review.decidedAt,
          },
          ...(state.extraReview
            ? [{ id: second.id, title: second.title, status: "pending", version: 1 }]
            : []),
        ],
      },
    ],
  });
  return { state, review, second, conversation };
}
async function signIn(page: Page, request: any) {
  const username = `chat_cancel_${Date.now()}`,
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
async function mockChat(page: Page, f: ReturnType<typeof fixture>) {
  await page.route("**/api/chat/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname.replace("/api/chat", "");
    let body: any = {};
    if (path === "/conversations")
      body = [{ id: "c1", title: "October spending", updatedAt: "2026-11-12" }];
    else if (path === "/conversations/c1") body = f.conversation();
    else if (path === "/reviews/review1") body = f.review;
    else if (path === "/reviews/review2") body = f.second;
    else if (path === "/reviews/review1/cancel") {
      f.state.cancelled.push(request.postDataJSON());
      f.review.status = "cancelled";
      f.review.decidedAt = "2026-11-12T08:00:00Z";
      body = f.review;
    } else if (path === "/proposals/p1/reject") {
      f.state.rejected.push("p1");
      f.state.proposals = [];
      body = { status: "rejected" };
    }
    await route.fulfill({ json: body });
  });
}
const shots = process.env.CANCEL_SHOTS;

test("a pending review can be cancelled from its card after a confirm", async ({
  page,
  request,
}) => {
  await signIn(page, request);
  const f = fixture();
  f.state.proposals = [];
  await mockChat(page, f);
  await page.goto("/chat?conversation=c1");
  const card = page.getByRole("button", { name: "Cancel review" });
  await expect(card).toBeVisible();
  if (shots) {
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${shots}/web-review-card-desktop.png` });
  }
  // Dismissing the confirm keeps it open.
  page.once("dialog", (d) => {
    expect(d.message()).toBe(
      "Close this review without applying its suggestions?",
    );
    void d.dismiss();
  });
  await card.click();
  expect(f.state.cancelled).toEqual([]);
  page.once("dialog", (d) => void d.accept());
  await card.click();
  await expect(page.getByText("Cancelled by you").first()).toBeVisible();
  expect(f.state.cancelled).toEqual([{ version: 2 }]);
  await expect(page.getByRole("button", { name: "Cancel review" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Pending approvals" })).toHaveCount(0);
});

test("the approvals bar closes items directly, hides on ✕ and returns for a new item", async ({
  page,
  request,
}) => {
  await signIn(page, request);
  const f = fixture();
  await mockChat(page, f);
  await page.goto("/chat?conversation=c1");
  const bar = page.getByRole("region", { name: "Pending approvals" });
  await expect(bar).toContainText("1 change and 1 review waiting for your approval");
  await bar.getByRole("button", { name: /waiting for your approval/ }).click();
  await expect(bar.getByText("Create bank account")).toBeVisible();
  await expect(bar.getByText("October bus and train trips")).toBeVisible();
  if (shots) {
    await page.screenshot({ path: `${shots}/web-bar-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await bar.getByRole("button", { name: /waiting for your approval/ }).click();
    await page.screenshot({ path: `${shots}/web-bar-phone.png` });
    await page.getByRole("button", { name: "Cancel review" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${shots}/web-review-card-phone.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await bar.getByRole("button", { name: /waiting for your approval/ }).click();
  }
  // Reject the proposal from the list.
  await bar.getByRole("button", { name: "Reject" }).click();
  await expect(bar).toContainText("1 review waiting for you");
  expect(f.state.rejected).toEqual(["p1"]);
  // ✕ hides it, also after a reload.
  await bar
    .getByRole("button", { name: "Hide until something new needs your approval" })
    .click();
  await expect(bar).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Please check these trips first.")).toBeVisible();
  await expect(bar).toHaveCount(0);
  // A new review brings it back.
  f.state.extraReview = true;
  await page.reload();
  await expect(bar).toContainText("2 reviews waiting for you");
  // Cancelling from the list asks first.
  await bar.getByRole("button", { name: /waiting for you/ }).click();
  page.once("dialog", (d) => void d.accept());
  await bar
    .getByRole("listitem")
    .filter({ hasText: "October bus and train trips" })
    .getByRole("button", { name: "Cancel" })
    .click();
  expect(f.state.cancelled).toEqual([{ version: 2 }]);
  await expect(bar).toContainText("1 review waiting for you");
});
