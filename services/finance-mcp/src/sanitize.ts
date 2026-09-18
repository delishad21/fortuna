const MCP_PRIVATE_FIELDS = new Set([
  "userId",
  "approvedByUserId",
  "storagePath",
  "secretHash",
  "commitTokenHash",
  "payloadHash",
]);

export function sanitizeForMcp(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForMcp);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !MCP_PRIVATE_FIELDS.has(key))
      .map(([key, item]) => [key, sanitizeForMcp(item)]),
  );
}
