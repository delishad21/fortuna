import { test, expect } from "@playwright/test";
const reply = [
  "## October spending",
  "Your SimplyGo spend for **October 1–31, 2026** came to **S$144.27 SGD**.",
  "",
  "- Card 4265-****-****-4591 paid for `bus_trip` rows",
  "- **Train** trips were the bulk",
  "",
  "1. First check",
  "2. Second check",
].join("\n");
for (const colorScheme of ["light", "dark"] as const)
  test(`phone chat renders assistant markdown (${colorScheme})`, async ({
    page,
  }) => {
    const server = "http://chat-fixture.local";
    await page.emulateMedia({ colorScheme });
    await page.addInitScript(
      ({ server }) =>
        sessionStorage.setItem(
          "fortuna.mobile.session",
          JSON.stringify({
            server,
            token: "qa-token",
            expiresAt: "2099-01-01",
          }),
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
    await page.route("http://chat-fixture.local/api/chat/**", (route) => {
      const path = new URL(route.request().url()).pathname.replace(
        "/api/chat",
        "",
      );
      let data: any = [];
      if (path === "/conversations")
        data = [{ id: "c1", title: "October", updatedAt: "2026-11-13" }];
      else if (path === "/conversations/c1")
        data = {
          id: "c1",
          title: "October",
          attachments: [],
          runs: [],
          messages: [
            {
              id: "m0",
              role: "user",
              blocks: [{ type: "text", text: "Keep **this** as typed" }],
            },
            {
              id: "m1",
              role: "assistant",
              blocks: [{ type: "text", text: reply }],
            },
          ],
        };
      return route.fulfill({ json: data });
    });
    await page.goto("/");
    await page.getByRole("tab", { name: /Chat/ }).click();
    await page
      .getByRole("button", { name: "Toggle chat history", exact: true })
      .click();
    await page.getByRole("button", { name: "October", exact: true }).click();
    await expect(
      page.getByText("October spending", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("S$144.27 SGD", { exact: true })).toBeVisible();
    await expect(page.getByText(/\*\*S\$144/)).toHaveCount(0);
    await expect(
      page.getByText("Card 4265-****-****-4591 paid for", { exact: false }),
    ).toBeVisible();
    await expect(page.getByText("bus_trip", { exact: true })).toBeVisible();
    await expect(page.getByText("2.", { exact: true })).toBeVisible();
    await expect(page.getByText("Keep **this** as typed")).toBeVisible();
    await expect(page.getByText("Conversations", { exact: true })).toBeHidden();
    await page.screenshot({
      path: `/tmp/fortuna-mobile-chat-markdown-${colorScheme}.png`,
    });
  });
