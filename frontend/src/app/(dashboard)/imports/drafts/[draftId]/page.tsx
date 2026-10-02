import { getAgentDraft } from "@/app/actions/agentDrafts";
import { AgentDraftReviewClient } from "@/components/import/AgentDraftReviewClient";

/** Only return to in-app chat pages, never an arbitrary or external URL. */
const safeReturnTo = (value: unknown) =>
  typeof value === "string" && /^\/chat(\?|$)/.test(value) ? value : undefined;

export default async function AgentDraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ draftId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { draftId } = await params;
  const { returnTo } = await searchParams;
  const { draft } = await getAgentDraft(draftId);
  return (
    <AgentDraftReviewClient
      initialDraft={draft as any}
      returnTo={safeReturnTo(returnTo)}
    />
  );
}
