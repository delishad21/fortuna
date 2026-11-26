import { z } from "zod";
import { scoreDuplicatePair, DUPLICATE_THRESHOLD, type DuplicateCandidate } from "../duplicates/duplicate-scoring";
import { PAYLAH_ALERT_SENDER, PAYLAH_ALERT_SUBJECT } from "../imports/paylah-emails";

/**
 * Sources: how an account's or one card's transactions reach the assistant.
 * A notification source names the bank app's Android package (twee's listener
 * allows it); an email source names the alert sender (Hermes's mail job
 * searches it). Like the PayLah email rules, the list lives in Fortuna and is
 * served to the assistant, so adding a bank is a settings change.
 */

export const SOURCE_KINDS = ["notification", "email"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const SOURCE_CHANNELS = ["main", "backup"] as const;
export type SourceChannel = (typeof SOURCE_CHANNELS)[number];

// ── externalId schemes ────────────────────────────────────────────────────

/**
 * The fixed externalId of each kind of message. The same message always gets
 * the same id, so a cron job can re-read the last days on every run and
 * re-sending only updates.
 */
export const EXTERNAL_ID_SCHEMES = {
  email: {
    format: "email:<Message-ID>",
    example: "email:CAF7xk2Qp9@mail.gmail.com",
    rule: "'email:' followed by the email's Message-ID header. Angle brackets are dropped, so email:<id@host> and email:id@host are the same id.",
  },
  notification: {
    format: "notif:<package>:<key>:<postTime>",
    example: "notif:sg.com.transitlink:0|sg.com.transitlink|7|null|10213:1764131700000",
    rule: "'notif:', the app's package, the notification's key (StatusBarNotification.getKey()) and its post time (getPostTime(), epoch milliseconds), joined by ':'.",
  },
  other:
    "Entries that come from neither (a receipt, something the user told you) use any other stable id, as long as it doesn't start with email: or notif:.",
} as const;

const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;
const NOTIFICATION_ID = /^notif:([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+):(.+):(\d{13})$/s;
const MESSAGE_ID = /^[^\s<>]+@[^\s<>]+$/;
const SCHEME_PREFIX = /^(email|notif):/i;

export type ParsedExternalId =
  | { kind: "email"; externalId: string; messageId: string }
  | { kind: "notification"; externalId: string; package: string; key: string; postTime: number }
  | { kind: "other"; externalId: string };

export class ExternalIdError extends Error {}

/**
 * Checks an externalId against its scheme and returns it in its one canonical
 * form. Ids outside both schemes pass unchanged (kind "other").
 */
export function parseExternalId(raw: string): ParsedExternalId {
  const value = raw.trim();
  const prefix = SCHEME_PREFIX.exec(value)?.[1];
  if (!prefix) return { kind: "other", externalId: value };
  if (prefix !== prefix.toLowerCase())
    throw new ExternalIdError(`externalId prefix must be lowercase: ${prefix.toLowerCase()}:`);
  if (prefix === "email") {
    let messageId = value.slice("email:".length).trim();
    if (messageId.startsWith("<") && messageId.endsWith(">")) messageId = messageId.slice(1, -1).trim();
    if (!MESSAGE_ID.test(messageId))
      throw new ExternalIdError(`externalId must be ${EXTERNAL_ID_SCHEMES.email.format}: the Message-ID header, e.g. ${EXTERNAL_ID_SCHEMES.email.example}`);
    return { kind: "email", externalId: `email:${messageId}`, messageId };
  }
  const match = NOTIFICATION_ID.exec(value);
  if (!match || !match[2].trim() || /[\r\n]/.test(match[2]))
    throw new ExternalIdError(
      `externalId must be ${EXTERNAL_ID_SCHEMES.notification.format} with the post time in epoch milliseconds, e.g. ${EXTERNAL_ID_SCHEMES.notification.example}`,
    );
  return { kind: "notification", externalId: value, package: match[1], key: match[2], postTime: Number(match[3]) };
}

/** The canonical form of an externalId; throws ExternalIdError when it breaks its scheme. */
export const normalizeExternalId = (raw: string) => parseExternalId(raw).externalId;

// ── Source input ──────────────────────────────────────────────────────────

const Text = z.string().trim().min(1).max(200);
const List = z.array(Text).max(20);
const EmailAddress = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/, "sender must be an email address, e.g. alerts@bank.com");
const PackageName = z.string().trim().regex(ANDROID_PACKAGE, "sender must be an app package, e.g. sg.com.transitlink");

const SourceFields = {
  accountId: z.string().min(1).optional(),
  cardId: z.string().min(1).nullable().optional(),
  name: z.string().trim().max(80).nullable().optional(),
  senders: List.optional(),
  subjectPatterns: List.optional(),
  textPatterns: List.optional(),
  identifiers: List.optional(),
  channel: z.enum(SOURCE_CHANNELS).optional(),
  enabled: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
};

/** Senders checked for the kind: email addresses, or app packages. Deduplicated. */
export function checkedSenders(kind: SourceKind, senders: string[]) {
  const schema = kind === "email" ? EmailAddress : PackageName;
  return [...new Set(senders.map((sender) => schema.parse(sender)))];
}

const clean = (list: string[] | undefined) =>
  list === undefined ? undefined : [...new Set(list.map((item) => item.trim()).filter(Boolean))];

export const SourceInputSchema = z
  .object({ kind: z.enum(SOURCE_KINDS), ...SourceFields })
  .strict()
  .superRefine((value, context) => {
    if (!value.accountId && !value.cardId)
      context.addIssue({ code: "custom", message: "Give the account (accountId) or the card (cardId)" });
    if (!value.senders?.length)
      context.addIssue({
        code: "custom",
        message: value.kind === "email" ? "Give at least one sender address" : "Give at least one app package",
      });
    try {
      checkedSenders(value.kind, value.senders ?? []);
    } catch (error) {
      if (error instanceof z.ZodError) for (const issue of error.issues) context.addIssue({ code: "custom", message: issue.message });
      else throw error;
    }
  })
  .transform((value) => ({
    ...value,
    senders: checkedSenders(value.kind, value.senders ?? []),
    subjectPatterns: clean(value.subjectPatterns),
    textPatterns: clean(value.textPatterns),
    identifiers: clean(value.identifiers),
  }));
export type SourceInput = z.infer<typeof SourceInputSchema>;

export const SourceUpdateSchema = z
  .object({ kind: z.enum(SOURCE_KINDS).optional(), ...SourceFields })
  .strict()
  .transform((value) => ({
    ...value,
    subjectPatterns: clean(value.subjectPatterns),
    textPatterns: clean(value.textPatterns),
    identifiers: clean(value.identifiers),
  }));
export type SourceUpdate = z.infer<typeof SourceUpdateSchema>;

// ── Matching a message to a source ────────────────────────────────────────

export type SourceRow = {
  id: string;
  accountId: string;
  cardId: string | null;
  kind: string;
  name: string | null;
  senders: string[];
  subjectPatterns: string[];
  textPatterns: string[];
  identifiers: string[];
  channel: string;
  enabled: boolean;
  notes: string | null;
};

const contains = (haystack: string, needles: string[]) => {
  const lower = haystack.toLowerCase();
  return needles.some((needle) => lower.includes(needle.toLowerCase()));
};

/** The address in "DBS Alerts <alerts@dbs.com>", lowercased. */
export function senderAddress(from: string) {
  const angle = /<([^>]+)>/.exec(from)?.[1];
  return (angle ?? from).trim().toLowerCase();
}

/**
 * The enabled source a message came from, or null when none or several fit.
 * Candidates are the sources of the message's kind with its package or sender;
 * when several fit, the card or account the entry was booked to, then the
 * source's identifiers and patterns found in the message's text, decide.
 */
export function pickSource(
  sources: SourceRow[],
  message: {
    kind: SourceKind;
    sender: string | null;
    text: string;
    subject?: string | null;
    cardId?: string | null;
    accountId?: string | null;
  },
): SourceRow | null {
  if (!message.sender) return null;
  const sender = message.kind === "email" ? senderAddress(message.sender) : message.sender;
  let candidates = sources.filter(
    (source) => source.enabled && source.kind === message.kind && source.senders.some((item) => item.toLowerCase() === sender.toLowerCase()),
  );
  const narrow = (keep: (source: SourceRow) => boolean) => {
    const kept = candidates.filter(keep);
    if (kept.length) candidates = kept;
  };
  if (candidates.length > 1 && message.cardId) narrow((source) => source.cardId === message.cardId);
  if (candidates.length > 1 && message.accountId) narrow((source) => source.accountId === message.accountId);
  if (candidates.length > 1) narrow((source) => source.identifiers.length > 0 && contains(message.text, source.identifiers));
  if (candidates.length > 1 && message.subject)
    narrow((source) => source.subjectPatterns.length > 0 && contains(message.subject!, source.subjectPatterns));
  if (candidates.length > 1) narrow((source) => source.textPatterns.length > 0 && contains(message.text, source.textPatterns));
  return candidates.length === 1 ? candidates[0] : null;
}

// ── Main and backup channels ──────────────────────────────────────────────

/** How far apart two reports' clock times may be and still be one purchase (emails can lag). */
export const CHANNEL_TIME_TOLERANCE_MINUTES = 30;

export type ChannelCandidate = DuplicateCandidate & { cardId?: string | null; time?: string | null };

const minutes = (time: string | null | undefined) => {
  const match = time ? /^(\d{2}):(\d{2})/.exec(time) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/**
 * Whether a backup channel's report and a main channel's entry are the same
 * purchase. It is the duplicate scoring statement imports use, plus what the
 * two channels of one card share: the card (+0.2) and the clock time (+0.2
 * when within 10 minutes). Times further apart than
 * CHANNEL_TIME_TOLERANCE_MINUTES, or different cards, are different purchases.
 */
export function scoreChannelPair(left: ChannelCandidate, right: ChannelCandidate) {
  if (left.cardId && right.cardId && left.cardId !== right.cardId) return null;
  const base = scoreDuplicatePair(left, right, 0);
  if (!base) return null;
  let score = base.score;
  const reasons = [...base.reasons];
  const leftTime = minutes(left.time);
  const rightTime = minutes(right.time);
  if (leftTime != null && rightTime != null) {
    const apart = Math.abs(leftTime - rightTime);
    if (apart > CHANNEL_TIME_TOLERANCE_MINUTES) return null;
    if (apart <= 10) {
      score += 0.2;
      reasons.push("Same time");
    }
  }
  if (left.cardId && left.cardId === right.cardId) {
    score += 0.2;
    reasons.push("Same card");
  }
  score = Math.round(score * 100) / 100;
  return score >= DUPLICATE_THRESHOLD ? { score, reasons } : null;
}

// ── The assistant's watch list ────────────────────────────────────────────

type WatchAccount = { id: string; name: string; type: string; institution: string | null };
type WatchCard = { id: string; last4: string; nickname: string | null };

/**
 * Enabled sources grouped by kind, in the shape each job needs: twee's
 * listener allows `notification.packages`, Hermes's mail job searches
 * `email.senders`. Each source says which account or card it reports and
 * whether it is that card's main or backup channel.
 */
export function watchList(
  sources: Array<SourceRow & { account: WatchAccount; card: WatchCard | null }>,
) {
  const enabled = sources.filter((source) => source.enabled);
  const describe = (source: (typeof enabled)[number]) => ({
    id: source.id,
    name: source.name,
    account: { id: source.account.id, name: source.account.name, type: source.account.type },
    card: source.card ? { id: source.card.id, last4: source.card.last4, nickname: source.card.nickname } : null,
    channel: source.channel,
    senders: source.senders,
    subjectPatterns: source.subjectPatterns,
    textPatterns: source.textPatterns,
    identifiers: source.identifiers,
    notes: source.notes,
  });
  const ofKind = (kind: SourceKind) => enabled.filter((source) => source.kind === kind).map(describe);
  const notification = ofKind("notification");
  const email = ofKind("email");
  return {
    notification: {
      externalId: EXTERNAL_ID_SCHEMES.notification.format,
      packages: [...new Set(notification.flatMap((source) => source.senders))].sort(),
      sources: notification,
    },
    email: {
      externalId: EXTERNAL_ID_SCHEMES.email.format,
      senders: [...new Set(email.flatMap((source) => source.senders))].sort(),
      sources: email,
    },
  };
}

// ── Suggestions from existing data ────────────────────────────────────────

export type SourceSuggestion = {
  key: string;
  accountId: string;
  accountName: string;
  cardId: string | null;
  kind: SourceKind;
  name: string;
  senders: string[];
  subjectPatterns: string[];
  textPatterns: string[];
  identifiers: string[];
  channel: SourceChannel;
  notes: string;
  why: string;
};

type SuggestionAccount = {
  id: string;
  name: string;
  institution: string | null;
  archived: boolean;
  identifiers: string[];
  parserIds: string[];
  cards: WatchCard[];
};

/**
 * Sources that are obvious from what Fortuna already knows: PayLah alert
 * emails for the account PayLah statements import into, and the SimplyGo app
 * for the SimplyGo account. They are offered, never added or enabled by
 * themselves; one the user already has is left out.
 */
export function suggestSources(
  accounts: SuggestionAccount[],
  existing: Array<Pick<SourceRow, "accountId" | "kind" | "senders">>,
): SourceSuggestion[] {
  const have = (accountId: string, kind: SourceKind, sender: string) =>
    existing.some(
      (source) => source.accountId === accountId && source.kind === kind && source.senders.some((s) => s.toLowerCase() === sender),
    );
  const named = (account: SuggestionAccount, pattern: RegExp) =>
    [account.name, account.institution ?? "", ...account.identifiers].some((value) => pattern.test(value));
  const suggestions: SourceSuggestion[] = [];
  for (const account of accounts) {
    if (account.archived) continue;
    const paylah = account.parserIds.some((id) => id.startsWith("dbs_paylah")) || named(account, /pay\s?lah/i);
    if (paylah && !have(account.id, "email", PAYLAH_ALERT_SENDER))
      suggestions.push({
        key: `${account.id}:email:${PAYLAH_ALERT_SENDER}`,
        accountId: account.id,
        accountName: account.name,
        cardId: null,
        kind: "email",
        name: "PayLah alert emails",
        senders: [PAYLAH_ALERT_SENDER],
        subjectPatterns: [PAYLAH_ALERT_SUBJECT],
        textPatterns: [],
        identifiers: [],
        channel: "main",
        notes: "One email per payment out (Transaction Ref, Date & Time in SGT, Amount, To). Money received isn't emailed.",
        why: account.parserIds.some((id) => id.startsWith("dbs_paylah"))
          ? "PayLah statements import into this account"
          : "The account is named PayLah",
      });
    const simplygo = account.parserIds.some((id) => id.startsWith("simplygo")) || named(account, /simply\s?go/i);
    if (simplygo && !have(account.id, "notification", "sg.com.transitlink"))
      suggestions.push({
        key: `${account.id}:notification:sg.com.transitlink`,
        accountId: account.id,
        accountName: account.name,
        cardId: account.cards.length === 1 ? account.cards[0].id : null,
        kind: "notification",
        name: "SimplyGo app",
        senders: ["sg.com.transitlink"],
        subjectPatterns: [],
        textPatterns: [],
        identifiers: account.cards.length === 1 ? [`ending ${account.cards[0].last4}`] : [],
        channel: "main",
        notes: "Fare notifications from the SimplyGo app; twee's listener already allows this package.",
        why: account.parserIds.some((id) => id.startsWith("simplygo"))
          ? "SimplyGo statements import into this account"
          : "The account is named SimplyGo",
      });
  }
  return suggestions;
}
