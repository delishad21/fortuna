import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { EntryError, audit, publicEntry, type EntryActor } from "../transactions/assistant-entries.service";
import { buildSearchWhere } from "../transactions/transaction-search";
import { TransactionService } from "../transactions/transactions.service";
import { EPSILON, money, toNumber } from "./links.core";
import { linksTouching, replaceLinks, runInTransaction, type Db } from "./links.service";
import {
  type Allocation,
  type BackfillGuess,
  type OpenItem,
  type Share,
  ShareError,
  describeShare,
  guessFromLabel,
  reimbursableOf,
  nameMatcher,
  parseShare,
  personNames,
  proposeAllocation,
  resolveShare,
  summarizeBalance,
} from "./reimbursables.core";

/**
 * Reimbursable spending: money out the user paid for someone who pays it back.
 * Each item keeps its real category and carries the person and the amount
 * they owe (transactions.reimbursable_*). Repayments are reimbursement links
 * (reimbursement_links, always written through links.service replaceLinks
 * inside runInTransaction); what a person still owes is their items' amounts
 * minus the repayments linked to them. Trips keep their own IOUs (trips.ious.ts).
 */

type Person = { id: string; name: string; aliases: string[]; archivedAt: Date | null };

const MAX_SET = 500;
/** Repayments this recent are offered for linking outside the review queue. */
const PROPOSAL_DAYS = 120;
/** Backfill: an item this old with nothing linked was probably settled outside Fortuna. */
const STALE_DAYS = 90;
/** Backfill: a partly repaid item this old is taken as shared, the repaid part being their share. */
const SETTLED_DAYS = 45;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const linkageType = (linkage: unknown) => {
  const type = record(linkage).type;
  return typeof type === "string" ? type : null;
};
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const shiftDay = (key: string, days: number) => dayKey(new Date(Date.parse(`${key}T00:00:00Z`) + days * 86_400_000));
const daysAgo = (date: Date, now: Date) => Math.floor((now.getTime() - date.getTime()) / 86_400_000);

const shareFromInput = (input: unknown): Share => {
  try {
    return parseShare(input);
  } catch (error) {
    if (error instanceof ShareError) throw new EntryError(400, error.message);
    throw error;
  }
};

const resolveFor = (amountOut: number, share: Share) => {
  try {
    return resolveShare(amountOut, share);
  } catch (error) {
    if (error instanceof ShareError) throw new EntryError(400, error.message);
    throw error;
  }
};

/** Why a transaction can't be reimbursable, or null when it can. */
export function ineligibleReason(row: { amountOut: unknown; linkage: unknown }) {
  if (!(toNumber(row.amountOut) > 0)) return "Only money out can be reimbursable";
  const type = linkageType(row.linkage);
  if (type === "internal") return "An internal transfer can't be reimbursable";
  if (type === "reimbursement") return "A reimbursement can't be reimbursable";
  return null;
}

const personView = (person: Person) => ({
  id: person.id,
  name: person.name,
  aliases: person.aliases,
  archived: !!person.archivedAt,
});

// ---------------------------------------------------------------- people

async function loadPeople(userId: string, includeArchived = true): Promise<Person[]> {
  return prisma.reimbursementPerson.findMany({
    where: { userId, ...(includeArchived ? {} : { archivedAt: null }) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, aliases: true, archivedAt: true },
  });
}

/** A person by id, name or alias (any case). */
export async function findPerson(userId: string, ref: string): Promise<Person | null> {
  const wanted = ref.trim().toLowerCase();
  if (!wanted) return null;
  const people = await loadPeople(userId);
  return (
    people.find((person) => person.id === ref.trim()) ??
    people.find((person) => person.name.toLowerCase() === wanted) ??
    people.find((person) => person.aliases.some((alias) => alias.toLowerCase() === wanted)) ??
    null
  );
}

const cleanAliases = (name: string, aliases: string[] | undefined) =>
  [...new Set((aliases || []).map((alias) => alias.trim()).filter((alias) => alias && alias.toLowerCase() !== name.toLowerCase()))].slice(0, 20);

async function createPersonRow(userId: string, name: string, aliases?: string[]) {
  const clean = name.trim();
  if (!clean) throw new EntryError(400, "A person needs a name");
  if (await findPerson(userId, clean)) throw new EntryError(409, `${clean} is already in your people list`);
  return prisma.reimbursementPerson.create({
    data: { userId, name: clean, aliases: cleanAliases(clean, aliases) },
    select: { id: true, name: true, aliases: true, archivedAt: true },
  });
}

/** A person by reference, created by name when `create` is set and none matches. */
async function personFor(userId: string, ref: string, create: boolean) {
  const found = await findPerson(userId, ref);
  if (found) {
    if (found.archivedAt) await prisma.reimbursementPerson.update({ where: { id: found.id }, data: { archivedAt: null } });
    return { ...found, archivedAt: null };
  }
  if (!create)
    throw new EntryError(404, `No one called "${ref}" in your people list; add them first (or pass createPerson)`, {
      people: (await loadPeople(userId, false)).map((person) => person.name),
    });
  return createPersonRow(userId, ref);
}

// ---------------------------------------------------------------- items and balances

type ItemRow = Prisma.TransactionGetPayload<{ include: { category: true } }>;

/** Repayments linked to each expense: saved links only (staged ones are pending until commit). */
async function repaymentsFor(userId: string, expenseIds: string[]) {
  const byExpense = new Map<string, Array<{ transactionId: string; amount: number; date: string; description: string; label: string | null }>>();
  if (!expenseIds.length) return byExpense;
  const links = await prisma.reimbursementLink.findMany({
    where: { userId, expenseTransactionId: { in: expenseIds }, reimbursementTransactionId: { not: null } },
    include: { reimbursementTransaction: { select: { id: true, date: true, description: true, label: true } } },
    orderBy: { createdAt: "asc" },
  });
  for (const link of links) {
    if (!link.expenseTransactionId || !link.reimbursementTransaction) continue;
    const list = byExpense.get(link.expenseTransactionId) || [];
    list.push({
      transactionId: link.reimbursementTransaction.id,
      amount: money(toNumber(link.amount)),
      date: dayKey(link.reimbursementTransaction.date),
      description: link.reimbursementTransaction.description,
      label: link.reimbursementTransaction.label,
    });
    byExpense.set(link.expenseTransactionId, list);
  }
  return byExpense;
}

function itemView(row: ItemRow, repayments: Array<{ transactionId: string; amount: number; date: string; description: string; label: string | null }>) {
  const owed = money(toNumber(row.reimbursableAmount));
  const repaid = money(repayments.reduce((sum, item) => sum + item.amount, 0));
  const fraction = row.reimbursableShare === null ? null : toNumber(row.reimbursableShare);
  return {
    id: row.id,
    date: dayKey(row.date),
    description: row.description,
    label: row.label,
    category: row.category ? { id: row.category.id, name: row.category.name, color: row.category.color } : null,
    amountOut: money(toNumber(row.amountOut)),
    currency: row.currency,
    personId: row.reimbursablePersonId,
    owed,
    share: describeShare(owed, fraction),
    note: row.reimbursableNote,
    repaid,
    outstanding: money(Math.max(owed - repaid, 0)),
    repayments,
  };
}

export type ItemView = ReturnType<typeof itemView>;

async function loadItems(
  userId: string,
  where: Prisma.TransactionWhereInput = {},
): Promise<ItemView[]> {
  const rows = await prisma.transaction.findMany({
    where: { userId, reimbursablePersonId: { not: null }, ...where },
    include: { category: true },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  const repayments = await repaymentsFor(userId, rows.map((row) => row.id));
  return rows.map((row) => itemView(row, repayments.get(row.id) || []));
}

const openItemsOf = (items: ItemView[]): OpenItem[] =>
  items
    .filter((item) => item.outstanding > EPSILON)
    .map((item) => ({ id: item.id, date: item.date, owed: item.owed, repaid: item.repaid, outstanding: item.outstanding }));

export type OutstandingQuery = {
  person?: string;
  /** YYYY-MM-DD, by the item's date. */
  from?: string;
  to?: string;
  /** open: only items still owing (default); all: every item. */
  items?: "open" | "all" | "none";
  includeArchived?: boolean;
};

/**
 * What each person owes: their items' amounts minus the repayments linked to
 * them, in total and per month of the item, with the items themselves.
 */
export async function outstanding(userId: string, query: OutstandingQuery = {}) {
  const people = query.person
    ? [await findPerson(userId, query.person)].filter((person): person is Person => !!person)
    : await loadPeople(userId, query.includeArchived ?? false);
  if (query.person && !people.length) throw new EntryError(404, `No one called "${query.person}" in your people list`);
  const items = await loadItems(userId, {
    reimbursablePersonId: { in: people.map((person) => person.id) },
    ...(query.from || query.to
      ? {
          date: {
            ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
            ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
  });
  const show = query.items ?? "open";
  const result = people.map((person) => {
    const mine = items.filter((item) => item.personId === person.id);
    const balance = summarizeBalance(mine);
    return {
      person: personView(person),
      ...balance,
      ...(show === "none" ? {} : { itemsList: show === "all" ? mine : mine.filter((item) => item.outstanding > EPSILON) }),
    };
  });
  return {
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
    outstanding: money(result.reduce((sum, person) => sum + person.outstanding, 0)),
    people: result.map(({ itemsList, ...rest }) => ({ ...rest, ...(itemsList ? { items: itemsList } : {}) })),
  };
}

export async function listPeople(userId: string, includeArchived = false) {
  const result = await outstanding(userId, { items: "none", includeArchived });
  return { people: result.people, outstanding: result.outstanding };
}

export async function createPerson(userId: string, input: { name: string; aliases?: string[] }) {
  return { person: personView(await createPersonRow(userId, input.name, input.aliases)) };
}

export async function updatePerson(
  userId: string,
  ref: string,
  input: { name?: string; aliases?: string[]; archived?: boolean },
) {
  const person = await findPerson(userId, ref);
  if (!person) throw new EntryError(404, "Person not found");
  const name = input.name?.trim() || person.name;
  if (name.toLowerCase() !== person.name.toLowerCase()) {
    const other = await findPerson(userId, name);
    if (other && other.id !== person.id) throw new EntryError(409, `${name} is already in your people list`);
  }
  const saved = await prisma.reimbursementPerson.update({
    where: { id: person.id },
    data: {
      name,
      ...(input.aliases !== undefined ? { aliases: cleanAliases(name, input.aliases) } : {}),
      ...(input.archived !== undefined ? { archivedAt: input.archived ? person.archivedAt ?? new Date() : null } : {}),
    },
    select: { id: true, name: true, aliases: true, archivedAt: true },
  });
  return { person: personView(saved) };
}

export async function deletePerson(userId: string, ref: string) {
  const person = await findPerson(userId, ref);
  if (!person) throw new EntryError(404, "Person not found");
  const items = await prisma.transaction.count({ where: { userId, reimbursablePersonId: person.id } });
  if (items) throw new EntryError(409, `${person.name} has ${items} reimbursable item${items === 1 ? "" : "s"}; unmark them or archive ${person.name} instead`);
  await prisma.reimbursementPerson.delete({ where: { id: person.id } });
  return { deleted: person.id };
}

// ---------------------------------------------------------------- marking items

export type SearchInput = {
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  /** Account id or statement identifier. */
  account?: string;
  /** Only rows whose category is this id or name. */
  category?: string;
};

function searchWhere(userId: string, search: SearchInput): Prisma.TransactionWhereInput {
  const and: Prisma.TransactionWhereInput[] = [{ userId }, { amountOut: { gt: 0 } }];
  if (search.query?.trim()) and.push(buildSearchWhere(search.query.trim()));
  if (search.dateFrom || search.dateTo)
    and.push({
      date: {
        ...(search.dateFrom ? { gte: new Date(`${search.dateFrom}T00:00:00.000Z`) } : {}),
        ...(search.dateTo ? { lte: new Date(`${search.dateTo}T23:59:59.999Z`) } : {}),
      },
    });
  if (search.account) and.push({ OR: [{ accountIdentifier: search.account }, { accountId: search.account }] });
  if (search.category)
    and.push({ OR: [{ categoryId: search.category }, { category: { name: { equals: search.category, mode: "insensitive" } } }] });
  return { AND: and };
}

async function rowsFor(userId: string, input: { ids?: string[]; search?: SearchInput }) {
  if (input.ids?.length) {
    const unique = [...new Set(input.ids)];
    const rows = await prisma.transaction.findMany({ where: { userId, id: { in: unique } }, include: { category: true } });
    const missing = unique.filter((id) => !rows.some((row) => row.id === id));
    if (missing.length) throw new EntryError(404, "Transaction not found", { missing });
    return rows;
  }
  if (!input.search || !Object.values(input.search).some((value) => typeof value === "string" && value.trim()))
    throw new EntryError(400, "Pass ids, or a search with at least a query, dates, account or category");
  const where = searchWhere(userId, input.search);
  const count = await prisma.transaction.count({ where });
  if (count > MAX_SET) throw new EntryError(400, `The search matches ${count} transactions; narrow it to at most ${MAX_SET}`);
  return prisma.transaction.findMany({ where, include: { category: true }, orderBy: [{ date: "asc" }, { id: "asc" }] });
}

async function writeFlag(
  userId: string,
  row: ItemRow,
  value: { personId: string; amount: number; fraction: number | null; note?: string | null } | null,
  actor: EntryActor,
  toolName: string,
) {
  const saved = await prisma.transaction.update({
    where: { id: row.id },
    data: value
      ? {
          reimbursablePersonId: value.personId,
          reimbursableAmount: value.amount,
          reimbursableShare: value.fraction,
          ...(value.note !== undefined ? { reimbursableNote: value.note || null } : {}),
        }
      : { reimbursablePersonId: null },
    include: { category: true },
  });
  await audit(userId, actor, toolName, row.id, {
    beforeValue: flagValue(row),
    afterValue: flagValue(saved),
  });
  return saved;
}

const flagValue = (row: ItemRow) =>
  row.reimbursablePersonId
    ? {
        personId: row.reimbursablePersonId,
        amount: money(toNumber(row.reimbursableAmount)),
        share: row.reimbursableShare === null ? null : toNumber(row.reimbursableShare),
        note: row.reimbursableNote,
      }
    : null;

export type SetInput = {
  ids?: string[];
  search?: SearchInput;
  /** Person id, name or alias. */
  person: string;
  /** Add the person when no one by that name exists. */
  createPerson?: boolean;
  share?: unknown;
  note?: string | null;
  /** Only list what would change. */
  preview?: boolean;
};

/**
 * Marks transactions reimbursable to a person, by ids or by a search (to
 * mark past spending). The share is full unless given. Rows that can't be
 * reimbursable (money in, internal transfers, reimbursements) are skipped and
 * listed. With preview nothing is written.
 */
export async function setReimbursable(userId: string, input: SetInput, actor: EntryActor) {
  const share = shareFromInput(input.share);
  const rows = await rowsFor(userId, input);
  const skipped: Array<{ id: string; date: string; description: string; reason: string }> = [];
  const planned: Array<{ row: ItemRow; amount: number; fraction: number | null }> = [];
  for (const row of rows) {
    const reason = ineligibleReason(row);
    if (reason) {
      skipped.push({ id: row.id, date: dayKey(row.date), description: row.label || row.description, reason });
      continue;
    }
    planned.push({ row, ...resolveFor(toNumber(row.amountOut), share) });
  }
  if (input.preview) {
    const person = await findPerson(userId, input.person);
    return {
      preview: true,
      person: person ? personView(person) : { name: input.person.trim(), createsPerson: true },
      matched: planned.map(({ row, amount }) => ({
        id: row.id,
        date: dayKey(row.date),
        description: row.description,
        label: row.label,
        amountOut: money(toNumber(row.amountOut)),
        owed: amount,
        currentPersonId: row.reimbursablePersonId,
      })),
      owed: money(planned.reduce((sum, item) => sum + item.amount, 0)),
      skipped,
    };
  }
  if (!planned.length) throw new EntryError(400, "None of these transactions can be reimbursable", { skipped });
  return runInTransaction(async () => {
    const person = await personFor(userId, input.person, !!input.createPerson);
    const saved = [];
    for (const item of planned)
      saved.push(
        await writeFlag(userId, item.row, { personId: person.id, amount: item.amount, fraction: item.fraction, note: input.note }, actor, "set_reimbursable"),
      );
    return {
      person: personView(person),
      transactions: saved.map((row) => withReimbursable(publicEntry(row), row, person)),
      owed: money(saved.reduce((sum, row) => sum + toNumber(row.reimbursableAmount), 0)),
      skipped,
    };
  });
}

/** Unmarks transactions; linked repayments stay linked. */
export async function clearReimbursable(userId: string, ids: string[], actor: EntryActor) {
  const rows = await rowsFor(userId, { ids });
  return runInTransaction(async () => {
    const saved = [];
    for (const row of rows) saved.push(row.reimbursablePersonId ? await writeFlag(userId, row, null, actor, "clear_reimbursable") : row);
    return { transactions: saved.map((row) => withReimbursable(publicEntry(row), row, null)) };
  });
}

const withReimbursable = <T extends object>(entry: T, row: ItemRow, person: { id: string; name: string } | null) => ({
  ...entry,
  reimbursable: reimbursableOf(row, person),
});

// ---------------------------------------------------------------- repayment proposals

type IncomingRow = {
  id: string;
  date: Date;
  description: string;
  label: string | null;
  amountIn: unknown;
  amountOut: unknown;
  linkage: unknown;
};

export type RepaymentProposal = {
  transactionId: string;
  person: { id: string; name: string };
  /** What the repayment can still pay back. */
  available: number;
  match: Allocation["match"];
  links: Array<{
    transactionId: string;
    date: string;
    description: string;
    label: string | null;
    owed: number;
    outstanding: number;
    amount: number;
  }>;
  unallocated: number;
  remainingOnItems: number;
  /** The repayment must be marked a Reimbursement when it is confirmed. */
  marksReimbursement: boolean;
};

/**
 * Link proposals for money in that looks like a repayment: it names a person
 * (as a word in its description or label) who has open items, and has money
 * left to link. Exact amounts first, else oldest first (see proposeAllocation).
 */
export async function proposeRepayments(userId: string, rows: IncomingRow[]): Promise<Map<string, RepaymentProposal>> {
  const proposals = new Map<string, RepaymentProposal>();
  const incoming = rows.filter((row) => toNumber(row.amountIn) > 0 && linkageType(row.linkage) !== "internal");
  if (!incoming.length) return proposals;
  const people = await loadPeople(userId, false);
  if (!people.length) return proposals;
  const matchers = people.map((person) => ({ person, matches: nameMatcher(person) }));
  const named = incoming
    .map((row) => ({ row, person: matchers.find((item) => item.matches(row.description, row.label))?.person }))
    .filter((item): item is { row: IncomingRow; person: Person } => !!item.person);
  if (!named.length) return proposals;

  const personIds = [...new Set(named.map((item) => item.person.id))];
  const items = await loadItems(userId, { reimbursablePersonId: { in: personIds } });
  const linked = await prisma.reimbursementLink.groupBy({
    by: ["reimbursementTransactionId"],
    where: { userId, reimbursementTransactionId: { in: named.map((item) => item.row.id) }, expenseTransactionId: { not: null } },
    _sum: { amount: true },
  });
  const linkedBy = new Map(linked.map((item) => [item.reimbursementTransactionId, toNumber(item._sum.amount)]));
  const byId = new Map(items.map((item) => [item.id, item]));

  for (const { row, person } of named) {
    const available = money(toNumber(row.amountIn) - (linkedBy.get(row.id) || 0));
    if (available <= EPSILON) continue;
    const open = openItemsOf(items.filter((item) => item.personId === person.id));
    const allocation = proposeAllocation(available, open, shiftDay(dayKey(row.date), 1));
    if (allocation.match === "none") continue;
    proposals.set(row.id, {
      transactionId: row.id,
      person: { id: person.id, name: person.name },
      available,
      match: allocation.match,
      links: allocation.links.map((link) => {
        const item = byId.get(link.transactionId) as ItemView;
        return {
          transactionId: link.transactionId,
          date: item.date,
          description: item.description,
          label: item.label,
          owed: item.owed,
          outstanding: item.outstanding,
          amount: link.amount,
        };
      }),
      unallocated: allocation.unallocated,
      remainingOnItems: allocation.remainingOnItems,
      marksReimbursement: linkageType(row.linkage) !== "reimbursement",
    });
  }
  return proposals;
}

/** Recent money in that looks like a repayment, with its proposed links. */
export async function listRepaymentProposals(userId: string, query: { person?: string; days?: number; transactionId?: string } = {}) {
  const since = new Date(Date.now() - (query.days ?? PROPOSAL_DAYS) * 86_400_000);
  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      amountIn: { gt: 0 },
      ...(query.transactionId ? { id: query.transactionId } : { date: { gte: since } }),
    },
    select: { id: true, date: true, description: true, label: true, amountIn: true, amountOut: true, linkage: true, reviewStatus: true },
    orderBy: { date: "desc" },
  });
  const proposals = await proposeRepayments(userId, rows);
  const person = query.person ? await findPerson(userId, query.person) : null;
  if (query.person && !person) throw new EntryError(404, `No one called "${query.person}" in your people list`);
  return {
    proposals: rows
      .filter((row) => proposals.has(row.id) && (!person || proposals.get(row.id)?.person.id === person.id))
      .map((row) => ({
        repayment: {
          id: row.id,
          date: dayKey(row.date),
          description: row.description,
          label: row.label,
          amountIn: money(toNumber(row.amountIn)),
          reviewStatus: row.reviewStatus,
        },
        ...(proposals.get(row.id) as RepaymentProposal),
      })),
  };
}

/**
 * Adds links from one repayment to expenses, keeping its other links (an
 * expense it already pays back gets the new amount). Marks the repayment a
 * Reimbursement first when it isn't one. Through the links service, so caches
 * and limits stay right.
 */
async function addRepaymentLinks(
  db: Db,
  userId: string,
  repaymentId: string,
  links: Array<{ transactionId: string; amount: number }>,
) {
  const repayment = await prisma.transaction.findFirst({ where: { id: repaymentId, userId }, select: { id: true, amountIn: true, linkage: true } });
  if (!repayment) throw new EntryError(404, "Repayment not found");
  if (!(toNumber(repayment.amountIn) > 0)) throw new EntryError(400, "Only money in can repay reimbursable items");
  if (linkageType(repayment.linkage) === "internal") throw new EntryError(400, "An internal transfer can't repay reimbursable items");
  if (linkageType(repayment.linkage) !== "reimbursement")
    await TransactionService.updateTransaction(repaymentId, userId, { linkage: { type: "reimbursement", leftoverCategoryId: null } as never });
  const existing = (await linksTouching(db, userId, [`t:${repaymentId}`])).filter(
    (link) => link.reimbursementTransactionId === repaymentId && !!link.expenseTransactionId,
  );
  const amounts = new Map(existing.map((link) => [link.expenseTransactionId as string, link.amount]));
  for (const link of links) amounts.set(link.transactionId, money(link.amount));
  return replaceLinks(db, userId, {
    subject: { transactionId: repaymentId },
    role: "reimbursement",
    links: [...amounts.entries()].map(([transactionId, amount]) => ({ other: { transactionId }, amount })),
  });
}

/**
 * Confirms a repayment's links (the proposal, or the user's edit of it). A
 * partial payment leaves the rest of the item outstanding.
 */
export async function confirmRepayment(
  userId: string,
  input: { transactionId: string; links: Array<{ transactionId: string; amount: number }>; markReviewed?: boolean },
  actor: EntryActor,
) {
  if (!input.links.length) throw new EntryError(400, "Choose at least one item it pays back");
  return runInTransaction(async (db) => {
    const before = await prisma.transaction.findFirst({ where: { id: input.transactionId, userId }, include: { category: true } });
    if (!before) throw new EntryError(404, "Repayment not found");
    const { warnings } = await addRepaymentLinks(db, userId, input.transactionId, input.links);
    const now = new Date();
    const saved = await prisma.transaction.update({
      where: { id: input.transactionId },
      data: input.markReviewed === false ? {} : { reviewStatus: "reviewed", reviewReasons: [], reviewedAt: now },
      include: { category: true },
    });
    await audit(userId, actor, "confirm_reimbursement_links", input.transactionId, {
      beforeValue: publicEntry(before),
      afterValue: { ...publicEntry(saved), links: input.links },
    });
    return { transaction: publicEntry(saved), warnings };
  });
}

// ---------------------------------------------------------------- backfill

export type BackfillItem = {
  transactionId: string;
  date: string;
  description: string;
  label: string | null;
  category: { id: string; name: string; color: string } | null;
  amountOut: number;
  /** labelled: the label names the person; linked: one of their repayments is linked to it. */
  source: "labelled" | "linked";
  share: Share;
  owed: number;
  repaid: number;
  outstanding: number;
  selected: boolean;
  confidence: BackfillGuess["confidence"];
  reason: string;
};

/**
 * What marking a person's past items would look like, without writing
 * anything: items whose label names them, items their repayments are already
 * linked to, and recent unlinked repayments that pay off those items exactly.
 * applyBackfill writes what the user keeps.
 */
export async function backfillProposal(userId: string, personRef: string, now = new Date()) {
  const existing = await findPerson(userId, personRef);
  const person = existing ?? { id: null as string | null, name: personRef.trim(), aliases: [] as string[] };
  if (!person.name) throw new EntryError(400, "Name the person whose items to find");
  const matches = nameMatcher(person);
  const names = personNames(person);
  const nameFilter = (field: "label" | "description") =>
    names.map((name) => ({ [field]: { contains: name, mode: "insensitive" as const } }));

  // Their repayments: money in naming them.
  const repayments = (
    await prisma.transaction.findMany({
      where: { userId, amountIn: { gt: 0 }, OR: [...nameFilter("label"), ...nameFilter("description")] },
      select: { id: true, date: true, description: true, label: true, amountIn: true, amountOut: true, linkage: true },
      orderBy: { date: "asc" },
    })
  ).filter((row) => linkageType(row.linkage) !== "internal" && matches(row.description, row.label));
  const repaymentIds = new Set(repayments.map((row) => row.id));

  const labelled = (
    await prisma.transaction.findMany({
      where: { userId, amountOut: { gt: 0 }, reimbursablePersonId: null, OR: nameFilter("label") },
      include: { category: true },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    })
  ).filter((row) => !ineligibleReason(row) && !!row.label && matches(row.label));
  const linkedRows = await prisma.reimbursementLink.findMany({
    where: { userId, reimbursementTransactionId: { in: [...repaymentIds] }, expenseTransactionId: { not: null } },
    select: { expenseTransactionId: true },
  });
  const labelledIds = new Set(labelled.map((row) => row.id));
  const linkedOnly = await prisma.transaction.findMany({
    where: {
      userId,
      reimbursablePersonId: null,
      id: { in: [...new Set(linkedRows.map((link) => link.expenseTransactionId as string))].filter((id) => !labelledIds.has(id)) },
    },
    include: { category: true },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  const candidates = [...labelled, ...linkedOnly.filter((row) => !ineligibleReason(row))];
  const repaid = await repaymentsFor(userId, candidates.map((row) => row.id));

  const items: BackfillItem[] = candidates.map((row) => {
    const amountOut = money(toNumber(row.amountOut));
    const links = repaid.get(row.id) || [];
    const linkedTotal = money(links.reduce((sum, link) => sum + link.amount, 0));
    const fromThem = money(links.filter((link) => repaymentIds.has(link.transactionId)).reduce((sum, link) => sum + link.amount, 0));
    const age = daysAgo(row.date, now);
    let guess: BackfillGuess;
    let source: BackfillItem["source"] = "labelled";
    if (labelledIds.has(row.id)) {
      guess = guessFromLabel(row.label as string, person) as BackfillGuess;
      if (linkedTotal > EPSILON && linkedTotal < amountOut - EPSILON && age > SETTLED_DAYS)
        guess = { ...guess, share: { kind: "amount", amount: linkedTotal }, reason: `Partly repaid (${linkedTotal.toFixed(2)} of ${amountOut.toFixed(2)}); taken as ${person.name}'s share` };
      else if (linkedTotal <= EPSILON && age > STALE_DAYS && guess.selected)
        guess = { ...guess, selected: false, confidence: "low", reason: `Older than ${STALE_DAYS} days with no repayment linked; probably settled outside Fortuna. Tick it to count it as owed` };
    } else {
      source = "linked";
      guess = {
        share: fromThem >= amountOut - EPSILON ? { kind: "full" } : { kind: "amount", amount: fromThem },
        selected: true,
        confidence: "high",
        reason: `Already paid back by ${person.name}'s repayment${links.length === 1 ? "" : "s"} (${fromThem.toFixed(2)})`,
      };
    }
    const { amount: owed } = resolveShare(amountOut, guess.share);
    return {
      transactionId: row.id,
      date: dayKey(row.date),
      description: row.description,
      label: row.label,
      category: row.category ? { id: row.category.id, name: row.category.name, color: row.category.color } : null,
      amountOut,
      source,
      share: describeShare(owed, guess.share.kind === "amount" ? null : guess.share.kind === "full" ? 1 : guess.share.fraction),
      owed,
      repaid: linkedTotal,
      outstanding: money(Math.max(owed - linkedTotal, 0)),
      selected: guess.selected,
      confidence: guess.confidence,
      reason: guess.reason,
    };
  });

  // Recent repayments with money left, against what would be open after the
  // ticked items are marked (plus items already marked): exact matches only.
  const already = existing ? await loadItems(userId, { reimbursablePersonId: existing.id }) : [];
  const open: OpenItem[] = [
    ...openItemsOf(already),
    ...items
      .filter((item) => item.selected && item.outstanding > EPSILON)
      .map((item) => ({ id: item.transactionId, date: item.date, owed: item.owed, repaid: item.repaid, outstanding: item.outstanding })),
  ];
  const linkedByRepayment = await prisma.reimbursementLink.groupBy({
    by: ["reimbursementTransactionId"],
    where: { userId, reimbursementTransactionId: { in: [...repaymentIds] }, expenseTransactionId: { not: null } },
    _sum: { amount: true },
  });
  const usedBy = new Map(linkedByRepayment.map((row) => [row.reimbursementTransactionId, toNumber(row._sum.amount)]));
  const describe = new Map<string, { description: string; label: string | null }>([
    ...already.map((item) => [item.id, { description: item.description, label: item.label }] as const),
    ...items.map((item) => [item.transactionId, { description: item.description, label: item.label }] as const),
  ]);
  const links: Array<{
    repayment: { id: string; date: string; description: string; label: string | null; amountIn: number };
    available: number;
    match: Allocation["match"];
    links: Array<{ transactionId: string; date: string; description: string; label: string | null; amount: number }>;
    marksReimbursement: boolean;
    selected: boolean;
  }> = [];
  const since = new Date(now.getTime() - PROPOSAL_DAYS * 86_400_000);
  for (const row of repayments) {
    if (row.date < since) continue;
    const available = money(toNumber(row.amountIn) - (usedBy.get(row.id) || 0));
    if (available <= EPSILON) continue;
    const allocation = proposeAllocation(available, open, shiftDay(dayKey(row.date), 1));
    if (allocation.match !== "exact" && allocation.match !== "exact_set") continue;
    for (const link of allocation.links) {
      const item = open.find((entry) => entry.id === link.transactionId) as OpenItem;
      item.outstanding = money(item.outstanding - link.amount);
    }
    links.push({
      repayment: { id: row.id, date: dayKey(row.date), description: row.description, label: row.label, amountIn: money(toNumber(row.amountIn)) },
      available,
      match: allocation.match,
      links: allocation.links.map((link) => ({
        transactionId: link.transactionId,
        date: open.find((entry) => entry.id === link.transactionId)?.date as string,
        ...(describe.get(link.transactionId) as { description: string; label: string | null }),
        amount: link.amount,
      })),
      marksReimbursement: linkageType(row.linkage) !== "reimbursement",
      selected: true,
    });
  }

  const selected = items.filter((item) => item.selected);
  const alreadyMarked = existing
    ? await prisma.transaction.count({ where: { userId, reimbursablePersonId: existing.id } })
    : 0;
  return {
    person: existing ? personView(existing) : { id: null, name: person.name, aliases: [], archived: false, createsPerson: true },
    items,
    links,
    alreadyMarked,
    summary: {
      items: items.length,
      selected: selected.length,
      owed: money(selected.reduce((sum, item) => sum + item.owed, 0)),
      repaid: money(selected.reduce((sum, item) => sum + Math.min(item.repaid, item.owed), 0)),
      outstanding: money(selected.reduce((sum, item) => sum + item.outstanding, 0)),
      linksToAdd: links.reduce((sum, group) => sum + group.links.reduce((acc, link) => acc + link.amount, 0), 0),
    },
  };
}

export type BackfillApplyInput = {
  person: string;
  items: Array<{ transactionId: string; share?: unknown; note?: string | null }>;
  links?: Array<{ repaymentId: string; links: Array<{ transactionId: string; amount: number }> }>;
};

/** Writes the backfill the user kept: marks the items, then links the repayments. One transaction. */
export async function applyBackfill(userId: string, input: BackfillApplyInput, actor: EntryActor) {
  if (!input.items.length && !input.links?.length) throw new EntryError(400, "Nothing to apply");
  const rows = input.items.length ? await rowsFor(userId, { ids: input.items.map((item) => item.transactionId) }) : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  return runInTransaction(async (db) => {
    const person = await personFor(userId, input.person, true);
    let marked = 0;
    for (const item of input.items) {
      const row = byId.get(item.transactionId) as ItemRow;
      const reason = ineligibleReason(row);
      if (reason) throw new EntryError(400, `${row.label || row.description}: ${reason}`);
      if (row.reimbursablePersonId && row.reimbursablePersonId !== person.id)
        throw new EntryError(409, `${row.label || row.description} is already reimbursable to someone else`);
      const { amount, fraction } = resolveFor(toNumber(row.amountOut), shareFromInput(item.share));
      await writeFlag(userId, row, { personId: person.id, amount, fraction, note: item.note }, actor, "backfill_reimbursable");
      marked += 1;
    }
    let linked = 0;
    const warnings: string[] = [];
    for (const group of input.links || []) {
      if (!group.links.length) continue;
      const result = await addRepaymentLinks(db, userId, group.repaymentId, group.links);
      warnings.push(...result.warnings);
      linked += group.links.length;
    }
    return { person: personView(person), marked, linked, warnings };
  });
}
