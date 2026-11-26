/**
 * Scores whether a statement row is the bank's copy of a transaction that was
 * already logged (by the assistant, by hand or on the phone), for reconciling a
 * statement upload against what's in the ledger.
 *
 * It is looser than the duplicate check in duplicate-scoring.ts, because the
 * two sides describe one purchase differently:
 * - dates: the bank posts a few days after the purchase, so the statement row
 *   may be up to RECONCILE_LAG_DAYS later (or a day earlier, across midnight);
 * - amounts: FX conversion and tips change the final amount, so an amount
 *   within AMOUNT_TOLERANCE still matches, with a warning, when the date and
 *   description agree;
 * - descriptions: "Starbucks" against "STARBUCKS COFFEE SG 1234 SINGAPORE",
 *   so merchant words count as well as the character similarity.
 * Journey times and card numbers that differ still tell two transactions apart.
 */
import { descriptionSimilarity, journeyTimes } from "./duplicate-scoring";

export type ReconcileSide = {
  date: string | Date;
  description: string;
  /** The entry's own label, which often names the merchant better than its description. */
  label?: string | null;
  amountIn: number | null;
  amountOut: number | null;
  /** Last 4 digits of the card used, when known. */
  cardLast4?: string | null;
  metadata?: unknown;
};

export type ReconcileScore = {
  score: number;
  reasons: string[];
  /** Days from the logged date to the statement date (positive: the bank posted later). */
  days: number;
  exactAmount: boolean;
  /** Statement amount minus the logged amount, when they differ. */
  amountDifference: number;
};

/** The statement may post this many days after the logged date. */
export const RECONCILE_LAG_DAYS = 5;
/** A statement row dated this many days before the logged date still matches (time zones, midnight). */
export const RECONCILE_LEAD_DAYS = 1;
export const RECONCILE_THRESHOLD = 0.6;
/** Amounts closer than this are a match with a warning: the larger of 20% and S$1. */
export const AMOUNT_TOLERANCE = { ratio: 0.2, minimum: 1 };

const NOISE = new Set([
  "sgp", "sg", "singapore", "pte", "ltd", "card", "debit", "credit", "purchase",
  "pos", "nets", "visa", "mastercard", "master", "transaction", "payment", "the",
  "and", "for", "from", "via", "online", "com", "www", "ref", "trf", "transfer",
]);

const cents = (value: number | null | undefined) => Math.round(Number(value || 0) * 100);

function dayNumber(value: string | Date) {
  if (value instanceof Date && Number.isNaN(value.getTime())) return NaN;
  const iso = value instanceof Date ? value.toISOString() : String(value);
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000;
}

/** Days from `from` to `to`, by calendar date. */
export function daysBetween(from: string | Date, to: string | Date) {
  return dayNumber(to) - dayNumber(from);
}

function words(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !NOISE.has(word));
}

/**
 * How alike two merchant descriptions are, 0 to 1: the better of the
 * character similarity and the share of the shorter one's words found in the
 * other (a word also counts when one starts with the other, "grab" in "grabfood").
 */
export function merchantSimilarity(left: string, right: string) {
  const dice = descriptionSimilarity(
    words(left).join(" ") || left,
    words(right).join(" ") || right,
  );
  const a = [...new Set(words(left))];
  const b = [...new Set(words(right))];
  if (!a.length || !b.length) return dice;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const shared = shorter.filter((word) =>
    longer.some(
      (other) =>
        other === word ||
        (Math.min(other.length, word.length) >= 4 &&
          (other.startsWith(word) || word.startsWith(other))),
    ),
  ).length;
  return Math.max(dice, shared / shorter.length);
}

function amountOf(side: ReconcileSide) {
  const amountIn = cents(side.amountIn);
  const amountOut = cents(side.amountOut);
  if (amountIn > 0 && amountOut <= 0) return { direction: "in" as const, cents: amountIn };
  if (amountOut > 0 && amountIn <= 0) return { direction: "out" as const, cents: amountOut };
  return null;
}

/** True when the two amounts are within the tolerance, or equal. */
export function withinAmountTolerance(statementCents: number, loggedCents: number) {
  const allowed = Math.max(
    AMOUNT_TOLERANCE.minimum * 100,
    Math.round(Math.max(statementCents, loggedCents) * AMOUNT_TOLERANCE.ratio),
  );
  return Math.abs(statementCents - loggedCents) <= allowed;
}

export function scoreReconcilePair(
  statement: ReconcileSide,
  logged: ReconcileSide,
): ReconcileScore | null {
  const row = amountOf(statement);
  const entry = amountOf(logged);
  if (!row || !entry || row.direction !== entry.direction) return null;
  const exactAmount = row.cents === entry.cents;
  if (!exactAmount && !withinAmountTolerance(row.cents, entry.cents)) return null;

  const days = daysBetween(logged.date, statement.date);
  if (!Number.isFinite(days) || days < -RECONCILE_LEAD_DAYS || days > RECONCILE_LAG_DAYS)
    return null;

  const statementTimes = journeyTimes(statement.metadata);
  const loggedTimes = journeyTimes(logged.metadata);
  if (statementTimes.length && loggedTimes.length && statementTimes.join(",") !== loggedTimes.join(","))
    return null;

  const statementCard = String(statement.cardLast4 || "").trim();
  const loggedCard = String(logged.cardLast4 || "").trim();
  if (statementCard && loggedCard && statementCard !== loggedCard) return null;

  const reasons: string[] = [];
  let score = 0;
  if (exactAmount) {
    score += 0.4;
    reasons.push("Same amount");
  } else {
    score += 0.15;
    reasons.push(`Amount differs by ${((row.cents - entry.cents) / 100).toFixed(2)}`);
  }

  const distance = Math.abs(days);
  if (distance === 0) {
    score += 0.3;
    reasons.push("Same date");
  } else if (distance === 1) {
    score += 0.25;
    reasons.push(days > 0 ? "Posted a day later" : "Dated a day earlier");
  } else if (distance <= 3) {
    score += 0.2;
    reasons.push(`Posted ${distance} days later`);
  } else {
    score += 0.1;
    reasons.push(`Posted ${distance} days later`);
  }

  if (statementCard && statementCard === loggedCard) {
    score += 0.1;
    reasons.push(`Same card (${statementCard})`);
  }

  const similarity = Math.max(
    merchantSimilarity(statement.description, logged.description),
    logged.label ? merchantSimilarity(statement.description, logged.label) : 0,
  );
  if (similarity >= 0.9) {
    score += 0.3;
    reasons.push("Same merchant");
  } else if (similarity >= 0.6) {
    score += 0.2;
    reasons.push("Similar description");
  } else if (similarity >= 0.35) {
    score += 0.1;
    reasons.push("Somewhat similar description");
  } else if (!exactAmount) {
    // A different amount needs the description to agree.
    return null;
  }

  score = Math.round(score * 100) / 100;
  return score >= RECONCILE_THRESHOLD
    ? { score, reasons, days, exactAmount, amountDifference: (row.cents - entry.cents) / 100 }
    : null;
}
