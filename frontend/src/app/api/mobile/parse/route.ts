import { parseFile } from "@/app/actions/parser";
import { authenticateMobile, mobileJson } from "@/lib/mobile/session";
import { mobileSessionContext } from "@/lib/mobile/context";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const identity = await authenticateMobile(request);
  if (!identity)
    return mobileJson({ error: "Session expired. Please sign in again." }, 401);
  try {
    const form = await request.formData();
    for (const value of form.values())
      if (typeof value !== "string" && value.size > 25 * 1024 * 1024)
        return mobileJson({ error: "Statements must be under 25 MB" }, 413);
    const result = await mobileSessionContext.run(identity.session, () =>
      parseFile(form),
    );
    return mobileJson({ data: result });
  } catch (error) {
    return mobileJson(
      {
        error:
          error instanceof Error ? error.message : "Could not parse statement",
      },
      400,
    );
  }
}
