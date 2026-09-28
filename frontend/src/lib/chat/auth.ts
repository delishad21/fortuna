type IdentityDependencies = {
  web: () => Promise<{ user?: { id?: string } } | null>;
  mobile: (
    request: Request,
  ) => Promise<{ session: { user?: { id?: string } } } | null>;
};
export async function resolveChatIdentity(
  request: Request,
  deps: IdentityDependencies,
  configuredOrigin: string,
) {
  const web = await deps.web();
  const bearer = request.headers.has("authorization");
  const fail = (status: number, message: string): never => {
    throw Object.assign(new Error(message), { status });
  };
  if (bearer) {
    if (web?.user?.id) return fail(400, "Use only one authentication method");
    const mobile = await deps.mobile(request);
    if (!mobile?.session.user?.id)
      return fail(401, "Session expired. Please sign in again.");
    return { userId: mobile.session.user.id };
  }
  if (!web?.user?.id) return fail(401, "Please sign in");
  if (!["GET", "HEAD"].includes(request.method)) {
    let expected: string;
    try {
      expected = new URL(configuredOrigin).origin;
    } catch {
      return fail(503, "Fortuna public origin is not configured");
    }
    if (request.headers.get("origin") !== expected)
      return fail(403, "Request origin is not allowed");
  }
  return { userId: web.user.id };
}
