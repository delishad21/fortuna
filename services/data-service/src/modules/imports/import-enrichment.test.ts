import assert from "node:assert/strict";
import test from "node:test";
import { alignReservedLinkage, withSourceMetadata } from "./import-enrichment";

test("tags rows with their statement and resolved account", () => {
  const [row] = withSourceMetadata(
    [{ date: "2026-08-08", description: "SHOP", metadata: { accountNumber: "123-4" } }],
    { filename: "may.pdf", parserId: "dbs_statement" },
  );
  assert.equal(row.accountIdentifier, "123-4");
  assert.deepEqual(row.metadata, {
    accountNumber: "123-4",
    sourceFilename: "may.pdf",
    parserId: "dbs_statement",
    accountIdentifier: "123-4",
  });
});

test("leaves parserId out of metadata when the rows have no parser", () => {
  const [row] = withSourceMetadata([{ description: "SHOP" }], { filename: "notes.txt" });
  assert.equal(row.accountIdentifier, undefined);
  assert.deepEqual(row.metadata, { sourceFilename: "notes.txt" });
});

test("maps reserved categories to linkage", () => {
  const [internal, reimbursement, outflow] = alignReservedLinkage(
    [
      { categoryId: "internal", amountOut: 10 },
      { categoryId: "reimbursement", amountIn: 25 },
      { categoryId: "reimbursement", amountOut: 5 },
    ],
    { internalId: "internal", reimbursementId: "reimbursement" },
  );
  assert.equal(internal.linkage.type, "internal");
  assert.equal(reimbursement.linkage.type, "reimbursement");
  assert.equal(reimbursement.linkage.leftoverAmount, 25);
  assert.equal(outflow.linkage, undefined);
});

test("fills defaults on an existing reimbursement linkage", () => {
  const [row] = alignReservedLinkage(
    [{ amountIn: 40, linkage: { type: "reimbursement" } }],
    {},
  );
  assert.deepEqual(row.linkage, {
    type: "reimbursement",
    reimbursesAllocations: [],
    leftoverAmount: 40,
    leftoverCategoryId: null,
  });
});
