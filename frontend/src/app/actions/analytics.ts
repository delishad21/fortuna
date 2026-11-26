"use server";

import { auth } from "@/lib/actionAuth";

const DATA_SERVICE_URL =
  process.env.DATA_SERVICE_URL || "http://localhost:4001";

async function fetchAnalytics(path: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(
    `${DATA_SERVICE_URL}${path}${separator}userId=${session.user.id}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to fetch analytics");
  }

  return response.json();
}

const queryString = (params: Record<string, string | undefined>) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  return query.toString() ? `?${query.toString()}` : "";
};

/** `today` is the caller's calendar date (YYYY-MM-DD); it defaults to today in Singapore. */
export async function getDashboardOverview(month?: string, today?: string) {
  return fetchAnalytics(`/api/analytics/dashboard-overview${queryString({ month, today })}`);
}

/**
 * The daily-tracking dashboard: today, this week, the month so far against
 * last month at the same day with a projection, category progress, recent
 * entries and what needs attention, plus the workflow preference.
 */
export async function getDailyOverview(today?: string) {
  return fetchAnalytics(`/api/analytics/daily-overview${queryString({ today })}`);
}

export async function getDashboardReview() {
  return fetchAnalytics("/api/analytics/dashboard-review");
}

export async function getImportSummaries() {
  return fetchAnalytics("/api/analytics/imports");
}

export async function getImportDetail(importKey: string) {
  return fetchAnalytics(
    `/api/analytics/import-detail?importKey=${encodeURIComponent(importKey)}`,
  );
}

export interface AnalyticsReportParams {
  month?: string;
  dateFrom?: string;
  dateTo?: string;
  range?: string;
  metric?: string;
  groupBy?: string;
  categoryId?: string;
  merchantKey?: string;
  /** Time-series bucket: "day" or "month" (defaults from groupBy). */
  interval?: string;
  /** An Account id, or "none" for rows without one. */
  accountId?: string;
  /** A card id, or "none". */
  cardId?: string;
  /** The caller's calendar date, so the running month is "so far". */
  today?: string;
}

export async function getAnalyticsReport(params: AnalyticsReportParams = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return fetchAnalytics(`/api/analytics/report${suffix}`);
}

export async function getAnalyticsOverview(today?: string) {
  return fetchAnalytics(`/api/analytics/overview${queryString({ today })}`);
}

export async function getAnalyticsInsights(month?: string, today?: string) {
  return fetchAnalytics(`/api/analytics/insights${queryString({ month, today })}`);
}

export async function getDashboardAnalytics(timeframeDays: number = 30) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/analytics/dashboard?userId=${session.user.id}&timeframe=${timeframeDays}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to fetch dashboard analytics");
  }

  return response.json();
}

export async function getMonthlyAnalytics(year: number, month: number) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const response = await fetch(
    `${DATA_SERVICE_URL}/api/analytics/monthly?userId=${session.user.id}&year=${year}&month=${month}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to fetch monthly analytics");
  }

  return response.json();
}
