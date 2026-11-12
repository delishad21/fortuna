import { Prisma, PrismaClient } from "@prisma/client";
/**
 * Proposals and reviews stay pending until the user decides, the run is stopped, they
 * expire, or the assistant replaces them with a newer one covering the same records.
 * Sending another message never closes them.
 *
 * Proposal statuses: pending, applied, rejected (by the user), stale (records changed),
 * expired, superseded (replaced by a newer proposal), cancelled (run stopped),
 * closed (closed by an older version without a recorded reason).
 * Review statuses: pending, queued (sent back while the conversation was replying; locked
 * until its turn), submitted, superseded, cancelled, closed.
 */
export const PROPOSAL_LIFETIME_MS = 24 * 60 * 60 * 1000;
type Db = PrismaClient | Prisma.TransactionClient;
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : typeof value === "string"
      ? [value]
      : [];
/** The records a proposal would change, as type-prefixed keys. */
export function proposalTargets(args: unknown): string[] {
  const a = (args || {}) as Record<string, any>;
  const keys = (prefix: string, values: unknown) =>
    strings(values).map((v) => `${prefix}:${v}`);
  switch (a.kind) {
    case "edit_transactions":
      return keys(
        "row",
        (Array.isArray(a.edits) ? a.edits : []).map((e: any) => e?.id),
      );
    case "commit_drafts":
    case "discard_draft":
      return keys("draft", a.draftIds);
    case "restage_draft":
      return keys("draft", a.draftId);
    case "retain_fixture":
      return keys("file", a.statementFileIds);
    case "approve_parser":
      return keys("candidate", a.candidateId);
    case "activate_parser":
    case "rollback_parser":
      return keys("parser", a.definitionId);
    case "create_account":
      return keys("account", String(a.accountIdentifier || "").toLowerCase());
    case "create_category":
      return keys("category", String(a.name || "").toLowerCase());
    case "update_import_rule":
      return keys("rule", a.ruleId || String(a.name || "").toLowerCase());
    default:
      return [];
  }
}
/** The transactions and staged rows a review covers. */
export function reviewTargets(rows: unknown): string[] {
  return (Array.isArray(rows) ? rows : []).flatMap((r: any) =>
    strings(r?.source?.transactionId || r?.source?.rowId || r?.id).map(
      (id) => `row:${id}`,
    ),
  );
}
const overlaps = (a: string[], b: Set<string>) => a.some((k) => b.has(k));
/** Marks proposals past their lifetime as expired, so they never read as rejected. */
export async function expireProposals(
  db: Db,
  where: Prisma.ChatActionProposalWhereInput,
) {
  await db.chatActionProposal.updateMany({
    where: { ...where, status: "pending", expiresAt: { lte: new Date() } },
    data: { status: "expired", decidedAt: new Date() },
  });
}
/** Closes the conversation's older pending proposals that touch the same records. */
export async function supersedeProposals(
  db: Db,
  newer: { id: string; userId: string; conversationId: string; arguments: unknown },
) {
  const targets = new Set(proposalTargets(newer.arguments));
  if (!targets.size) return [];
  const older = await db.chatActionProposal.findMany({
    where: {
      userId: newer.userId,
      conversationId: newer.conversationId,
      status: "pending",
      id: { not: newer.id },
    },
    select: { id: true, arguments: true },
  });
  const replaced = older
    .filter((p) => overlaps(proposalTargets(p.arguments), targets))
    .map((p) => p.id);
  if (replaced.length)
    await db.chatActionProposal.updateMany({
      where: { id: { in: replaced }, status: "pending" },
      data: { status: "superseded", decidedAt: new Date() },
    });
  return replaced;
}
/** Closes the conversation's older pending reviews that cover the same rows. */
export async function supersedeReviews(
  db: Db,
  newer: { id: string; userId: string; conversationId: string; rows: unknown },
) {
  const targets = new Set(reviewTargets(newer.rows));
  if (!targets.size) return [];
  const older = await db.chatTransactionReview.findMany({
    where: {
      userId: newer.userId,
      conversationId: newer.conversationId,
      status: "pending",
      id: { not: newer.id },
    },
    select: { id: true, rows: true },
  });
  const replaced = older
    .filter((r) => overlaps(reviewTargets(r.rows), targets))
    .map((r) => r.id);
  if (replaced.length)
    await db.chatTransactionReview.updateMany({
      where: { id: { in: replaced }, status: "pending" },
      data: { status: "superseded" },
    });
  return replaced;
}
/** Closes what a stopped run left waiting; the user didn't reject any of it. */
export async function cancelPending(db: Db, where: { userId: string; runId?: string; conversationId?: string; run?: Prisma.ChatRunWhereInput }) {
  await db.chatActionProposal.updateMany({
    where: { ...where, status: "pending" },
    data: { status: "cancelled", decidedAt: new Date() },
  });
  await db.chatTransactionReview.updateMany({
    where: { ...where, status: "pending" },
    data: { status: "cancelled" },
  });
}
/**
 * What is still waiting for the user in this conversation, told to the model at the start
 * of a run so it neither proposes them again nor assumes they were dropped.
 */
export async function pendingForModel(
  db: PrismaClient,
  userId: string,
  conversationId: string,
  runId: string,
) {
  const scope = { userId, conversationId, runId: { not: runId } };
  await expireProposals(db, scope);
  const [proposals, reviews] = await Promise.all([
    db.chatActionProposal.findMany({
      where: { ...scope, status: "pending" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        kind: true,
        preview: true,
        createdAt: true,
        expiresAt: true,
      },
    }),
    db.chatTransactionReview.findMany({
      where: { ...scope, status: "pending" },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, rows: true, createdAt: true },
    }),
  ]);
  if (!proposals.length && !reviews.length) return null;
  return {
    type: "pending_approvals",
    note: "Still waiting for the user in the interface from earlier turns. Sending a message did not reject or close them: the user can still confirm, reject or submit them. Don't propose or request them again; refer to them instead. A new proposal or review covering the same records replaces the old one. Outcomes (applied, rejected) appear in the conversation as they happen.",
    proposals: proposals.map((p) => ({
      proposalId: p.id,
      kind: p.kind,
      title: (p.preview as any)?.title || p.kind,
      proposedAt: p.createdAt.toISOString(),
      expiresAt: p.expiresAt.toISOString(),
    })),
    reviews: reviews.map((r) => ({
      reviewId: r.id,
      title: r.title,
      rows: Array.isArray(r.rows) ? r.rows.length : 0,
      requestedAt: r.createdAt.toISOString(),
    })),
  };
}
