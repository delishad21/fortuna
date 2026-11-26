import { forwardAgentPath, type PathContext } from "../../forward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/agent/proposals[/...]: decisions on a draft's proposals, with the
// caller's drafts:write token.
function forward(request: Request, context: PathContext) {
  return forwardAgentPath(request, context, "proposals", "Draft service is unavailable");
}

export const POST = forward;
