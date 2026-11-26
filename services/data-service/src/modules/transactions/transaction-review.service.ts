import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { runInTransaction } from "../reimbursements/links.service";
import {
  AssistantEntries,
  audit,
  EntryError,
  findAccount,
  linkageFor,
  publicEntry,
  RESERVED,
  resolveCategory,
  type EntryActor,
  UNASSIGNED_ACCOUNT,
} from "./assistant-entries.service";
import type {
  AnswerInput,
  ClassificationDecision,
  CorrectionInput,
  EntryQuestion,
  ReviewQueueQuery,
  ReviewReason,
} from "./entry-review";
import { REVIEW_REASONS, TRANSACTION_TYPES } from "./entry-review";
import { storedQuestions } from "./entry-decision";
import { TransactionService } from "./transactions.service";
import {
  addCard,
  attachIdentifier,
  createAccount,
  getAccount,
  markAccountReviewed,
  mergeAccount,
  updateAccount,
} from "../accounts/accounts.service";
import { assertAssistantRule, freeRuleName, Rules } from "../rules/rules.service";
import { parseExternalId, SourceInputSchema } from "../sources/sources";
import { createSource } from "../sources/sources.service";
import { runInTransaction as runAccountTransaction } from "../accounts/accounts.service";
import { answerReimbursable, proposeRepayments } from "../reimbursements/reimbursables.service";

/**
 * The review queue behind /api/agent/transactions/review (scope
 * transactions:review): list what waits, correct category, account, label,
 * merchant or type on any transaction (statement rows too), mark entries reviewed, and confirm or
 * merge the accounts Fortuna created for assistant entries.
 */

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function queueWhere(userId: string, query: ReviewQueueQuery): Prisma.TransactionWhereInput {
  return {
    userId,
    ...(query.status !== "all" ? { reviewStatus: query.status } : {}),
    ...(query.reasons?.length ? { reviewReasons: { hasSome: query.reasons } } : {}),
    ...(query.entrySource?.length ? { entrySource: { in: query.entrySource } } : {}),
    // An account by statement identifier or by its Account id.
    ...(query.account ? { OR: [{ accountIdentifier: query.account }, { accountId: query.account }] } : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          date: {
            ...(query.dateFrom ? { gte: new Date(`${query.dateFrom}T00:00:00.000Z`) } : {}),
            ...(query.dateTo ? { lte: new Date(`${query.dateTo}T00:00:00.000Z`) } : {}),
          },
        }
      : {}),
  };
}

async function loadOwned(userId: string, ids: string[]) {
  const unique = Array.from(new Set(ids));
  const rows = await prisma.transaction.findMany({
    where: { userId, id: { in: unique } },
    include: { category: true, reimbursablePerson: { select: { id: true, name: true } } },
  });
  const missing = unique.filter((id) => !rows.some((row) => row.id === id));
  if (missing.length) throw new EntryError(404, "Transaction not found", { missing });
  return rows;
}

async function accountAudit(
  userId: string,
  actor: EntryActor,
  toolName: string,
  targetId: string,
  values: { beforeValue?: unknown; afterValue?: unknown },
) {
  await prisma.agentAuditEvent.create({
    data: {
      userId,
      ...actor,
      toolName,
      targetType: "account",
      targetId,
      ...(values.beforeValue !== undefined ? { beforeValue: values.beforeValue as Prisma.InputJsonValue } : {}),
      ...(values.afterValue !== undefined ? { afterValue: values.afterValue as Prisma.InputJsonValue } : {}),
    },
  });
}


/**
 * Answers an account question: adds the card to an existing account, links
 * the identifier to one, or makes a new account, then books every open entry
 * asking the same question there and adds the entry source the message came
 * through (Settings → Sources), so the next message finds it by itself.
 */
async function applyAccountAnswer(userId: string, asked: EntryQuestion, option: string, actor: EntryActor) {
  const context = record(asked.context) as { last4?: string; identifier?: string; name?: string };
  const [action, arg] = [option.slice(0, option.indexOf(":")), option.slice(option.indexOf(":") + 1)];
  const placed = await runAccountTransaction(async (db) => {
    if (action === "add_card" || action === "link") {
      const account = await db.financialAccount.findFirst({ where: { id: arg, userId }, select: { id: true } });
      if (!account) throw new EntryError(404, "Account not found");
      let cardId: string | null = null;
      if (context.last4) {
        const existing = await db.card.findUnique({ where: { accountId_last4: { accountId: account.id, last4: context.last4 } } });
        cardId = existing?.id ?? (await addCard(db, userId, account.id, { last4: context.last4 })).id;
      }
      if (context.identifier && action === "link") await attachIdentifier(db, userId, account.id, context.identifier);
      return { accountId: account.id, cardId, created: false };
    }
    if (action === "new_account") {
      const type = (["credit_card", "savings", "current", "other"] as const).find((item) => item === arg) ?? "other";
      const account = await createAccount(db, userId, {
        name: context.name || (context.last4 ? `Card ending ${context.last4}` : context.identifier || "New account"),
        type,
        color: "#6366f1",
        identifiers: context.identifier ? [context.identifier] : [],
      });
      const cardId = context.last4 ? (await addCard(db, userId, account.id, { last4: context.last4 })).id : null;
      return { accountId: account.id, cardId, created: true };
    }
    throw new EntryError(400, `Unknown account answer "${option}"`);
  });
  await accountAudit(userId, actor, placed.created ? "create_account_from_answer" : "place_unknown_account", placed.accountId, {
    afterValue: { option, ...context, cardId: placed.cardId },
  });

  // Every open entry with the same unknown card or account goes there.
  const same = await prisma.transaction.findMany({
    where: { userId, reviewStatus: "to_review", questions: { array_contains: [{ key: asked.key }] } },
    select: { id: true, sourceReports: { where: { primary: true }, select: { externalId: true, kind: true, sourceId: true, facts: true } } },
  });
  for (const row of same)
    await prisma.transaction.update({
      where: { id: row.id },
      data: placed.cardId ? { cardId: placed.cardId, accountId: placed.accountId } : { accountId: placed.accountId },
    });

  // The message's channel becomes an entry source for the new card or account.
  let source: { id: string } | null = null;
  const report = same.flatMap((row) => row.sourceReports).find((item) => !item.sourceId && item.kind !== "other");
  if (report) {
    const parsed = parseExternalId(report.externalId);
    const sender =
      parsed.kind === "notification" ? parsed.package : (record(report.facts).sender as string | undefined) ?? null;
    if (sender) {
      const input = SourceInputSchema.safeParse({
        kind: parsed.kind,
        ...(placed.cardId ? { cardId: placed.cardId } : { accountId: placed.accountId }),
        senders: [sender],
        identifiers: context.last4 ? [`card ending ${context.last4}`] : context.identifier ? [context.identifier] : [],
        channel: "main",
        enabled: true,
        notes: "Added when a review answered where this card or account belongs",
      });
      if (input.success) {
        try {
          source = await runAccountTransaction((db) => createSource(db, userId, input.data));
          await prisma.transactionSourceReport.updateMany({
            where: { userId, transactionId: { in: same.map((row) => row.id) }, sourceId: null },
            data: { sourceId: source.id, channel: "main" },
          });
        } catch (error) {
          console.error("Could not add the entry source:", error);
        }
      }
    }
  }
  return { ...placed, entryIds: same.map((row) => row.id), sourceId: source?.id ?? null };
}

const done = (rows: Array<{ reviewStatus: string }>) => rows.every((row) => row.reviewStatus === "reviewed");

/** metadata with merchant set (a name), cleared (null or ""), or left as it was (undefined). */
function withMerchant(metadata: Record<string, unknown>, merchant: string | null | undefined) {
  if (merchant === undefined) return metadata;
  const { merchant: _previous, ...rest } = metadata;
  return merchant ? { ...rest, merchant } : rest;
}

export const TransactionReview = {
  async queue(userId: string, query: ReviewQueueQuery) {
    const where = queueWhere(userId, query);
    const [total, rows, grouped] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where,
        include: { category: true, reimbursablePerson: { select: { id: true, name: true } } },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: query.limit,
        skip: query.offset,
      }),
      Promise.all(
        REVIEW_REASONS.map(async (reason) => [
          reason,
          await prisma.transaction.count({
            where: { ...queueWhere(userId, { ...query, reasons: undefined }), reviewReasons: { has: reason } },
          }),
        ]),
      ),
    ]);
    const precedentIds = rows.flatMap((row) => {
      const ids = record(record(record(row.metadata).classification).assistant).precedentIds;
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
    });
    const precedents = precedentIds.length
      ? await prisma.transaction.findMany({
          where: { userId, id: { in: [...new Set(precedentIds)] } },
          include: { category: true },
        })
      : [];
    const precedentView = new Map(
      precedents.map((row) => [
        row.id,
        {
          id: row.id,
          date: row.date.toISOString().slice(0, 10),
          description: row.description,
          label: row.label,
          amountIn: row.amountIn == null ? null : Number(row.amountIn),
          amountOut: row.amountOut == null ? null : Number(row.amountOut),
          category: row.category?.name ?? null,
        },
      ]),
    );
    // Money in that looks like a repayment from someone with open items comes
    // with proposed reimbursement links, for twee and the apps to confirm.
    const proposals = await proposeRepayments(
      userId,
      rows.filter((row) => row.reviewStatus === "to_review"),
    );
    return {
      total,
      limit: query.limit,
      offset: query.offset,
      reasons: Object.fromEntries(grouped) as Record<ReviewReason, number>,
      /** Rules the assistant created by itself since the last review, to show with Undo. */
      newRules: await Rules.unacknowledged(userId),
      transactions: rows.map((row) => {
        const entry = publicEntry(row);
        const ids = (entry.decision as { precedentIds?: unknown } | null)?.precedentIds;
        return {
          ...entry,
          precedents: Array.isArray(ids) ? ids.map((id) => precedentView.get(id)).filter(Boolean) : [],
          reimbursementProposal: proposals.get(row.id) ?? null,
        };
      }),
    };
  },

  async correct(userId: string, input: CorrectionInput, actor: EntryActor) {
    // internal and reimbursement are told by their reserved category, as answer() sets them.
    const reserved =
      input.transactionType === "internal"
        ? RESERVED.internal
        : input.transactionType === "reimbursement"
          ? RESERVED.reimbursement
          : null;
    if (reserved && input.category && input.category.toLowerCase() !== reserved.toLowerCase())
      throw new EntryError(400, `A ${input.transactionType} entry goes in ${reserved}; leave category out or give ${reserved}`);
    const categoryName = input.category ?? reserved;
    const category = categoryName ? await resolveCategory(userId, categoryName) : null;
    const account = input.account ? await findAccount(userId, input.account) : null;
    if (input.account && !account)
      throw new EntryError(400, `Unknown account "${input.account}"; corrections only use existing accounts`, {
        accounts: (await prisma.accountIdentifier.findMany({ where: { userId }, select: { accountIdentifier: true } })).map(
          (item) => item.accountIdentifier,
        ),
      });
    const rows = await loadOwned(userId, input.ids);
    if (category?.name === RESERVED.reimbursement && rows.some((row) => !(Number(row.amountIn ?? 0) > 0)))
      throw new EntryError(400, "Only money in can be a Reimbursement");
    if (input.createRule) {
      const needle = input.createRule.matchValue.toLowerCase();
      const unmatched = rows.filter((row) => !row.description.toLowerCase().includes(needle));
      if (unmatched.length)
        throw new EntryError(400, "The rule's matchValue must appear in every corrected description", {
          unmatched: unmatched.map((row) => ({ id: row.id, description: row.description })),
        });
    }

    const now = new Date();
    const updated = await runInTransaction(async () => {
      const results = [];
      for (const existing of rows) {
        const existingType = record(existing.linkage).type;
        const reservedBefore = existingType === "internal" || existingType === "reimbursement";
        const linkage = category ? linkageFor(category.name, Number(existing.amountIn ?? 0) || null) : undefined;
        await TransactionService.updateTransaction(existing.id, userId, {
          ...(category ? { categoryId: category.id } : {}),
          ...(linkage ? { linkage: linkage as never } : category && reservedBefore ? { linkage: null } : {}),
          ...(account
            ? account.accountIdentifier
              ? { accountIdentifier: account.accountIdentifier }
              : { accountId: account.accountId }
            : {}),
          ...(input.label !== undefined ? { label: (input.label || null) as string } : {}),
        });
        const metadata = record(existing.metadata);
        const previous = record(metadata.classification) as Partial<ClassificationDecision>;
        // A correction answers the questions about what it corrected.
        const questions = storedQuestions(existing.questions).filter(
          (item) =>
            !(category && (item.field === "category" || item.field === "transactionType" || item.field === "rule")) &&
            !(input.label !== undefined && item.field === "label") &&
            !(input.merchant !== undefined && item.field === "merchant") &&
            !(input.transactionType !== undefined && item.field === "transactionType") &&
            !(account && item.field === "account"),
        );
        const reasons = existing.reviewReasons.filter(
          (reason) =>
            !(category && (reason === "no_rule_matched" || reason === "assistant_category" || reason === "low_confidence")) &&
            !(account && reason === "new_account" && !account.autoCreated) &&
            !(account && reason === "unknown_account") &&
            !(reason === "question" && !questions.length),
        );
        const saved = await prisma.transaction.update({
          where: { id: existing.id },
          data: {
            metadata: {
              ...withMerchant(metadata, input.merchant),
              ...(input.transactionType !== undefined ? { transactionType: input.transactionType } : {}),
              ...(category
                ? {
                    classification: {
                      ...previous,
                      decidedBy: "correction",
                      correctedFrom: previous.decidedBy ?? null,
                      at: now.toISOString(),
                    },
                  }
                : {}),
            } as Prisma.InputJsonValue,
            ...(input.markReviewed
              ? { reviewStatus: "reviewed", reviewReasons: [], reviewedAt: now, questions: [] }
              : { reviewReasons: reasons, questions: questions as unknown as Prisma.InputJsonValue }),
          },
          include: { category: true },
        });
        await audit(userId, actor, "correct_transaction", existing.id, {
          beforeValue: publicEntry(existing),
          afterValue: publicEntry(saved),
        });
        results.push(saved);
      }
      return results;
    });

    if (input.markReviewed) await Rules.acknowledge(userId, now);

    let rule = null;
    if (input.createRule) {
      const sets = category ? category.name : (input.label as string);
      const accountIdentifier =
        input.createRule.accountOnly && (account?.accountIdentifier || rows[0].accountIdentifier)
          ? account?.accountIdentifier || rows[0].accountIdentifier
          : null;
      const accountId = input.createRule.accountOnly ? (account?.accountId ?? rows[0].accountId ?? null) : null;
      const fields = {
        matchType: "description_contains" as const,
        matchValue: input.createRule.matchValue,
        caseSensitive: false,
        accountIdentifier,
        accountId,
        cardId: null,
        amountMin: input.createRule.amountMin ?? null,
        amountMax: input.createRule.amountMax ?? null,
        setCategoryName: category && category.name !== RESERVED.internal ? category.name : null,
        setLabel: input.label || null,
        markInternal: category?.name === RESERVED.internal,
        // From Fortuna's own To review screen it is the user's rule.
        origin: actor.actorType === "trusted_service" ? ("user" as const) : input.createRule.origin,
        reason:
          input.createRule.reason ??
          (actor.actorType === "trusted_service"
            ? "Made from a correction in Fortuna"
            : input.createRule.confirmed
              ? "The user agreed to it in conversation"
              : null),
        // The corrected entries are reviewed examples now, besides any it names.
        exampleTransactionIds: [...new Set([...(input.markReviewed ? input.ids : []), ...(input.createRule.exampleIds ?? [])])],
        recurringBill: null,
      };
      await assertAssistantRule(userId, fields);
      rule = await TransactionService.createImportRule(userId, {
        ...fields,
        name: await freeRuleName(
          userId,
          input.createRule.name || `${input.createRule.matchValue} → ${sets}`.slice(0, 100),
        ),
        enabled: true,
      });
      await prisma.agentAuditEvent.create({
        data: {
          userId,
          ...actor,
          toolName: "create_rule_from_correction",
          targetType: "import_rule",
          targetId: rule.id,
          afterValue: rule as unknown as Prisma.InputJsonValue,
        },
      });
    }
    return {
      transactions: updated.map(publicEntry),
      ...(rule
        ? {
            rule: {
              id: rule.id,
              name: rule.name,
              matchType: rule.matchType,
              matchValue: rule.matchValue,
              accountIdentifier: rule.accountIdentifier,
              setCategoryName: rule.setCategoryName,
              setLabel: rule.setLabel,
              markInternal: rule.markInternal,
              enabled: rule.enabled,
              origin: rule.origin,
              reason: rule.reason,
              exampleTransactionIds: rule.exampleTransactionIds,
            },
          }
        : {}),
    };
  },

  async setStatus(userId: string, ids: string[], status: "to_review" | "reviewed", actor: EntryActor) {
    const rows = await loadOwned(userId, ids);
    const now = new Date();
    const updated = await runInTransaction(async () => {
      const results = [];
      for (const existing of rows) {
        const saved = await prisma.transaction.update({
          where: { id: existing.id },
          data:
            status === "reviewed"
              ? // Approving an entry as it is settles its open questions too.
                { reviewStatus: "reviewed", reviewReasons: [], reviewedAt: now, questions: [] }
              : { reviewStatus: "to_review", reviewedAt: null },
          include: { category: true },
        });
        if (existing.reviewStatus !== status)
          await audit(userId, actor, status === "reviewed" ? "mark_reviewed" : "reopen_review", existing.id, {
            beforeValue: { reviewStatus: existing.reviewStatus, reviewReasons: existing.reviewReasons },
            afterValue: { reviewStatus: saved.reviewStatus },
          });
        results.push(saved);
      }
      return results;
    });
    if (status === "reviewed") await Rules.acknowledge(userId, now);
    return { transactions: updated.map(publicEntry) };
  },

  /**
   * Keeps an account Fortuna created: it is no longer flagged, and its entries
   * lose the new_account reason (accounts.service confirmAccount, like Keep in
   * the apps). A label renames the account.
   */
  async confirmAccount(userId: string, ref: string, input: { label?: string }, actor: EntryActor) {
    const account = await findAccount(userId, ref);
    if (!account?.accountId) throw new EntryError(404, "Account not found");
    const accountId = account.accountId;
    return runInTransaction(async () => {
      const entries = await markAccountReviewed(prisma, userId, accountId);
      const saved = input.label
        ? await updateAccount(prisma, userId, accountId, { name: input.label })
        : await getAccount(prisma, userId, accountId);
      await accountAudit(userId, actor, "confirm_account", accountId, { beforeValue: account, afterValue: saved });
      return {
        account: {
          id: saved.id,
          accountIdentifier: account.accountIdentifier,
          label: saved.name,
          autoCreated: saved.autoCreated,
          autoCreatedFrom: saved.autoCreatedFrom,
        },
        entriesUpdated: entries,
      };
    });
  },

  /**
   * Merges an account Fortuna created into an existing one (accounts.service
   * mergeAccount, like Merge into… in the apps): its cards, identifiers and
   * entries move and it is removed, so the next entry for that card or
   * identifier lands on the existing account. The shared "no account"
   * identifier is dropped instead, so later entries without an account are
   * flagged again. Only auto-created accounts can be merged away here.
   */
  async mergeAccount(userId: string, ref: string, into: string, actor: EntryActor) {
    const [from, target] = await Promise.all([findAccount(userId, ref), findAccount(userId, into)]);
    if (!from?.accountId) throw new EntryError(404, "Account not found");
    if (!target?.accountId) throw new EntryError(400, `Unknown account "${into}"`);
    if (from.accountId === target.accountId) throw new EntryError(400, "An account can't be merged into itself");
    if (!from.autoCreated)
      throw new EntryError(409, "Only accounts Fortuna created can be merged away; correct entries one by one instead");
    const fromId = from.accountId;
    const targetId = target.accountId;
    const moved = await runInTransaction(async () => {
      const count = await prisma.transaction.count({ where: { userId, accountId: fromId } });
      await mergeAccount(prisma, userId, fromId, targetId);
      if (from.accountIdentifier === UNASSIGNED_ACCOUNT) {
        await prisma.transaction.updateMany({
          where: { userId, accountIdentifier: UNASSIGNED_ACCOUNT },
          data: target.accountIdentifier ? { accountIdentifier: target.accountIdentifier } : { accountId: targetId },
        });
        await prisma.accountIdentifier.deleteMany({ where: { userId, accountIdentifier: UNASSIGNED_ACCOUNT } });
      }
      await accountAudit(userId, actor, "merge_account", fromId, {
        beforeValue: from,
        afterValue: { mergedInto: target, transactionsMoved: count },
      });
      return count;
    });
    return {
      merged: { from: from.accountIdentifier, into: target.accountIdentifier },
      transactionsMoved: moved,
    };
  },
  /**
   * Answers a question on an entry: applies the answer (a category, label,
   * merchant, transaction type, whether to apply a rule, who pays it back and
   * how much, or where an unknown card or account belongs) and removes the
   * question. Entries asking the
   * same keyed question (one unknown card) are answered together.
   */
  async answer(userId: string, input: AnswerInput, actor: EntryActor) {
    const [entry] = await loadOwned(userId, [input.transactionId]);
    const asked = storedQuestions(entry.questions).find((item) => item.id === input.questionId);
    if (!asked) throw new EntryError(404, "Question not found; it may be answered already");
    const chosen = input.option ? asked.options.find((item) => item.id === input.option) : null;
    if (input.option && !chosen)
      throw new EntryError(400, "That isn't one of the question's options", { options: asked.options });
    if (input.value && !asked.allowOther && asked.options.length && asked.field !== "other")
      throw new EntryError(400, "This question takes one of its options", { options: asked.options });
    const answer = chosen?.id ?? input.value!;
    const applied: Record<string, unknown> = {};
    let entryIds = [entry.id];

    switch (asked.field) {
      case "category":
        await TransactionReview.correct(userId, { ids: [entry.id], category: answer, markReviewed: false }, actor);
        applied.category = answer;
        break;
      case "label":
        await TransactionReview.correct(userId, { ids: [entry.id], label: answer, markReviewed: false }, actor);
        applied.label = answer;
        break;
      case "transactionType": {
        if (!(TRANSACTION_TYPES as readonly string[]).includes(answer))
          throw new EntryError(400, `transactionType must be one of ${TRANSACTION_TYPES.join(", ")}`);
        const reserved =
          answer === "internal" ? RESERVED.internal : answer === "reimbursement" ? RESERVED.reimbursement : null;
        if (reserved) await TransactionReview.correct(userId, { ids: [entry.id], category: reserved, markReviewed: false }, actor);
        const fresh = (await loadOwned(userId, [entry.id]))[0];
        await prisma.transaction.update({
          where: { id: entry.id },
          data: { metadata: { ...record(fresh.metadata), transactionType: answer } as Prisma.InputJsonValue },
        });
        applied.transactionType = answer;
        break;
      }
      case "merchant": {
        await prisma.transaction.update({
          where: { id: entry.id },
          data: { metadata: { ...record(entry.metadata), merchant: answer } as Prisma.InputJsonValue },
        });
        applied.merchant = answer;
        break;
      }
      case "rule": {
        if (answer === "apply" && asked.ruleId) {
          const rule = await prisma.importRule.findFirst({ where: { id: asked.ruleId, userId } });
          if (!rule) throw new EntryError(404, "The rule is gone");
          const category = rule.markInternal ? RESERVED.internal : rule.setCategoryName;
          if (category || rule.setLabel)
            await TransactionReview.correct(
              userId,
              {
                ids: [entry.id],
                ...(category ? { category } : {}),
                ...(rule.setLabel ? { label: rule.setLabel } : {}),
                markReviewed: false,
              },
              actor,
            );
          applied.rule = { id: rule.id, name: rule.name, applied: true };
        } else applied.rule = { id: asked.ruleId ?? null, applied: false };
        break;
      }
      case "account": {
        if (!chosen) throw new EntryError(400, "Pick one of the options");
        const placed = await applyAccountAnswer(userId, asked, chosen.id, actor);
        entryIds = [...new Set([entry.id, ...placed.entryIds])];
        applied.account = { accountId: placed.accountId, cardId: placed.cardId, created: placed.created, sourceId: placed.sourceId };
        break;
      }
      case "reimbursable":
        // Set like set_reimbursable, so what the person owes updates now.
        applied.reimbursable = await answerReimbursable(
          userId,
          entry.id,
          asked,
          chosen ? [chosen.id, chosen.label] : [answer],
          actor,
        );
        break;
      default:
        applied[asked.field] = answer;
    }

    const now = new Date();
    const results = [];
    for (const id of entryIds) {
      const [current] = await loadOwned(userId, [id]);
      const remaining = storedQuestions(current.questions).filter(
        (item) => item.id !== asked.id && !(asked.key && item.key === asked.key),
      );
      const metadata = record(current.metadata);
      const answers = Array.isArray(metadata.answers) ? metadata.answers : [];
      const reasons = current.reviewReasons.filter(
        (reason) =>
          !(reason === "question" && !remaining.length) &&
          !(asked.field === "account" && reason === "unknown_account"),
      );
      const done = input.markReviewed && !remaining.length;
      await prisma.transaction.update({
        where: { id },
        data: {
          questions: remaining as unknown as Prisma.InputJsonValue,
          metadata: {
            ...metadata,
            answers: [...answers, { questionId: asked.id, field: asked.field, prompt: asked.prompt, answer, at: now.toISOString(), by: actor.actorType }],
          } as Prisma.InputJsonValue,
          ...(done ? { reviewStatus: "reviewed", reviewReasons: [], reviewedAt: now } : { reviewReasons: reasons }),
        },
      });
      // Now that the account is known, its rules and transfer detection apply.
      if (asked.field === "account" && current.entrySource === "assistant")
        await AssistantEntries.reclassify(userId, id, actor, done ? [] : (reasons.filter((reason) => reason !== "question") as ReviewReason[]));
      if (done && asked.field === "account")
        await prisma.transaction.update({ where: { id }, data: { reviewStatus: "reviewed", reviewReasons: [], reviewedAt: now } });
      await audit(userId, actor, "answer_question", id, { afterValue: { questionId: asked.id, field: asked.field, answer } });
      results.push((await loadOwned(userId, [id]))[0]);
    }
    if (done(results)) await Rules.acknowledge(userId, now);
    const [first, ...others] = results;
    return {
      transaction: publicEntry(first),
      answered: { questionId: asked.id, field: asked.field, answer },
      applied,
      ...(others.length ? { alsoAnswered: others.map(publicEntry) } : {}),
    };
  },

  /** Undo of a rule the assistant created, from the review: see Rules.undo. */
  async undoRule(userId: string, ruleId: string, actor: EntryActor) {
    return Rules.undo(userId, ruleId, actor);
  },
};
