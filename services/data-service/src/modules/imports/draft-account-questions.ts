import { z } from "zod";
import prisma from "../../lib/prisma";
import { addCard, attachIdentifier, createAccount, runInTransaction } from "../accounts/accounts.service";
import { identifierDigits } from "../transactions/assistant-entries";

/**
 * A statement draft whose account identifier Fortuna doesn't know gets a
 * question instead of an account made up for it: add it as a card under an
 * existing account, link the identifier to an existing account, or create a
 * new account. Answering does that, so the draft validates and commits.
 */

export const DraftAccountAnswerSchema = z
  .object({
    identifier: z.string().trim().min(1).max(120),
    /** One of the question's option ids: add_card:<accountId>, link:<accountId> or new_account:<type>. */
    option: z.string().trim().min(1).max(200),
    /** The new account's name, for new_account. */
    name: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

/** A card number as statements print it: masked or long, ending in 4 digits. */
export function looksLikeCard(identifier: string) {
  const digits = identifierDigits(identifier);
  return /\*|x{2,}/i.test(identifier) ? digits.length >= 4 : digits.length >= 12;
}

export async function draftAccountQuestions(userId: string, identifiers: string[]) {
  if (!identifiers.length) return [];
  const accounts = await prisma.financialAccount.findMany({
    where: { userId, archived: false, autoCreated: false },
    select: { id: true, name: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 6,
  });
  return identifiers.map((identifier) => {
    const card = looksLikeCard(identifier);
    const last4 = identifierDigits(identifier).slice(-4);
    return {
      identifier,
      key: `unknown_account:${identifier.toLowerCase()}`,
      field: "account" as const,
      prompt: card
        ? `The statement is for card ${identifier}, which Fortuna doesn't know. Where does it belong?`
        : `The statement's account “${identifier}” isn't one Fortuna knows. Which account is it?`,
      options: [
        ...(card ? accounts.map((account) => ({ id: `add_card:${account.id}`, label: `Add card ••${last4} to ${account.name}` })) : []),
        ...accounts.map((account) => ({ id: `link:${account.id}`, label: `Link it to ${account.name}` })),
        { id: card ? "new_account:credit_card" : "new_account:savings", label: card ? "New credit card account" : "New bank account" },
      ],
    };
  });
}

export async function answerDraftAccountQuestion(userId: string, input: z.infer<typeof DraftAccountAnswerSchema>) {
  const known = await prisma.accountIdentifier.findFirst({
    where: { userId, accountIdentifier: input.identifier, accountId: { not: null } },
    select: { accountId: true },
  });
  if (known) throw Object.assign(new Error(`${input.identifier} already belongs to an account`), { status: 409 });
  const split = input.option.indexOf(":");
  const action = split > 0 ? input.option.slice(0, split) : input.option;
  const arg = split > 0 ? input.option.slice(split + 1) : "";
  const last4 = identifierDigits(input.identifier).slice(-4);
  return runInTransaction(async (db) => {
    if (action === "link" || action === "add_card") {
      const account = await db.financialAccount.findFirst({ where: { id: arg, userId }, select: { id: true } });
      if (!account) throw Object.assign(new Error("Account not found"), { status: 404 });
      await attachIdentifier(db, userId, account.id, input.identifier);
      if (action === "add_card" && /^\d{4}$/.test(last4)) {
        const existing = await db.card.findUnique({ where: { accountId_last4: { accountId: account.id, last4 } } });
        if (!existing) await addCard(db, userId, account.id, { last4 });
      }
      return { accountId: account.id, identifier: input.identifier, created: false };
    }
    if (action === "new_account") {
      const type = (["credit_card", "savings", "current", "other"] as const).find((item) => item === arg) ?? "other";
      const account = await createAccount(db, userId, {
        name: input.name || (type === "credit_card" ? `Card ending ${last4}` : input.identifier),
        type,
        color: "#6366f1",
        identifiers: [input.identifier],
      });
      if (type === "credit_card" && /^\d{4}$/.test(last4)) await addCard(db, userId, account.id, { last4 });
      return { accountId: account.id, identifier: input.identifier, created: true };
    }
    throw Object.assign(new Error(`Unknown option "${input.option}"`), { status: 400 });
  });
}
