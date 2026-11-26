export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_SERVICE_URL = process.env.DATA_SERVICE_URL || "http://localhost:4001";

// GET /api/agent/classification-guide: the one classification guide every
// agent follows, passed through with the caller's API token.
export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return Response.json(
      { error: "API token required" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const response = await fetch(`${DATA_SERVICE_URL}/api/agent/classification-guide`, {
      headers: { Authorization: authorization },
      cache: "no-store",
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { error: "Instruction service is unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
