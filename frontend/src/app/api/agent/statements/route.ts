export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_SERVICE_URL = process.env.DATA_SERVICE_URL || "http://localhost:4001";
// The data service allows 25 MB per statement; this leaves room for the multipart framing.
const MAX_BODY_BYTES = 26 * 1024 * 1024;

const noStore = { "Cache-Control": "no-store" };

// Passes POST /api/agent/statements (a multipart statement upload, with an
// optional PDF password) through to the data service with the caller's API
// token, which must grant statements:write. The body is forwarded as is and
// never logged.
export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return Response.json({ error: "API token required" }, { status: 401, headers: noStore });
  }
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return Response.json(
      { error: 'Send the statement as multipart/form-data in a "file" field' },
      { status: 400, headers: noStore },
    );
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return Response.json({ error: "Statements must be under 25 MB" }, { status: 413, headers: noStore });
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) {
    return Response.json({ error: "Statements must be under 25 MB" }, { status: 413, headers: noStore });
  }
  try {
    const response = await fetch(`${DATA_SERVICE_URL}/api/agent/statements`, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": contentType,
        ...(request.headers.get("x-request-id")
          ? { "x-request-id": request.headers.get("x-request-id")! }
          : {}),
      },
      body,
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
    return Response.json({ error: "Statement service is unavailable" }, { status: 502, headers: noStore });
  }
}
