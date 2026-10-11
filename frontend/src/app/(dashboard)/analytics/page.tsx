import { getAccountNumbers } from "@/app/actions/accountNumbers";
import { getAnalyticsInsights, getAnalyticsOverview, getAnalyticsReport } from "@/app/actions/analytics";
import { AnalyticsClient } from "@/components/analytics/AnalyticsClient";

export default async function AnalyticsPage() {
  const [initialOverview, initialReport, initialInsights, accounts] = await Promise.all([
    getAnalyticsOverview(),
    getAnalyticsReport({ groupBy: "day", interval: "day" }),
    getAnalyticsInsights(),
    getAccountNumbers(),
  ]);

  return <AnalyticsClient initialOverview={initialOverview} initialReport={initialReport} initialInsights={initialInsights} accounts={accounts} />;
}
