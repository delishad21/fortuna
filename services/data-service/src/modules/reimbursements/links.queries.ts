import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import {
  CLOSED_DRAFT_STATUSES,
  EPSILON,
  EndInfo,
  EndRef,
  LinkError,
  LinkRow,
  Role,
  canonicalLinkage,
  capacityOf,
  classifyEndLinks,
  describeEnd,
  draftRowKey,
  endKeyFor,
  expenseKeyOf,
  keyOf,
  money,
  otherRole,
  reimbursementKeyOf,
  roleProblem,
  sameJson,
  toNumber,
  transactionKey,
} from "./links.core";
import {
  Db,
  linksTouching,
  loadEnds,
  replaceLinks,
  runInTransaction,
  syncTransactionCaches,
} from "./links.service";

export type Candidate = {
  key: string;
  transactionId?: string;
  draftId?: string;
  rowId?: string;
  rowIndex?: number;
  filename?: string;
  date: string | null;
  description: string;
  label: string | null;
  amount: number;
  /** What the subject already takes from (or gives to) this candidate. */
  linkedToSubject: number;
  /** Claims that count against this candidate, excluding the subject's link. */
  otherLinked: number;
  /** Claims from unrelated staged imports (first save wins). */
  pending: Array<{ amount: number; filename: string }>;
  available: number;
  fullyAllocated: boolean;
  categoryId: string | null;
  accountIdentifier: string | null;
};

const counterparts = (links: LinkRow[]) =>
  links.flatMap((link) => [reimbursementKeyOf(link), expenseKeyOf(link)]);

async function describeCandidates(
  db: Db | typeof prisma,
  userId: string,
  subjectKey: string,
  role: Role,
  ends: EndInfo[],
  related: Set<string>,
  extra: Map<string, { categoryId: string | null; accountIdentifier: string | null }>,
): Promise<Candidate[]> {
  if (!ends.length) return [];
  const links = await linksTouching(db as Db, userId, ends.map((end) => end.key));
  const endMap = new Map(ends.map((end) => [end.key, end]));
  const missing = counterparts(links).filter((key) => !endMap.has(key));
  (await loadEnds(db as Db, userId, missing)).forEach((end, key) => endMap.set(key, end));
  return ends.map((end) => {
    const own = links.filter((link) => endKeyFor(link, role) === end.key);
    const subjectLink = own.find(
      (link) => endKeyFor(link, otherRole(role)) === subjectKey,
    );
    const { hard, pending } = classifyEndLinks(
      end,
      role,
      own.filter((link) => link !== subjectLink),
      endMap,
      related,
    );
    const amount = capacityOf(end, role);
    const available = money(Math.max(amount - hard, 0));
    const linkedToSubject = subjectLink?.amount || 0;
    const details = extra.get(end.key);
    return {
      key: end.key,
      ...(end.kind === "transaction"
        ? { transactionId: end.id }
        : {
            draftId: end.draftId,
            rowId: end.id,
            rowIndex: end.rowIndex,
            filename: end.draftFilename,
          }),
      date: end.date,
      description: end.description,
      label: end.label,
      amount,
      linkedToSubject,
      otherLinked: hard,
      pending: pending.map((item) => ({ amount: item.amount, filename: item.filename })),
      available,
      fullyAllocated: available <= EPSILON && linkedToSubject <= EPSILON,
      categoryId: details?.categoryId ?? null,
      accountIdentifier: details?.accountIdentifier ?? null,
    };
  });
}

/**
 * Transactions and staged rows the subject can link to. `lookingFor` is the
 * role the candidates play: "reimbursement" when an expense picks what paid it
 * back, "expense" when a reimbursement picks what it pays back.
 */
export async function listCandidates(input: {
  userId: string;
  subject: EndRef;
  lookingFor: Role;
  query?: string;
  limit?: number;
  offset?: number;
  contextDraftIds?: string[];
  /** Narrow candidates: a category id ("" for uncategorized), a YYYY-MM-DD range, or an exact amount. */
  categoryId?: string;
  dateFrom?: string;
  dateTo?: string;
  amountEquals?: number;
}) {
  const db = prisma as unknown as Db;
  const { userId, lookingFor } = input;
  const subjectRole = otherRole(lookingFor);
  const subjectKey = keyOf(input.subject);
  const subject = (await loadEnds(db, userId, [subjectKey])).get(subjectKey);
  if (!subject) throw new LinkError("Transaction not found", 404);
  const related = new Set([
    ...(input.contextDraftIds || []),
    ...(subject.draftId ? [subject.draftId] : []),
  ]);
  const search = input.query?.trim();
  const limit = Math.min(Math.max(input.limit || 30, 1), 100);
  const offset = Math.max(input.offset || 0, 0);
  const subjectDate = subject.date ? new Date(subject.date) : new Date();
  const roleFilter =
    lookingFor === "reimbursement"
      ? Prisma.sql`t.linkage->>'type' = 'reimbursement' AND COALESCE(t.amount_in,0) > 0`
      : Prisma.sql`COALESCE(t.amount_out,0) > 0 AND COALESCE(t.linkage->>'type','') NOT IN ('internal','reimbursement')`;
  const searchFilter = search
    ? Prisma.sql`AND (t.description ILIKE ${"%" + search + "%"} OR t.label ILIKE ${"%" + search + "%"})`
    : Prisma.empty;
  const day = (value: string | undefined, end: boolean) =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`)
      : null;
  const from = day(input.dateFrom, false);
  const to = day(input.dateTo, true);
  const amountEquals = Number.isFinite(input.amountEquals) ? Number(input.amountEquals) : null;
  const amountColumn =
    lookingFor === "reimbursement" ? Prisma.sql`COALESCE(t.amount_in,0)` : Prisma.sql`COALESCE(t.amount_out,0)`;
  const narrowFilter = Prisma.sql`${
    input.categoryId === undefined
      ? Prisma.empty
      : input.categoryId
        ? Prisma.sql`AND t.category_id = ${input.categoryId}`
        : Prisma.sql`AND t.category_id IS NULL`
  } ${from ? Prisma.sql`AND t.date >= ${from}` : Prisma.empty} ${
    to ? Prisma.sql`AND t.date <= ${to}` : Prisma.empty
  } ${amountEquals !== null ? Prisma.sql`AND ABS(${amountColumn} - ${amountEquals}) < 0.005` : Prisma.empty}`;
  const narrowed =
    !!search || input.categoryId !== undefined || !!from || !!to || amountEquals !== null;
  const subjectLinks = (await linksTouching(db, userId, [subjectKey])).filter(
    (link) => endKeyFor(link, subjectRole) === subjectKey,
  );
  // What the subject already links to is listed first, then the rest page by page.
  const linkedSavedIds = subjectLinks
    .map((link) => endKeyFor(link, lookingFor))
    .filter((key) => key.startsWith("t:"))
    .map((key) => key.slice(2));
  // Unfiltered, linked rows are listed first, so the pages skip them; filtered, they page normally.
  const excludeSubject = Prisma.sql`${
    subject.kind === "transaction" ? Prisma.sql`AND t.id <> ${subject.id}` : Prisma.empty
  } ${
    linkedSavedIds.length && !narrowed
      ? Prisma.sql`AND t.id NOT IN (${Prisma.join(linkedSavedIds)})`
      : Prisma.empty
  }`;
  // Reimbursements usually come after the expense, and expenses before the reimbursement.
  const afterFirst =
    lookingFor === "reimbursement"
      ? Prisma.sql`(t.date < ${subjectDate})`
      : Prisma.sql`(t.date > ${subjectDate})`;
  const [ids, totalRows] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT t.id FROM transactions t
      WHERE t.user_id = ${userId} AND ${roleFilter} ${searchFilter} ${narrowFilter} ${excludeSubject}
      ORDER BY ${afterFirst}, ABS(EXTRACT(EPOCH FROM (t.date - ${subjectDate}))), t.id
      LIMIT ${limit} OFFSET ${offset}`,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM transactions t
      WHERE t.user_id = ${userId} AND ${roleFilter} ${searchFilter} ${narrowFilter} ${excludeSubject}`,
  ]);
  const savedKeys = [
    ...(offset === 0 && !narrowed ? linkedSavedIds : []),
    ...ids.map((row) => row.id),
  ].map(transactionKey);
  const savedEndsMap = await loadEnds(db, userId, savedKeys);
  const savedDetails = await prisma.transaction.findMany({
    where: { userId, id: { in: savedKeys.map((key) => key.slice(2)) } },
    select: { id: true, categoryId: true, accountIdentifier: true },
  });
  const extra = new Map<string, { categoryId: string | null; accountIdentifier: string | null }>(
    savedDetails.map((row) => [
      transactionKey(row.id),
      { categoryId: row.categoryId, accountIdentifier: row.accountIdentifier },
    ]),
  );

  const stagedRows = await prisma.importDraftRow.findMany({
    where: {
      draft: {
        userId,
        mode: "main",
        status: { notIn: CLOSED_DRAFT_STATUSES },
      },
      ...(subject.kind === "draftRow" ? { id: { not: subject.id } } : {}),
    },
    select: { id: true, currentPayload: true },
    orderBy: [{ draftId: "asc" }, { rowIndex: "asc" }],
    take: 2000,
  });
  const stagedEndsMap = await loadEnds(
    db,
    userId,
    stagedRows.map((row) => draftRowKey(row.id)),
  );
  for (const row of stagedRows) {
    const payload = (row.currentPayload || {}) as Record<string, unknown>;
    extra.set(draftRowKey(row.id), {
      categoryId: typeof payload.categoryId === "string" ? payload.categoryId : null,
      accountIdentifier:
        typeof payload.accountIdentifier === "string" ? payload.accountIdentifier : null,
    });
  }
  const needle = search?.toLowerCase();
  const stagedEnds = [...stagedEndsMap.values()].filter((end) => {
    const date = end.date ? new Date(end.date) : null;
    return (
      !roleProblem(end, lookingFor) &&
      (!needle ||
        end.description.toLowerCase().includes(needle) ||
        (end.label || "").toLowerCase().includes(needle)) &&
      (input.categoryId === undefined ||
        (extra.get(end.key)?.categoryId || "") === input.categoryId) &&
      (!from || (date !== null && date >= from)) &&
      (!to || (date !== null && date <= to)) &&
      (amountEquals === null || Math.abs(capacityOf(end, lookingFor) - amountEquals) < 0.005)
    );
  });

  const [saved, staged] = await Promise.all([
    describeCandidates(
      db,
      userId,
      subjectKey,
      lookingFor,
      savedKeys.map((key) => savedEndsMap.get(key)).filter((end): end is EndInfo => !!end),
      related,
      extra,
    ),
    describeCandidates(db, userId, subjectKey, lookingFor, stagedEnds, related, extra),
  ]);

  const subjectEnds = await loadEnds(db, userId, counterparts(subjectLinks));
  subjectEnds.set(subjectKey, subject);
  const subjectTotals = classifyEndLinks(subject, subjectRole, subjectLinks, subjectEnds, related);
  return {
    subject: {
      key: subjectKey,
      role: subjectRole,
      roleProblem: roleProblem(subject, subjectRole),
      amount: capacityOf(subject, subjectRole),
      linked: subjectLinks.map((link) => {
        const other = subjectEnds.get(endKeyFor(link, lookingFor));
        return {
          key: endKeyFor(link, lookingFor),
          amount: link.amount,
          description: other?.description || "",
          label: other?.label ?? null,
          date: other?.date ?? null,
          filename: other?.kind === "draftRow" ? other.draftFilename : undefined,
        };
      }),
      linkedAmount: subjectTotals.hard,
      pending: subjectTotals.pending.map((item) => ({ amount: item.amount, filename: item.filename })),
      available: money(Math.max(capacityOf(subject, subjectRole) - subjectTotals.hard, 0)),
    },
    saved: {
      items: saved,
      total: Number(totalRows[0]?.count || 0) + (offset === 0 && !narrowed ? linkedSavedIds.length : 0),
    },
    staged,
  };
}

export type AuditFinding = {
  kind:
    | "cache_drift"
    | "invalid_link"
    | "over_allocated"
    | "legacy_link_not_migrated"
    | "reimbursement_not_money_in"
    | "misplaced_link_restored"
    | "stale_staged_link";
  userId: string;
  transactionId?: string;
  linkId?: string;
  message: string;
  fixed?: boolean;
};

/**
 * Compare the links table, the cached linkage JSON and the rules. With `fix`,
 * invalid and stale links are removed, over-allocations trimmed (newest links
 * first), and every cache rebuilt. Legacy JSON links that never reached the
 * table are reported only: they need a person to decide.
 */
export async function auditLinks(options: { userId?: string; fix?: boolean } = {}) {
  const users = options.userId
    ? [{ id: options.userId }]
    : await prisma.user.findMany({ select: { id: true } });
  const findings: AuditFinding[] = [];
  for (const user of users) {
    const userFindings = await runInTransaction((db) => auditUser(db, user.id, !!options.fix));
    findings.push(...userFindings);
  }
  const counts: Record<string, number> = {};
  for (const finding of findings) counts[finding.kind] = (counts[finding.kind] || 0) + 1;
  return { findings, counts };
}

async function auditUser(db: Db, userId: string, fix: boolean) {
  const findings: AuditFinding[] = [];
  const transactions = await db.transaction.findMany({
    where: {
      userId,
      OR: [
        { linkage: { not: Prisma.DbNull } },
        { reimbursementLinksAsReimbursement: { some: {} } },
        { reimbursementLinksAsExpense: { some: {} } },
      ],
    },
    select: {
      id: true,
      amountIn: true,
      amountOut: true,
      linkage: true,
      description: true,
      label: true,
      date: true,
      importBatchId: true,
    },
  });
  const allLinks = (
    await db.reimbursementLink.findMany({ where: { userId }, orderBy: { createdAt: "asc" } })
  ).map((link) => ({ ...link, amount: money(toNumber(link.amount)) }));
  const savedLinks = allLinks.filter(
    (link) => link.reimbursementTransactionId && link.expenseTransactionId,
  );
  // Include legacy JSON targets: they may have no links of their own yet.
  const legacyTargets = transactions.flatMap((tx) => {
    const allocations = ((tx.linkage || {}) as Record<string, any>).reimbursesAllocations;
    return Array.isArray(allocations)
      ? allocations
          .map((item: any) => (typeof item?.transactionId === "string" ? item.transactionId : ""))
          .filter(Boolean)
          .map(transactionKey)
      : [];
  });
  const ends = await loadEnds(db, userId, [
    ...transactions.map((tx) => transactionKey(tx.id)),
    ...allLinks.flatMap((link) => [reimbursementKeyOf(link), expenseKeyOf(link)]),
    ...legacyTargets,
  ]);

  // Legacy JSON allocations with no matching saved link (reported, not fixed).
  for (const tx of transactions) {
    const linkage = (tx.linkage || {}) as Record<string, any>;
    if (linkage.type !== "reimbursement" || !Array.isArray(linkage.reimbursesAllocations)) continue;
    for (const allocation of linkage.reimbursesAllocations) {
      const targetId = typeof allocation?.transactionId === "string" ? allocation.transactionId : "";
      const amount = money(toNumber(allocation?.amount));
      if (!(amount > 0)) continue;
      const link = savedLinks.find(
        (item) => item.reimbursementTransactionId === tx.id && item.expenseTransactionId === targetId,
      );
      if (link && Math.abs(link.amount - amount) < EPSILON) continue;
      const end = ends.get(transactionKey(tx.id));
      const target = targetId ? ends.get(transactionKey(targetId)) : undefined;
      findings.push({
        kind: "legacy_link_not_migrated",
        userId,
        transactionId: tx.id,
        message: link
          ? `${end ? describeEnd(end) : tx.id} paid back ${amount.toFixed(2)} of ${target ? describeEnd(target) : targetId}; the link now holds ${link.amount.toFixed(2)} (trimmed to fit)`
          : `${end ? describeEnd(end) : tx.id} listed ${amount.toFixed(2)} for ${target ? describeEnd(target) : targetId ? `missing transaction ${targetId}` : "a target that was never saved"}; no link was kept`,
      });
    }
  }

  // Links whose ends can no longer play their roles.
  const invalid = new Set<string>();
  for (const link of allLinks) {
    for (const role of ["reimbursement", "expense"] as Role[]) {
      const end = ends.get(endKeyFor(link, role));
      if (!end) continue;
      if (end.kind === "draftRow" && end.draftStatus && CLOSED_DRAFT_STATUSES.includes(end.draftStatus)) {
        invalid.add(link.id);
        findings.push({
          kind: "stale_staged_link",
          userId,
          linkId: link.id,
          message: `Link to ${describeEnd(end)} points at a closed import`,
        });
        continue;
      }
      if (end.kind !== "transaction") continue;
      const problem = roleProblem(end, role);
      if (problem && !invalid.has(link.id)) {
        invalid.add(link.id);
        const other = ends.get(endKeyFor(link, otherRole(role)));
        findings.push({
          kind: "invalid_link",
          userId,
          linkId: link.id,
          transactionId: end.id,
          message: `${problem}; its ${link.amount.toFixed(2)} link with ${other ? describeEnd(other) : "another transaction"} is invalid`,
        });
      }
    }
  }
  if (fix && invalid.size) {
    await db.reimbursementLink.deleteMany({ where: { id: { in: [...invalid] } } });
    findings.forEach((finding) => {
      if (finding.linkId && invalid.has(finding.linkId)) finding.fixed = true;
    });
  }

  // Over-allocated saved ends: trim the newest links until the total fits.
  const remainingLinks = savedLinks.filter((link) => !invalid.has(link.id));
  const amounts = new Map(remainingLinks.map((link) => [link.id, link.amount]));
  for (const tx of transactions) {
    const end = ends.get(transactionKey(tx.id));
    if (!end) continue;
    for (const role of ["reimbursement", "expense"] as Role[]) {
      const held = remainingLinks.filter((link) => endKeyFor(link, role) === end.key);
      const total = money(held.reduce((sum, link) => sum + (amounts.get(link.id) || 0), 0));
      const capacity = capacityOf(end, role);
      if (total - capacity <= EPSILON) continue;
      findings.push({
        kind: "over_allocated",
        userId,
        transactionId: tx.id,
        message: `${describeEnd(end)} holds ${total.toFixed(2)} of links but is ${capacity.toFixed(2)}`,
        fixed: fix,
      });
      if (!fix) continue;
      let excess = money(total - capacity);
      for (const link of [...held].reverse()) {
        if (excess <= EPSILON) break;
        const current = amounts.get(link.id) || 0;
        const next = money(Math.max(current - excess, 0));
        excess = money(excess - (current - next));
        amounts.set(link.id, next);
        if (next <= 0) await db.reimbursementLink.delete({ where: { id: link.id } });
        else await db.reimbursementLink.update({ where: { id: link.id }, data: { amount: next } });
      }
    }
  }

  // Rows marked as reimbursements that are money out. The old import screen
  // could save a reimbursement's links onto a neighbouring expense row; when a
  // real reimbursement in the same import lists unresolved links with exactly
  // the same amounts, the links are moved back to it.
  const amountsKey = (amounts: number[]) =>
    amounts.map((amount) => money(amount).toFixed(2)).sort().join(",");
  const legacyAllocations = (linkage: Record<string, any>) =>
    Array.isArray(linkage.reimbursesAllocations) ? linkage.reimbursesAllocations : [];
  const unresolvedByBatch = new Map<string, typeof transactions>();
  for (const tx of transactions) {
    const linkage = (tx.linkage || {}) as Record<string, any>;
    if (linkage.type !== "reimbursement" || !(toNumber(tx.amountIn) > 0) || !tx.importBatchId) continue;
    const allocations = legacyAllocations(linkage);
    if (!allocations.length || allocations.some((item: any) => item?.transactionId)) continue;
    const list = unresolvedByBatch.get(tx.importBatchId) || [];
    list.push(tx);
    unresolvedByBatch.set(tx.importBatchId, list);
  }
  const misplaced = transactions.filter((tx) => {
    const linkage = (tx.linkage || {}) as Record<string, any>;
    return linkage.type === "reimbursement" && !(toNumber(tx.amountIn) > 0);
  });
  for (const tx of misplaced) {
    const linkage = (tx.linkage || {}) as Record<string, any>;
    const end = ends.get(transactionKey(tx.id));
    const allocations = legacyAllocations(linkage).filter(
      (item: any) => typeof item?.transactionId === "string" && toNumber(item.amount) > 0,
    );
    const key = amountsKey(allocations.map((item: any) => toNumber(item.amount)));
    const matches = (unresolvedByBatch.get(tx.importBatchId || "") || []).filter(
      (candidate) =>
        amountsKey(legacyAllocations(candidate.linkage as Record<string, any>).map((item: any) => toNumber(item.amount))) === key,
    );
    const rivals = misplaced.filter(
      (other) =>
        other.id !== tx.id &&
        other.importBatchId === tx.importBatchId &&
        amountsKey(
          legacyAllocations((other.linkage || {}) as Record<string, any>)
            .filter((item: any) => typeof item?.transactionId === "string")
            .map((item: any) => toNumber(item.amount)),
        ) === key,
    );
    const owner = allocations.length && matches.length === 1 && rivals.length === 0 ? matches[0] : null;
    if (owner) {
      const ownerEnd = ends.get(transactionKey(owner.id));
      const targets = allocations
        .map((item: any) => ({ transactionId: String(item.transactionId), amount: money(toNumber(item.amount)) }))
        .filter((item: { transactionId: string }) => ends.has(transactionKey(item.transactionId)));
      const finding: AuditFinding = {
        kind: "misplaced_link_restored",
        userId,
        transactionId: owner.id,
        message: `${end ? describeEnd(end) : tx.id} held links that belong to ${ownerEnd ? describeEnd(ownerEnd) : owner.id}: ${targets
          .map((item: { transactionId: string; amount: number }) => {
            const target = ends.get(transactionKey(item.transactionId));
            return `${item.amount.toFixed(2)} for ${target ? describeEnd(target) : item.transactionId}`;
          })
          .join(", ")}`,
      };
      if (fix) {
        try {
          const existing = (await db.reimbursementLink.findMany({
            where: { userId, reimbursementTransactionId: owner.id, expenseTransactionId: { not: null } },
          })).map((link) => ({ other: { transactionId: link.expenseTransactionId as string }, amount: toNumber(link.amount) }));
          await replaceLinks(db, userId, {
            subject: { transactionId: owner.id },
            role: "reimbursement",
            links: [
              ...existing,
              ...targets.map((item: { transactionId: string; amount: number }) => ({
                other: { transactionId: item.transactionId },
                amount: item.amount,
              })),
            ],
          });
          await db.transaction.update({ where: { id: tx.id }, data: { linkage: Prisma.DbNull } });
          tx.linkage = null;
          finding.fixed = true;
        } catch (error) {
          finding.message += ` (not restored: ${error instanceof Error ? error.message : "failed"})`;
        }
      }
      findings.push(finding);
      continue;
    }
    findings.push({
      kind: "reimbursement_not_money_in",
      userId,
      transactionId: tx.id,
      message: `${end ? describeEnd(end) : tx.id} is marked as a reimbursement but is money out${fix ? "; the reimbursement mark was removed (its category is unchanged)" : ""}`,
      fixed: fix,
    });
    if (fix) {
      await db.transaction.update({ where: { id: tx.id }, data: { linkage: Prisma.DbNull } });
      tx.linkage = null;
    }
  }

  // Cached linkage JSON that disagrees with the links table.
  const finalLinks = fix
    ? (await db.reimbursementLink.findMany({ where: { userId } })).map((link) => ({ ...link, amount: money(toNumber(link.amount)) }))
    : allLinks.filter((link) => !invalid.has(link.id));
  const finalSaved = finalLinks.filter((link) => link.reimbursementTransactionId && link.expenseTransactionId);
  const driftIds: string[] = [];
  for (const tx of transactions) {
    const next = canonicalLinkage(
      tx.linkage,
      toNumber(tx.amountIn),
      finalSaved
        .filter((link) => link.reimbursementTransactionId === tx.id)
        .map((link) => ({ transactionId: link.expenseTransactionId as string, amount: link.amount })),
      finalSaved
        .filter((link) => link.expenseTransactionId === tx.id)
        .map((link) => ({ transactionId: link.reimbursementTransactionId as string, amount: link.amount })),
    );
    if (sameJson(next, tx.linkage)) continue;
    driftIds.push(tx.id);
    const end = ends.get(transactionKey(tx.id));
    findings.push({
      kind: "cache_drift",
      userId,
      transactionId: tx.id,
      message: `${end ? describeEnd(end) : tx.id}: cached links differ from the links table`,
      fixed: fix,
    });
  }
  if (fix && driftIds.length) await syncTransactionCaches(db, userId, driftIds);
  return findings;
}
