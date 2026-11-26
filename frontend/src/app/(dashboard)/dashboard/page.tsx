import { getAccountNumbers } from "@/app/actions/accountNumbers";
import { getDailyOverview, getDashboardOverview, getDashboardReview } from "@/app/actions/analytics";
import { getCategories } from "@/app/actions/categories";
import { DashboardClient } from "@/components/analytics/DashboardClient";

export default async function DashboardPage() {
  const [overview, review, daily, categories, accounts] = await Promise.all([
    getDashboardOverview(),
    getDashboardReview(),
    getDailyOverview(),
    getCategories({ scope: "main" }),
    getAccountNumbers(),
  ]);

  return (
    <DashboardClient
      initialOverview={overview}
      initialReview={review}
      initialDaily={daily}
      categories={categories}
      accounts={accounts}
    />
  );
}
