export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_SERVICE_URL = process.env.DATA_SERVICE_URL || "http://localhost:4001";

// Passes /api/agent/transactions[/...] through to the data service with the
// caller's API token, which must grant transactions:write. Only this path is
// forwarded; the data service's other routes stay internal.
async function forward(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return Response.json(
      { error: "API token required" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { path = [] } = await context.params;
  const suffix = path.map((part) => `/${encodeURIComponent(part)}`).join("");
  const { search } = new URL(request.url);
  const hasBody = request.method === "POST" || request.method === "PATCH";
  try {
    const response = await fetch(`${DATA_SERVICE_URL}/api/agent/transactions${suffix}${search}`, {
      method: request.method,
      headers: {
        Authorization: authorization,
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...(request.headers.get("x-request-id")
          ? { "x-request-id": request.headers.get("x-request-id")! }
          : {}),
      },
      body: hasBody ? await request.text() : undefined,
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
      { error: "Transaction service is unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const DELETE = forward;
