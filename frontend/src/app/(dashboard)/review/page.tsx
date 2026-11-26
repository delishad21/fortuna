import { getAccounts } from "@/app/actions/accounts";
import { getCategories } from "@/app/actions/categories";
import { getReviewQueue } from "@/app/actions/review";
import { ReviewClient } from "@/components/review/ReviewClient";

export default async function ReviewPage() {
  const [queue, accounts, categories] = await Promise.all([
    getReviewQueue({ status: "to_review", limit: 50 }),
    getAccounts({ includeArchived: false }).catch(() => []),
    getCategories({ scope: "main" }),
  ]);
  return <ReviewClient initialQueue={queue} initialAccounts={accounts} categories={categories} />;
}
