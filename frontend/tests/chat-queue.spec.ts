import { test, expect, Page } from "@playwright/test";
/** A conversation replying, with a message and a returned review waiting behind it. */
function fixture() {
  const state = {
    queue: [
      {
        id: "q1",
        kind: "message",
        text: "Also split last month's groceries by store",
        attachmentIds: [] as string[],
        reviewId: null as string | null,
        reviewTitle: null as string | null,
        status: "queued",
        error: null as string | null,
      },
      {
        id: "q2",
        kind: "message",
        text: "Here is my completed review: October bus and train trips",
        attachmentIds: [],
        reviewId: "review1",
        reviewTitle: "October bus and train trips",
        status: "queued",
        error: null,
      },
      {
        id: "q3",
        kind: "message",
        text: "Import this statement too",
        attachmentIds: ["att1"],
        reviewId: null,
        reviewTitle: null,
        status: "failed",
        error:
          "Not sent: DBS Oct.pdf was deleted or expired while this message waited. Remove the file and attach it again, or remove this message.",
      },
    ],
    sent: [] as any[],
    edits: [] as any[],
    removed: [] as string[],
    cancelled: [] as any[],
  };
  const review = {
    id: "review1",
    conversationId: "c1",
    title: "October bus and train trips",
    instructions: "",
    status: "queued",
    version: 3,
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
  const conversation = () => ({
    id: "c1",
    title: "October spending",
    attachments: [
      {
        id: "att1",
        statementFile: {
          filename: "DBS Oct.pdf",
          expiresAt: "2026-11-01",
          deletedAt: "2026-11-10",
        },
      },
    ],
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
      {
        id: "u2",
        role: "user",
        blocks: [{ type: "text", text: "And food in October?" }],
      },
    ],
    runs: [
      { id: "r2", status: "running", proposals: [], reviews: [] },
      {
        id: "r1",
        status: "completed",
        proposals: [],
        reviews: [{ id: "review1", title: review.title, status: review.status }],
      },
    ],
    queue: state.queue,
  });
  return { state, review, conversation };
}
async function signIn(page: Page, request: any) {
  const username = `chat_queue_${Date.now()}`,
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
    else if (path === "/runs/r2/events")
      body = {
        events: [
          {
            sequence: 1,
            payload: { type: "tool_call", name: "spending_summary" },
          },
        ],
        status: "running",
        queued: false,
        cursor: 1,
      };
    else if (path === "/conversations/c1/messages") {
      const sent = request.postDataJSON();
      f.state.sent.push(sent);
      f.state.queue.push({
        id: `q${f.state.queue.length + 1}`,
        kind: "message",
        text: sent.text,
        attachmentIds: sent.attachmentIds,
        reviewId: null,
        reviewTitle: null,
        status: "queued",
        error: null,
      });
      body = { queued: true, queuedId: "q4", position: 3 };
    } else if (path.startsWith("/conversations/c1/queue/")) {
      const id = path.split("/").pop()!;
      if (request.method() === "DELETE") {
        f.state.removed.push(id);
        f.state.queue = f.state.queue.filter((q) => q.id !== id);
      } else {
        const edit = request.postDataJSON();
        f.state.edits.push({ id, ...edit });
        f.state.queue = f.state.queue.map((q) =>
          q.id === id ? { ...q, ...edit, status: "queued", error: null } : q,
        );
      }
      body = f.state.queue;
    } else if (path === "/runs/r2/cancel") {
      f.state.cancelled.push(request.postDataJSON());
      body = { cancelled: true };
    }
    await route.fulfill({ json: body });
  });
}
test("messages sent while Fortuna replies wait in the chat, editable until they start", async ({
  page,
  request,
}) => {
  await signIn(page, request);
  const f = fixture();
  await mockChat(page, f);
  await page.goto("/chat?conversation=c1");
  await expect(page.getByText("Queued (1)", { exact: true })).toBeVisible();
  await expect(page.getByText("Queued (2)", { exact: true })).toBeVisible();
  await expect(page.getByText("Not sent", { exact: true })).toBeVisible();
  await expect(page.getByText(/DBS Oct\.pdf was deleted or expired/)).toBeVisible();
  await expect(
    page.getByText("Queued: sends after the current reply").first(),
  ).toBeVisible();
  // The composer stays open while the reply runs.
  const box = page.getByLabel("Message", { exact: true });
  await expect(box).toBeEnabled();
  await expect(page.getByText("Will send after the current reply")).toBeVisible();
  await box.fill("Then show me the biggest one");
  await page.getByRole("button", { name: "Queue message" }).click();
  await expect(page.getByText("Queued (3)", { exact: true })).toBeVisible();
  expect(f.state.sent[0].text).toBe("Then show me the biggest one");
  if (process.env.QUEUE_SHOTS) {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.getByText("Queued (3)", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.QUEUE_SHOTS}/web-desktop.png` });
  }
  // Edit one, remove another.
  const first = page.getByRole("article", { name: "Queued (1) message" });
  await first.getByRole("button", { name: "Edit" }).click();
  await first
    .getByLabel("Edit queued message")
    .fill("Split groceries by store, please");
  await first.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Split groceries by store, please")).toBeVisible();
  expect(f.state.edits[0]).toEqual({
    id: "q1",
    text: "Split groceries by store, please",
    attachmentIds: [],
  });
  await page
    .getByRole("article", { name: "Not sent message" })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(page.getByText("Not sent", { exact: true })).toHaveCount(0);
  expect(f.state.removed).toEqual(["q3"]);
  // Stop asks what to do with the queue.
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByText(/3 queued messages are waiting/)).toBeVisible();
  if (process.env.QUEUE_SHOTS)
    await page.screenshot({
      path: `${process.env.QUEUE_SHOTS}/web-desktop-stop.png`,
    });
  await page.getByRole("button", { name: "Stop and keep the queue" }).click();
  await expect.poll(() => f.state.cancelled).toEqual([{ queue: "keep" }]);
});
test("on a phone-width screen the queue and the open composer fit", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, request);
  await mockChat(page, fixture());
  await page.goto("/chat?conversation=c1");
  const second = page.getByText("Queued (2)", { exact: true });
  await expect(second).toBeVisible();
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Queue message" })).toBeVisible();
  if (process.env.QUEUE_SHOTS) {
    await second.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.QUEUE_SHOTS}/web-phone.png` });
  }
});
