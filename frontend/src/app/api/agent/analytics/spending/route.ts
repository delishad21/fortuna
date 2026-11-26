import { forwardAnalytics } from "../forward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return forwardAnalytics(request, "spending");
}
