const NOISE_PATTERNS = [
  /\b\d{6,}\b/g, // long refs
  /\b\d{4}-\d{4}-\d{4}-\d{4}\b/g, // card like
  /\*{2,}\d{2,}/g, // masked tails
  /\b\d{1,2}(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/gi, // statement-style date token (e.g. 25APR)
  /\bsi\s+ng\b/gi, // OCR split of "SINGAPORE"
  /\b(?:visa|mastercard|debit card transaction|card transaction)\b/gi,
  /\b(?:sgp|singapore)\b/gi,
];

export function normalizeDescription(input: string): string {
  let normalized = (input || "").toLowerCase();
  for (const pattern of NOISE_PATTERNS) {
    normalized = normalized.replace(pattern, " ");
  }
  normalized = normalized
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized;
}

export function toMerchantStem(input: string): string {
  const normalized = normalizeDescription(input);
  const tokens = normalized
    .split(" ")
    .filter((token) => token.length >= 3)
    .slice(0, 5);
  return tokens.join(" ");
}

export function directionOf(transaction: {
  amountIn?: number;
  amountOut?: number;
}): "in" | "out" | "none" {
  const amountIn = Number(transaction.amountIn || 0);
  const amountOut = Number(transaction.amountOut || 0);
  if (amountIn > 0) return "in";
  if (amountOut > 0) return "out";
  return "none";
}

export function amountBucket(transaction: {
  amountIn?: number;
  amountOut?: number;
}): number {
  const amount = Number(transaction.amountOut || transaction.amountIn || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount / 10) * 10;
}
