const DATA_SERVICE_URL = process.env.DATA_SERVICE_URL || "http://localhost:4001";

const noStore = { "Cache-Control": "no-store" };

export type PathContext = { params: Promise<{ path?: string[] }> };

// Passes /api/agent/<base>[/...] through to the data service with the caller's
// API token; the data service checks the token's scopes. Only the routes that
// call this are forwarded; the data service's other routes stay internal.
export async function forwardAgentPath(
  request: Request,
  context: PathContext,
  base: string,
  unavailable: string,
) {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return Response.json({ error: "API token required" }, { status: 401, headers: noStore });
  }

  const { path = [] } = await context.params;
  const suffix = path.map((part) => `/${encodeURIComponent(part)}`).join("");
  const { search } = new URL(request.url);
  const hasBody = request.method === "POST" || request.method === "PATCH";
  try {
    const response = await fetch(`${DATA_SERVICE_URL}/api/agent/${base}${suffix}${search}`, {
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
        ...noStore,
      },
    });
  } catch {
    return Response.json({ error: unavailable }, { status: 502, headers: noStore });
  }
}
