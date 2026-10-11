import { getAccountNumbers } from "@/app/actions/accountNumbers";
import { getDashboardOverview, getDashboardReview } from "@/app/actions/analytics";
import { getCategories } from "@/app/actions/categories";
import { DashboardClient } from "@/components/analytics/DashboardClient";

export default async function DashboardPage() {
  const [overview, review, categories, accounts] = await Promise.all([
    getDashboardOverview(),
    getDashboardReview(),
    getCategories({ scope: "main" }),
    getAccountNumbers(),
  ]);

  return <DashboardClient initialOverview={overview} initialReview={review} categories={categories} accounts={accounts} />;
}
