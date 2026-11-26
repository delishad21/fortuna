// Classification instructions: the user's judgement about how to classify, in
// their words ("SimplyGo journeys between Simei and Townsville are
// Madeline's"). One store in Fortuna, read and written by Fortuna's chat agent,
// the outside assistant (Hermes and twee through finance-mcp) and the apps'
// Settings. Rules hold facts that never change; instructions hold judgement;
// precedents (similar past entries) cover the rest.
//
// An instruction applies everywhere, or only to one account, card, entry
// source or merchant pattern, so an agent loads only what applies to the
// entry in front of it. A one-off instruction stops being served after its
// end date.

import { z } from "zod";
import { todayKey } from "../analytics/month-to-date";
import { ENTRY_SOURCES } from "../transactions/assistant-entries";

export const INSTRUCTION_SCOPES = ["account", "card", "entry_source", "merchant"] as const;
export const INSTRUCTION_KINDS = ["lasting", "one_off"] as const;
export const INSTRUCTION_AUTHORS = ["user", "fortuna_chat", "assistant"] as const;
export type InstructionScope = (typeof INSTRUCTION_SCOPES)[number];
export type InstructionKind = (typeof INSTRUCTION_KINDS)[number];
export type InstructionAuthor = (typeof INSTRUCTION_AUTHORS)[number];

export const INSTRUCTION_LIMIT = 200;
export const INSTRUCTION_TEXT_MAX = 1000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Where an instruction applies. Absent (or null) means everywhere. */
export const ScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("account"), accountId: z.string().trim().min(1).max(120) }).strict(),
  z.object({ type: z.literal("card"), cardId: z.string().trim().min(1).max(120) }).strict(),
  z.object({ type: z.literal("entry_source"), entrySource: z.enum(ENTRY_SOURCES) }).strict(),
  z.object({ type: z.literal("merchant"), pattern: z.string().trim().min(2).max(120) }).strict(),
]);
export type InstructionScopeInput = z.infer<typeof ScopeSchema>;

const text = z.string().trim().min(1).max(INSTRUCTION_TEXT_MAX);
const endsOn = z.string().regex(DAY, "endsOn must be YYYY-MM-DD");

export const InstructionInputSchema = z
  .object({
    text,
    scope: ScopeSchema.nullable().optional(),
    kind: z.enum(INSTRUCTION_KINDS).default("lasting"),
    endsOn: endsOn.nullable().optional(),
    enabled: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "one_off" && !value.endsOn)
      context.addIssue({ code: "custom", path: ["endsOn"], message: "A one-off instruction needs endsOn (YYYY-MM-DD)" });
    if (value.kind === "lasting" && value.endsOn)
      context.addIssue({ code: "custom", path: ["endsOn"], message: "Only a one-off instruction has endsOn" });
  });
export type InstructionInput = z.infer<typeof InstructionInputSchema>;

/** An edit: every field optional; kind and endsOn are checked against the saved instruction. */
export const InstructionUpdateSchema = z
  .object({
    text: text.optional(),
    scope: ScopeSchema.nullable().optional(),
    kind: z.enum(INSTRUCTION_KINDS).optional(),
    endsOn: endsOn.nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
export type InstructionUpdate = z.infer<typeof InstructionUpdateSchema>;

/** What an entry (a transaction, a staged row, or one about to be written) shows. */
export interface EntryFacts {
  accountId?: string | null;
  cardId?: string | null;
  entrySource?: string | null;
  description?: string | null;
}

export interface StoredInstruction {
  id: string;
  text: string;
  scopeType: string | null;
  accountId: string | null;
  cardId: string | null;
  entrySource: string | null;
  merchantPattern: string | null;
  kind: string;
  endsOn: Date | null;
  author: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const dayOf = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

/** Served to agents: enabled, and lasting or not past its end date (in Fortuna's timezone). */
export function isActive(instruction: Pick<StoredInstruction, "enabled" | "kind" | "endsOn">, today = todayKey()) {
  if (!instruction.enabled) return false;
  if (instruction.kind !== "one_off") return true;
  const last = dayOf(instruction.endsOn);
  return !!last && last >= today;
}

export function isExpired(instruction: Pick<StoredInstruction, "kind" | "endsOn">, today = todayKey()) {
  const last = dayOf(instruction.endsOn);
  return instruction.kind === "one_off" && !!last && last < today;
}

/**
 * Whether an instruction covers an entry. Unscoped ones cover every entry; an
 * account scope covers the account's cards too; a merchant pattern is a
 * case-insensitive piece of the description.
 */
export function appliesTo(instruction: StoredInstruction, entry: EntryFacts) {
  switch (instruction.scopeType) {
    case null:
      return true;
    case "account":
      return !!entry.accountId && entry.accountId === instruction.accountId;
    case "card":
      return !!entry.cardId && entry.cardId === instruction.cardId;
    case "entry_source":
      return !!entry.entrySource && entry.entrySource === instruction.entrySource;
    case "merchant":
      return (
        !!instruction.merchantPattern &&
        !!entry.description &&
        entry.description.toLowerCase().includes(instruction.merchantPattern.trim().toLowerCase())
      );
    default:
      return false;
  }
}

/** The columns a scope sets; every other scope column is cleared. */
export function scopeColumns(scope: InstructionScopeInput | null | undefined) {
  return {
    scopeType: scope?.type ?? null,
    accountId: scope?.type === "account" ? scope.accountId : null,
    cardId: scope?.type === "card" ? scope.cardId : null,
    entrySource: scope?.type === "entry_source" ? scope.entrySource : null,
    merchantPattern: scope?.type === "merchant" ? scope.pattern : null,
  };
}

/** The scope as the API shows it, with the account or card's name when known. */
export function publicScope(
  instruction: StoredInstruction,
  names: { account?: string | null; card?: string | null } = {},
) {
  switch (instruction.scopeType) {
    case "account":
      return { type: "account" as const, accountId: instruction.accountId, label: names.account ?? "Account" };
    case "card":
      return { type: "card" as const, cardId: instruction.cardId, label: names.card ?? "Card" };
    case "entry_source":
      return { type: "entry_source" as const, entrySource: instruction.entrySource, label: `${instruction.entrySource} entries` };
    case "merchant":
      return { type: "merchant" as const, pattern: instruction.merchantPattern, label: `Descriptions containing "${instruction.merchantPattern}"` };
    default:
      return null;
  }
}
