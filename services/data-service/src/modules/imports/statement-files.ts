import { Prisma } from "@prisma/client";

type Db = Pick<Prisma.TransactionClient, "statementFile" | "chatAttachment">;
type FileState = { id: string; filename: string; deletedAt: Date | null };

/** Why a statement file can't be used, or null when it can. */
export function statementFileProblem(file: FileState): string | null {
  if (file.deletedAt)
    return `${file.filename} (${file.id}) was deleted from the Statements list by the user`;
  return null;
}

/**
 * Checks that every ID is a usable statement file of the user, and says exactly
 * what is wrong with each one that isn't: an attachment ID passed by mistake
 * (naming its statementFileId), an unknown ID or a file the user deleted.
 * Returns the files in ID order; throws { status: 404 } listing every problem.
 */
export async function requireStatementFiles(
  db: Db,
  userId: string,
  ids: string[],
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
      const problem = statementFileProblem(file);
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

const CLOSED_DRAFT_STATUSES = ["committed", "discarded", "expired", "failed"];

/**
 * The files among fileIds that an import draft which isn't committed,
 * discarded, expired or failed was staged from; those can't be deleted yet.
 */
export async function statementFilesInUse(
  db: Pick<Prisma.TransactionClient, "importDraft">,
  fileIds: string[],
) {
  const used = new Set<string>();
  if (!fileIds.length) return used;
  const drafts = await db.importDraft.findMany({
    where: {
      sourceFileId: { in: [...new Set(fileIds)] },
      status: { notIn: CLOSED_DRAFT_STATUSES },
    },
    select: { sourceFileId: true },
  });
  for (const draft of drafts) if (draft.sourceFileId) used.add(draft.sourceFileId);
  return used;
}
