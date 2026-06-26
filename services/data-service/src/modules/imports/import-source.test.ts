import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractMonthYearFromFilename,
  inferImportSourceFilename,
  splitImportBatchFilenames,
} from "./import-source";

describe("import source inference", () => {
  it("splits semicolon-joined import batch filenames", () => {
    assert.deepEqual(splitImportBatchFilenames("Jan2024.pdf; Feb2024.pdf"), [
      "Jan2024.pdf",
      "Feb2024.pdf",
    ]);
  });

  it("extracts month and year from statement filenames", () => {
    assert.deepEqual(
      extractMonthYearFromFilename("DBS_POSB_Consolidated_August2022.pdf"),
      { year: 2022, month: 8 },
    );
    assert.deepEqual(extractMonthYearFromFilename("2022-Dec-PayLah.pdf"), {
      year: 2022,
      month: 12,
    });
  });

  it("keeps existing source filename as the canonical source", () => {
    assert.deepEqual(
      inferImportSourceFilename({
        batchFilename: "Jan2024.pdf; Feb2024.pdf",
        metadata: { sourceFilename: "Uploaded-Feb2024.pdf" },
      }),
      {
        filename: "Uploaded-Feb2024.pdf",
        strategy: "existing_source_filename",
      },
    );
  });

  it("uses the batch filename for single-file imports", () => {
    assert.deepEqual(
      inferImportSourceFilename({
        batchFilename: "Statement January2024.csv",
        transactionDate: new Date("2024-01-14"),
        metadata: {},
      }),
      {
        filename: "Statement January2024.csv",
        strategy: "single_batch_filename",
      },
    );
  });

  it("prefers statement month metadata for multi-file imports", () => {
    assert.deepEqual(
      inferImportSourceFilename({
        batchFilename: "PayLah November2022.pdf; PayLah December2022.pdf",
        transactionDate: new Date("2022-10-31"),
        metadata: { statementYear: 2022, statementMonth: 11 },
      }),
      {
        filename: "PayLah November2022.pdf",
        strategy: "statement_month",
      },
    );
  });

  it("falls back to transaction month when statement metadata is missing", () => {
    assert.deepEqual(
      inferImportSourceFilename({
        batchFilename:
          "DBS_POSB_Consolidated_August2022.pdf; DBS_POSB_Consolidated_September2022.pdf",
        transactionDate: new Date("2022-09-10"),
        metadata: {},
      }),
      {
        filename: "DBS_POSB_Consolidated_September2022.pdf",
        strategy: "transaction_month",
      },
    );
  });

  it("does not guess when no filename matches uniquely", () => {
    assert.equal(
      inferImportSourceFilename({
        batchFilename: "Combined statement.pdf; Supplement.pdf",
        transactionDate: new Date("2022-09-10"),
        metadata: {},
      }),
      null,
    );
  });
});
