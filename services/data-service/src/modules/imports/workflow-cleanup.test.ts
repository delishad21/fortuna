import assert from "node:assert/strict";
import test from "node:test";
import { cleanupExpiredWorkflowData } from "./workflow-cleanup";

test("cleanup expires parser workspaces and leaves statement files and drafts alone", async () => {
  const calls: string[] = [];
  const touch = (name: string) => async () => {
    calls.push(name);
    return { count: 2 };
  };
  const prisma = {
    statementFile: { findMany: touch("statementFile.findMany"), updateMany: touch("statementFile.updateMany") },
    parserWorkspace: { updateMany: touch("parserWorkspace.updateMany") },
    importDraft: { updateMany: touch("importDraft.updateMany") },
  };

  const result = await cleanupExpiredWorkflowData(prisma, new Date("2026-09-23T08:22:58.000Z"));

  assert.deepEqual(calls, ["parserWorkspace.updateMany"]);
  assert.deepEqual(result, { expiredDrafts: 0, expiredWorkspaces: 2 });
});
