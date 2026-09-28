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
    else if (path === "/conversations/c1")
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
  await page.getByRole("button", { name: /Phone review/ }).click();
  await page.getByLabel("Message", { exact: true }).fill("Review lunch");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("Connection interrupted", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "Review lunch",
  );
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByText("Before", { exact: true })).toBeVisible();
  await expect(page.getByText("Work lunch", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/fortuna-chat-phone-approval.png" });
  await page.getByRole("button", { name: "Confirm changes" }).click();
  await expect(
    page.getByText("Changes applied", { exact: true }),
  ).toBeVisible();
});
