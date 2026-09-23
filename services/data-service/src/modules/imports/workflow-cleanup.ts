type CleanupPrisma = {
  statementFile: {
    findMany: (...args: any[]) => Promise<Array<{ id: string; storagePath: string }>>;
    updateMany: (...args: any[]) => Promise<{ count: number }>;
  };
  parserWorkspace: {
    updateMany: (...args: any[]) => Promise<{ count: number }>;
  };
};

export async function cleanupExpiredWorkflowData(
  prisma: CleanupPrisma,
  removeFile: (path: string) => Promise<void>,
  now = new Date(),
) {
  const files = await prisma.statementFile.findMany({
    where: { retained: false, deletedAt: null, expiresAt: { lte: now } },
    select: { id: true, storagePath: true },
    take: 500,
  });

  if (files.length) {
    await prisma.statementFile.updateMany({
      where: { id: { in: files.map((file) => file.id) } },
      data: { status: "deleted", deletedAt: now },
    });
    await Promise.all(
      files.map((file) => removeFile(file.storagePath).catch(() => undefined)),
    );
  }

  const workspaces = await prisma.parserWorkspace.updateMany({
    where: {
      expiresAt: { lte: now },
      status: { notIn: ["approved", "expired"] },
    },
    data: { status: "expired" },
  });

  return {
    deletedFiles: files.length,
    expiredDrafts: 0,
    expiredWorkspaces: workspaces.count,
  };
}
