import { test, expect } from "@playwright/test";
test("phone chat shows queued messages while Fortuna replies, and Stop asks about them", async ({
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
  let queue = [
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
  ];
  const sent: any[] = [],
    removed: string[] = [],
    cancelled: any[] = [];
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
        messages: [
          {
            id: "u1",
            role: "user",
            blocks: [{ type: "text", text: "And food in October?" }],
          },
        ],
        runs: [{ id: "r2", status: "running", proposals: [], reviews: [] }],
        queue,
      };
    else if (path === "/runs/r2/events")
      data = {
        events: [
          { sequence: 1, payload: { type: "tool_call", name: "spending_summary" } },
        ],
        status: "running",
        queued: false,
        cursor: 1,
      };
    else if (path === "/conversations/c1/messages") {
      const body = request.postDataJSON();
      sent.push(body);
      queue = [
        ...queue,
        { ...queue[0], id: "q3", text: body.text, reviewId: null, reviewTitle: null },
      ];
      data = { queued: true, queuedId: "q3", position: 3 };
    } else if (path.startsWith("/conversations/c1/queue/")) {
      const id = path.split("/").pop()!;
      removed.push(id);
      queue = queue.filter((q) => q.id !== id);
      data = queue;
    } else if (path === "/runs/r2/cancel") {
      cancelled.push(request.postDataJSON());
      data = { cancelled: true };
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
  await expect(page.getByText("Queued (1)", { exact: true })).toBeVisible();
  await expect(page.getByText("Queued (2)", { exact: true })).toBeVisible();
  await expect(page.getByText("Will send after the current reply")).toBeVisible();
  await page
    .getByLabel("Message", { exact: true })
    .fill("Then show me the biggest one");
  await page.getByRole("button", { name: "Queue message" }).click();
  await expect(page.getByText("Queued (3)", { exact: true })).toBeVisible();
  expect(sent[0].text).toBe("Then show me the biggest one");
  if (process.env.QUEUE_SHOTS) {
    await page.getByText("Queued (1)", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.QUEUE_SHOTS}/phone-app.png` });
  }
  await page.getByRole("button", { name: "Remove" }).first().click();
  await expect(page.getByText("Queued (3)", { exact: true })).toHaveCount(0);
  expect(removed).toEqual(["q1"]);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByText(/2 queued messages are waiting/)).toBeVisible();
  if (process.env.QUEUE_SHOTS)
    await page.screenshot({
      path: `${process.env.QUEUE_SHOTS}/phone-app-stop.png`,
    });
  await page.getByRole("button", { name: "Stop and clear the queue" }).click();
  await expect.poll(() => cancelled).toEqual([{ queue: "clear" }]);
});
