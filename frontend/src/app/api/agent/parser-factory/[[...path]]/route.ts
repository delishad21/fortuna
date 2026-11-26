import { forwardAgentPath, type PathContext } from "../../forward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/agent/parser-factory[/...]: parser workspaces, candidates and
// definitions, with the caller's parser:develop or parser:approve token.
function forward(request: Request, context: PathContext) {
  return forwardAgentPath(request, context, "parser-factory", "Parser service is unavailable");
}

export const GET = forward;
export const POST = forward;
