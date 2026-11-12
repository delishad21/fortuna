/**
 * Scores whether two transactions are the same one, for both checks:
 * staged rows against saved transactions, and staged rows against each other.
 *
 * Alike is not enough. A transaction counts as a duplicate only when nothing
 * that tells transactions apart differs:
 * - journey times (SimplyGo legs): different times are different journeys,
 *   and a timed journey must fall on the same date;
 * - reference numbers: "BUS/MRT 942796843" and "BUS/MRT 942735373" are two charges;
 * - dates: a nearby date only counts when the two rows come from different
 *   sources, which can date one transaction differently (posting vs
 *   transaction date). One source dates a transaction the same way every time,
 *   so the same coffee on consecutive days from one card is two coffees.
 */
export type DuplicateCandidate = {
  date: string | Date;
  description: string;
  amountIn: number | null;
  amountOut: number | null;
  accountIdentifier?: string | null;
  source?: string | null;
  metadata?: unknown;
};

export type DuplicateScore = { score: number; reasons: string[] };

export const DUPLICATE_THRESHOLD = 0.8;
export const DATE_THRESHOLD_DAYS = 2;

const TIME_PATTERN = /\b\d{1,2}:\d{2}(?:\s?[AP]M)?\b/i;
// Reference numbers on card lines are long digit runs; short ones (store
// numbers, "7-ELEVEN") are part of the merchant name.
const REFERENCE_PATTERN = /\d{6,}/g;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function dayNumber(value: string | Date) {
  if (value instanceof Date && Number.isNaN(value.getTime())) return NaN;
  const iso = value instanceof Date ? value.toISOString() : String(value);
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000;
}

/** The start time of each leg, e.g. ["07:55 PM", "08:20 PM"]. Older statements printed only the start time. */
export function journeyTimes(metadata: unknown): string[] {
  const legs = record(metadata).legs;
  if (!Array.isArray(legs)) return [];
  return legs
    .map((leg) => String(leg).match(TIME_PATTERN)?.[0])
    .filter((time): time is string => Boolean(time))
    .map((time) => time.toUpperCase().replace(/\s+/g, " "));
}

function references(candidate: DuplicateCandidate) {
  const found: string[] = [...(candidate.description.match(REFERENCE_PATTERN) ?? [])];
  const meta = record(candidate.metadata);
  for (const key of ["reference", "referenceNumber"]) {
    if (meta[key] != null && String(meta[key]).trim()) found.push(String(meta[key]).trim());
  }
  return [...new Set(found)].sort();
}

function withoutReferences(description: string) {
  return description.replace(REFERENCE_PATTERN, "#").replace(/\s+/g, " ").trim().toLowerCase();
}

function sourceOf(candidate: DuplicateCandidate) {
  const meta = record(candidate.metadata);
  const parser = String(meta.parserId || candidate.source || "").trim();
  if (!parser) return null;
  const account = String(candidate.accountIdentifier || meta.accountIdentifier || "").trim();
  return `${parser}|${account}`;
}

function bigrams(value: string) {
  const pairs: string[] = [];
  for (let index = 0; index < value.length - 1; index++) {
    pairs.push(value.slice(index, index + 2));
  }
  return pairs;
}

/** Dice's coefficient over character bigrams, case-insensitive. */
export function descriptionSimilarity(left: string, right: string) {
  const first = left.toLowerCase();
  const second = right.toLowerCase();
  if (first === second) return 1;
  if (first.length < 2 || second.length < 2) return 0;
  const firstPairs = bigrams(first);
  const secondPairs = bigrams(second);
  const shared = firstPairs.filter((pair) => secondPairs.includes(pair)).length;
  return (2 * shared) / (firstPairs.length + secondPairs.length);
}

export function scoreDuplicatePair(
  left: DuplicateCandidate,
  right: DuplicateCandidate,
): DuplicateScore | null {
  const sameCredit =
    left.amountIn != null && left.amountIn > 0 && left.amountIn === right.amountIn;
  const sameDebit =
    left.amountOut != null && left.amountOut > 0 && left.amountOut === right.amountOut;
  if (!sameCredit && !sameDebit) return null;

  const days = Math.abs(dayNumber(left.date) - dayNumber(right.date));
  if (!Number.isFinite(days) || days > DATE_THRESHOLD_DAYS) return null;

  const reasons: string[] = ["Exact amount match"];

  const leftTimes = journeyTimes(left.metadata);
  const rightTimes = journeyTimes(right.metadata);
  if (leftTimes.length || rightTimes.length) {
    // A timed journey has its own date; one on another day is another trip.
    if (days !== 0) return null;
    if (leftTimes.length && rightTimes.length) {
      if (leftTimes.join(",") !== rightTimes.join(",")) return null;
      reasons.push("Same journey times");
    }
  }

  const leftRefs = references(left);
  const rightRefs = references(right);
  if (
    leftRefs.length &&
    rightRefs.length &&
    leftRefs.join(",") !== rightRefs.join(",") &&
    withoutReferences(left.description) === withoutReferences(right.description)
  ) {
    return null;
  }

  if (days !== 0) {
    const leftSource = sourceOf(left);
    if (leftSource && leftSource === sourceOf(right)) return null;
  }

  let score = 0.3;
  if (days === 0) {
    score += 0.3;
    reasons.push("Same date");
  } else {
    score += 0.15;
    reasons.push(`Date within ${Math.ceil(days)} days`);
  }

  const similarity = descriptionSimilarity(left.description, right.description);
  if (similarity === 1) {
    score += 0.4;
    reasons.push("Exact description match");
  } else if (similarity >= 0.9) {
    score += 0.3;
    reasons.push("Very similar description");
  } else if (similarity >= 0.7) {
    score += 0.2;
    reasons.push("Similar description");
  } else if (similarity >= 0.5) {
    score += 0.1;
    reasons.push("Somewhat similar description");
  }
  return score >= DUPLICATE_THRESHOLD ? { score, reasons } : null;
}
