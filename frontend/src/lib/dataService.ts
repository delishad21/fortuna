/**
 * Calls a data-service route as the signed-in user, through the trusted
 * frontend channel (internal service token + asserted user id).
 */
export async function dataServiceRequest<T>(
  userId: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${process.env.DATA_SERVICE_URL || "http://localhost:4001"}${path}`, {
    method: init.method || "GET",
    headers: {
      "x-internal-service-token": process.env.INTERNAL_SERVICE_TOKEN || "",
      "x-authenticated-user-id": userId,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    cache: "no-store",
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(body?.error || `Request failed with ${response.status}`);
  return body as T;
}
