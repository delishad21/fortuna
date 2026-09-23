import assert from "node:assert/strict";
import test from "node:test";
import { cleanupExpiredWorkflowData } from "./workflow-cleanup";

test("cleanup leaves staged import drafts available for explicit review or discard", async () => {
  const calls: string[] = [];
  const removed: string[] = [];
  const prisma = {
    statementFile: {
      findMany: async () => [{ id: "file-1", storagePath: "/tmp/file-1" }],
      updateMany: async () => {
        calls.push("statementFile.updateMany");
        return { count: 1 };
      },
    },
    parserWorkspace: {
      updateMany: async () => {
        calls.push("parserWorkspace.updateMany");
        return { count: 2 };
      },
    },
    importDraft: {
      updateMany: async () => {
        calls.push("importDraft.updateMany");
        return { count: 3 };
      },
    },
  };

  const result = await cleanupExpiredWorkflowData(
    prisma,
    async (path) => {
      removed.push(path);
    },
    new Date("2026-09-23T08:22:58.000Z"),
  );

  assert.deepEqual(calls, [
    "statementFile.updateMany",
    "parserWorkspace.updateMany",
  ]);
  assert.deepEqual(removed, ["/tmp/file-1"]);
  assert.deepEqual(result, {
    deletedFiles: 1,
    expiredDrafts: 0,
    expiredWorkspaces: 2,
  });
});
