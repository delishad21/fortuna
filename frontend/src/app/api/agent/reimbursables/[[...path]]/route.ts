import { forwardAgentPath, type PathContext } from "../../forward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/agent/reimbursables[/...]: the people the user pays for, what they owe,
// marking entries reimbursable (set, clear) and repayment link proposals
// (proposals, proposals/confirm), with the caller's transactions:review or
// analytics:read token.
function forward(request: Request, context: PathContext) {
  return forwardAgentPath(request, context, "reimbursables", "Reimbursables service is unavailable");
}

export const GET = forward;
export const POST = forward;
