import { getImportSummaries } from "@/app/actions/analytics";
import { ImportHistoryClient } from "@/components/analytics/ImportHistoryClient";

export default async function ImportsPage() {
  const data = await getImportSummaries();
  return <ImportHistoryClient imports={data.imports || []} />;
}
