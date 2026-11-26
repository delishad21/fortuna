import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../../lib/prisma";
import { deleteImageIfUnused, imageBytesFromInput, saveImage } from "../images/image-store";
import { moveAccountSources, moveCardSources } from "../sources/sources.service";

/**
 * Accounts (FinancialAccount), the statement identifiers that map to them and
 * the cards under them. Transactions follow identifiers and cards through
 * database triggers (see the 20261126000500_financial_accounts migration), so
 * moving an identifier or merging accounts moves their transactions too.
 */

export const ACCOUNT_TYPES = ["savings", "current", "credit_card", "other"] as const;
export const CARD_NETWORKS = ["visa", "mastercard", "amex", "unionpay", "jcb", "discover", "nets", "other"] as const;

export const IdentifierSchema = z.string().trim().min(1).max(120);
export const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "color must be a six-digit hex value");
export const Last4Schema = z.string().trim().regex(/^[0-9]{4}$/, "last4 must be exactly 4 digits");
const NameSchema = z.string().trim().min(1).max(80);
const OptionalText = z.string().trim().max(80).nullable().optional();

export const AccountInputSchema = z.object({
  name: NameSchema,
  institution: OptionalText,
  type: z.enum(ACCOUNT_TYPES).default("other"),
  color: ColorSchema.default("#6366f1"),
  identifiers: z.array(IdentifierSchema).max(20).optional(),
  /** Created by the assistant because nothing matched: listed for review. */
  autoCreated: z.boolean().optional(),
  /** What it was created from, e.g. "identifier:532392****2124" or "card:1234". */
  autoCreatedFrom: z.string().trim().max(200).nullable().optional(),
});
export const AccountUpdateSchema = z.object({
  name: NameSchema.optional(),
  institution: OptionalText,
  type: z.enum(ACCOUNT_TYPES).optional(),
  color: ColorSchema.optional(),
  archived: z.boolean().optional(),
});
export const CardInputSchema = z.object({
  last4: Last4Schema,
  network: z.enum(CARD_NETWORKS).nullable().optional(),
  nickname: OptionalText,
});
export const CardUpdateSchema = CardInputSchema.partial().extend({
  accountId: z.string().min(1).optional(),
});
export const ImageInputSchema = z
  .object({ base64: z.string().min(1).optional(), url: z.string().url().max(2000).optional() })
  .refine((v) => Boolean(v.base64) !== Boolean(v.url), "Send exactly one of base64 or url");

type Db = Prisma.TransactionClient;

const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};

export const imageUrl = (imageId: string | null | undefined) =>
  imageId ? `/api/images/${imageId}` : null;

const accountInclude = {
  identifiers: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  cards: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  _count: { select: { transactions: true } },
} satisfies Prisma.FinancialAccountInclude;

type AccountRow = Prisma.FinancialAccountGetPayload<{ include: typeof accountInclude }>;
type CardRow = Prisma.CardGetPayload<object>;

export function publicCard(card: CardRow, account?: { imageId: string | null }) {
  const effective = card.imageId || account?.imageId || null;
  return {
    id: card.id,
    accountId: card.accountId,
    last4: card.last4,
    network: card.network,
    nickname: card.nickname,
    imageId: card.imageId,
    /** The card's own image, else its account's. */
    imageUrl: imageUrl(effective),
  };
}

export function publicAccount(account: AccountRow) {
  return {
    id: account.id,
    name: account.name,
    institution: account.institution,
    type: account.type,
    color: account.color,
    archived: account.archived,
    /** Created automatically and not yet confirmed or merged by the user. */
    autoCreated: account.autoCreated,
    autoCreatedFrom: account.autoCreatedFrom,
    imageId: account.imageId,
    imageUrl: imageUrl(account.imageId),
    identifiers: account.identifiers.map((i) => ({ id: i.id, identifier: i.accountIdentifier })),
    cards: account.cards.map((card) => publicCard(card, account)),
    transactionCount: account._count.transactions,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}
export type PublicAccount = ReturnType<typeof publicAccount>;

async function ownedAccount(db: Db, userId: string, accountId: string) {
  const account = await db.financialAccount.findFirst({ where: { id: accountId, userId } });
  return account ?? fail(404, "Account not found");
}

async function ownedCard(db: Db, userId: string, cardId: string) {
  const card = await db.card.findFirst({ where: { id: cardId, userId } });
  return card ?? fail(404, "Card not found");
}

export async function getAccount(db: Db, userId: string, accountId: string) {
  const account = await db.financialAccount.findFirst({
    where: { id: accountId, userId },
    include: accountInclude,
  });
  return publicAccount(account ?? fail(404, "Account not found"));
}

export async function listAccounts(
  db: Db,
  userId: string,
  options: { includeArchived?: boolean; needsReview?: boolean } = {},
) {
  const accounts = await db.financialAccount.findMany({
    where: {
      userId,
      ...(options.includeArchived ? {} : { archived: false }),
      ...(options.needsReview ? { autoCreated: true } : {}),
    },
    include: accountInclude,
    orderBy: [{ archived: "asc" }, { name: "asc" }],
  });
  return accounts.map(publicAccount);
}

async function assertIdentifiersFree(db: Db, userId: string, identifiers: string[]) {
  const taken = await db.accountIdentifier.findMany({
    where: { userId, accountIdentifier: { in: identifiers } },
    include: { account: { select: { name: true } } },
  });
  if (taken.length)
    fail(
      409,
      taken
        .map((t) => `${t.accountIdentifier} already belongs to ${t.account?.name ?? "another account"}; move it instead`)
        .join(". "),
    );
}

export async function createAccount(db: Db, userId: string, input: z.infer<typeof AccountInputSchema>) {
  const identifiers = [...new Set(input.identifiers ?? [])];
  await assertIdentifiersFree(db, userId, identifiers);
  const account = await db.financialAccount.create({
    data: {
      userId,
      name: input.name,
      institution: input.institution || null,
      type: input.type,
      color: input.color,
      autoCreated: input.autoCreated ?? false,
      autoCreatedFrom: input.autoCreated ? input.autoCreatedFrom || null : null,
    },
  });
  for (const identifier of identifiers)
    await db.accountIdentifier.create({
      data: { userId, accountIdentifier: identifier, accountId: account.id, color: input.color, label: input.name },
    });
  return getAccount(db, userId, account.id);
}

export async function updateAccount(db: Db, userId: string, accountId: string, input: z.infer<typeof AccountUpdateSchema>) {
  await ownedAccount(db, userId, accountId);
  await db.financialAccount.update({
    where: { id: accountId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.institution !== undefined ? { institution: input.institution || null } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.archived !== undefined ? { archived: input.archived } : {}),
    },
  });
  return getAccount(db, userId, accountId);
}

/**
 * An account no longer needs review: clears its flag and the new_account
 * review reason on its transactions.
 * Returns how many transactions lost the reason.
 */
export async function markAccountReviewed(db: Db, userId: string, accountId: string) {
  await db.financialAccount.update({ where: { id: accountId }, data: { autoCreated: false } });
  const flagged = await db.transaction.findMany({
    where: { userId, accountId, reviewReasons: { has: "new_account" } },
    select: { id: true, reviewReasons: true },
  });
  for (const row of flagged)
    await db.transaction.update({
      where: { id: row.id },
      data: { reviewReasons: row.reviewReasons.filter((reason) => reason !== "new_account") },
    });
  return flagged.length;
}

/** Keeps an automatically created account as it is: it no longer needs review. */
export async function confirmAccount(db: Db, userId: string, accountId: string) {
  await ownedAccount(db, userId, accountId);
  await markAccountReviewed(db, userId, accountId);
  return getAccount(db, userId, accountId);
}

/** Deletes an account no transaction uses (with its identifiers and cards). */
export async function deleteAccount(db: Db, userId: string, accountId: string) {
  const account = await ownedAccount(db, userId, accountId);
  const [count, cards, identifiers] = await Promise.all([
    db.transaction.count({ where: { userId, accountId } }),
    db.card.findMany({ where: { accountId }, select: { imageId: true } }),
    db.accountIdentifier.findMany({ where: { accountId }, select: { accountIdentifier: true } }),
  ]);
  if (count > 0)
    fail(409, `${account.name} has ${count} transaction${count === 1 ? "" : "s"}; archive it or merge it into another account instead`);
  if (identifiers.length) {
    const used = await db.transaction.count({
      where: { userId, accountIdentifier: { in: identifiers.map((i) => i.accountIdentifier) } },
    });
    if (used > 0) fail(409, `${account.name}'s identifiers are still used by transactions`);
  }
  await db.financialAccount.delete({ where: { id: accountId } });
  for (const imageId of [account.imageId, ...cards.map((c) => c.imageId)]) await deleteImageIfUnused(db, imageId);
}

/**
 * Moves everything on one account (identifiers, cards, sources, transactions, its image
 * when the target has none) onto another, then deletes it. Cards with the same
 * last 4 digits become one card.
 */
export async function mergeAccount(db: Db, userId: string, sourceId: string, targetId: string) {
  if (sourceId === targetId) fail(400, "Pick a different account to merge into");
  const [source, target] = await Promise.all([ownedAccount(db, userId, sourceId), ownedAccount(db, userId, targetId)]);
  const [sourceCards, targetCards] = await Promise.all([
    db.card.findMany({ where: { accountId: source.id } }),
    db.card.findMany({ where: { accountId: target.id } }),
  ]);
  const targetByLast4 = new Map(targetCards.map((c) => [c.last4, c]));
  // Order matters for the triggers: cards first, so transactions keep them
  // when their identifiers move; twins are re-attached after the move.
  const twins: Array<{ source: CardRow; twin: CardRow; transactionIds: string[] }> = [];
  for (const card of sourceCards) {
    const twin = targetByLast4.get(card.last4);
    if (twin) {
      const rows = await db.transaction.findMany({ where: { userId, cardId: card.id }, select: { id: true } });
      twins.push({ source: card, twin, transactionIds: rows.map((r) => r.id) });
    } else {
      await db.card.update({ where: { id: card.id }, data: { accountId: target.id } });
    }
  }
  // Moving identifiers moves the transactions that carry them (trigger).
  await db.accountIdentifier.updateMany({ where: { userId, accountId: source.id }, data: { accountId: target.id } });
  await db.transaction.updateMany({ where: { userId, accountId: source.id }, data: { accountId: target.id } });
  // Sources too, before twin cards are deleted (their sources would go with them).
  await moveAccountSources(
    db,
    userId,
    source.id,
    target.id,
    twins.map(({ source: card, twin }) => ({ from: card.id, to: twin.id })),
  );
  for (const { source: card, twin, transactionIds } of twins) {
    await db.transaction.updateMany({ where: { userId, id: { in: transactionIds } }, data: { cardId: twin.id } });
    if (!twin.imageId && card.imageId) await db.card.update({ where: { id: twin.id }, data: { imageId: card.imageId } });
    await db.card.delete({ where: { id: card.id } });
  }
  if (!target.imageId && source.imageId)
    await db.financialAccount.update({ where: { id: target.id }, data: { imageId: source.imageId } });
  await db.financialAccount.delete({ where: { id: source.id } });
  // Merging a created account into a real one settles its review.
  if (source.autoCreated && !target.autoCreated) await markAccountReviewed(db, userId, target.id);
  return getAccount(db, userId, target.id);
}

/** Adds a statement identifier to an account, moving it there if another account has it. */
export async function attachIdentifier(db: Db, userId: string, accountId: string, identifier: string) {
  const account = await ownedAccount(db, userId, accountId);
  const existing = await db.accountIdentifier.findUnique({
    where: { userId_accountIdentifier: { userId, accountIdentifier: identifier } },
  });
  if (existing) {
    if (existing.accountId !== account.id)
      await db.accountIdentifier.update({ where: { id: existing.id }, data: { accountId: account.id } });
  } else {
    await db.accountIdentifier.create({
      data: { userId, accountIdentifier: identifier, accountId: account.id, color: account.color, label: account.name },
    });
  }
  return getAccount(db, userId, account.id);
}

/** Removes an identifier no transaction carries. */
export async function detachIdentifier(db: Db, userId: string, identifierId: string) {
  const identifier = await db.accountIdentifier.findFirst({ where: { id: identifierId, userId } });
  if (!identifier) return fail(404, "Identifier not found");
  const used = await db.transaction.count({ where: { userId, accountIdentifier: identifier.accountIdentifier } });
  if (used > 0)
    fail(409, `${identifier.accountIdentifier} is used by ${used} transaction${used === 1 ? "" : "s"}; move it to another account instead`);
  await db.accountIdentifier.delete({ where: { id: identifier.id } });
}

export async function addCard(db: Db, userId: string, accountId: string, input: z.infer<typeof CardInputSchema>) {
  const account = await ownedAccount(db, userId, accountId);
  const clash = await db.card.findUnique({ where: { accountId_last4: { accountId: account.id, last4: input.last4 } } });
  if (clash) fail(409, `${account.name} already has a card ending ${input.last4}`);
  const card = await db.card.create({
    data: { userId, accountId: account.id, last4: input.last4, network: input.network ?? null, nickname: input.nickname || null },
  });
  return publicCard(card, account);
}

export async function updateCard(db: Db, userId: string, cardId: string, input: z.infer<typeof CardUpdateSchema>) {
  const card = await ownedCard(db, userId, cardId);
  const accountId = input.accountId ?? card.accountId;
  const account = await ownedAccount(db, userId, accountId);
  const last4 = input.last4 ?? card.last4;
  if (accountId !== card.accountId || last4 !== card.last4) {
    const clash = await db.card.findUnique({ where: { accountId_last4: { accountId, last4 } } });
    if (clash && clash.id !== card.id) fail(409, `${account.name} already has a card ending ${last4}`);
  }
  const saved = await db.card.update({
    where: { id: card.id },
    data: {
      accountId,
      last4,
      ...(input.network !== undefined ? { network: input.network } : {}),
      ...(input.nickname !== undefined ? { nickname: input.nickname || null } : {}),
    },
  });
  // The card's transactions go with it to the new account.
  if (accountId !== card.accountId) {
    await db.transaction.updateMany({ where: { userId, cardId: card.id }, data: { accountId, cardId: card.id } });
    await moveCardSources(db, userId, card.id, accountId);
  }
  return publicCard(saved, account);
}

export async function deleteCard(db: Db, userId: string, cardId: string) {
  const card = await ownedCard(db, userId, cardId);
  await db.card.delete({ where: { id: card.id } });
  await deleteImageIfUnused(db, card.imageId);
}

/**
 * Accounts and cards matching what a notification or statement names: card
 * last 4 digits, or a statement identifier (also matched by its last 4).
 */
export async function resolveAccount(db: Db, userId: string, query: { last4?: string; identifier?: string }) {
  const matches: Array<{ account: PublicAccount; card: ReturnType<typeof publicCard> | null; matchedBy: string }> = [];
  const seen = new Set<string>();
  const push = (account: AccountRow, card: CardRow | null, matchedBy: string) => {
    const key = `${account.id}:${card?.id ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    matches.push({ account: publicAccount(account), card: card ? publicCard(card, account) : null, matchedBy });
  };
  if (query.identifier) {
    const exact = await db.accountIdentifier.findUnique({
      where: { userId_accountIdentifier: { userId, accountIdentifier: query.identifier } },
      include: { account: { include: accountInclude } },
    });
    if (exact?.account) push(exact.account, null, "identifier");
  }
  const last4 =
    query.last4 ?? (query.identifier && /[0-9]{4}$/.test(query.identifier) ? query.identifier.slice(-4) : undefined);
  if (last4) {
    const cards = await db.card.findMany({
      where: { userId, last4 },
      include: { account: { include: accountInclude } },
    });
    for (const card of cards) push(card.account, card, "card_last4");
    const identifiers = await db.accountIdentifier.findMany({
      where: { userId, accountIdentifier: { endsWith: last4 } },
      include: { account: { include: accountInclude } },
    });
    for (const identifier of identifiers) if (identifier.account) push(identifier.account, null, "identifier_last4");
  }
  return matches;
}

/** Sets (from base64 or a URL) or clears the image of a transaction, account or card. */
export async function setImage(
  db: Db,
  userId: string,
  target: { type: "transaction" | "account" | "card"; id: string },
  input: z.infer<typeof ImageInputSchema> | null,
) {
  const current =
    target.type === "transaction"
      ? await db.transaction.findFirst({ where: { id: target.id, userId }, select: { imageId: true } })
      : target.type === "account"
        ? await db.financialAccount.findFirst({ where: { id: target.id, userId }, select: { imageId: true } })
        : await db.card.findFirst({ where: { id: target.id, userId }, select: { imageId: true } });
  if (!current) return fail(404, `${target.type[0].toUpperCase()}${target.type.slice(1)} not found`);
  let imageId: string | null = null;
  if (input) {
    const { bytes, sourceUrl } = await imageBytesFromInput(input);
    imageId = (await saveImage(db, userId, bytes, { sourceUrl })).id;
  }
  const data = { imageId };
  if (target.type === "transaction") await db.transaction.update({ where: { id: target.id }, data });
  else if (target.type === "account") await db.financialAccount.update({ where: { id: target.id }, data });
  else await db.card.update({ where: { id: target.id }, data });
  if (current.imageId && current.imageId !== imageId) await deleteImageIfUnused(db, current.imageId);
  return { imageId, imageUrl: imageUrl(imageId), previousImageId: current.imageId };
}

export async function runInTransaction<T>(work: (db: Db) => Promise<T>) {
  return prisma.$transaction(work, { timeout: 30000 });
}
