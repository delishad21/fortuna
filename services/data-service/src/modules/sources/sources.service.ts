import { Prisma } from "@prisma/client";
import {
  checkedSenders,
  suggestSources,
  watchList,
  type SourceInput,
  type SourceKind,
  type SourceUpdate,
} from "./sources";

type Db = Prisma.TransactionClient;

const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};

const sourceInclude = {
  account: { select: { id: true, name: true, type: true, institution: true, color: true, archived: true } },
  card: { select: { id: true, last4: true, nickname: true, network: true } },
  _count: { select: { reports: true } },
} satisfies Prisma.TransactionSourceInclude;

type SourceRecord = Prisma.TransactionSourceGetPayload<{ include: typeof sourceInclude }>;

export function publicSource(source: SourceRecord) {
  return {
    id: source.id,
    kind: source.kind as SourceKind,
    name: source.name,
    accountId: source.accountId,
    cardId: source.cardId,
    account: { id: source.account.id, name: source.account.name, type: source.account.type, color: source.account.color },
    card: source.card ? { id: source.card.id, last4: source.card.last4, nickname: source.card.nickname, network: source.card.network } : null,
    senders: source.senders,
    subjectPatterns: source.subjectPatterns,
    textPatterns: source.textPatterns,
    identifiers: source.identifiers,
    channel: source.channel as "main" | "backup",
    enabled: source.enabled,
    notes: source.notes,
    /** Messages from it that reached Fortuna. */
    reportCount: source._count.reports,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}
export type PublicSource = ReturnType<typeof publicSource>;

/** The account and card a source is on: a card's source is on the card's account. */
async function placement(db: Db, userId: string, input: { accountId?: string; cardId?: string | null }) {
  if (input.cardId) {
    const card = await db.card.findFirst({ where: { id: input.cardId, userId }, select: { id: true, accountId: true } });
    if (!card) return fail(404, "Card not found");
    if (input.accountId && input.accountId !== card.accountId) fail(400, "That card belongs to another account");
    return { accountId: card.accountId, cardId: card.id };
  }
  const account = await db.financialAccount.findFirst({ where: { id: input.accountId, userId }, select: { id: true } });
  if (!account) return fail(404, "Account not found");
  return { accountId: account.id, cardId: null };
}

export async function getSource(db: Db, userId: string, sourceId: string) {
  const source = await db.transactionSource.findFirst({ where: { id: sourceId, userId }, include: sourceInclude });
  return publicSource(source ?? fail(404, "Source not found"));
}

export async function listSources(
  db: Db,
  userId: string,
  filter: { accountId?: string; kind?: SourceKind; enabled?: boolean } = {},
) {
  const sources = await db.transactionSource.findMany({
    where: {
      userId,
      ...(filter.accountId ? { accountId: filter.accountId } : {}),
      ...(filter.kind ? { kind: filter.kind } : {}),
      ...(filter.enabled !== undefined ? { enabled: filter.enabled } : {}),
    },
    include: sourceInclude,
    orderBy: [{ account: { name: "asc" } }, { kind: "asc" }, { createdAt: "asc" }],
  });
  return sources.map(publicSource);
}

export async function createSource(db: Db, userId: string, input: SourceInput) {
  const where = await placement(db, userId, input);
  const saved = await db.transactionSource.create({
    data: {
      userId,
      ...where,
      kind: input.kind,
      name: input.name || null,
      senders: input.senders,
      subjectPatterns: input.subjectPatterns ?? [],
      textPatterns: input.textPatterns ?? [],
      identifiers: input.identifiers ?? [],
      channel: input.channel ?? "main",
      // Nothing watches a source until someone turns it on.
      enabled: input.enabled ?? false,
      notes: input.notes || null,
    },
  });
  return getSource(db, userId, saved.id);
}

export async function updateSource(db: Db, userId: string, sourceId: string, input: SourceUpdate) {
  const current = await db.transactionSource.findFirst({ where: { id: sourceId, userId } });
  if (!current) return fail(404, "Source not found");
  const kind = (input.kind ?? current.kind) as SourceKind;
  const senders = input.senders ?? current.senders;
  if (!senders.length) fail(400, kind === "email" ? "Give at least one sender address" : "Give at least one app package");
  const moved =
    input.accountId !== undefined || input.cardId !== undefined
      ? await placement(db, userId, {
          accountId: input.accountId ?? (input.cardId ? undefined : current.accountId),
          cardId: input.cardId === undefined ? current.cardId : input.cardId,
        })
      : null;
  await db.transactionSource.update({
    where: { id: current.id },
    data: {
      ...(moved ?? {}),
      kind,
      senders: checkedSenders(kind, senders),
      ...(input.name !== undefined ? { name: input.name || null } : {}),
      ...(input.subjectPatterns !== undefined ? { subjectPatterns: input.subjectPatterns } : {}),
      ...(input.textPatterns !== undefined ? { textPatterns: input.textPatterns } : {}),
      ...(input.identifiers !== undefined ? { identifiers: input.identifiers } : {}),
      ...(input.channel !== undefined ? { channel: input.channel } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
    },
  });
  return getSource(db, userId, current.id);
}

/** Deletes a source. Transactions it reported keep their record of it (the report loses its source). */
export async function deleteSource(db: Db, userId: string, sourceId: string) {
  const source = await getSource(db, userId, sourceId);
  await db.transactionSource.delete({ where: { id: source.id } });
  return source;
}

/** Enabled sources grouped by kind, for twee's listener and Hermes's mail job. */
export async function sourceWatchList(db: Db, userId: string) {
  const sources = await db.transactionSource.findMany({
    where: { userId, enabled: true, account: { archived: false } },
    include: sourceInclude,
    orderBy: [{ account: { name: "asc" } }, { createdAt: "asc" }],
  });
  return watchList(sources);
}

/** Sources Fortuna can tell from existing accounts and imports; offered, never added by themselves. */
export async function sourceSuggestions(db: Db, userId: string) {
  const [accounts, parsers, existing] = await Promise.all([
    db.financialAccount.findMany({
      where: { userId, archived: false },
      include: {
        identifiers: { select: { accountIdentifier: true } },
        cards: { select: { id: true, last4: true, nickname: true }, orderBy: { createdAt: "asc" } },
      },
    }),
    db.$queryRaw<Array<{ account_id: string; parser_id: string }>>`
      SELECT DISTINCT account_id, metadata->>'parserId' AS parser_id
      FROM transactions
      WHERE user_id = ${userId} AND account_id IS NOT NULL AND metadata->>'parserId' IS NOT NULL`,
    db.transactionSource.findMany({ where: { userId }, select: { accountId: true, kind: true, senders: true } }),
  ]);
  return suggestSources(
    accounts.map((account) => ({
      id: account.id,
      name: account.name,
      institution: account.institution,
      archived: account.archived,
      identifiers: account.identifiers.map((item) => item.accountIdentifier),
      parserIds: parsers.filter((row) => row.account_id === account.id).map((row) => row.parser_id),
      cards: account.cards,
    })),
    existing,
  );
}

/** A card moved to another account: its sources go with it. */
export async function moveCardSources(db: Db, userId: string, cardId: string, accountId: string) {
  await db.transactionSource.updateMany({ where: { userId, cardId }, data: { accountId } });
}

/**
 * Merging accounts: the source account's sources move to the target, and
 * sources on a card that is folded into its twin move to the twin.
 */
export async function moveAccountSources(
  db: Db,
  userId: string,
  fromAccountId: string,
  toAccountId: string,
  cardTwins: Array<{ from: string; to: string }>,
) {
  for (const twin of cardTwins)
    await db.transactionSource.updateMany({ where: { userId, cardId: twin.from }, data: { cardId: twin.to } });
  await db.transactionSource.updateMany({ where: { userId, accountId: fromAccountId }, data: { accountId: toAccountId } });
}
