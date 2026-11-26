import { z } from "zod";
import { ExternalIdError, normalizeExternalId } from "../sources/sources";
import { AssistantDecisionSchema, QuestionInputSchema } from "./entry-review";

/**
 * Input rules for transactions the outside assistant writes through
 * /api/agent/transactions (scope transactions:write). Entries go straight into
 * the ledger with entrySource "assistant" and are queued for review. Fortuna
 * detects transfers between the user's own accounts and applies enabled
 * rules; everything else is the assistant's decision (decision: category,
 * type, label, merchant, reason, confidence, precedents), with a learned
 * pattern or history match only when the assistant sends none. An unknown
 * card or account becomes a question on the entry.
 */

export const ENTRY_SOURCES = ["assistant", "manual", "statement", "mobile"] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})$/;
// The calendar date and clock time are taken as written, so a notification at
// 07:00 +08:00 stays on its own day instead of moving to the day before in UTC.
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const TIME = /^(\d{2}):(\d{2})(?::\d{2})?$/;

function validDay(day: string) {
  const date = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

function validTime(time: string) {
  const match = TIME.exec(time);
  return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60);
}

/**
 * Splits the assistant's date (and optional separate time) into the stored
 * date, midnight UTC of the calendar day like statement rows, and the clock
 * time kept in metadata.
 */
export function entryDateParts(dateInput: string, timeInput?: string | null) {
  const text = dateInput.trim();
  const dateOnly = DATE_ONLY.exec(text);
  const dateTime = dateOnly ? null : DATE_TIME.exec(text);
  const day = dateOnly?.[1] ?? dateTime?.[1];
  if (!day || !validDay(day)) throw new Error("date must be YYYY-MM-DD or an ISO date and time");
  let time = dateTime?.[2] ?? null;
  if (timeInput != null && timeInput.trim()) {
    if (!validTime(timeInput.trim())) throw new Error("time must be HH:MM");
    time = timeInput.trim().slice(0, 5);
  }
  if (time && !validTime(time)) throw new Error("time must be HH:MM");
  return {
    date: new Date(`${day}T00:00:00.000Z`),
    time,
    occurredAt: dateTime ? text : null,
  };
}

const Money = z.number().finite().positive().max(9_999_999_999.99);

const CardSchema = z
  .object({
    id: z.string().trim().min(1).max(120).optional(),
    last4: z.string().trim().regex(/^\d{4}$/, "card.last4 must be four digits").optional(),
  })
  .strict()
  .refine((card) => card.id || card.last4, "card needs an id or last4");

const EntryFields = {
  date: z.string().trim().min(1).max(40),
  time: z.string().trim().max(8).nullish(),
  description: z.string().trim().min(1).max(500),
  label: z.string().trim().max(200).nullish(),
  amountIn: Money.nullish(),
  amountOut: Money.nullish(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "currency must be a three-letter code").nullish(),
  suggestedCategory: z.string().trim().min(1).max(120).nullish(),
  account: z.string().trim().min(1).max(120).nullish(),
  accountName: z.string().trim().min(1).max(120).nullish(),
  card: CardSchema.nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  /** The assistant's classification, made from similar past entries and the user's instructions. */
  decision: AssistantDecisionSchema.nullish(),
  /** Questions for the review when the assistant is unsure. */
  questions: z.array(QuestionInputSchema).max(5).nullish(),
};

/**
 * An externalId in its canonical form. email: and notif: ids must follow
 * their scheme (see EXTERNAL_ID_SCHEMES in modules/sources/sources.ts); other
 * ids pass as sent.
 */
export const ExternalIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .transform((value, context) => {
    try {
      return normalizeExternalId(value);
    } catch (error) {
      if (!(error instanceof ExternalIdError)) throw error;
      context.addIssue({ code: "custom", message: error.message });
      return z.NEVER;
    }
  });

export const CreateEntrySchema = z
  .object({
    externalId: ExternalIdSchema,
    ...EntryFields,
    /** The source (Settings → Sources) the message came from, from get_entry_sources. */
    sourceId: z.string().trim().min(1).max(120).nullish(),
    /** An email's From address; finds the source when sourceId is left out. */
    sender: z.string().trim().min(1).max(320).nullish(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasIn = value.amountIn != null;
    const hasOut = value.amountOut != null;
    if (hasIn === hasOut)
      context.addIssue({ code: "custom", message: "Give exactly one of amountIn or amountOut" });
  });

export const UpdateEntrySchema = z
  .object({
    date: EntryFields.date.optional(),
    time: EntryFields.time,
    description: EntryFields.description.optional(),
    label: EntryFields.label,
    amountIn: EntryFields.amountIn,
    amountOut: EntryFields.amountOut,
    currency: EntryFields.currency,
    suggestedCategory: EntryFields.suggestedCategory,
    account: EntryFields.account,
    accountName: EntryFields.accountName,
    card: EntryFields.card,
    metadata: EntryFields.metadata,
    decision: EntryFields.decision,
    questions: EntryFields.questions,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.amountIn != null && value.amountOut != null)
      context.addIssue({ code: "custom", message: "Give only one of amountIn or amountOut" });
  });

export type CreateEntryInput = z.infer<typeof CreateEntrySchema>;
export type UpdateEntryInput = z.infer<typeof UpdateEntrySchema>;

/** The digits of an account identifier, e.g. "4265-****-****-4591" → "42654591". */
export function identifierDigits(identifier: string) {
  return identifier.replace(/\D/g, "");
}

/** Accounts a card's last 4 digits could belong to: identifiers ending in them. */
export function accountsForLast4<T extends { accountIdentifier: string }>(accounts: T[], last4: string) {
  return accounts.filter((account) => identifierDigits(account.accountIdentifier).endsWith(last4));
}

/** Parses the list filters `entrySource` (comma-separated) and `reconciled` (true/false). */
export function parseEntryFilters(query: { entrySource?: unknown; reconciled?: unknown }) {
  const sources = query.entrySource
    ? String(query.entrySource)
        .split(",")
        .map((value) => value.trim())
        .filter((value): value is EntrySource => (ENTRY_SOURCES as readonly string[]).includes(value))
    : [];
  const reconciled =
    query.reconciled === "true" || query.reconciled === true
      ? true
      : query.reconciled === "false" || query.reconciled === false
        ? false
        : undefined;
  return { entrySources: sources.length ? sources : undefined, reconciled };
}
