import { test, expect, type Page } from "@playwright/test";
import { cell, focused, signIn, stubReview } from "./review-helpers";

const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "May wallet payments" });
const expand = (page: Page) =>
  page.getByRole("button", { name: "Expand", exact: true });
const scroller = (page: Page) => page.locator("table").locator("..");

test("full screen keeps the same editor: typing, saves, filters, sorting and scroll", async ({
  page,
  request,
}) => {
  await signIn(page, request, "rv_full");
  const stub = await stubReview(page, { rows: 60, delay: 900 });
  await page.goto("/chat?conversation=c1");
  await cell(page, 0, "label").fill("Before");
  await page.getByLabel("Search label or description").fill("SAMPLE");
  await page.getByRole("button", { name: "Filter and sort Out" }).click();
  await page.getByRole("button", { name: "Largest first" }).click();
  await page.keyboard.press("Escape");
  await expect(cell(page, 0, "description")).toHaveValue(/ 60$/);
  await scroller(page).evaluate((e) => (e.scrollTop = 400));
  await page.waitForTimeout(200);
  // The text being typed goes along, and so does the save it starts.
  await cell(page, 9, "label").fill("Typed");
  await page.evaluate(() => {
    (window as any).sheet = document.querySelector("fieldset");
  });
  const gets = stub.gets;
  const chat = page.locator(
    "section[aria-label=Conversation] > div.overflow-y-auto",
  );
  const chatScroll = await chat.evaluate((e) => e.scrollTop);
  await expand(page).click();
  await expect(dialog(page)).toBeVisible();
  expect(await dialog(page).boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: 1440,
    height: 1000,
  });
  expect(
    await page.evaluate(
      () => (window as any).sheet === document.querySelector("fieldset"),
    ),
  ).toBe(true);
  await expect(cell(page, 9, "label")).toHaveValue("Typed");
  await expect(page.getByLabel("Search label or description")).toHaveValue(
    "SAMPLE",
  );
  await expect(cell(page, 9, "description")).toHaveValue(/ 51$/);
  expect(
    Math.abs((await scroller(page).evaluate((e) => e.scrollTop)) - 400),
  ).toBeLessThan(120);
  await expect(cell(page, 9, "label")).toBeInViewport();
  // The table takes the window; the notices are folded away.
  expect((await scroller(page).boundingBox())!.height).toBeGreaterThan(780);
  await expect(page.getByText(/Fortuna wasn’t sure about/)).toBeHidden();
  await dialog(page).locator("summary").click();
  await expect(page.getByText(/Fortuna wasn’t sure about/)).toBeVisible();
  await dialog(page).locator("summary").click();
  // Text typed here survives closing, with its save still running.
  await cell(page, 10, "label").fill("Inside");
  await page.getByRole("button", { name: "Back to chat" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(expand(page)).toBeFocused();
  await expect(cell(page, 10, "label")).toHaveValue("Inside");
  await expect(cell(page, 9, "description")).toHaveValue(/ 51$/);
  expect(
    await page.evaluate(
      () => (window as any).sheet === document.querySelector("fieldset"),
    ),
  ).toBe(true);
  expect(await chat.evaluate((e) => [e.style.overflow, e.scrollTop])).toEqual([
    "",
    chatScroll,
  ]);
  expect(stub.gets).toBe(gets);
  await expect
    .poll(() => stub.review.rows[49].value.label, { timeout: 8000 })
    .toBe("Inside");
  expect(stub.review.rows[50].value.label).toBe("Typed");
  expect(stub.review.rows[0].value.label).toBe("Before");
  // One poll, not one more per opening.
  await page.getByText("Sample reply paragraph 12.").click();
  const from = stub.gets;
  await page.waitForTimeout(4500);
  expect(stub.gets - from).toBeLessThanOrEqual(4);
});

test("Esc belongs to fields and menus first, then closes; focus stays inside", async ({
  page,
  request,
}) => {
  await signIn(page, request, "rv_esc");
  await stubReview(page, { rows: 12, delay: 300 });
  await page.goto("/chat?conversation=c1");
  const open = async () => {
    await expand(page).click();
    await expect(dialog(page)).toBeVisible();
  };
  await open();
  await cell(page, 0, "label").click();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeVisible();
  // Category picker: its search box, then its trigger.
  await cell(page, 1, "category").click();
  const search = page.getByLabel("Search categories");
  await expect(search).toBeFocused();
  await expect(search).toBeInViewport();
  const top = await search.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return e === document.elementFromPoint(r.x + 5, r.y + 5);
  });
  expect(top).toBe(true);
  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);
  await expect(dialog(page)).toBeVisible();
  // Column menu and date picker.
  await page.getByRole("button", { name: "Filter and sort Category" }).click();
  const menu = page.getByRole("dialog", { name: "Filter and sort Category" });
  await expect(menu).toBeInViewport();
  await menu
    .getByLabel(/Dining/)
    .first()
    .click();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(dialog(page)).toBeVisible();
  await page.getByRole("button", { name: "Reset filters" }).click();
  await cell(page, 0, "date").click();
  await expect(page.getByText("May 2026", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("May 2026", { exact: true })).toHaveCount(0);
  await expect(dialog(page)).toBeVisible();
  // Focus never reaches the page behind it.
  await page.getByRole("button", { name: "Back to chat" }).focus();
  await cell(page, 0, "label").click();
  await page.keyboard.press("Tab");
  expect(await focused(page)).toBe("0:category");
  await page.locator("summary").focus();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest("[role=dialog]"),
      ),
    ).toBe(true);
  }
  await page
    .getByLabel("Message")
    .first()
    .evaluate((e) => (e as HTMLElement).focus())
    .catch(() => {});
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest("[role=dialog]"),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Back to chat" }).focus();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(expand(page)).toBeFocused();
});

test("reimbursement controls work in full screen, then it sends and returns to the chat", async ({
  page,
  request,
}) => {
  await signIn(page, request, "rv_fsend");
  const stub = await stubReview(page, { rows: 6, delay: 600 });
  Object.assign(stub.review.rows[1].value, { amountIn: 20, amountOut: null });
  await page.goto("/chat?conversation=c1");
  await expand(page).click();
  const send = page.getByRole("button", { name: /^Send review/ });
  await expect(send).toHaveCount(1);
  await page
    .getByRole("button", { name: /^Show details/ })
    .nth(1)
    .click();
  await page.getByRole("button", { name: "Mark as Reimbursement" }).click();
  await page
    .getByLabel("Add reimbursement target for row 2")
    .selectOption("t1");
  await expect(page.getByLabel("Allocation 1 amount for row 2")).toHaveValue(
    "6.5",
  );
  await page.locator("[role=dialog] button", { hasText: "111-sample" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeVisible();
  await expect(send).toBeDisabled();
  await expect(send).toBeEnabled({ timeout: 8000 });
  await cell(page, 0, "label").fill("Last");
  await send.click();
  await expect(dialog(page)).toHaveCount(0, { timeout: 8000 });
  expect(stub.sent).toHaveLength(1);
  expect(stub.review.rows[0].value.label).toBe("Last");
  expect(stub.review.rows[1].value.linkage.reimbursesAllocations).toEqual([
    { transactionId: "t1", amount: 6.5 },
  ]);
  expect(stub.puts.map((p) => p.status)).not.toContain(409);
  await expect(expand(page)).toBeFocused();
});

test("a closed review opens read-only, and cancelling returns to the chat", async ({
  page,
  request,
}) => {
  await signIn(page, request, "rv_closed");
  const stub = await stubReview(page);
  await page.goto("/chat?conversation=c1");
  await expand(page).click();
  page.once("dialog", (d) => void d.accept());
  await dialog(page).getByRole("button", { name: "Cancel review" }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(stub.review.status).toBe("cancelled");
  await expand(page).click();
  await expect(dialog(page)).toBeVisible();
  await expect(cell(page, 0, "label")).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Send review/ })).toHaveCount(
    0,
  );
  await expect(
    dialog(page).getByRole("button", { name: "Cancel review" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
});

test("a review closed elsewhere turns read-only in full screen", async ({
  page,
  request,
}) => {
  await signIn(page, request, "rv_else");
  const stub = await stubReview(page);
  await page.goto("/chat?conversation=c1");
  await expand(page).click();
  await cell(page, 0, "label").click();
  stub.review.status = "cancelled";
  stub.review.decidedAt = "2026-06-02T00:00:00Z";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(cell(page, 0, "label")).toBeDisabled({ timeout: 8000 });
  await expect(dialog(page)).toBeVisible();
});

test("full screen fits wide and narrow windows", async ({ page, request }) => {
  await signIn(page, request, "rv_shots");
  await stubReview(page, { rows: 42 });
  await page.goto("/chat?conversation=c1");
  const shots = process.env.REVIEW_SHOTS;
  for (const width of [1440, 412]) {
    await page.setViewportSize({ width, height: 915 });
    await expand(page).click();
    await expect(dialog(page)).toBeVisible();
    for (const name of [
      "Back to chat",
      "Cancel review",
      /^Send review/,
    ] as const) {
      const box = (await dialog(page)
        .getByRole("button", { name })
        .boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    expect((await scroller(page).boundingBox())!.height).toBeGreaterThan(540);
    expect(
      await dialog(page).evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBe(true);
    if (shots)
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (dark) => document.documentElement.classList.toggle("dark", dark),
          theme === "dark",
        );
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `${shots}/full-${width}-${theme}.png` });
      }
    await page.getByRole("button", { name: "Back to chat" }).click();
  }
});
