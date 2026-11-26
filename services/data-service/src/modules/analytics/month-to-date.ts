import {
  AnalyticsTransaction,
  buildCategoryBreakdown,
  formatDayKey,
  getEffectiveIn,
  getEffectiveOut,
  shiftMonthKey,
} from "./analytics.utils";

/**
 * The running month: what is spent so far, against last month at the same
 * day, and where it is heading. The dashboard, the analytics screens and the
 * agent endpoint (GET /api/agent/analytics/month-to-date) all use these
 * numbers, so the assistant and the apps agree.
 *
 * Transaction dates are calendar days stored as midnight UTC, so every key
 * here is a plain "YYYY-MM-DD" and "today" is the user's calendar date.
 */

/** The timezone "today" is taken in; Fortuna's users are in Singapore. */
export const DEFAULT_TIME_ZONE = process.env.FORTUNA_TIME_ZONE || "Asia/Singapore";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Today's calendar date in the timezone, as YYYY-MM-DD. */
export const todayKey = (now = new Date(), timeZone = DEFAULT_TIME_ZONE) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
};

/** A `today=YYYY-MM-DD` the client sent (its own calendar date), else today here. */
export const resolveToday = (value: unknown, now = new Date()) => {
  if (typeof value === "string" && DAY_PATTERN.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value) return value;
  }
  return todayKey(now);
};

export const daysInMonth = (monthKey: string) => {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};

export const dayDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** Adds days to a YYYY-MM-DD key. */
export const shiftDayKey = (day: string, offset: number) => {
  const date = dayDate(day);
  date.setUTCDate(date.getUTCDate() + offset);
  return formatDayKey(date);
};

/** Monday of the week containing the day. */
export const weekStartKey = (day: string) => {
  const weekday = dayDate(day).getUTCDay();
  return shiftDayKey(day, -((weekday + 6) % 7));
};

/** The same day of the month in another month, clamped to that month's length (31 Mar → 28 Feb). */
export const sameDayIn = (monthKey: string, dayOfMonth: number) =>
  `${monthKey}-${String(Math.min(dayOfMonth, daysInMonth(monthKey))).padStart(2, "0")}`;

const round = (value: number) => Number(value.toFixed(2));

const sumOut = (transactions: AnalyticsTransaction[]) =>
  round(transactions.reduce((sum, tx) => sum + getEffectiveOut(tx), 0));

const sumIn = (transactions: AnalyticsTransaction[]) =>
  round(transactions.reduce((sum, tx) => sum + getEffectiveIn(tx), 0));

const between = (transactions: AnalyticsTransaction[], from: string, to: string) =>
  transactions.filter((tx) => {
    const day = formatDayKey(tx.date);
    return day >= from && day <= to;
  });

/**
 * Month-end projection at the pace so far: spending per elapsed day times the
 * days in the month. Null until a day has passed with spending.
 */
export const projectMonthEnd = (spentSoFar: number, dayOfMonth: number, totalDays: number) =>
  dayOfMonth > 0 && spentSoFar > 0 ? round((spentSoFar / dayOfMonth) * totalDays) : null;

/**
 * How far a period that contains today has run, and its totals scaled to the
 * whole period. Null for periods entirely in the past or the future.
 */
export const partialPeriod = (
  start: string,
  end: string,
  today: string,
  totals: { totalIn: number; totalOut: number },
) => {
  if (today < start || today > end) return null;
  const length = (from: string, to: string) => Math.round((dayDate(to).getTime() - dayDate(from).getTime()) / 86400000) + 1;
  const elapsedDays = length(start, today);
  const totalDays = length(start, end);
  return {
    asOf: today,
    elapsedDays,
    totalDays,
    projected: {
      totalOut: projectMonthEnd(totals.totalOut, elapsedDays, totalDays),
      totalIn: totals.totalIn > 0 ? round((totals.totalIn / elapsedDays) * totalDays) : null,
    },
  };
};

/**
 * Month-to-date numbers from the transactions of this month and last month
 * (already filtered to what analytics counts).
 */
export const buildMonthToDate = (transactions: AnalyticsTransaction[], today: string) => {
  const month = today.slice(0, 7);
  const previousMonth = shiftMonthKey(month, -1);
  const dayOfMonth = Number(today.slice(8, 10));
  const totalDays = daysInMonth(month);
  const previousSameDay = sameDayIn(previousMonth, dayOfMonth);
  const previousEnd = `${previousMonth}-${String(daysInMonth(previousMonth)).padStart(2, "0")}`;
  const weekStart = weekStartKey(today);

  const soFar = between(transactions, `${month}-01`, today);
  const previousSoFar = between(transactions, `${previousMonth}-01`, previousSameDay);
  const previousWhole = between(transactions, `${previousMonth}-01`, previousEnd);
  const spent = sumOut(soFar);
  const previousSpentSameDay = sumOut(previousSoFar);

  const previousCategories = new Map(buildCategoryBreakdown(previousSoFar).map((item) => [item.key, item]));
  const previousWholeCategories = new Map(buildCategoryBreakdown(previousWhole).map((item) => [item.key, item]));
  const iconOf = new Map(
    transactions.map((tx) => [tx.categoryId || "uncategorized", tx.category?.icon ?? null] as const),
  );
  const categories = buildCategoryBreakdown(soFar)
    .filter((item) => item.totalOut > 0)
    .map((item) => ({
      key: item.key,
      name: item.name,
      color: item.color,
      icon: iconOf.get(item.key) ?? null,
      spent: round(item.totalOut),
      transactionCount: item.transactionCount,
      previousSameDay: round(previousCategories.get(item.key)?.totalOut || 0),
      previousTotal: round(previousWholeCategories.get(item.key)?.totalOut || 0),
    }));

  return {
    month,
    today,
    dayOfMonth,
    daysInMonth: totalDays,
    spent,
    income: sumIn(soFar),
    transactionCount: soFar.length,
    todaySpent: sumOut(between(transactions, today, today)),
    weekStart,
    weekSpent: sumOut(between(transactions, weekStart, today)),
    previous: {
      month: previousMonth,
      sameDay: previousSameDay,
      spentSameDay: previousSpentSameDay,
      spentTotal: sumOut(previousWhole),
      hasData: previousWhole.length > 0,
    },
    change: round(spent - previousSpentSameDay),
    projected: projectMonthEnd(spent, dayOfMonth, totalDays),
    categories,
  };
};

export type MonthToDate = ReturnType<typeof buildMonthToDate>;

/** First day buildMonthToDate needs: the 1st of last month (a week never starts earlier). */
export const monthToDateFrom = (today: string) => `${shiftMonthKey(today.slice(0, 7), -1)}-01`;
