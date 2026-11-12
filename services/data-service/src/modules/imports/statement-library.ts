import { unlink } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { statementFilesInUse } from "./statement-files";

const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};

/**
 * Every statement file the user uploaded, kept until they delete it here. A file
 * an open import draft was staged from can't be deleted until that draft closes.
 */
export class StatementLibrary {
  constructor(private db: PrismaClient) {}

  async list(userId: string) {
    const files = await this.db.statementFile.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        filename: true,
        contentType: true,
        sizeBytes: true,
        createdAt: true,
        drafts: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            mode: true,
            status: true,
            sourceFilename: true,
            createdAt: true,
            committedAt: true,
            _count: { select: { rows: true } },
          },
        },
      },
      take: 500,
    });
    const inUse = await statementFilesInUse(
      this.db,
      files.map((f) => f.id),
    );
    return files.map(({ drafts, ...file }) => ({
      ...file,
      inUse: inUse.has(file.id),
      imports: drafts.map(({ _count, ...draft }) => ({ ...draft, rows: _count.rows })),
    }));
  }

  async file(userId: string, id: string) {
    const file = await this.db.statementFile.findFirst({
      where: { id, userId, deletedAt: null },
    });
    return file ?? fail(404, "Statement not found");
  }

  /** Removes the file from disk and marks it deleted; its imports stay. */
  async remove(userId: string, id: string) {
    const file = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM statement_files WHERE id = ${id} AND user_id = ${userId} FOR UPDATE`;
      const current = await tx.statementFile.findFirst({
        where: { id, userId, deletedAt: null },
      });
      if (!current) return fail(404, "Statement not found");
      if ((await statementFilesInUse(tx, [id])).has(id))
        return fail(
          409,
          `${current.filename} is still used by an open import. Commit or discard that import first.`,
        );
      await tx.statementFile.update({
        where: { id },
        data: { status: "deleted", deletedAt: new Date() },
      });
      await tx.agentAuditEvent.create({
        data: {
          userId,
          actorType: "user",
          actorId: userId,
          toolName: "delete_statement",
          targetType: "statement_file",
          targetId: id,
          metadata: { filename: current.filename, sha256: current.sha256 },
        },
      });
      return current;
    });
    await unlink(file.storagePath).catch(() => undefined);
    return { id: file.id, deleted: true };
  }
}
