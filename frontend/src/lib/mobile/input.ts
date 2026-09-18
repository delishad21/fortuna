// Never accept ownership assertions from the device, including inside nested payloads.
export function reviveMobileInput(
  value: unknown,
  key = "",
  depth = 0,
  reviveDates = true,
): any {
  if (depth > 24) throw new Error("Request is too deeply nested");
  if (["userId", "__proto__", "constructor", "prototype"].includes(key))
    throw new Error("Reserved request field");
  if (
    reviveDates &&
    (key === "dateFrom" || key === "dateTo") &&
    typeof value === "string"
  ) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()))
      throw new Error("Invalid date filter");
    return date;
  }
  if (Array.isArray(value))
    return value.map((item) =>
      reviveMobileInput(item, "", depth + 1, reviveDates),
    );
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        reviveMobileInput(v, k, depth + 1, reviveDates),
      ]),
    );
  return value;
}
