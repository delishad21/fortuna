import { Router, Request, Response } from "express";
import prisma from "../../lib/prisma";
import {
  AnalyticsTransaction,
  buildDailySeries as buildAnalyticsDailySeries,
  buildMonthSeries,
  formatDayKey as formatAnalyticsDayKey,
  formatMonthKey,
  getCategoryInfo,
  getCategoryKey,
  getEffectiveOut as getAnalyticsEffectiveOut,
  getMonthRange,
  isImportedMonth,
  normalizeMerchant,
  serializeTransaction,
  summarizeTransactions,
  toNumber as toAnalyticsNumber,
} from "./analytics.utils";

export const analyticsRouter = Router();

const toNumber = (value: any) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
};

const getReimbursedAmount = (linkage: any) => {
  if (!linkage || typeof linkage !== "object") return 0;
  const allocations = Array.isArray(linkage.reimbursedByAllocations)
    ? linkage.reimbursedByAllocations
    : [];
  return allocations.reduce(
    (sum: number, item: any) => sum + Math.max(toNumber(item?.amount), 0),
    0,
  );
};

const getEffectiveOut = (tx: { amountOut: any; linkage?: any }) => {
  const rawOut = Math.max(toNumber(tx.amountOut), 0);
  const reimbursed = getReimbursedAmount(tx.linkage);
  return Number(Math.max(rawOut - reimbursed, 0).toFixed(2));
};

const formatDayKey = (date: Date) => date.toISOString().slice(0, 10);

const buildDailySeries = (start: Date, end: Date) => {
  const days: string[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const endDate = new Date(end);
  endDate.setHours(0, 0, 0, 0);
  while (cursor <= endDate) {
    days.push(formatDayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
};

const getImportedMonthGroups = (transactions: AnalyticsTransaction[]) => {
  const groups = new Map<string, AnalyticsTransaction[]>();
  for (const tx of transactions) {
    const month = formatMonthKey(tx.date);
    const current = groups.get(month) || [];
    current.push(tx);
    groups.set(month, current);
  }

  return Array.from(groups.entries())
    .filter(([, monthTransactions]) => isImportedMonth(monthTransactions))
    .sort(([a], [b]) => b.localeCompare(a));
};

const buildCategoryBreakdown = (transactions: AnalyticsTransaction[]) => {
  const map = new Map<
    string,
    { key: string; name: string; color: string; totalIn: number; totalOut: number; transactionCount: number }
  >();

  for (const tx of transactions) {
    const key = getCategoryKey(tx);
    const category = getCategoryInfo(tx);
    const current = map.get(key) || {
      key,
      name: category.name,
      color: category.color,
      totalIn: 0,
      totalOut: 0,
      transactionCount: 0,
    };
    current.totalIn += toAnalyticsNumber(tx.amountIn);
    current.totalOut += getAnalyticsEffectiveOut(tx);
    current.transactionCount += 1;
    map.set(key, current);
  }

  return Array.from(map.values()).sort((a, b) => b.totalOut - a.totalOut);
};

const buildMerchantBreakdown = (transactions: AnalyticsTransaction[]) => {
  const map = new Map<
    string,
    { key: string; name: string; totalIn: number; totalOut: number; transactionCount: number }
  >();

  for (const tx of transactions) {
    const merchant = normalizeMerchant(tx);
    const current = map.get(merchant.key) || {
      key: merchant.key,
      name: merchant.name,
      totalIn: 0,
      totalOut: 0,
      transactionCount: 0,
    };
    current.totalIn += toAnalyticsNumber(tx.amountIn);
    current.totalOut += getAnalyticsEffectiveOut(tx);
    current.transactionCount += 1;
    map.set(merchant.key, current);
  }

  return Array.from(map.values()).sort((a, b) => b.totalOut - a.totalOut);
};

const getRangeForQuery = (range: string, month: string) => {
  const selected = getMonthRange(month);
  if (range === "last3") {
    const start = new Date(selected.start);
    start.setMonth(start.getMonth() - 2);
    return { start, end: selected.end };
  }
  if (range === "ytd") {
    return { start: new Date(selected.start.getFullYear(), 0, 1), end: selected.end };
  }
  if (range === "last12") {
    const start = new Date(selected.start);
    start.setMonth(start.getMonth() - 11);
    return { start, end: selected.end };
  }
  return selected;
};

const findLatestImportedMonth = async (userId: string) => {
  const allTransactions = await prisma.transaction.findMany({
    where: { userId },
    include: { category: true },
    orderBy: { date: "desc" },
  });
  const importedMonthGroups = getImportedMonthGroups(allTransactions);
  return {
    allTransactions,
    importedMonthGroups,
    latestMonth: importedMonthGroups[0]?.[0] || null,
  };
};

/**
 * GET /api/analytics/dashboard
 * Summary analytics for dashboard
 */
analyticsRouter.get("/dashboard", async (req: Request, res: Response) => {
  try {
    const { userId, timeframe } = req.query;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const timeframeDays = Math.max(Number(timeframe || 30), 1);
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (timeframeDays - 1));
    startDate.setHours(0, 0, 0, 0);

    const [transactions] = await Promise.all([
      prisma.transaction.findMany({
        where: {
          userId: userId as string,
          date: { gte: startDate, lte: endDate },
        },
        include: { category: true },
        orderBy: { date: "asc" },
      }),
    ]);

    const totals = transactions.reduce(
      (acc, tx) => ({
        totalIn: acc.totalIn + toNumber(tx.amountIn),
        totalOut: acc.totalOut + getEffectiveOut(tx),
      }),
      { totalIn: 0, totalOut: 0 },
    );

    const days = buildDailySeries(startDate, endDate);
    const seriesMap = new Map(
      days.map((day) => [day, { date: day, in: 0, out: 0 }]),
    );

    const categoryMap = new Map<
      string,
      { category: any; totalOut: number }
    >();

    transactions.forEach((tx) => {
      const dayKey = formatDayKey(tx.date);
      const entry = seriesMap.get(dayKey);
      if (entry) {
        entry.in += toNumber(tx.amountIn);
        entry.out += getEffectiveOut(tx);
      }

      const categoryId = tx.categoryId || "uncategorized";
      const category =
        tx.category ||
        (tx.categoryId
          ? null
          : { id: "uncategorized", name: "Uncategorized", color: "#9ca3af" });
      const current = categoryMap.get(categoryId) || {
        category,
        totalOut: 0,
      };
      current.totalOut += getEffectiveOut(tx);
      categoryMap.set(categoryId, current);
    });

    const categoryBreakdown = Array.from(categoryMap.values()).sort(
      (a, b) => b.totalOut - a.totalOut,
    );

    const recentTransactions = await prisma.transaction.findMany({
      where: { userId: userId as string },
      include: { category: true },
      orderBy: { date: "desc" },
      take: 6,
    });

    res.json({
      timeframeDays,
      totals: {
        ...totals,
        net: totals.totalIn - totals.totalOut,
      },
      series: Array.from(seriesMap.values()),
      categoryBreakdown,
      recentTransactions,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/dashboard-overview
 * Imported-month dashboard summary for the home overview tab
 */
analyticsRouter.get("/dashboard-overview", async (req: Request, res: Response) => {
  try {
    const { userId, month } = req.query;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const { allTransactions, importedMonthGroups, latestMonth } =
      await findLatestImportedMonth(userId as string);
    const selectedMonth = (month as string | undefined) || latestMonth;
    const selectedTransactions = selectedMonth
      ? importedMonthGroups.find(([monthKey]) => monthKey === selectedMonth)?.[1] || []
      : [];

    const categoryBreakdown = buildCategoryBreakdown(selectedTransactions);
    const largestTransaction = [...selectedTransactions]
      .sort((a, b) => getAnalyticsEffectiveOut(b) - getAnalyticsEffectiveOut(a))[0];

    const monthsAscending = [...importedMonthGroups].reverse();
    const trend = monthsAscending.slice(-6).map(([monthKey, monthTransactions]) => ({
      month: monthKey,
      ...summarizeTransactions(monthTransactions),
    }));

    const previousMonth = selectedMonth
      ? monthsAscending[monthsAscending.findIndex(([monthKey]) => monthKey === selectedMonth) - 1]
      : undefined;
    const currentSummary = summarizeTransactions(selectedTransactions);
    const previousSummary = previousMonth ? summarizeTransactions(previousMonth[1]) : null;

    const recentTransactions = await prisma.transaction.findMany({
      where: { userId: userId as string },
      include: { category: true },
      orderBy: { date: "desc" },
      take: 8,
    });

    res.json({
      selectedMonth,
      importedMonths: importedMonthGroups.map(([monthKey, monthTransactions]) => ({
        month: monthKey,
        transactionCount: monthTransactions.length,
      })),
      summary: {
        ...currentSummary,
        topCategory: categoryBreakdown[0] || null,
        largestTransaction: largestTransaction ? serializeTransaction(largestTransaction) : null,
        previousMonth: previousMonth
          ? {
              month: previousMonth[0],
              totalOut: previousSummary?.totalOut || 0,
              spendingDelta: currentSummary.totalOut - (previousSummary?.totalOut || 0),
            }
          : null,
      },
      trend,
      recentTransactions: recentTransactions.map(serializeTransaction),
      hasTransactions: allTransactions.length > 0,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/dashboard-review
 * Cleanup and data-health summary for the home review tab
 */
analyticsRouter.get("/dashboard-review", async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const transactions = await prisma.transaction.findMany({
      where: { userId: userId as string },
      include: { category: true, importBatch: true },
      orderBy: { date: "desc" },
    });
    const importedMonthGroups = getImportedMonthGroups(transactions);
    const categoryBreakdown = buildCategoryBreakdown(transactions);
    const merchantBreakdown = buildMerchantBreakdown(transactions);

    const uncategorized = transactions
      .filter((tx) => !tx.categoryId)
      .slice(0, 8)
      .map(serializeTransaction);
    const averageOut = transactions.length
      ? transactions.reduce((sum, tx) => sum + getAnalyticsEffectiveOut(tx), 0) / transactions.length
      : 0;
    const largeTransactions = transactions
      .filter((tx) => getAnalyticsEffectiveOut(tx) > Math.max(averageOut * 3, 250))
      .slice(0, 8)
      .map(serializeTransaction);

    const firstSeen = new Map<string, Date>();
    [...transactions].reverse().forEach((tx) => {
      const merchant = normalizeMerchant(tx);
      if (!firstSeen.has(merchant.key)) firstSeen.set(merchant.key, tx.date);
    });
    const latestMonth = importedMonthGroups[0]?.[0] || null;
    const newMerchants = latestMonth
      ? transactions
          .filter((tx) => formatMonthKey(tx.date) === latestMonth)
          .map((tx) => normalizeMerchant(tx))
          .filter((merchant, index, arr) =>
            arr.findIndex((item) => item.key === merchant.key) === index &&
            firstSeen.get(merchant.key) &&
            formatMonthKey(firstSeen.get(merchant.key) as Date) === latestMonth,
          )
          .slice(0, 8)
      : [];

    const importSummaries = importedMonthGroups.slice(0, 6).map(([monthKey, monthTransactions]) => {
      const monthCategories = buildCategoryBreakdown(monthTransactions);
      return {
        month: monthKey,
        latestTransactionDate: monthTransactions.reduce(
          (latest, tx) => (tx.date > latest ? tx.date : latest),
          monthTransactions[0]?.date || new Date(),
        ),
        ...summarizeTransactions(monthTransactions),
        topCategory: monthCategories[0] || null,
      };
    });

    const ruleCount = await prisma.importRule.count({ where: { userId: userId as string } });
    const categorizedCount = transactions.filter((tx) => tx.categoryId).length;

    res.json({
      reviewQueue: {
        uncategorized,
        newMerchants,
        largeTransactions,
      },
      importSummaries,
      dataHealth: {
        transactionCount: transactions.length,
        categorizedCount,
        uncategorizedCount: transactions.length - categorizedCount,
        categorizedPercent: transactions.length ? Math.round((categorizedCount / transactions.length) * 100) : 0,
        ruleCount,
        merchantCount: merchantBreakdown.length,
        categoryCount: categoryBreakdown.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/report
 * Configurable reporting data for the analytics reports tab
 */
analyticsRouter.get("/report", async (req: Request, res: Response) => {
  try {
    const {
      userId,
      month,
      range = "month",
      metric = "inOut",
      groupBy = "month",
      categoryId,
      merchantKey,
    } = req.query;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const { latestMonth, importedMonthGroups } = await findLatestImportedMonth(userId as string);
    const selectedMonth = (month as string | undefined) || latestMonth || formatMonthKey(new Date());
    const { start, end } = getRangeForQuery(range as string, selectedMonth);

    const baseTransactions = await prisma.transaction.findMany({
      where: {
        userId: userId as string,
        date: { gte: start, lte: end },
      },
      include: { category: true },
      orderBy: { date: "asc" },
    });

    let transactions = await prisma.transaction.findMany({
      where: {
        userId: userId as string,
        date: { gte: start, lte: end },
        ...(categoryId
          ? categoryId === "uncategorized"
            ? { categoryId: null }
            : { categoryId: categoryId as string }
          : {}),
      },
      include: { category: true },
      orderBy: { date: "asc" },
    });

    if (merchantKey) {
      transactions = transactions.filter((tx) => normalizeMerchant(tx).key === merchantKey);
    }

    const summary = summarizeTransactions(transactions);
    const monthSeries = buildMonthSeries(start, end).map((monthKey) => ({
      key: monthKey,
      label: monthKey,
      totalIn: 0,
      totalOut: 0,
      net: 0,
      transactionCount: 0,
    }));
    const daySeries = buildAnalyticsDailySeries(start, end).map((day) => ({
      key: day,
      label: day,
      totalIn: 0,
      totalOut: 0,
      net: 0,
      transactionCount: 0,
    }));
    const timeSeries = groupBy === "day" ? daySeries : monthSeries;
    const timeSeriesMap = new Map(timeSeries.map((item) => [item.key, item]));

    for (const tx of transactions) {
      const key = groupBy === "day" ? formatAnalyticsDayKey(tx.date) : formatMonthKey(tx.date);
      const item = timeSeriesMap.get(key);
      if (!item) continue;
      item.totalIn += toAnalyticsNumber(tx.amountIn);
      item.totalOut += getAnalyticsEffectiveOut(tx);
      item.net = item.totalIn - item.totalOut;
      item.transactionCount += 1;
    }

    const categoryBreakdown = buildCategoryBreakdown(transactions);
    const merchantBreakdown = buildMerchantBreakdown(transactions);
    const availableCategories = buildCategoryBreakdown(baseTransactions);
    const availableMerchants = buildMerchantBreakdown(baseTransactions);
    const breakdown = groupBy === "merchant" ? merchantBreakdown : categoryBreakdown;
    const getMetricValue = (item: { totalIn: number; totalOut: number }) => {
      if (metric === "income") return item.totalIn;
      if (metric === "net") return item.totalIn - item.totalOut;
      return item.totalOut;
    };
    const totalForPercent = breakdown.reduce(
      (sum, item) => sum + Math.abs(getMetricValue(item)),
      0,
    );

    res.json({
      selectedMonth,
      importedMonths: importedMonthGroups.map(([monthKey]) => monthKey),
      controls: { range, metric, groupBy, categoryId: categoryId || null, merchantKey: merchantKey || null },
      period: { start, end },
      summary,
      chartSeries: groupBy === "category" || groupBy === "merchant"
        ? breakdown.map((item: any) => ({
            key: item.key,
            label: item.name,
            totalIn: item.totalIn,
            totalOut: item.totalOut,
            net: item.totalIn - item.totalOut,
            metricValue: getMetricValue(item),
            transactionCount: item.transactionCount,
            color: item.color || "#5750F1",
          }))
        : timeSeries,
      breakdown: breakdown.map((item: any) => ({
        ...item,
        metricValue: getMetricValue(item),
        percentOfTotal: totalForPercent ? Math.round((Math.abs(getMetricValue(item)) / totalForPercent) * 1000) / 10 : 0,
      })),
      transactions: [...transactions].reverse().map(serializeTransaction),
      categories: availableCategories.map((item) => ({ id: item.key, name: item.name, color: item.color })),
      merchants: availableMerchants.map((item) => ({ key: item.key, name: item.name })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/insights
 * Opinionated insights for imported statement data
 */
analyticsRouter.get("/insights", async (req: Request, res: Response) => {
  try {
    const { userId, month } = req.query;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const { allTransactions, importedMonthGroups, latestMonth } =
      await findLatestImportedMonth(userId as string);
    const selectedMonth = (month as string | undefined) || latestMonth;
    const selectedTransactions = selectedMonth
      ? importedMonthGroups.find(([monthKey]) => monthKey === selectedMonth)?.[1] || []
      : [];
    const monthsAscending = [...importedMonthGroups].reverse();
    const selectedIndex = monthsAscending.findIndex(([monthKey]) => monthKey === selectedMonth);
    const previousMonth = selectedIndex > 0 ? monthsAscending[selectedIndex - 1] : null;
    const priorThree = selectedIndex > 0 ? monthsAscending.slice(Math.max(0, selectedIndex - 3), selectedIndex) : [];
    const currentSummary = summarizeTransactions(selectedTransactions);
    const previousSummary = previousMonth ? summarizeTransactions(previousMonth[1]) : null;
    const threeMonthAverage = priorThree.length
      ? priorThree.reduce((sum, [, monthTransactions]) => sum + summarizeTransactions(monthTransactions).totalOut, 0) / priorThree.length
      : null;

    const currentCategories = buildCategoryBreakdown(selectedTransactions);
    const previousCategories = previousMonth ? buildCategoryBreakdown(previousMonth[1]) : [];
    const previousCategoryMap = new Map(previousCategories.map((item) => [item.key, item]));
    const categoryChanges = currentCategories
      .map((item) => {
        const previous = previousCategoryMap.get(item.key);
        const delta = item.totalOut - (previous?.totalOut || 0);
        return {
          ...item,
          previousTotalOut: previous?.totalOut || 0,
          delta,
          percentDelta: previous?.totalOut ? Math.round((delta / previous.totalOut) * 1000) / 10 : null,
        };
      })
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 8);

    const merchantByMonth = new Map<string, Map<string, { name: string; months: Set<string>; totalOut: number; amounts: number[] }>>();
    for (const [monthKey, monthTransactions] of importedMonthGroups) {
      for (const tx of monthTransactions) {
        const amountOut = getAnalyticsEffectiveOut(tx);
        if (amountOut <= 0) continue;
        const merchant = normalizeMerchant(tx);
        const monthMap = merchantByMonth.get(merchant.key) || new Map();
        const current = monthMap.get(monthKey) || { name: merchant.name, months: new Set<string>(), totalOut: 0, amounts: [] };
        current.months.add(monthKey);
        current.totalOut += amountOut;
        current.amounts.push(amountOut);
        monthMap.set(monthKey, current);
        merchantByMonth.set(merchant.key, monthMap);
      }
    }

    const recurringMerchants = Array.from(merchantByMonth.entries())
      .map(([key, monthMap]) => {
        const entries = Array.from(monthMap.values());
        const monthsSeen = entries.length;
        const amounts = entries.flatMap((entry) => entry.amounts);
        const averageAmount = amounts.reduce((sum, amount) => sum + amount, 0) / Math.max(amounts.length, 1);
        const minAmount = Math.min(...amounts);
        const maxAmount = Math.max(...amounts);
        return {
          key,
          name: entries[0]?.name || key,
          monthsSeen,
          totalOut: entries.reduce((sum, entry) => sum + entry.totalOut, 0),
          averageAmount,
          frequency: monthsSeen >= 3 ? "monthly" : monthsSeen === 2 ? "recurring" : "one-off",
          stability: maxAmount - minAmount <= Math.max(5, averageAmount * 0.1) ? "fixed" : "variable",
        };
      })
      .filter((item) => item.monthsSeen >= 2)
      .sort((a, b) => b.totalOut - a.totalOut)
      .slice(0, 8);

    const merchantBreakdown = buildMerchantBreakdown(selectedTransactions);
    const previousMerchantKeys = new Set(previousMonth ? buildMerchantBreakdown(previousMonth[1]).map((item) => item.key) : []);
    const newMerchants = merchantBreakdown.filter((item) => !previousMerchantKeys.has(item.key)).slice(0, 8);
    const averageSelectedOut = selectedTransactions.length
      ? selectedTransactions.reduce((sum, tx) => sum + getAnalyticsEffectiveOut(tx), 0) / selectedTransactions.length
      : 0;
    const anomalies = selectedTransactions
      .filter((tx) => getAnalyticsEffectiveOut(tx) > Math.max(averageSelectedOut * 3, 250))
      .sort((a, b) => getAnalyticsEffectiveOut(b) - getAnalyticsEffectiveOut(a))
      .slice(0, 8)
      .map(serializeTransaction);

    res.json({
      selectedMonth,
      importedMonths: importedMonthGroups.map(([monthKey]) => monthKey),
      monthlySummary: {
        ...currentSummary,
        previousMonth: previousMonth ? previousMonth[0] : null,
        previousTotalOut: previousSummary?.totalOut || null,
        spendingDelta: previousSummary ? currentSummary.totalOut - previousSummary.totalOut : null,
        threeMonthAverage,
        threeMonthDelta: threeMonthAverage !== null ? currentSummary.totalOut - threeMonthAverage : null,
        mainDrivers: categoryChanges.slice(0, 3),
      },
      recurringMerchants,
      merchantInsights: {
        topMerchants: merchantBreakdown.slice(0, 8),
        newMerchants,
      },
      categoryChanges,
      anomalies,
      hasTransactions: allTransactions.length > 0,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/monthly
 * Detailed analytics for selected month
 */
analyticsRouter.get("/monthly", async (req: Request, res: Response) => {
  try {
    const { userId, year, month } = req.query;
    if (!userId || !year || !month) {
      return res
        .status(400)
        .json({ error: "userId, year, and month are required" });
    }

    const yearNum = parseInt(year as string, 10);
    const monthNum = parseInt(month as string, 10);
    const startDate = new Date(yearNum, monthNum - 1, 1);
    const endDate = new Date(yearNum, monthNum, 0);
    endDate.setHours(23, 59, 59, 999);

    const transactions = await prisma.transaction.findMany({
      where: {
        userId: userId as string,
        date: { gte: startDate, lte: endDate },
      },
      include: { category: true },
      orderBy: { date: "asc" },
    });

    const totals = transactions.reduce(
      (acc, tx) => ({
        totalIn: acc.totalIn + toNumber(tx.amountIn),
        totalOut: acc.totalOut + getEffectiveOut(tx),
      }),
      { totalIn: 0, totalOut: 0 },
    );

    const days = buildDailySeries(startDate, endDate);
    const seriesMap = new Map(
      days.map((day) => [day, { date: day, in: 0, out: 0 }]),
    );

    const categoryMap = new Map<
      string,
      { category: any; totalIn: number; totalOut: number }
    >();

    transactions.forEach((tx) => {
      const dayKey = formatDayKey(tx.date);
      const entry = seriesMap.get(dayKey);
      if (entry) {
        entry.in += toNumber(tx.amountIn);
        entry.out += getEffectiveOut(tx);
      }

      const categoryId = tx.categoryId || "uncategorized";
      const category =
        tx.category ||
        (tx.categoryId
          ? null
          : { id: "uncategorized", name: "Uncategorized", color: "#9ca3af" });
      const current = categoryMap.get(categoryId) || {
        category,
        totalIn: 0,
        totalOut: 0,
      };
      current.totalIn += toNumber(tx.amountIn);
      current.totalOut += getEffectiveOut(tx);
      categoryMap.set(categoryId, current);
    });

    const categoryBreakdown = Array.from(categoryMap.values()).sort(
      (a, b) => b.totalOut - a.totalOut,
    );

    const trendMonths = 6;
    const trendStart = new Date(yearNum, monthNum - trendMonths, 1);
    const trendEnd = new Date(yearNum, monthNum, 0);
    trendEnd.setHours(23, 59, 59, 999);

    const trendTransactions = await prisma.transaction.findMany({
      where: {
        userId: userId as string,
        date: { gte: trendStart, lte: trendEnd },
      },
      orderBy: { date: "asc" },
    });

    const trendSeries: Array<{ month: string; totalOut: number }> = [];
    for (let i = trendMonths - 1; i >= 0; i--) {
      const monthStart = new Date(yearNum, monthNum - 1 - i, 1);
      const monthEnd = new Date(yearNum, monthNum - i, 0);
      monthEnd.setHours(23, 59, 59, 999);

      const monthTx = trendTransactions.filter(
        (tx) => tx.date >= monthStart && tx.date <= monthEnd,
      );
      const totalOut = monthTx.reduce(
        (acc, tx) => acc + getEffectiveOut(tx),
        0,
      );
      trendSeries.push({
        month: `${monthStart.getFullYear()}-${String(
          monthStart.getMonth() + 1,
        ).padStart(2, "0")}`,
        totalOut,
      });
    }

    res.json({
      period: { year: yearNum, month: monthNum },
      totals: { ...totals, net: totals.totalIn - totals.totalOut },
      dailySeries: Array.from(seriesMap.values()),
      categoryBreakdown,
      trendSeries,
      transactions: transactions.map((tx) => ({
        id: tx.id,
        date: tx.date,
        description: tx.description,
        label: tx.label,
        amountIn: toNumber(tx.amountIn),
        amountOut: getEffectiveOut(tx),
        category: tx.category
          ? { id: tx.category.id, name: tx.category.name, color: tx.category.color }
          : null,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/monthly-summary
 * Get monthly spending summary
 */
analyticsRouter.get("/monthly-summary", async (req: Request, res: Response) => {
  try {
    const { userId, year, month } = req.query;

    if (!userId || !year || !month) {
      return res
        .status(400)
        .json({ error: "userId, year, and month are required" });
    }

    const startDate = new Date(
      parseInt(year as string),
      parseInt(month as string) - 1,
      1,
    );
    const endDate = new Date(
      parseInt(year as string),
      parseInt(month as string),
      0,
    );

    // Get category breakdown
    const categoryBreakdown = await prisma.transaction.groupBy({
      by: ["categoryId"],
      where: {
        userId: userId as string,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      _sum: {
        amountIn: true,
        amountOut: true,
      },
    });

    // Get category details
    const categoryIds = categoryBreakdown
      .map((c: any) => c.categoryId)
      .filter((id: any): id is string => id !== null);

    const categories = await prisma.category.findMany({
      where: {
        id: { in: categoryIds },
      },
    });

    const categoryMap = new Map(categories.map((c: any) => [c.id, c]));

    // Format response
    const breakdown = categoryBreakdown.map((item: any) => ({
      category: item.categoryId ? categoryMap.get(item.categoryId) : null,
      totalIn: item._sum.amountIn?.toNumber() || 0,
      totalOut: item._sum.amountOut?.toNumber() || 0,
    }));

    // Replace raw totalOut with reimbursement-adjusted totalOut.
    // Prisma groupBy can't derive JSON-based linkage allocations in SQL directly.
    const monthlyTransactions = await prisma.transaction.findMany({
      where: {
        userId: userId as string,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        categoryId: true,
        amountOut: true,
        amountIn: true,
        linkage: true,
      },
    });

    const adjustedByCategory = new Map<string | null, { totalIn: number; totalOut: number }>();
    for (const tx of monthlyTransactions) {
      const key = tx.categoryId ?? null;
      const current = adjustedByCategory.get(key) || { totalIn: 0, totalOut: 0 };
      current.totalIn += toNumber(tx.amountIn);
      current.totalOut += getEffectiveOut(tx);
      adjustedByCategory.set(key, current);
    }

    for (const item of breakdown) {
      const key = item.category?.id ?? null;
      const adjusted = adjustedByCategory.get(key) || { totalIn: 0, totalOut: 0 };
      item.totalIn = adjusted.totalIn;
      item.totalOut = adjusted.totalOut;
    }

    // Calculate totals
    const totals = breakdown.reduce(
      (acc: any, item: any) => ({
        totalIn: acc.totalIn + item.totalIn,
        totalOut: acc.totalOut + item.totalOut,
      }),
      { totalIn: 0, totalOut: 0 },
    );

    res.json({
      period: {
        year: parseInt(year as string),
        month: parseInt(month as string),
      },
      totals,
      breakdown,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/category-spending
 * Get spending by category over time
 */
analyticsRouter.get(
  "/category-spending",
  async (req: Request, res: Response) => {
    try {
      const { userId, dateFrom, dateTo, categoryId } = req.query;

      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      const where: any = {
        userId: userId as string,
      };

      if (dateFrom && dateTo) {
        where.date = {
          gte: new Date(dateFrom as string),
          lte: new Date(dateTo as string),
        };
      }

      if (categoryId) {
        where.categoryId = categoryId;
      }

      const transactions = await prisma.transaction.findMany({
        where,
        include: {
          category: true,
        },
        orderBy: {
          date: "asc",
        },
      });

      res.json({
        transactions: transactions.map((tx) => ({
          ...tx,
          amountOut: getEffectiveOut(tx),
          rawAmountOut: toNumber(tx.amountOut),
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);
