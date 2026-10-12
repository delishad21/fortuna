/**
 * A transaction date from any client: a Date, an ISO timestamp, or a plain
 * "YYYY-MM-DD" (the phone sends these), which is stored as midnight UTC like
 * the web's `new Date("YYYY-MM-DD").toISOString()`.
 */
export const toTransactionDate = (value: unknown): Date => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("Invalid transaction date");
    return value;
  }
  const text = String(value ?? "").trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00.000Z`) : new Date(text);
  if (!text || Number.isNaN(date.getTime())) throw new Error("Invalid transaction date");
  return date;
};
