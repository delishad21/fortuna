import { forwardAgentPath, type PathContext } from "../../forward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/agent/drafts[/...]: statement drafts (read, reconcile, validate, commit,
// delete), with the caller's drafts:read, drafts:write or imports:commit token.
function forward(request: Request, context: PathContext) {
  return forwardAgentPath(request, context, "drafts", "Draft service is unavailable");
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const DELETE = forward;
