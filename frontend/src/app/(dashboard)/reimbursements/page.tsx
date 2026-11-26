import { getOutstandingReimbursements } from "@/app/actions/reimbursables";
import { ReimbursementsClient } from "@/components/reimbursables/ReimbursementsClient";

export default async function ReimbursementsPage() {
  const initial = await getOutstandingReimbursements({ items: "none" }).catch(() => ({ outstanding: 0, people: [] }));
  return <ReimbursementsClient initial={initial} />;
}
