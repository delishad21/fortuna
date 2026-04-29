import { getDashboardOverview, getDashboardReview } from "@/app/actions/analytics";
import { DashboardClient } from "@/components/analytics/DashboardClient";

export default async function DashboardPage() {
  const [overview, review] = await Promise.all([
    getDashboardOverview(),
    getDashboardReview(),
  ]);

  return <DashboardClient initialOverview={overview} initialReview={review} />;
}
