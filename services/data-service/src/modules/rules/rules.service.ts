import { Prisma, type ImportRule } from "@prisma/client";
import { z } from "zod";
import prisma from "../../lib/prisma";
import { TransactionService, RULE_ORIGINS, type RuleOrigin } from "../transactions/transactions.service";
import { AssistantEntries, audit, EntryError, type EntryActor } from "../transactions/assistant-entries.service";

/**
 * Classification rules, for facts that stay true without upkeep (a card's
 * BUS/MRT rides are Internal, a fixed monthly bill). Everything else is the
 * assistant's decision from similar past entries and the user's instructions.
 *
 * Each rule has an origin: user (made in Fortuna), assistant_on_request (the
 * user asked the assistant for it) or assistant_detected (the assistant saw a
 * pattern). An assistant_detected rule needs a reason and either at least
 * MIN_EXAMPLES consistent reviewed examples or a stated recurring bill, and it
 * is listed in the review queue until a review has seen it, with Undo.
 */

export const MIN_EXAMPLES = 3;

const Money = z.number().finite().nonnegative().max(9_999_999_999.99);

const RecurringBillSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    amount: Money.optional(),
    frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]).optional(),
  })
  .strict();

const RuleFields = {
  name: z.string().trim().min(1).max(100).optional(),
  matchType: z.enum(["always", "description_contains"]).default("description_contains"),
  matchValue: z.string().trim().min(2).max(200).nullish(),
  caseSensitive: z.boolean().optional(),
  /** Scope: an account (id, identifier or name) or one card (id, or last4 when only one card has it). */
  account: z.string().trim().min(1).max(120).nullish(),
  card: z
    .object({ id: z.string().trim().min(1).max(64).optional(), last4: z.string().regex(/^\d{4}$/).optional() })
    .strict()
    .nullish(),
  setCategory: z.string().trim().min(1).max(120).nullish(),
  setLabel: z.string().trim().min(1).max(200).nullish(),
  markInternal: z.boolean().optional(),
  amountMin: Money.nullish(),
  amountMax: Money.nullish(),
  reason: z.string().trim().min(1).max(1000).nullish(),
  exampleIds: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  recurringBill: RecurringBillSchema.nullish(),
  sortOrder: z.number().int().min(-1000).max(100000).optional(),
};

export const CreateRuleSchema = z
  .object({
    ...RuleFields,
    origin: z.enum(["assistant_on_request", "assistant_detected"]),
    reason: z.string().trim().min(1).max(1000),
    enabled: z.boolean().default(true),
  })
  .strict()
  .refine((value) => value.matchType === "always" || value.matchValue, "description_contains needs matchValue")
  .refine((value) => value.setCategory || value.setLabel || value.markInternal, "A rule must set a category, a label or Internal");

export const UpdateRuleSchema = z
  .object({ ...RuleFields, matchType: RuleFields.matchType.optional(), enabled: z.boolean().optional() })
  .strict();

export const ListRulesQuerySchema = z
  .object({
    origin: z.enum(RULE_ORIGINS).optional(),
    enabled: z.enum(["true", "false"]).optional(),
  })
  .strict();

type RuleRow = ImportRule & {
  account?: { id: string; name: string } | null;
  card?: { id: string; last4: string } | null;
};

/** A rule as the API, the review queue and the apps show it. */
export function publicRule(rule: RuleRow, examples: Map<string, ExampleView> = new Map()) {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    origin: rule.origin as RuleOrigin,
    reason: rule.reason,
    matchType: rule.matchType,
    matchValue: rule.matchValue,
    caseSensitive: rule.caseSensitive,
    parserId: rule.parserId,
    accountIdentifier: rule.accountIdentifier,
    accountId: rule.accountId,
    account: rule.account ? { id: rule.account.id, name: rule.account.name } : null,
    cardId: rule.cardId,
    card: rule.card ? { id: rule.card.id, last4: rule.card.last4 } : null,
    setCategoryName: rule.setCategoryName,
    setLabel: rule.setLabel,
    markInternal: rule.markInternal,
    amountMin: rule.amountMin == null ? null : Number(rule.amountMin),
    amountMax: rule.amountMax == null ? null : Number(rule.amountMax),
    recurringBill: rule.recurringBill ?? null,
    exampleTransactionIds: rule.exampleTransactionIds,
    examples: rule.exampleTransactionIds.map((id) => examples.get(id)).filter((item): item is ExampleView => Boolean(item)),
    hitCount: rule.hitCount,
    lastHitAt: rule.lastHitAt,
    acknowledgedAt: rule.acknowledgedAt,
    undoneAt: rule.undoneAt,
    sortOrder: rule.sortOrder,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}
export type PublicRule = ReturnType<typeof publicRule>;

type ExampleView = {
  id: string;
  date: string;
  description: string;
  label: string | null;
  amountIn: number | null;
  amountOut: number | null;
  category: string | null;
  reviewStatus: string;
};

const ruleInclude = {
  account: { select: { id: true, name: true } },
  card: { select: { id: true, last4: true } },
} satisfies Prisma.ImportRuleInclude;

async function exampleViews(userId: string, ids: string[]) {
  if (!ids.length) return new Map<string, ExampleView>();
  const rows = await prisma.transaction.findMany({
    where: { userId, id: { in: [...new Set(ids)] } },
    include: { category: { select: { name: true } } },
  });
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        date: row.date.toISOString().slice(0, 10),
        description: row.description,
        label: row.label,
        amountIn: row.amountIn == null ? null : Number(row.amountIn),
        amountOut: row.amountOut == null ? null : Number(row.amountOut),
        category: row.category?.name ?? null,
        reviewStatus: row.reviewStatus,
      },
    ]),
  );
}

export async function publicRules(userId: string, rules: RuleRow[]) {
  const views = await exampleViews(userId, rules.flatMap((rule) => rule.exampleTransactionIds));
  return rules.map((rule) => publicRule(rule, views));
}

type ExampleRow = {
  id: string;
  description: string;
  label: string | null;
  amountIn: number | null;
  amountOut: number | null;
  accountIdentifier: string | null;
  accountId: string | null;
  cardId: string | null;
  reviewStatus: string;
  category: string | null;
  internal: boolean;
};

/**
 * Why examples don't support a rule: each must be reviewed, match the rule
 * (text, scope and amount range) and already be classified the way the rule
 * would classify it. Empty when they all do.
 */
export function exampleProblems(
  rule: {
    matchType: string;
    matchValue: string | null;
    caseSensitive: boolean;
    accountIdentifier: string | null;
    accountId: string | null;
    cardId: string | null;
    amountMin: number | null;
    amountMax: number | null;
    setCategoryName: string | null;
    setLabel: string | null;
    markInternal: boolean;
  },
  examples: ExampleRow[],
  accountIds?: Map<string, string>,
) {
  const problems: Array<{ id: string; problem: string }> = [];
  for (const example of examples) {
    if (example.reviewStatus !== "reviewed") problems.push({ id: example.id, problem: "not reviewed yet" });
    else if (!TransactionService.ruleMatches(rule, example, accountIds)) problems.push({ id: example.id, problem: "the rule doesn't match it" });
    else if (!TransactionService.ruleAmountFits(rule, example)) problems.push({ id: example.id, problem: "its amount is outside the rule's range" });
    else if (rule.markInternal && !example.internal) problems.push({ id: example.id, problem: "it isn't Internal" });
    else if (
      !rule.markInternal &&
      rule.setCategoryName &&
      example.category?.toLowerCase() !== rule.setCategoryName.toLowerCase()
    )
      problems.push({ id: example.id, problem: `its category is ${example.category ?? "none"}, not ${rule.setCategoryName}` });
    else if (rule.setLabel && example.label !== rule.setLabel)
      problems.push({ id: example.id, problem: `its label is ${example.label ?? "empty"}, not ${rule.setLabel}` });
  }
  return problems;
}

async function loadExamples(userId: string, ids: string[]): Promise<ExampleRow[]> {
  const unique = [...new Set(ids)];
  const rows = await prisma.transaction.findMany({
    where: { userId, id: { in: unique } },
    include: { category: { select: { name: true } } },
  });
  const missing = unique.filter((id) => !rows.some((row) => row.id === id));
  if (missing.length) throw new EntryError(404, "Example transaction not found", { missing });
  return rows.map((row) => ({
    id: row.id,
    description: row.description,
    label: row.label,
    amountIn: row.amountIn == null ? null : Number(row.amountIn),
    amountOut: row.amountOut == null ? null : Number(row.amountOut),
    accountIdentifier: row.accountIdentifier,
    accountId: row.accountId,
    cardId: row.cardId,
    reviewStatus: row.reviewStatus,
    category: row.category?.name ?? null,
    internal: (row.linkage as { type?: string } | null)?.type === "internal" || row.category?.name === "Internal",
  }));
}

/**
 * Checks what an assistant's rule needs: a reason always, and for
 * assistant_detected at least MIN_EXAMPLES consistent reviewed examples or a
 * stated recurring bill (whose examples, if any, must still be consistent).
 */
export async function assertAssistantRule(
  userId: string,
  rule: Parameters<typeof exampleProblems>[0] & {
    origin: RuleOrigin;
    reason: string | null;
    exampleTransactionIds: string[];
    recurringBill: unknown;
  },
) {
  if (rule.origin === "user") return;
  if (!rule.reason?.trim()) throw new EntryError(400, "A rule from the assistant needs a reason");
  if (rule.origin !== "assistant_detected" && !rule.exampleTransactionIds.length) return;
  const examples = await loadExamples(userId, rule.exampleTransactionIds);
  const identifiers = await prisma.accountIdentifier.findMany({
    where: { userId, accountId: { not: null } },
    select: { accountIdentifier: true, accountId: true },
  });
  const problems = exampleProblems(
    rule,
    examples,
    new Map(identifiers.map((item) => [item.accountIdentifier, item.accountId!])),
  );
  if (problems.length)
    throw new EntryError(400, "Some examples don't support the rule", { problems });
  if (rule.origin === "assistant_detected" && !rule.recurringBill && examples.length < MIN_EXAMPLES)
    throw new EntryError(
      400,
      `A rule the assistant detected needs at least ${MIN_EXAMPLES} consistent reviewed examples, or a recurring bill`,
      { examples: examples.length },
    );
}

/** The scope a rule input names: an account by id, identifier or name, or a card by id or last4. */
async function scopeOf(userId: string, input: { account?: string | null; card?: { id?: string; last4?: string } | null }) {
  const scope: { accountId?: string | null; cardId?: string | null; accountIdentifier?: string | null } = {};
  if (input.account !== undefined) {
    if (input.account === null) Object.assign(scope, { accountId: null, accountIdentifier: null });
    else {
      const wanted = input.account.trim();
      const identifier = await prisma.accountIdentifier.findFirst({
        where: { userId, accountIdentifier: wanted },
        select: { accountId: true, accountIdentifier: true },
      });
      const account =
        identifier?.accountId
          ? { id: identifier.accountId }
          : await prisma.financialAccount.findFirst({
              where: { userId, OR: [{ id: wanted }, { name: { equals: wanted, mode: "insensitive" } }] },
              select: { id: true },
            });
      if (!account) throw new EntryError(400, `Unknown account "${wanted}"`);
      Object.assign(scope, { accountId: account.id, accountIdentifier: identifier?.accountIdentifier ?? null });
    }
  }
  if (input.card !== undefined) {
    if (input.card === null) scope.cardId = null;
    else {
      const cards = await prisma.card.findMany({
        where: { userId, ...(input.card.id ? { id: input.card.id } : { last4: input.card.last4 }) },
        select: { id: true, accountId: true },
      });
      if (cards.length !== 1)
        throw new EntryError(400, cards.length ? "More than one card has those digits; give the card id" : "Unknown card");
      scope.cardId = cards[0].id;
      if (scope.accountId === undefined) scope.accountId = cards[0].accountId;
    }
  }
  return scope;
}

async function categoryName(userId: string, name: string | null | undefined) {
  if (!name) return name;
  const category = await prisma.category.findFirst({
    where: { userId, name: { equals: name.trim(), mode: "insensitive" } },
    select: { name: true },
  });
  if (!category) throw new EntryError(400, `Unknown category "${name}"`);
  return category.name;
}

/** A rule name that is free for this user. */
export async function freeRuleName(userId: string, wanted: string) {
  const base = wanted.slice(0, 90);
  const taken = new Set(
    (await prisma.importRule.findMany({ where: { userId, name: { startsWith: base } }, select: { name: true } })).map(
      (rule) => rule.name,
    ),
  );
  if (!taken.has(wanted)) return wanted;
  for (let index = 2; index < 100; index += 1) {
    const name = `${base} (${index})`;
    if (!taken.has(name)) return name;
  }
  throw new EntryError(409, "Give the rule a name");
}

function ruleAudit(userId: string, actor: EntryActor, toolName: string, targetId: string, values: { beforeValue?: unknown; afterValue?: unknown }) {
  return prisma.agentAuditEvent.create({
    data: {
      userId,
      ...actor,
      toolName,
      targetType: "import_rule",
      targetId,
      ...(values.beforeValue !== undefined ? { beforeValue: values.beforeValue as Prisma.InputJsonValue } : {}),
      ...(values.afterValue !== undefined ? { afterValue: values.afterValue as Prisma.InputJsonValue } : {}),
    },
  });
}

/** Errors from TransactionService's rule checks, as API errors. */
async function asEntryError<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof EntryError) throw error;
    if (error instanceof Error && /not found|required|must not|belongs to another/i.test(error.message))
      throw new EntryError(/not found/i.test(error.message) ? 404 : 400, error.message);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      throw new EntryError(409, "A rule with that name exists; give another name");
    throw error;
  }
}

export const Rules = {
  async list(userId: string, query: z.infer<typeof ListRulesQuerySchema> = {}) {
    const rules = await prisma.importRule.findMany({
      where: {
        userId,
        ...(query.origin ? { origin: query.origin } : {}),
        ...(query.enabled ? { enabled: query.enabled === "true" } : {}),
      },
      include: ruleInclude,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return { rules: await publicRules(userId, rules) };
  },

  async get(userId: string, ruleId: string) {
    const rule = await prisma.importRule.findFirst({ where: { id: ruleId, userId }, include: ruleInclude });
    if (!rule) throw new EntryError(404, "Rule not found");
    return (await publicRules(userId, [rule]))[0];
  },

  /** A rule from the assistant: on the user's request, or detected from a pattern. */
  async create(userId: string, input: z.infer<typeof CreateRuleSchema>, actor: EntryActor) {
    const scope = await scopeOf(userId, input);
    const setCategoryName = input.markInternal ? null : await categoryName(userId, input.setCategory);
    const sets = input.markInternal ? "Internal" : setCategoryName || input.setLabel;
    const checked = {
      origin: input.origin,
      reason: input.reason,
      exampleTransactionIds: input.exampleIds ?? [],
      recurringBill: input.recurringBill ?? null,
      matchType: input.matchType,
      matchValue: input.matchValue ?? null,
      caseSensitive: input.caseSensitive ?? false,
      accountIdentifier: scope.accountIdentifier ?? null,
      accountId: scope.accountId ?? null,
      cardId: scope.cardId ?? null,
      amountMin: input.amountMin ?? null,
      amountMax: input.amountMax ?? null,
      setCategoryName: setCategoryName ?? null,
      setLabel: input.setLabel ?? null,
      markInternal: input.markInternal ?? false,
    };
    await assertAssistantRule(userId, checked);
    const rule = await asEntryError(() =>
      TransactionService.createImportRule(userId, {
        ...checked,
        name: input.name ?? `${input.matchValue ?? "Everything"} → ${sets}`.slice(0, 100),
        enabled: input.enabled,
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      }).catch(async (error) => {
        if (!input.name && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
          return TransactionService.createImportRule(userId, {
            ...checked,
            name: await freeRuleName(userId, `${input.matchValue ?? "Everything"} → ${sets}`.slice(0, 100)),
            enabled: input.enabled,
          });
        throw error;
      }),
    );
    await ruleAudit(userId, actor, "create_rule", rule.id, { afterValue: rule });
    return Rules.get(userId, rule.id);
  },

  async update(userId: string, ruleId: string, input: z.infer<typeof UpdateRuleSchema>, actor: EntryActor) {
    const existing = await prisma.importRule.findFirst({ where: { id: ruleId, userId } });
    if (!existing) throw new EntryError(404, "Rule not found");
    const scope = await scopeOf(userId, input);
    const setCategoryName =
      input.setCategory !== undefined ? ((await categoryName(userId, input.setCategory)) ?? null) : undefined;
    const payload = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.matchType !== undefined ? { matchType: input.matchType } : {}),
      ...(input.matchValue !== undefined ? { matchValue: input.matchValue } : {}),
      ...(input.caseSensitive !== undefined ? { caseSensitive: input.caseSensitive } : {}),
      ...scope,
      ...(setCategoryName !== undefined ? { setCategoryName } : {}),
      ...(input.setLabel !== undefined ? { setLabel: input.setLabel } : {}),
      ...(input.markInternal !== undefined ? { markInternal: input.markInternal } : {}),
      ...(input.amountMin !== undefined ? { amountMin: input.amountMin } : {}),
      ...(input.amountMax !== undefined ? { amountMax: input.amountMax } : {}),
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      ...(input.exampleIds !== undefined ? { exampleTransactionIds: input.exampleIds } : {}),
      ...(input.recurringBill !== undefined ? { recurringBill: input.recurringBill } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled, ...(input.enabled ? {} : {}) } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    };
    // What the rule would be after the change still needs its reason and examples.
    const next = { ...existing, ...payload } as ImportRule;
    await assertAssistantRule(userId, {
      ...next,
      origin: next.origin as RuleOrigin,
      amountMin: next.amountMin == null ? null : Number(next.amountMin),
      amountMax: next.amountMax == null ? null : Number(next.amountMax),
    });
    const rule = await asEntryError(() => TransactionService.updateImportRule(userId, ruleId, payload as never));
    // Turning an undone rule back on makes it a rule again.
    if (input.enabled === true && existing.undoneAt)
      await prisma.importRule.update({ where: { id: ruleId }, data: { undoneAt: null } });
    await ruleAudit(userId, actor, input.enabled === false ? "disable_rule" : "update_rule", rule.id, {
      beforeValue: existing,
      afterValue: rule,
    });
    return Rules.get(userId, rule.id);
  },

  async setEnabled(userId: string, ruleId: string, enabled: boolean, actor: EntryActor) {
    return Rules.update(userId, ruleId, { enabled }, actor);
  },

  /**
   * Undo from a review: the rule is disabled, and every transaction it
   * classified goes back into the review queue (reason rule_undone). An
   * assistant entry no review has corrected is classified again without it.
   */
  async undo(userId: string, ruleId: string, actor: EntryActor) {
    const existing = await prisma.importRule.findFirst({ where: { id: ruleId, userId } });
    if (!existing) throw new EntryError(404, "Rule not found");
    const now = new Date();
    await prisma.importRule.update({
      where: { id: ruleId },
      data: { enabled: false, undoneAt: now, acknowledgedAt: existing.acknowledgedAt ?? now },
    });
    const touched = await prisma.transaction.findMany({
      where: {
        userId,
        OR: [
          { metadata: { path: ["classification", "ruleId"], equals: ruleId } },
          { metadata: { path: ["fixedRuleId"], equals: ruleId } },
        ],
      },
      select: { id: true, entrySource: true, reviewReasons: true, metadata: true },
    });
    let reclassified = 0;
    for (const row of touched) {
      const decidedBy = (row.metadata as { classification?: { decidedBy?: string } } | null)?.classification?.decidedBy;
      if (row.entrySource === "assistant" && decidedBy !== "correction") {
        await AssistantEntries.reclassify(userId, row.id, actor, ["rule_undone"]);
        reclassified += 1;
      } else {
        await prisma.transaction.update({
          where: { id: row.id },
          data: {
            reviewStatus: "to_review",
            reviewedAt: null,
            reviewReasons: [...new Set([...row.reviewReasons, "rule_undone"])],
          },
        });
        await audit(userId, actor, "reopen_review", row.id, { afterValue: { reason: "rule_undone", ruleId } });
      }
    }
    await ruleAudit(userId, actor, "undo_rule", ruleId, {
      beforeValue: existing,
      afterValue: { enabled: false, undoneAt: now, reopened: touched.length },
    });
    return { rule: await Rules.get(userId, ruleId), reopened: touched.length, reclassified };
  },

  /** Rules the assistant detected that no review has seen yet, for the review queue (with Undo). */
  async unacknowledged(userId: string) {
    const rules = await prisma.importRule.findMany({
      where: { userId, origin: "assistant_detected", acknowledgedAt: null, undoneAt: null },
      include: ruleInclude,
      orderBy: { createdAt: "asc" },
    });
    return publicRules(userId, rules);
  },

  /** A review happened: rules created up to now have been seen. */
  async acknowledge(userId: string, at = new Date()) {
    await prisma.importRule.updateMany({
      where: { userId, origin: "assistant_detected", acknowledgedAt: null, createdAt: { lte: at } },
      data: { acknowledgedAt: at },
    });
  },
};
