import { getAgentDraft } from "@/app/actions/agentDrafts";
import { AgentDraftReviewClient } from "@/components/import/AgentDraftReviewClient";

export default async function AgentDraftPage({ params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  const { draft } = await getAgentDraft(draftId);
  return <AgentDraftReviewClient initialDraft={draft as any} />;
}
