import { auth } from "@/lib/auth";
import { authenticateMobile } from "@/lib/mobile/session";
import { resolveChatIdentity } from "@/lib/chat/auth";
import { forwardAgentImage, isAgentToken } from "../../agent/forward";

export const runtime = "nodejs";

/**
 * A transaction, account or card image, for its owner only (web session or
 * mobile bearer token), or for an API token's user (the data service checks
 * the token). The files live with data-service.
 */
export async function GET(request: Request, context: { params: Promise<{ imageId: string }> }) {
  if (isAgentToken(request)) return forwardAgentImage(request, (await context.params).imageId);
  try {
    const { userId } = await resolveChatIdentity(
      request,
      { web: auth, mobile: authenticateMobile },
      process.env.AUTH_URL || process.env.NEXTAUTH_URL || "",
    );
    const { imageId } = await context.params;
    if (!/^[\w-]{1,64}$/.test(imageId)) return Response.json({ error: "Image not found" }, { status: 404 });
    const upstream = await fetch(
      `${process.env.DATA_SERVICE_URL || "http://localhost:4001"}/api/images/${imageId}`,
      {
        headers: {
          "x-internal-service-token": process.env.INTERNAL_SERVICE_TOKEN || "",
          "x-authenticated-user-id": userId,
        },
        cache: "no-store",
      },
    );
    if (!upstream.ok)
      return Response.json({ error: "Image not found" }, { status: upstream.status === 404 ? 404 : 502 });
    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch (error) {
    const status = (error as { status?: number }).status || 502;
    return Response.json({ error: (error as Error).message }, { status });
  }
}
