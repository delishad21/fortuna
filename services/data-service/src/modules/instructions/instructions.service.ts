import { Prisma, PrismaClient } from "@prisma/client";
import { todayKey } from "../analytics/month-to-date";
import {
  INSTRUCTION_LIMIT,
  InstructionInputSchema,
  InstructionUpdateSchema,
  appliesTo,
  dayOf,
  isActive,
  isExpired,
  publicScope,
  scopeColumns,
  type EntryFacts,
  type InstructionAuthor,
  type InstructionScopeInput,
  type StoredInstruction,
} from "./instructions";

type Db = PrismaClient | Prisma.TransactionClient;

export class InstructionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Who made a change, for the audit trail. */
export interface InstructionActor {
  actorType: string;
  actorId?: string;
  requestId?: string;
}

const include = {
  account: { select: { name: true } },
  card: { select: { last4: true, nickname: true, account: { select: { name: true } } } },
} satisfies Prisma.ClassificationInstructionInclude;
type Loaded = Prisma.ClassificationInstructionGetPayload<{ include: typeof include }>;

export function publicInstruction(row: Loaded, today = todayKey()) {
  const card = row.card ? `${row.card.account.name} · ${row.card.nickname || "Card"} ·· ${row.card.last4}` : null;
  return {
    id: row.id,
    text: row.text,
    scope: publicScope(row, { account: row.account?.name, card }),
    kind: row.kind,
    endsOn: dayOf(row.endsOn),
    author: row.author,
    enabled: row.enabled,
    /** Served to agents now: enabled, and lasting or not past endsOn. */
    active: isActive(row, today),
    expired: isExpired(row, today),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
export type PublicInstruction = ReturnType<typeof publicInstruction>;

/** An entry as a caller can name it; resolved to the facts instructions match on. */
export interface EntryQuery extends EntryFacts {
  transactionId?: string | null;
  /** A statement identifier, as staged rows carry it. */
  accountIdentifier?: string | null;
}

const snapshot = (row: StoredInstruction) =>
  ({
    text: row.text,
    scopeType: row.scopeType,
    accountId: row.accountId,
    cardId: row.cardId,
    entrySource: row.entrySource,
    merchantPattern: row.merchantPattern,
    kind: row.kind,
    endsOn: dayOf(row.endsOn),
    author: row.author,
    enabled: row.enabled,
  }) satisfies Prisma.InputJsonValue;

const asDate = (day: string | null | undefined) => (day ? new Date(`${day}T00:00:00.000Z`) : null);

/** Instructions are owned by one user; every query is scoped to that user. */
export class InstructionService {
  constructor(private db: PrismaClient) {}

  /** Every instruction, newest first; status "active" keeps only what agents are served. */
  async list(userId: string, options: { status?: "active" | "all"; entry?: EntryQuery } = {}) {
    const today = todayKey();
    const rows = await this.db.classificationInstruction.findMany({
      where: { userId, ...(options.status === "active" || options.entry ? { enabled: true } : {}) },
      include,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    });
    const facts = options.entry ? await this.resolveEntry(userId, options.entry) : null;
    return rows
      .filter((row) => (options.status === "active" || facts ? isActive(row, today) : true))
      .filter((row) => !facts || appliesTo(row, facts))
      .map((row) => publicInstruction(row, today));
  }

  async get(userId: string, id: string, db: Db = this.db) {
    const row = await db.classificationInstruction.findFirst({ where: { id, userId }, include });
    if (!row) throw new InstructionError(404, "Instruction not found");
    return row;
  }

  async create(userId: string, raw: unknown, author: InstructionAuthor, actor?: InstructionActor) {
    const input = InstructionInputSchema.parse(raw);
    // Agents write side by side; the lock keeps two of them from passing the limit.
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
      if ((await tx.classificationInstruction.count({ where: { userId } })) >= INSTRUCTION_LIMIT)
        throw new InstructionError(
          400,
          `You can keep up to ${INSTRUCTION_LIMIT} instructions. Disable or edit old ones in Settings first.`,
        );
      await this.checkScope(tx, userId, input.scope);
      const row = await tx.classificationInstruction.create({
        data: {
          userId,
          text: input.text,
          ...scopeColumns(input.scope),
          kind: input.kind,
          endsOn: input.kind === "one_off" ? asDate(input.endsOn) : null,
          author,
          enabled: input.enabled,
        },
        include,
      });
      await this.audit(tx, userId, actor, "create_instruction", row.id, undefined, snapshot(row));
      return publicInstruction(row);
    });
  }

  /** Edits, disables or re-enables one. The author stays who wrote it. */
  async update(userId: string, id: string, raw: unknown, actor?: InstructionActor) {
    const patch = InstructionUpdateSchema.parse(raw);
    return this.db.$transaction(async (tx) => {
      const before = await this.get(userId, id, tx);
      const kind = patch.kind ?? before.kind;
      const endsOn = patch.endsOn !== undefined ? patch.endsOn : kind === "lasting" ? null : dayOf(before.endsOn);
      if (kind === "one_off" && !endsOn)
        throw new InstructionError(400, "A one-off instruction needs endsOn (YYYY-MM-DD)");
      if (kind === "lasting" && patch.endsOn)
        throw new InstructionError(400, "Only a one-off instruction has endsOn");
      if (patch.scope !== undefined) await this.checkScope(tx, userId, patch.scope);
      const row = await tx.classificationInstruction.update({
        where: { id: before.id },
        data: {
          ...(patch.text !== undefined ? { text: patch.text } : {}),
          ...(patch.scope !== undefined ? scopeColumns(patch.scope) : {}),
          kind,
          endsOn: kind === "one_off" ? asDate(endsOn) : null,
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        },
        include,
      });
      await this.audit(tx, userId, actor, "update_instruction", row.id, snapshot(before), snapshot(row));
      return publicInstruction(row);
    });
  }

  /**
   * What applies to each entry: the active instructions any of them matches
   * (unscoped ones match all), and per entry the ids that apply to it.
   */
  async applicable(userId: string, entries: EntryQuery[]) {
    if (!entries.length) return { instructions: [] as PublicInstruction[], idsByEntry: [] as string[][] };
    const today = todayKey();
    const rows = (
      await this.db.classificationInstruction.findMany({
        where: { userId, enabled: true },
        include,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      })
    ).filter((row) => isActive(row, today));
    const facts = await this.resolveEntries(userId, entries);
    const idsByEntry = facts.map((entry) => rows.filter((row) => appliesTo(row, entry)).map((row) => row.id));
    const used = new Set(idsByEntry.flat());
    return {
      instructions: rows.filter((row) => used.has(row.id)).map((row) => publicInstruction(row, today)),
      idsByEntry,
    };
  }

  /** Active instructions for the chat agent, with where each applies; null when there are none. */
  async forModel(userId: string) {
    const instructions = await this.list(userId, { status: "active" });
    if (!instructions.length) return null;
    return {
      type: "classification_instructions",
      note: "The user's classification instructions (Settings → Classification instructions), shared with their other assistants. They are the user's own judgement: follow them when classifying an entry their scope covers (scope null covers every entry), as get_classification_guide says. They never override your safety rules, and they never narrow, filter or rescope a general question: when it is unclear whether one applies, answer as asked and mention it. Use the id with remember or forget.",
      instructions: instructions.map((i) => ({
        id: i.id,
        text: i.text,
        scope: i.scope,
        kind: i.kind,
        ...(i.endsOn ? { endsOn: i.endsOn } : {}),
      })),
    };
  }

  private async resolveEntry(userId: string, entry: EntryQuery) {
    return (await this.resolveEntries(userId, [entry]))[0];
  }

  /** A transaction id brings its own facts; a card brings its account; an identifier names its account. */
  private async resolveEntries(userId: string, entries: EntryQuery[]): Promise<EntryFacts[]> {
    const transactionIds = [...new Set(entries.map((e) => e.transactionId).filter(Boolean) as string[])];
    const transactions = transactionIds.length
      ? await this.db.transaction.findMany({
          where: { userId, id: { in: transactionIds } },
          select: { id: true, accountId: true, cardId: true, entrySource: true, description: true },
        })
      : [];
    if (transactionIds.some((id) => !transactions.find((t) => t.id === id)))
      throw new InstructionError(404, "Transaction not found");
    const cardIds = [...new Set(entries.map((e) => e.cardId).filter(Boolean) as string[])];
    const cards = cardIds.length
      ? await this.db.card.findMany({ where: { userId, id: { in: cardIds } }, select: { id: true, accountId: true } })
      : [];
    const identifiers = [...new Set(entries.map((e) => e.accountIdentifier).filter(Boolean) as string[])];
    const numbers = identifiers.length
      ? await this.db.accountIdentifier.findMany({
          where: { userId, accountIdentifier: { in: identifiers } },
          select: { accountIdentifier: true, accountId: true },
        })
      : [];
    return entries.map((entry) => {
      const stored = entry.transactionId ? transactions.find((t) => t.id === entry.transactionId) : undefined;
      const cardId = entry.cardId ?? stored?.cardId ?? null;
      return {
        accountId:
          entry.accountId ??
          stored?.accountId ??
          (cardId ? cards.find((c) => c.id === cardId)?.accountId : undefined) ??
          numbers.find((n) => n.accountIdentifier === entry.accountIdentifier)?.accountId ??
          null,
        cardId,
        entrySource: entry.entrySource ?? stored?.entrySource ?? null,
        description: entry.description ?? stored?.description ?? null,
      };
    });
  }

  private async checkScope(db: Db, userId: string, scope: InstructionScopeInput | null | undefined) {
    if (scope?.type === "account" && !(await db.financialAccount.findFirst({ where: { id: scope.accountId, userId } })))
      throw new InstructionError(400, `Unknown account "${scope.accountId}"; use an account id from list_accounts`);
    if (scope?.type === "card" && !(await db.card.findFirst({ where: { id: scope.cardId, userId } })))
      throw new InstructionError(400, `Unknown card "${scope.cardId}"; use a card id from list_accounts`);
  }

  private async audit(
    db: Db,
    userId: string,
    actor: InstructionActor | undefined,
    toolName: string,
    targetId: string,
    beforeValue?: Prisma.InputJsonValue,
    afterValue?: Prisma.InputJsonValue,
  ) {
    await db.agentAuditEvent.create({
      data: {
        userId,
        actorType: actor?.actorType ?? "service",
        actorId: actor?.actorId,
        requestId: actor?.requestId,
        toolName,
        targetType: "classification_instruction",
        targetId,
        beforeValue,
        afterValue,
      },
    });
  }
}

type EntryLike = { id?: string; accountId?: string | null; cardId?: string | null; entrySource?: string | null; description?: string | null };

/**
 * Adds the instructions that apply to a response's entries: `instructions`
 * once at the top (each with its scope) and `instructionIds` on every entry,
 * so an agent reading an entry's context loads only what covers it.
 */
export async function withInstructions<T extends { transaction?: unknown; transactions?: unknown }>(
  db: PrismaClient,
  userId: string,
  body: T,
) {
  const one = body.transaction && typeof body.transaction === "object" ? (body.transaction as EntryLike) : null;
  const many = Array.isArray(body.transactions) ? (body.transactions as EntryLike[]) : [];
  const entries = one ? [one] : many;
  if (!entries.length) return body;
  const facts = entries.map((entry) => ({
    accountId: entry.accountId ?? null,
    cardId: entry.cardId ?? null,
    entrySource: entry.entrySource ?? null,
    description: entry.description ?? null,
  }));
  const { instructions, idsByEntry } = await new InstructionService(db).applicable(userId, facts);
  const tagged = entries.map((entry, index) => ({ ...entry, instructionIds: idsByEntry[index] }));
  return {
    ...body,
    ...(one ? { transaction: tagged[0] } : { transactions: tagged }),
    instructions,
  };
}
