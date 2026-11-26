import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { runInTransaction } from "../reimbursements/links.service";
import {
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
import type { ClassificationDecision, CorrectionInput, ReviewQueueQuery, ReviewReason } from "./entry-review";
import { REVIEW_REASONS } from "./entry-review";
import { TransactionService } from "./transactions.service";
import { getAccount, markAccountReviewed, mergeAccount, updateAccount } from "../accounts/accounts.service";
import { proposeRepayments } from "../reimbursements/reimbursables.service";

/**
 * The review queue behind /api/agent/transactions/review (scope
 * transactions:review): list what waits, correct category, account or label on
 * any transaction (statement rows too), mark entries reviewed, and confirm or
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
    include: { category: true },
  });
  const missing = unique.filter((id) => !rows.some((row) => row.id === id));
  if (missing.length) throw new EntryError(404, "Transaction not found", { missing });
  return rows;
}

/** A rule name that is free for this user, from the match value and what it sets. */
async function freeRuleName(userId: string, wanted: string) {
  const taken = new Set(
    (
      await prisma.importRule.findMany({
        where: { userId, name: { startsWith: wanted.slice(0, 90) } },
        select: { name: true },
      })
    ).map((rule) => rule.name),
  );
  if (!taken.has(wanted)) return wanted;
  for (let index = 2; index < 100; index += 1) {
    const name = `${wanted.slice(0, 90)} (${index})`;
    if (!taken.has(name)) return name;
  }
  throw new EntryError(409, "Give the rule a name");
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
      transactions: rows.map((row) => ({
        ...publicEntry(row),
        reimbursementProposal: proposals.get(row.id) ?? null,
      })),
    };
  },

  async correct(userId: string, input: CorrectionInput, actor: EntryActor) {
    const category = input.category ? await resolveCategory(userId, input.category) : null;
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
        const reasons = existing.reviewReasons.filter(
          (reason) =>
            !(category && (reason === "no_rule_matched" || reason === "assistant_category")) &&
            !(account && reason === "new_account" && !account.autoCreated),
        );
        const saved = await prisma.transaction.update({
          where: { id: existing.id },
          data: {
            metadata: {
              ...metadata,
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
              ? { reviewStatus: "reviewed", reviewReasons: [], reviewedAt: now }
              : { reviewReasons: reasons }),
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

    let rule = null;
    if (input.createRule) {
      const sets = category ? category.name : (input.label as string);
      rule = await TransactionService.createImportRule(userId, {
        name: await freeRuleName(
          userId,
          input.createRule.name || `${input.createRule.matchValue} → ${sets}`.slice(0, 100),
        ),
        matchType: "description_contains",
        matchValue: input.createRule.matchValue,
        accountIdentifier:
          input.createRule.accountOnly && (account?.accountIdentifier || rows[0].accountIdentifier)
            ? account?.accountIdentifier || rows[0].accountIdentifier
            : null,
        ...(category
          ? category.name === RESERVED.internal
            ? { markInternal: true }
            : { setCategoryName: category.name }
          : {}),
        ...(input.label ? { setLabel: input.label } : {}),
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
              ? { reviewStatus: "reviewed", reviewReasons: [], reviewedAt: now }
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
};
