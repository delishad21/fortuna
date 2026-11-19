export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_SERVICE_URL = process.env.DATA_SERVICE_URL || "http://localhost:4001";

// Passes GET /api/agent/analytics/spending through to the data service with
// the caller's API token, which must grant analytics:read. Only this route is
// forwarded; the data service's other routes stay internal.
export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return Response.json(
      { error: "API token required" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { search } = new URL(request.url);
  try {
    const response = await fetch(`${DATA_SERVICE_URL}/api/agent/analytics/spending${search}`, {
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
      { error: "Analytics service is unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
