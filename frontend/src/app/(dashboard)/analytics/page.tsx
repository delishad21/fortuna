import { getAnalyticsInsights, getAnalyticsOverview, getAnalyticsReport } from "@/app/actions/analytics";
import { AnalyticsClient } from "@/components/analytics/AnalyticsClient";

export default async function AnalyticsPage() {
  const [initialOverview, initialReport, initialInsights] = await Promise.all([
    getAnalyticsOverview(),
    getAnalyticsReport(),
    getAnalyticsInsights(),
  ]);

  return <AnalyticsClient initialOverview={initialOverview} initialReport={initialReport} initialInsights={initialInsights} />;
}
