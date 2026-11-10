// Turns a PayLah "Transaction Alerts" email body into the few fields the chat may see.
// Nothing else from the email (raw text, HTML, headers) leaves this module.

export const PAYLAH_KINDS = [
  "PayLah! Scan & Pay Transfer",
  "PayLah! Transfer",
  "PayNow Transfer",
] as const;
export type PaylahKind = (typeof PAYLAH_KINDS)[number] | "Other";

export type PaylahAlert = {
  transactionRef: string;
  kind: PaylahKind;
  /** From the body's "Date & Time", which is SGT: "YYYY-MM-DD HH:mm SGT". */
  dateTime: string;
  /** "YYYY-MM-DD" in SGT, for pairing with bank rows. */
  date: string;
  /** Decimal string, e.g. "3.50". */
  amount: string;
  currency: string;
  counterparty: string;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const SGT_OFFSET_MS = 8 * 3600 * 1000;
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  ndash: "–",
  mdash: "—",
};

function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name[0] === "#") {
      const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

/** Plain text of an alert body, one table cell or paragraph per line. */
export function alertText(body: string, isHtml: boolean) {
  let text = body;
  if (isHtml)
    text = decodeEntities(
      body
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/gi, " ")
        .replace(/<(br|\/td|\/th|\/tr|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, "\n")
        .replace(/<[^>]*>/g, " "),
    );
  return text
    .replace(/[​‌‍﻿]/g, "")
    .replace(/[^\S\n]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

/** The text after "Label:" on the same line, or on the next line when the cell is split. */
function field(text: string, label: string) {
  const match = new RegExp(`(?:^|\\n)${label}:[^\\S\\n]*([^\\n]*)(?:\\n([^\\n]*))?`, "i").exec(text);
  if (!match) return null;
  return (match[1] || match[2] || "").trim() || null;
}

const clean = (value: string, max: number) =>
  value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The body gives day, month and time in SGT but no year. Take the year that puts the
 * transaction closest to when the email was sent (the alert follows within minutes),
 * so a 31 Dec 23:58 payment alerted on 1 Jan UTC stays in December.
 */
function sgtDate(day: number, month: number, hour: number, minute: number, sent: Date, year?: number) {
  const sentSgt = new Date(sent.getTime() + SGT_OFFSET_MS);
  const base = sentSgt.getUTCFullYear();
  const years = year ? [year] : [base - 1, base, base + 1];
  let best: Date | null = null;
  for (const y of years) {
    const candidate = new Date(Date.UTC(y, month, day, hour, minute));
    if (candidate.getUTCMonth() !== month || candidate.getUTCDate() !== day) continue;
    if (!best || Math.abs(candidate.getTime() - sentSgt.getTime()) < Math.abs(best.getTime() - sentSgt.getTime()))
      best = candidate;
  }
  return best;
}

/** Parsed fields of one alert, or null when the body is not a PayLah payment alert. */
export function parsePaylahAlert(text: string, sent: Date): PaylahAlert | null {
  const ref = /Transaction Ref:\s*([A-Z0-9-]{6,64})/i.exec(text)?.[1];
  const when = /Date\s*&\s*Time:\s*(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?(?:\s+(\d{4}))?,?\s+(\d{1,2}):(\d{2})\s*\(SGT\)/i.exec(text);
  const money = /Amount:\s*([A-Z]{3})\s*([\d,]+(?:\.\d{1,2})?)/i.exec(text);
  const to = field(text, "To");
  if (!ref || !when || !money || !to || Number.isNaN(sent.getTime())) return null;
  const month = MONTHS.indexOf(when[2].toLowerCase());
  if (month < 0) return null;
  const at = sgtDate(Number(when[1]), month, Number(when[4]), Number(when[5]), sent, when[3] ? Number(when[3]) : undefined);
  if (!at) return null;
  const date = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
  const kindText = /We refer to (?:your |a |an )?(.+?) dated\b/i.exec(text)?.[1]?.trim().toLowerCase();
  const kind = PAYLAH_KINDS.find((k) => k.toLowerCase() === kindText) ?? "Other";
  return {
    transactionRef: ref.toUpperCase(),
    kind,
    dateTime: `${date} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} SGT`,
    date,
    amount: Number(money[2].replace(/,/g, "")).toFixed(2),
    currency: money[1].toUpperCase(),
    counterparty: clean(to, 120),
  };
}
