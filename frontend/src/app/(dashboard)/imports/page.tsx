import { getImportSummaries } from "@/app/actions/analytics";
import { ImportHistoryClient } from "@/components/analytics/ImportHistoryClient";
import { getAgentDrafts } from "@/app/actions/agentDrafts";

export default async function ImportsPage() {
  const [data, agentData] = await Promise.all([getImportSummaries(), getAgentDrafts()]);
  return <ImportHistoryClient imports={data.imports || []} agentDrafts={agentData.drafts || []} />;
}
