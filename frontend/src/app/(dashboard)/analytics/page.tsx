import { getAnalyticsInsights, getAnalyticsReport } from "@/app/actions/analytics";
import { AnalyticsClient } from "@/components/analytics/AnalyticsClient";

export default async function AnalyticsPage() {
  const [initialReport, initialInsights] = await Promise.all([
    getAnalyticsReport(),
    getAnalyticsInsights(),
  ]);

  return <AnalyticsClient initialReport={initialReport} initialInsights={initialInsights} />;
}
