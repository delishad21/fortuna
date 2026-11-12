type CleanupPrisma = {
  parserWorkspace: {
    updateMany: (...args: any[]) => Promise<{ count: number }>;
  };
};

/**
 * Expires parser workspaces past their life. Statement files are not touched:
 * they are kept until the user deletes them from the Statements list.
 */
export async function cleanupExpiredWorkflowData(prisma: CleanupPrisma, now: Date) {
  const workspaces = await prisma.parserWorkspace.updateMany({
    where: {
      expiresAt: { lte: now },
      status: { notIn: ["approved", "expired"] },
    },
    data: { status: "expired" },
  });

  return {
    expiredDrafts: 0,
    expiredWorkspaces: workspaces.count,
  };
}
