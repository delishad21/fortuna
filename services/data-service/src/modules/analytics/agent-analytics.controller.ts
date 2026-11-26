import { Router } from "express";
import prisma from "../../lib/prisma";
import { authenticatedUserId, requireApiToken } from "../auth/auth.middleware";
import { asOwnSpending, buildReimbursableSummary } from "./analytics.utils";
import { buildSpendingRows, matchesCategory, parseSpendingQuery } from "./spending";
import { resolveToday } from "./month-to-date";
import { loadMonthToDate, reimbursementPeopleNames } from "./month-to-date.service";

/** Read-only analytics for API tokens with the analytics:read scope. */
export const agentAnalyticsRouter = Router();

agentAnalyticsRouter.get("/spending", requireApiToken(["analytics:read"]), async (request, response) => {
  const parsed = parseSpendingQuery(request.query as Record<string, unknown>);
  if (!parsed.ok) return response.status(400).json({ error: parsed.error });
  const query = parsed.value;

  try {
    const userId = authenticatedUserId(request);
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { currency: true, analyticsExcludedCategoryIds: true, analyticsCountReimbursable: true },
    });
    // One currency per answer, like the chat's summaries: rows in other
    // currencies are left out rather than added together.
    const currency = settings?.currency || "SGD";
    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        currency,
        date: { gte: new Date(`${query.from}T00:00:00`), lte: new Date(`${query.to}T23:59:59.999`) },
      },
      select: {
        id: true,
        date: true,
        description: true,
        label: true,
        amountOut: true,
        linkage: true,
        categoryId: true,
        category: { select: { id: true, name: true, color: true } },
        accountId: true,
        account: { select: { id: true, name: true, color: true } },
        reimbursablePersonId: true,
        reimbursableAmount: true,
      },
    });

    // Same exclusions as the app's analytics, and reimbursable spending apart
    // from the user's own unless they count it (Settings → Analytics).
    const countsAsOwn = settings?.analyticsCountReimbursable ?? false;
    const excluded = new Set(
      Array.isArray(settings?.analyticsExcludedCategoryIds)
        ? settings.analyticsExcludedCategoryIds.filter((id): id is string => typeof id === "string")
        : [],
    );
    const kept = asOwnSpending(
      transactions.filter(
        (tx) =>
          (!tx.categoryId || !excluded.has(tx.categoryId)) &&
          (!query.category || matchesCategory(tx, query.category)),
      ),
      countsAsOwn,
    );

    response.setHeader("Cache-Control", "no-store");
    return response.json({
      currency,
      rows: buildSpendingRows(kept, query),
      /** Spent for people who pay it back in this period (left out of rows unless countsAsOwn). */
      reimbursable: buildReimbursableSummary(kept, await reimbursementPeopleNames(userId), countsAsOwn),
    });
  } catch (error) {
    console.error("Failed to build spending analytics:", error);
    return response.status(500).json({ error: "Failed to build spending analytics" });
  }
});

/**
 * The month so far, as the dashboard shows it: spent and received to today,
 * today and this week (from Monday), last month to the same day and in
 * total, the month-end projection at this pace, and spending per category.
 * `today=YYYY-MM-DD` sets the calendar date (defaults to today in Singapore).
 */
agentAnalyticsRouter.get("/month-to-date", requireApiToken(["analytics:read"]), async (request, response) => {
  const raw = request.query.today;
  if (raw !== undefined && resolveToday(raw) !== raw) {
    return response.status(400).json({ error: "today must be a date as YYYY-MM-DD" });
  }
  try {
    const userId = authenticatedUserId(request);
    response.setHeader("Cache-Control", "no-store");
    return response.json(await loadMonthToDate(userId, resolveToday(raw)));
  } catch (error) {
    console.error("Failed to build month-to-date analytics:", error);
    return response.status(500).json({ error: "Failed to build month-to-date analytics" });
  }
});
