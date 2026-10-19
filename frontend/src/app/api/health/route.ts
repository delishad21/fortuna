import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public liveness check for the container healthcheck and devbot deploys:
// confirms the app is serving and can reach the database.
export async function GET() {
  const revision = process.env.REVISION || "dev";
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json(
      { status: "ok", revision },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "error", revision },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
