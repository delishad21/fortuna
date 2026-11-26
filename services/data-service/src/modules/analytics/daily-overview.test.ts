import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import type { PrismaClient } from "@prisma/client";
import { withChatDb } from "../chat/test-harness";
import { withDatabase } from "../../lib/database-context";
import { hashApiTokenSecret } from "../auth/api-token";
import { analyticsRouter } from "./analytics.controller";
import { agentAnalyticsRouter } from "./agent-analytics.controller";

async function serve(db: PrismaClient) {
  const app = express();
  app.use(express.json());
  app.use((_request, _response, next) => void withDatabase(db, async () => next()));
  app.use("/api/analytics", analyticsRouter);
  app.use("/api/agent/analytics", agentAnalyticsRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const get = async (path: string, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}${path}`, { headers });
    return { status: response.status, body: (await response.json()) as any };
  };
  return { server, get };
}

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

async function seed(db: PrismaClient) {
  const user = await db.user.create({ data: { username: "daily-overview" } });
  await db.userSettings.create({ data: { userId: user.id, currency: "SGD" } });
  const food = await db.category.create({ data: { userId: user.id, name: "Food", icon: "utensils" } });
  const bank = await db.financialAccount.create({ data: { userId: user.id, name: "DBS Multiplier", color: "#111111" } });
  const auto = await db.financialAccount.create({
    data: { userId: user.id, name: "Card ending 4591", autoCreated: true, autoCreatedFrom: "assistant entry (card 4591)" },
  });
  const row = (date: string, amountOut: number, extra: Record<string, unknown> = {}) =>
    db.transaction.create({
      data: {
        userId: user.id,
        date: day(date),
        description: `ROW ${date} ${amountOut}`,
        amountOut,
        categoryId: food.id,
        accountId: bank.id,
        entrySource: "statement",
        reconciled: true,
        ...extra,
      },
    });
  await row("2026-10-05", 40);
  await row("2026-10-20", 10);
  await row("2026-10-29", 500);
  await row("2026-11-02", 30);
  await row("2026-11-24", 20, {
    entrySource: "assistant",
    reconciled: false,
    reviewStatus: "to_review",
    reviewReasons: ["new_account"],
    accountId: auto.id,
    categoryId: null,
  });
  // Logged in an earlier month and never matched by a statement.
  await row("2026-09-12", 7, { entrySource: "manual", reconciled: false });
  return { user, bank, auto };
}

test("the daily dashboard, the running month in reports and the agent agree on month to date", () =>
  withChatDb(async (db) => {
    const { user, bank, auto } = await seed(db);
    await db.apiToken.create({
      data: { id: "mtdread01", userId: user.id, name: "mtd", secretHash: hashApiTokenSecret("mtdread01-secret"), scopes: ["analytics:read"] },
    });
    const { server, get } = await serve(db);
    try {
      const daily = await get(`/api/analytics/daily-overview?userId=${user.id}&today=2026-11-26`);
      assert.equal(daily.status, 200, JSON.stringify(daily.body));
      const mtd = daily.body.monthToDate;
      // Assistant entries make a user who hasn't chosen a daily tracker.
      assert.deepEqual(daily.body.workflow, { mode: "daily", chosen: false });
      assert.equal(mtd.spent, 50);
      assert.equal(mtd.weekSpent, 20);
      assert.equal(mtd.todaySpent, 0);
      assert.equal(mtd.previous.spentSameDay, 50);
      assert.equal(mtd.previous.spentTotal, 550);
      assert.equal(mtd.projected, 57.69);
      assert.equal(daily.body.recent[0].entrySource, "assistant");
      assert.equal(daily.body.recent[0].account.name, "Card ending 4591");
      assert.deepEqual(daily.body.attention.autoCreatedAccounts.map((item: any) => [item.id, item.transactionCount]), [[auto.id, 1]]);
      assert.equal(daily.body.attention.toReview, 1);
      assert.equal(daily.body.attention.uncategorizedCount, 1);
      assert.deepEqual(daily.body.attention.unreconciledPastMonths, { count: 1, months: [{ month: "2026-09", count: 1 }] });

      const agent = await get("/api/agent/analytics/month-to-date?today=2026-11-26", {
        Authorization: "Bearer pfa_mtdread01.mtdread01-secret",
      });
      assert.equal(agent.status, 200);
      assert.equal(agent.body.currency, "SGD");
      assert.deepEqual({ ...agent.body, currency: undefined }, { ...mtd, currency: undefined });
      assert.equal((await get("/api/agent/analytics/month-to-date?today=2026-13-01", {
        Authorization: "Bearer pfa_mtdread01.mtdread01-secret",
      })).status, 400);

      // The running month is analysed so far and compared with October to the same day.
      const report = await get(`/api/analytics/report?userId=${user.id}&today=2026-11-26&month=2026-11&groupBy=account`);
      assert.equal(report.status, 200, JSON.stringify(report.body));
      assert.equal(report.body.importedMonths[0], "2026-11");
      assert.equal(report.body.partial.elapsedDays, 26);
      assert.equal(report.body.summary.totalOut, 50);
      assert.equal(report.body.previousPeriod.sameDays, true);
      assert.equal(report.body.previousPeriod.summary.totalOut, 50);
      assert.deepEqual(report.body.breakdown.map((item: any) => [item.name, item.totalOut]), [
        ["DBS Multiplier", 30],
        ["Card ending 4591", 20],
      ]);
      const filtered = await get(`/api/analytics/report?userId=${user.id}&today=2026-11-26&month=2026-11&accountId=${bank.id}`);
      assert.equal(filtered.body.summary.totalOut, 30);

      // Daily trackers' analytics open on the running month.
      const insights = await get(`/api/analytics/insights?userId=${user.id}&today=2026-11-26`);
      assert.equal(insights.body.selectedMonth, "2026-11");
      assert.equal(insights.body.monthlySummary.previousTotalOut, 50);

      // The statement dashboard still leads with the last completed month.
      const statements = await get(`/api/analytics/dashboard-overview?userId=${user.id}&today=2026-11-26`);
      assert.equal(statements.body.selectedMonth, "2026-10");
      assert.equal(statements.body.latestStatementMonth, "2026-11");

      await db.userSettings.update({ where: { userId: user.id }, data: { workflowMode: "statements" } });
      const chosen = await get(`/api/analytics/daily-overview?userId=${user.id}&today=2026-11-26`);
      assert.deepEqual(chosen.body.workflow, { mode: "statements", chosen: true });
    } finally {
      server.close();
    }
  }));
