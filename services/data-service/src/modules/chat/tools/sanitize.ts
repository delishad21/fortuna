const privateFields = new Set([
  "userId",
  "approvedByUserId",
  "storagePath",
  "secret",
  "secretHash",
  "commitTokenHash",
  "confirmationToken",
  "payloadHash",
  "loginId",
  "accessToken",
  "refreshToken",
]);
/** Keep domain identifiers, but never send transport credentials or host paths to a model. */
export function sanitizeToolResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeToolResult);
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !privateFields.has(key))
      .map(([key, item]) => [key, sanitizeToolResult(item)]),
  );
}
