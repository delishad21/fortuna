import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
const requireFrontend = createRequire(
  path.resolve(__dirname, "../../frontend/package.json"),
);
const { PrismaClient } = requireFrontend("@prisma/client");
const server = process.env.FORTUNA_TEST_SERVER || "http://localhost:3001";

test("mobile authentication, financial workflows and phone navigation", async ({
  page,
  request,
}) => {
  const username = `mobile_qa_${Date.now()}`;
  const password = randomBytes(18).toString("hex");
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url:
          process.env.FORTUNA_TEST_DATABASE_URL ||
          "postgresql://financeuser:financepass@localhost:5433/personal_finance?schema=public",
      },
    },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let token = "";
  const rpc = async (operation: string, ...args: any[]) => {
    const response = await request.post(`${server}/api/mobile/action`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { operation, args },
    });
    const body = await response.json();
    expect(
      response.ok(),
      `${operation}: ${body.error || response.status()}`,
    ).toBeTruthy();
    return body.data;
  };
  try {
    expect(
      (
        await request.post(`${server}/api/auth/register`, {
          data: { name: "Mobile QA", username, password, baseCurrency: "SGD" },
        })
      ).ok(),
    ).toBeTruthy();
    const login = await request.post(`${server}/api/mobile/session`, {
      data: { username, password },
    });
    expect(login.ok()).toBeTruthy();
    token = (await login.json()).token;
    expect(
      (
        await request.post(`${server}/api/mobile/action`, {
          data: { operation: "getCurrentUser", args: [] },
        })
      ).status(),
    ).toBe(401);
    for (const args of [
      [{ userId: "someone-else" }],
      [{ metadata: { userId: "someone-else" } }],
    ])
      expect(
        (
          await request.post(`${server}/api/mobile/action`, {
            headers: { Authorization: `Bearer ${token}` },
            data: { operation: "getTransactions", args },
          })
        ).status(),
      ).toBe(400);
    const cats = await rpc("getCategories");
    const account = await rpc("upsertAccountNumber", "QA everyday", "#5750F1");
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const draft = await prisma.importDraft.create({
      data: {
        userId: user.id,
        mode: "main",
        sourceFilename: "Agent staged QA.csv",
        sourceSha256: "qa",
        status: "review",
        expiresAt: new Date(Date.now() + 86400000),
        rows: {
          create: [0, 1, 2, 3].map((index) => {
            const payload = {
              date: "2026-09-22",
              description: `Staged expense ${index + 1}`,
              label:
                index === 3
                  ? "Incoming reimbursement"
                  : index === 2
                    ? "Ready expense"
                    : "",
              categoryId: cats[0].id,
              amountIn: index === 3 ? 5 : 0,
              amountOut: index === 3 ? 0 : 5 + index,
              accountIdentifier: account.accountIdentifier,
            };
            return {
              rowIndex: index,
              parsedPayload: payload,
              currentPayload: payload,
              reviewStatus: index >= 2 ? "auto_applied" : "proposed",
            };
          }),
        },
      },
      include: { rows: { orderBy: { rowIndex: "asc" } } },
    });
    for (const [index, row] of draft.rows.slice(0, 2).entries())
      await prisma.classificationProposal.create({
        data: {
          draftId: draft.id,
          draftRowId: row.id,
          inputDraftVersion: 1,
          inputRowVersion: 1,
          proposedLabel: `Reviewed expense ${index + 1}`,
          proposedCategoryId: cats[0].id,
          ...(index === 1 ? { proposedLinkage: { type: "internal" } } : {}),
          confidence: 0.85,
          reason:
            index === 1 ? "Check this transfer" : "Confirm merchant label",
          model: "qa",
          promptVersion: "qa",
          idempotencyKey: `${username}-${index}`,
          payloadHash: "qa",
        },
      });
    expect(
      (await rpc("getAgentDrafts")).drafts.find((d: any) => d.id === draft.id)
        .reviewSummary,
    ).toMatchObject({ total: 4, needsReview: 2, reconciliation: 1, ready: 2 });
    const rows = [
      {
        date: "2026-09-20",
        description: "Coffee with friends",
        label: "Morning coffee",
        amountOut: 12,
        amountIn: 0,
        categoryId: cats[0].id,
        accountIdentifier: account.accountIdentifier,
      },
      {
        date: "2026-09-21",
        description: "Monthly pay",
        amountIn: 3000,
        amountOut: 0,
        categoryId: cats[0].id,
      },
    ];
    expect(
      (
        await rpc("commitImport", rows, [0, 1], {
          filename: "qa.csv",
          parserId: "manual",
          fileType: "csv",
        })
      ).success,
    ).toBeTruthy();
    expect((await rpc("checkImportDuplicates", rows)).duplicates.length).toBe(
      2,
    );
    const transactions = await rpc("getTransactions", {
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
    });
    expect(transactions.transactions.length).toBe(2);
    const expense = transactions.transactions.find(
      (t: any) => Number(t.amountOut) > 0,
    );
    await rpc("updateTransaction", expense.id, { label: "Coffee catch-up" });
    expect(await rpc("exportTransactionsCsv", { ids: [expense.id] })).toContain(
      "Coffee",
    );
    const overview = await rpc("getDashboardOverview", "2026-09");
    expect(overview.summary.totalOut).toBe(12);
    for (const op of [
      "getDashboardReview",
      "getAnalyticsOverview",
      "getImportSummaries",
      "getImportRules",
      "getClassificationPatterns",
      "getApiTokens",
      "getAvailableParsers",
      "getAgentDrafts",
    ])
      await rpc(op);
    await rpc("getAnalyticsReport", {
      month: "2026-09",
      range: "last3",
      metric: "expense",
      groupBy: "category",
    });
    const trip = await rpc("createTrip", {
      name: "Kyoto getaway",
      baseCurrency: "SGD",
      startDate: "2026-09-01",
      endDate: "2026-09-08",
    });
    const wallet = await rpc("createWallet", trip.id, {
      name: "Travel card",
      currency: "JPY",
      color: "#5750F1",
    });
    const funding = await rpc("createTripFunding", trip.id, {
      walletId: wallet.id,
      sourceType: "manual",
      sourceCurrency: "SGD",
      sourceAmount: 100,
      destinationCurrency: "JPY",
      destinationAmount: 11000,
    });
    await rpc("createTripEntry", trip.id, {
      walletId: wallet.id,
      type: "spending",
      date: "2026-09-21",
      description: "Ramen lunch",
      localCurrency: "JPY",
      localAmount: 1100,
      baseAmount: 10,
      fxRate: 0.009090909,
    });
    expect(
      (await rpc("getTripEntries", trip.id, {})).items.length,
    ).toBeGreaterThan(0);
    await rpc("getTripAnalytics", trip.id);
    await rpc("getTripWalletSummaries", trip.id);
    await rpc("updateTripFunding", trip.id, funding.funding.id, {
      sourceAmount: 100,
    });
    // The preview requests the same real backend, through a same-origin test proxy.
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({
        url: `${server}${url.pathname}${url.search}`,
      });
      await route.fulfill({ response });
    });
    await page.goto("/");
    await page
      .getByLabel("Fortuna server domain or URL", { exact: true })
      .fill("http://localhost:8081");
    await page.getByLabel("Username", { exact: true }).fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Hello, Mobile.", { exact: true })).toBeVisible(
      { timeout: 30000 },
    );
    await expect(
      page.getByText("Net cash flow", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/home-phone.png",
      fullPage: true,
    });
    await page.getByRole("tab", { name: /Activity|Transactions/ }).click();
    await expect(
      page.getByText("Your transactions", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Coffee catch-up", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("2 transactions", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/transactions-phone.png",
      fullPage: true,
    });
    await page.getByRole("tab", { name: /Trips/ }).click();
    await expect(
      page.getByText("Kyoto getaway", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Open trip", exact: true }).click();
    await expect(
      page.getByText("Net trip cost", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/trip-phone.png",
      fullPage: true,
    });
    await page.getByRole("link", { name: /back/i }).first().click();
    await page.getByRole("tab", { name: /Import/ }).click();
    await expect(page.getByText("Your imports", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Agent staged QA.csv", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Review staged transactions", exact: true })
      .click();
    await expect(
      page.getByText("Staged expense 1", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Exclude row", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: "Include row", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Include row", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Accept", exact: true })
      .first()
      .click();
    await expect(
      page.getByText("Reviewed expense 1", { exact: true }),
    ).toBeHidden();
    await page
      .getByRole("button", { name: "Reconciliation", exact: true })
      .click();
    await expect(
      page.getByText("Check this transfer", { exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(
      page.getByText(
        "No transactions match this view. Choose All to see every row.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Ready", exact: true }).click();
    await expect(
      page.getByText("Reviewed expense 1", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Edit details", exact: true })
      .first()
      .click();
    await page
      .getByLabel("Label", { exact: true })
      .fill("Phone reviewed expense");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(
      page.getByText("Phone reviewed expense", { exact: true }),
    ).toBeVisible();
    expect(
      (await rpc("getAgentDraft", draft.id)).draft.reviewSummary,
    ).toMatchObject({ needsReview: 0, ready: 4, selected: 4 });
    await page.screenshot({
      path: "test-results/staged-review-phone.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Edit details", exact: true })
      .last()
      .click();
    await page
      .getByRole("button", { name: "Allocate reimbursement", exact: true })
      .click();
    await expect(
      page.getByText(
        "Choose expenses in this statement or your saved ledger.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: /Phone reviewed expense/ }).click();
    await page
      .getByRole("button", { name: "Save allocations", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Review & save 4 rows", exact: true }),
    ).toBeVisible();
    expect(
      (await rpc("getAgentDraft", draft.id)).draft.rows[3].currentPayload
        .linkage,
    ).toMatchObject({
      type: "reimbursement",
      reimbursesAllocations: [{ pendingBatchIndex: 0, amount: 5 }],
      leftoverAmount: 0,
    });
    page.once("dialog", (dialog) => void dialog.accept());
    await page
      .getByRole("button", { name: "Review & save 4 rows", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Review & save 4 rows", exact: true }),
    ).toBeHidden();
    await expect
      .poll(async () => (await rpc("getAgentDraft", draft.id)).draft.status)
      .toBe("committed");
    await page.getByRole("link", { name: /back/i }).first().click();
    await expect(
      page.getByRole("button", {
        name: "Review staged transactions",
        exact: true,
      }),
    ).toBeHidden();
    await page.getByRole("button", { name: "History", exact: true }).click();
    await expect(page.getByText("qa.csv", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Import a statement", exact: true })
      .click();
    await expect(
      page.getByText("Bring it all together", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Statement parser", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Done", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Done", exact: true }),
    ).toBeHidden();
    await page.getByRole("link", { name: /back/i }).first().click();
    await page.getByRole("tab", { name: /Settings/ }).click();
    await expect(
      page.getByText("Make it yours", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "dark", exact: true }).click();
    await page.screenshot({
      path: "test-results/settings-dark-phone.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Categories", exact: true }).click();
    await page
      .getByRole("button", { name: "Add category", exact: true })
      .click();
    await page
      .getByLabel("Name", { exact: true })
      .fill("Mobile-created category");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(
      page.getByText("Mobile-created category", { exact: true }),
    ).toBeVisible();
    expect(
      (await rpc("getCategories")).some(
        (c: any) => c.name === "Mobile-created category",
      ),
    ).toBeTruthy();
    expect(errors).toEqual([]);
    await rpc("splitTransaction", expense.id, [
      { description: "Coffee", amountOut: 8 },
      { description: "Pastry", amountOut: 4 },
    ]);
    expect(
      (
        await request.delete(`${server}/api/mobile/session`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await request.post(`${server}/api/mobile/action`, {
          headers: { Authorization: `Bearer ${token}` },
          data: { operation: "getCurrentUser", args: [] },
        })
      ).status(),
    ).toBe(401);
  } finally {
    const user = await prisma.user.findUnique({ where: { username } });
    if (user) await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
