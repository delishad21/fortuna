import { Prisma } from "@prisma/client";

type Db = Pick<Prisma.TransactionClient, "statementFile" | "chatAttachment">;
type FileState = {
  id: string;
  filename: string;
  expiresAt: Date;
  retained: boolean;
  deletedAt: Date | null;
};
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Why a statement file can't be used, or null when it can. */
export function statementFileProblem(
  file: FileState,
  now = new Date(),
): string | null {
  if (file.deletedAt)
    return `${file.filename} (${file.id}) was deleted; ask the user to upload it again`;
  if (!file.retained && file.expiresAt <= now)
    return `${file.filename} (${file.id}) expired on ${day(file.expiresAt)}; ask the user to upload it again`;
  return null;
}

/**
 * Checks that every ID is a usable statement file of the user, and says exactly
 * what is wrong with each one that isn't: an attachment ID passed by mistake
 * (naming its statementFileId), an unknown ID, a deleted or an expired file.
 * Returns the files in ID order; throws { status: 404 } listing every problem.
 */
export async function requireStatementFiles(
  db: Db,
  userId: string,
  ids: string[],
  now = new Date(),
) {
  const unique = [...new Set(ids)];
  const files = await db.statementFile.findMany({
    where: { id: { in: unique }, userId },
    orderBy: { id: "asc" },
  });
  const byId = new Map(files.map((f) => [f.id, f]));
  const missing = unique.filter((id) => !byId.has(id));
  const attachments = missing.length
    ? await db.chatAttachment.findMany({
        where: { id: { in: missing }, userId },
        select: { id: true, statementFileId: true },
      })
    : [];
  const attachment = new Map(attachments.map((a) => [a.id, a.statementFileId]));
  const problems = unique.flatMap((id) => {
    const file = byId.get(id);
    if (file) {
      const problem = statementFileProblem(file, now);
      return problem ? [problem] : [];
    }
    return attachment.has(id)
      ? [
          `not found: ${id} is a chat attachment ID, not a statement file; the attachment's statementFileId is ${attachment.get(id)}`,
        ]
      : [
          `not found: ${id} is not a statement file of this user (statement file IDs look like upload_…)`,
        ];
  });
  if (problems.length)
    throw Object.assign(new Error(problems.join(". ")), { status: 404 });
  return files;
}

/**
 * Accepts statement file IDs or chat attachment IDs of this conversation, and
 * returns statement file IDs in the same order. Unknown IDs pass through
 * unchanged so requireStatementFiles can say what is wrong with them.
 */
export async function toStatementFileIds(
  db: Db,
  context: { userId: string; conversationId: string },
  ids: string[],
) {
  const known = new Set(
    (
      await db.statementFile.findMany({
        where: { id: { in: ids }, userId: context.userId },
        select: { id: true },
      })
    ).map((f) => f.id),
  );
  const unknown = ids.filter((id) => !known.has(id));
  const attachments = unknown.length
    ? await db.chatAttachment.findMany({
        where: {
          id: { in: unknown },
          userId: context.userId,
          conversationId: context.conversationId,
        },
        select: { id: true, statementFileId: true },
      })
    : [];
  const mapped = new Map(attachments.map((a) => [a.id, a.statementFileId]));
  return [...new Set(ids.map((id) => mapped.get(id) ?? id))];
}

/**
 * The conversation's attachment for an attachment ID or the statement file ID
 * it holds, with its file checked; throws { status: 404 } saying what is wrong.
 */
export async function requireConversationAttachment(
  db: Db,
  context: { userId: string; conversationId: string },
  id: string,
) {
  const attachment = await db.chatAttachment.findFirst({
    where: {
      userId: context.userId,
      conversationId: context.conversationId,
      OR: [{ id }, { statementFileId: id }],
    },
    include: { statementFile: true },
  });
  if (!attachment)
    throw Object.assign(
      new Error(
        `not found: ${id} is not an attachment of this conversation (use an attachment ID or its statementFileId)`,
      ),
      { status: 404 },
    );
  const problem = statementFileProblem(attachment.statementFile);
  if (problem) throw Object.assign(new Error(problem), { status: 404 });
  return attachment;
}

/** A statement file's normal life; chat use older than this no longer holds it. */
export const STATEMENT_FILE_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
const CLOSED_DRAFT_STATUSES = ["committed", "discarded", "expired", "failed"];
const OPEN_RUN_STATUSES = ["queued", "running", "awaiting_confirmation"];

type UseDb = Pick<
  Prisma.TransactionClient,
  "importDraft" | "chatAttachment" | "chatRun" | "chatMessage"
>;

/**
 * The files among fileIds that a chat still uses: an attachment added, or sent
 * in a message, within the file's normal life, or one in a conversation whose
 * run is still open.
 */
export async function statementFilesUsedByChats(
  db: Pick<UseDb, "chatAttachment" | "chatRun" | "chatMessage">,
  fileIds: string[],
  now = new Date(),
) {
  const used = new Set<string>();
  if (!fileIds.length) return used;
  const since = new Date(now.getTime() - STATEMENT_FILE_LIFE_MS);
  const attachments = await db.chatAttachment.findMany({
    where: {
      statementFileId: { in: [...new Set(fileIds)] },
      conversation: { deletedAt: null },
    },
    select: { id: true, conversationId: true, statementFileId: true, createdAt: true },
  });
  const older = attachments.filter((a) => {
    if (a.createdAt < since) return true;
    used.add(a.statementFileId);
    return false;
  });
  const conversationIds = [...new Set(older.map((a) => a.conversationId))];
  if (!conversationIds.length) return used;
  const openRuns = new Set(
    (
      await db.chatRun.findMany({
        where: {
          conversationId: { in: conversationIds },
          status: { in: OPEN_RUN_STATUSES },
          updatedAt: { gte: since },
        },
        select: { conversationId: true },
      })
    ).map((run) => run.conversationId),
  );
  const sent = new Set<string>();
  for (const message of await db.chatMessage.findMany({
    where: { conversationId: { in: conversationIds }, createdAt: { gte: since } },
    select: { blocks: true },
  }))
    for (const block of Array.isArray(message.blocks) ? message.blocks : [])
      if (block && typeof block === "object" && "type" in block && block.type === "attachment")
        sent.add(String((block as { id?: unknown }).id));
  for (const a of older)
    if (openRuns.has(a.conversationId) || sent.has(a.id)) used.add(a.statementFileId);
  return used;
}

/**
 * Why each of fileIds must not be deleted yet: "draft" when an import draft
 * that isn't committed, discarded, expired or failed (other than exceptDraftIds)
 * was staged from it, "chat" when a chat still uses it. Files missing from the
 * map can be deleted.
 */
export async function statementFilesInUse(
  db: UseDb,
  fileIds: string[],
  options: { exceptDraftIds?: string[]; now?: Date } = {},
) {
  const uses = new Map<string, "draft" | "chat">();
  if (!fileIds.length) return uses;
  const drafts = await db.importDraft.findMany({
    where: {
      sourceFileId: { in: [...new Set(fileIds)] },
      id: { notIn: options.exceptDraftIds ?? [] },
      status: { notIn: CLOSED_DRAFT_STATUSES },
    },
    select: { sourceFileId: true },
  });
  for (const draft of drafts) if (draft.sourceFileId) uses.set(draft.sourceFileId, "draft");
  const rest = fileIds.filter((id) => !uses.has(id));
  for (const id of await statementFilesUsedByChats(db, rest, options.now))
    uses.set(id, "chat");
  return uses;
}
