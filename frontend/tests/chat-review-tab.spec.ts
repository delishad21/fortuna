import { test, expect, type Page } from "@playwright/test";
import {
  FAKE_DATA_SERVICE_PORT,
  cell,
  focused,
  serveDraft,
  signIn,
  stubReview,
  walk,
} from "./review-helpers";

// Label to Category, Category to the next Label, Shift+Tab up the column.
const STEPS: Array<[string, string]> = [
  ["=Lunch", "0:label"],
  ["Tab", "0:category"],
  ["Tab", "1:label"],
  ["=Gadget", "1:label"],
  ["Tab", "1:category"],
  ["=boo", "1:category"],
  ["Tab", "2:label"],
  ["Shift+Tab", "1:label"],
  ["Shift+Tab", "0:label"],
  ["Tab", "0:category"],
  ["Escape", "0:category"],
  ["Tab", "1:label"],
  ["Tab", "1:category"],
  ["Tab", "2:label"],
  ["Shift+Tab", "1:label"],
  // At the last row Tab stays on it, at the first Shift+Tab does.
  ["Shift+Tab", "0:label"],
  ["Shift+Tab", "0:label"],
];

async function sharedWalks(page: Page) {
  await cell(page, 0, "label").click();
  expect(
    await walk(
      page,
      STEPS.map(([key]) => key),
    ),
  ).toEqual(STEPS.map(([, at]) => at));
  // Other columns go down and up their column.
  await cell(page, 0, "description").click();
  expect(await walk(page, ["Tab", "Tab", "Shift+Tab"])).toEqual([
    "1:description",
    "2:description",
    "1:description",
  ]);
  await cell(page, 1, "amountOut").click();
  expect(await walk(page, ["End", "=9", "Tab", "Shift+Tab"])).toEqual([
    "1:amountOut",
    "1:amountOut",
    "2:amountOut",
    "1:amountOut",
  ]);
  // Whichever way an open picker is left, Tab goes on to the next row's label.
  const search = page.getByLabel("Search categories");
  for (const leave of ["Tab", "mouse", "Enter", "Escape"]) {
    await cell(page, 3, "category").click();
    await expect(search).toBeFocused();
    if (leave === "mouse")
      await page.locator("[data-category-id]").nth(2).click();
    else await page.keyboard.press(leave);
    await expect(search).toHaveCount(0);
    if (leave !== "Tab") {
      expect(await focused(page), leave).toBe("3:category");
      await page.keyboard.press("Tab");
    }
    await page.waitForTimeout(100);
    expect(await focused(page), leave).toBe("4:label");
  }
  // Filtered and sorted, Tab follows the rows as shown.
  await page.getByRole("button", { name: "Filter and sort Out" }).click();
  await page
    .getByRole("dialog", { name: "Filter and sort Out" })
    .locator("[aria-pressed]")
    .nth(1)
    .click();
  await page.keyboard.press("Escape");
  await page.getByLabel("Search label or description").fill("A");
  await page.getByLabel("Search label or description").fill("SAMPLE");
  await cell(page, 0, "label").click();
  expect(await walk(page, ["=x", "Tab", "Tab", "Tab", "Shift+Tab"])).toEqual([
    "0:label",
    "0:category",
    "1:label",
    "1:category",
    "0:category",
  ]);
}

test("Tab moves through a review while saves are slow", async ({
  page,
  request,
}) => {
  await signIn(page, request, "rv_tab");
  const stub = await stubReview(page, { delay: 700 });
  await page.goto("/chat?conversation=c1");
  await sharedWalks(page);
  await expect(page.getByText("Changes save automatically")).toBeVisible({
    timeout: 20000,
  });
  expect(stub.puts.map((p) => p.status)).not.toContain(409);
  expect(stub.review.rows[0].value.label).toBe("Lunch");
  expect(stub.review.rows[1].value).toMatchObject({
    label: "Gadget",
    categoryId: "books",
    amountOut: 7.59,
  });
});

test("Tab moves through the import table the same way", async ({
  page,
  request,
}) => {
  test.skip(!FAKE_DATA_SERVICE_PORT, "needs FAKE_DATA_SERVICE_PORT");
  await signIn(page, request, "rv_imp");
  const draft = await serveDraft({ delay: 300 });
  try {
    await page.goto("/imports/drafts/draft1");
    await sharedWalks(page);
  } finally {
    draft.close();
  }
});

test("typed text survives scrolling its row away, and Tab reaches every row", async ({
  page,
  request,
}) => {
  await signIn(page, request, "rv_virt");
  const stub = await stubReview(page, { rows: 90, delay: 300 });
  await page.goto("/chat?conversation=c1");
  await cell(page, 0, "label").click();
  for (let i = 0; i < 60; i++) await page.keyboard.press("Tab");
  await expect.poll(() => focused(page)).toBe("30:label");
  await page.keyboard.type("Kept");
  const scroller = page.locator("table").locator("..");
  await scroller.evaluate((e) => (e.scrollTop = 0));
  await expect(cell(page, 30, "label")).toHaveCount(0);
  await expect
    .poll(() => stub.review.rows[30].value.label, { timeout: 5000 })
    .toBe("Kept");
});

test("fast typing across rows with slow saves keeps every edit", async ({
  page,
  request,
}) => {
  await signIn(page, request, "rv_fast");
  const stub = await stubReview(page, { delay: 500 });
  await page.goto("/chat?conversation=c1");
  await cell(page, 0, "label").click();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.type(`Label ${i + 1}`);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
  }
  // More edits to the first row while its first save is still on its way.
  await cell(page, 0, "label").fill("Label 1 again");
  await cell(page, 0, "amountOut").fill("77");
  await cell(page, 0, "description").focus();
  await page.keyboard.press("End");
  await page.keyboard.type(" typing");
  await expect
    .poll(() => stub.puts.length, { timeout: 15000 })
    .toBeGreaterThanOrEqual(7);
  await page.waitForTimeout(700);
  // The text still being typed was not replaced by the responses.
  await expect(cell(page, 0, "description")).toHaveValue(/ typing$/);
  expect(await focused(page)).toBe("0:description");
  await page.getByText("Sample reply paragraph 12.").click();
  await expect
    .poll(() => stub.review.rows[0].value.description)
    .toMatch(/ typing$/);
  expect(stub.puts.map((p) => p.status)).not.toContain(409);
  expect(stub.review.rows.map((r) => r.value.label)).toEqual([
    "Label 1 again",
    "Label 2",
    "Label 3",
    "Label 4",
    "Label 5",
    "Label 6",
  ]);
  expect(stub.review.rows[0].value.amountOut).toBe(77);
});

test("the fields in a row's details keep their text while another save returns", async ({
  page,
  request,
}) => {
  await signIn(page, request, "rv_details");
  const stub = await stubReview(page, { delay: 800 });
  await page.goto("/chat?conversation=c1");
  await page
    .getByRole("button", { name: /^Show details/ })
    .first()
    .click();
  await cell(page, 0, "label").fill("Slow");
  await page.getByLabel("Balance for row 1").click();
  await page.keyboard.type("12");
  await expect.poll(() => stub.puts.length).toBe(1);
  await page.waitForTimeout(300);
  await page.keyboard.type("3.5");
  await expect(page.getByLabel("Balance for row 1")).toHaveValue("123.5");
  await page.keyboard.press("Tab");
  await expect.poll(() => stub.review.rows[0].value.balance).toBe(123.5);
});

test("a conflict shows its error and Reload, and blocks sending until then", async ({
  page,
  request,
}) => {
  await signIn(page, request, "rv_409");
  const stub = await stubReview(page, { delay: 300 });
  await page.goto("/chat?conversation=c1");
  await cell(page, 0, "label").click();
  stub.review.rows[0].version = 5;
  stub.review.rows[0].value.label = "From the phone";
  await page.keyboard.type("Mine");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Second row");
  await page.keyboard.press("Tab");
  await expect(page.getByText("another device")).toBeVisible();
  await expect(cell(page, 0, "label")).toHaveValue("From the phone");
  await expect.poll(() => stub.review.rows[1].value.label).toBe("Second row");
  const send = page.getByRole("button", { name: "Send review to Fortuna" });
  await expect(send).toBeDisabled();
  // Another edit doesn't hide the failed one.
  await cell(page, 2, "label").fill("Third row");
  await cell(page, 3, "label").focus();
  await expect.poll(() => stub.review.rows[2].value.label).toBe("Third row");
  await expect(page.getByText("another device")).toBeVisible();
  await page.getByRole("button", { name: "Reload saved review" }).click();
  await expect(page.getByText("another device")).toHaveCount(0);
  await expect(send).toBeEnabled();
});

test("a poll doesn't replace what is being typed or saved", async ({
  page,
  request,
}) => {
  await signIn(page, request, "rv_poll");
  const stub = await stubReview(page, { delay: 200 });
  await page.goto("/chat?conversation=c1");
  await expect(cell(page, 0, "label")).toBeVisible();
  // Hold a poll open with the old values while a label is typed.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const gets = stub.gets;
  stub.beforeGet = () => held;
  await expect.poll(() => stub.gets).toBeGreaterThan(gets);
  await cell(page, 0, "label").fill("Typed");
  release();
  stub.beforeGet = null;
  await page.waitForTimeout(400);
  await expect(cell(page, 0, "label")).toHaveValue("Typed");
  const during = stub.gets;
  await page.waitForTimeout(3500);
  expect(stub.gets).toBe(during);
  await page.getByText("Sample reply paragraph 12.").click();
  await expect.poll(() => stub.review.rows[0].value.label).toBe("Typed");
  await expect(cell(page, 0, "label")).toHaveValue("Typed");
});

test("sending waits for every save, and takes the text still in a cell", async ({
  page,
  request,
}) => {
  await signIn(page, request, "rv_send");
  const stub = await stubReview(page, { delay: 900 });
  await page.goto("/chat?conversation=c1");
  const send = page.getByRole("button", { name: "Send review to Fortuna" });
  const sheet = page.getByLabel("Transaction review spreadsheet");
  const cancel = page
    .getByLabel("May wallet payments", { exact: true })
    .getByRole("button", { name: "Cancel review", exact: true });
  await cell(page, 0, "label").fill("One");
  await cell(page, 1, "label").fill("Two");
  await expect(send).toBeDisabled();
  await expect(cancel).toBeDisabled();
  await send.click({ force: true });
  expect(stub.sent).toHaveLength(0);
  await expect(send).toBeEnabled({ timeout: 10000 });
  // Row 3's text is still unsaved; pressing Send leaves the cell, saves it, then sends.
  await cell(page, 2, "label").fill("Three");
  await send.click();
  await page.waitForTimeout(300);
  expect(stub.sent).toHaveLength(0);
  await expect.poll(() => stub.sent.length, { timeout: 10000 }).toBe(1);
  expect(stub.review.rows.slice(0, 3).map((r) => r.value.label)).toEqual([
    "One",
    "Two",
    "Three",
  ]);
  expect(stub.sent[0].reviewVersion).toBe(stub.review.version);
  await expect(sheet).toHaveAttribute("disabled", "");
});
