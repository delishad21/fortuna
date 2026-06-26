import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSourceAwareTransactions,
  detectNewAccountIdentifiers,
  mergeFileParseStatuses,
  resolveTransactionAccountColor,
} from "./importAccountMapping";

describe("import account mapping", () => {
  it("attaches parser, source file, and row-level account to parsed transactions", () => {
    const transactions = buildSourceAwareTransactions([
      {
        filename: "dbs-jan.pdf",
        parserId: "dbs_statement",
        accountIdentifier: "DBS 1234",
        success: true,
        count: 1,
        transactions: [
          {
            date: "2026-01-02",
            description: "Coffee",
            amountOut: 4.5,
            metadata: { row: 8 },
          },
        ],
      },
      {
        filename: "uob-jan.csv",
        parserId: "uob_csv",
        success: true,
        count: 1,
        transactions: [
          {
            date: "2026-01-01",
            description: "Salary",
            amountIn: 1000,
            accountIdentifier: "UOB 5678",
            metadata: { row: 2 },
          },
        ],
      },
    ]);

    assert.deepEqual(
      transactions.map((transaction) => ({
        date: transaction.date,
        accountIdentifier: transaction.accountIdentifier,
        metadata: transaction.metadata,
      })),
      [
        {
          date: "2026-01-01",
          accountIdentifier: "UOB 5678",
          metadata: {
            row: 2,
            sourceFilename: "uob-jan.csv",
            parserId: "uob_csv",
            accountIdentifier: "UOB 5678",
          },
        },
        {
          date: "2026-01-02",
          accountIdentifier: "DBS 1234",
          metadata: {
            row: 8,
            sourceFilename: "dbs-jan.pdf",
            parserId: "dbs_statement",
            accountIdentifier: "DBS 1234",
          },
        },
      ],
    );
  });

  it("detects unique new accounts that are not already saved", () => {
    const newAccounts = detectNewAccountIdentifiers(
      [
        { accountIdentifier: "DBS 1234" },
        { accountIdentifier: "UOB 5678" },
        { accountIdentifier: "DBS 1234" },
        { accountIdentifier: "" },
      ],
      [{ id: "existing", accountIdentifier: "UOB 5678", color: "#22c55e" }],
    );

    assert.deepEqual(newAccounts, ["DBS 1234"]);
  });

  it("resolves row rail color from saved accounts, pending colors, then neutral fallback", () => {
    const saved = [{ id: "a1", accountIdentifier: "DBS 1234", color: "#6366f1" }];
    const pending = new Map([["UOB 5678", "#f97316"]]);

    assert.equal(
      resolveTransactionAccountColor("DBS 1234", saved, pending),
      "#6366f1",
    );
    assert.equal(
      resolveTransactionAccountColor("UOB 5678", saved, pending),
      "#f97316",
    );
    assert.equal(resolveTransactionAccountColor("", saved, pending), "#9ca3af");
  });

  it("matches parse results back to pending files by file object instead of filename", () => {
    const firstFile = { name: "statement.csv" };
    const secondFile = { name: "statement.csv" };
    const files = [
      { file: firstFile, status: "pending" as const },
      { file: secondFile, status: "pending" as const },
    ];

    assert.deepEqual(
      mergeFileParseStatuses(files, files, [
        {
          filename: "statement.csv",
          parserId: "dbs",
          success: false,
          transactions: [],
          count: 0,
          error: "DBS parse failed",
        },
        {
          filename: "statement.csv",
          parserId: "uob",
          success: true,
          transactions: [],
          count: 0,
        },
      ]).map((fileState) => ({
        status: fileState.status,
        error: fileState.error,
      })),
      [
        { status: "error", error: "DBS parse failed" },
        { status: "success", error: undefined },
      ],
    );
  });
});
