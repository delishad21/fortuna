import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { DATE_THRESHOLD_DAYS } from "../duplicates/duplicate-scoring";
import { pickSource, scoreChannelPair, type ParsedExternalId, type SourceRow } from "../sources/sources";

/**
 * Which source (Settings → Sources) an assistant entry came from, the report
 * that ties its externalId to the transaction, and main/backup merging: when
 * a card's backup channel reports a purchase its main channel already
 * reported (or the other way round), the two become one transaction.
 */

export type EntrySourceError = { status: number; message: string };

export type ReportKind = "email" | "notification" | "other";

/** One message behind a transaction, as kept in metadata.sources. */
export type SourceEntry = {
  externalId: string;
  sourceId: string | null;
  kind: ReportKind;
  channel: "main" | "backup" | null;
  name: string | null;
  primary: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const textOf = (value: unknown): string =>
  typeof value === "string"
    ? value
    : Array.isArray(value)
      ? value.map(textOf).join(" ")
      : value && typeof value === "object"
        ? Object.values(value).map(textOf).join(" ")
        : "";

/**
 * The entry's source: the one it names (sourceId), else the enabled source of
 * its message's kind with the notification's package or the email's sender.
 * Several fitting sources are narrowed by the card's last 4 digits and the
 * sources' identifiers and patterns in the message text; when that leaves
 * more than one, or none, the entry has no source and a warning says so.
 */
export async function resolveEntrySource(
  userId: string,
  input: {
    sourceId?: string | null;
    sender?: string | null;
    description: string;
    card?: { id?: string; last4?: string } | null;
    metadata?: Record<string, unknown> | null;
  },
  parsed: ParsedExternalId,
): Promise<{ source: SourceRow | null; warnings: string[]; error?: EntrySourceError }> {
  if (input.sourceId) {
    const source = await prisma.transactionSource.findFirst({ where: { id: input.sourceId, userId } });
    if (!source) return { source: null, warnings: [], error: { status: 400, message: `Unknown sourceId "${input.sourceId}"; see get_entry_sources` } };
    if (parsed.kind !== source.kind)
      return {
        source: null,
        warnings: [],
        error: {
          status: 400,
          message:
            source.kind === "email"
              ? "This source reports emails: externalId must be email:<Message-ID>"
              : "This source reports notifications: externalId must be notif:<package>:<key>:<postTime>",
        },
      };
    if (parsed.kind === "notification" && !source.senders.includes(parsed.package))
      return {
        source: null,
        warnings: [],
        error: { status: 400, message: `The notification is from ${parsed.package}, which isn't one of this source's apps (${source.senders.join(", ")})` },
      };
    return { source, warnings: source.enabled ? [] : ["This source is turned off in Settings; the entry is saved anyway"] };
  }
  if (parsed.kind === "other") return { source: null, warnings: [] };
  const sender = parsed.kind === "notification" ? parsed.package : (input.sender ?? null);
  if (!sender)
    return { source: null, warnings: ["Send sourceId or sender with an email entry so Fortuna knows its source"] };
  const sources = await prisma.transactionSource.findMany({ where: { userId, kind: parsed.kind, enabled: true } });
  const cardIds = input.card?.last4
    ? (await prisma.card.findMany({ where: { userId, last4: input.card.last4 }, select: { id: true } })).map((card) => card.id)
    : input.card?.id
      ? [input.card.id]
      : [];
  const metadata = record(input.metadata);
  const subject = [metadata.emailSubject, metadata.subject].find((value): value is string => typeof value === "string") ?? null;
  const text = `${input.description} ${textOf(metadata)}`;
  // Narrow by the card first when the evidence names one.
  const onCard = cardIds.length ? sources.filter((source) => source.cardId && cardIds.includes(source.cardId)) : [];
  const source =
    (onCard.length ? pickSource(onCard, { kind: parsed.kind, sender, text, subject }) : null) ??
    pickSource(sources, { kind: parsed.kind, sender, text, subject, cardId: cardIds.length === 1 ? cardIds[0] : null });
  if (source) return { source, warnings: [] };
  const fitting = sources.filter((item) => item.senders.some((value) => value.toLowerCase() === sender.toLowerCase()));
  return {
    source: null,
    warnings: [
      fitting.length > 1
        ? `${fitting.length} sources fit ${sender}; send sourceId so Fortuna knows which`
        : `No enabled source in Settings → Sources has ${sender}; the entry is saved without one`,
    ],
  };
}

/** metadata.sources with this message in it (replacing an earlier copy); a primary one demotes the rest. */
export function withSourceEntry(metadata: unknown, entry: SourceEntry) {
  const next = { ...record(metadata) };
  const list = (Array.isArray(next.sources) ? (next.sources as SourceEntry[]) : []).filter(
    (item) => item && item.externalId !== entry.externalId,
  );
  next.sources = [...list.map((item) => (entry.primary ? { ...item, primary: false } : item)), entry];
  return next as Prisma.InputJsonValue;
}

export function withoutSourceEntry(metadata: unknown, externalId: string) {
  const next = { ...record(metadata) };
  if (Array.isArray(next.sources)) next.sources = (next.sources as SourceEntry[]).filter((item) => item?.externalId !== externalId);
  return next as Prisma.InputJsonValue;
}

export function sourceEntry(
  externalId: string,
  kind: ReportKind,
  source: SourceRow | null,
  primary: boolean,
): SourceEntry {
  return {
    externalId,
    sourceId: source?.id ?? null,
    kind,
    channel: (source?.channel as SourceEntry["channel"]) ?? null,
    name: source?.name ?? null,
    primary,
  };
}

export type ChannelMatch = {
  transaction: Prisma.TransactionGetPayload<{ include: { category: true } }>;
  /** What the existing transaction is: the main channel's entry, or only backup reports so far. */
  existing: "main" | "backup";
  matchScore: number;
  matchReasons: string[];
};

/**
 * The transaction this source's message is the other channel's report of.
 * A backup's message looks for an entry the main channel reported; a main
 * message looks for an entry only backups reported. Candidates are on the same
 * account, with the same amount within DATE_THRESHOLD_DAYS, and have no report
 * from this source yet (one source reporting twice is two purchases). The
 * best one scoring as the same purchase (scoreChannelPair) wins.
 */
export async function findChannelCounterpart(
  userId: string,
  source: SourceRow,
  entry: {
    accountId: string | null;
    cardId: string | null;
    date: Date;
    time: string | null;
    description: string;
    amountIn: number | null;
    amountOut: number | null;
  },
): Promise<ChannelMatch | null> {
  if (!entry.accountId) return null;
  const from = new Date(entry.date);
  from.setUTCDate(from.getUTCDate() - DATE_THRESHOLD_DAYS);
  const to = new Date(entry.date);
  to.setUTCDate(to.getUTCDate() + DATE_THRESHOLD_DAYS);
  const wanted = source.channel === "backup" ? "main" : "backup";
  const candidates = await prisma.transaction.findMany({
    where: {
      userId,
      accountId: entry.accountId,
      entrySource: "assistant",
      date: { gte: from, lte: to },
      ...(entry.amountIn != null ? { amountIn: entry.amountIn } : { amountOut: entry.amountOut }),
      AND: [
        { sourceReports: { some: { channel: wanted } } },
        { sourceReports: { none: { sourceId: source.id } } },
        ...(wanted === "backup" ? [{ sourceReports: { none: { channel: "main" } } }] : []),
      ],
    },
    include: { category: true, sourceReports: { select: { facts: true, primary: true } } },
  });
  let best: ChannelMatch | null = null;
  for (const candidate of candidates) {
    const metadata = record(candidate.metadata);
    const facts = candidate.sourceReports.find((report) => report.primary)?.facts;
    const score = scoreChannelPair(
      {
        date: entry.date,
        description: entry.description,
        amountIn: entry.amountIn,
        amountOut: entry.amountOut,
        cardId: entry.cardId,
        time: entry.time,
      },
      {
        // The message as sent, not the label or description a review changed.
        date: candidate.date,
        description: typeof record(facts).description === "string" ? String(record(facts).description) : candidate.description,
        amountIn: candidate.amountIn == null ? null : Number(candidate.amountIn),
        amountOut: candidate.amountOut == null ? null : Number(candidate.amountOut),
        cardId: candidate.cardId,
        time: typeof metadata.time === "string" ? metadata.time : null,
      },
    );
    if (score && (!best || score.score > best.matchScore)) {
      const { sourceReports: _reports, ...transaction } = candidate;
      best = { transaction, existing: wanted, matchScore: score.score, matchReasons: score.reasons };
    }
  }
  return best;
}
