import { authenticateMobile, mobileJson } from "@/lib/mobile/session";
import { mobileSessionContext } from "@/lib/mobile/context";
import { mobileOperations } from "@/lib/mobile/operations";
import { reviveMobileInput } from "@/lib/mobile/input";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const identity = await authenticateMobile(request);
  if (!identity)
    return mobileJson({ error: "Session expired. Please sign in again." }, 401);
  try {
    const raw = await request.text();
    if (raw.length > 8 * 1024 * 1024)
      return mobileJson({ error: "Request is too large" }, 413);
    const { operation, args } = JSON.parse(raw);
    if (
      typeof operation !== "string" ||
      !Object.hasOwn(mobileOperations, operation) ||
      !Array.isArray(args) ||
      args.length > 8
    )
      return mobileJson(
        { error: "Unknown operation or invalid arguments" },
        400,
      );
    if (
      operation === "changePassword" &&
      (typeof args[1] !== "string" ||
        args[1].length < 8 ||
        args[1].length > 200)
    )
      return mobileJson(
        { error: "Use a password between 8 and 200 characters" },
        400,
      );
    const fn = mobileOperations[operation as keyof typeof mobileOperations] as (
      ...input: any[]
    ) => Promise<unknown>;
    const result = await mobileSessionContext.run(identity.session, () =>
      fn(
        ...reviveMobileInput(
          args,
          "",
          0,
          [
            "getTransactions",
            "bulkUpdateTransactionsByFilter",
            "bulkDeleteTransactionsByFilter",
            "exportTransactionsCsv",
            "getTripEntries",
            "bulkUpdateTripEntriesByFilter",
            "bulkDeleteTripEntriesByFilter",
          ].includes(operation),
        ),
      ),
    );
    return mobileJson({ data: result ?? null });
  } catch (error) {
    return mobileJson(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to complete this action",
      },
      400,
    );
  }
}
