import { getDashboardOverview, getDashboardReview } from "@/app/actions/analytics";
import { getCategories } from "@/app/actions/categories";
import { DashboardClient } from "@/components/analytics/DashboardClient";

export default async function DashboardPage() {
  const [overview, review, categories] = await Promise.all([
    getDashboardOverview(),
    getDashboardReview(),
    getCategories({ scope: "main" }),
  ]);

  return <DashboardClient initialOverview={overview} initialReview={review} categories={categories} />;
}
