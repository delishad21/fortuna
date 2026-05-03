import assert from "node:assert/strict";
import test from "node:test";
import {
  orderCreatedTransactionsForImport,
  stripImportOrderMetadata,
} from "./transactions.service";

test("orders created import transactions by explicit import row metadata", () => {
  const createdRows = [
    { id: "created-for-row-2", metadata: { __importOriginalIndex: 2 } },
    { id: "created-for-row-0", metadata: { __importOriginalIndex: 0 } },
    { id: "created-for-row-1", metadata: { __importOriginalIndex: 1 } },
  ];

  const ordered = orderCreatedTransactionsForImport(createdRows, [0, 1, 2]);

  assert.deepEqual(
    ordered.map((row) => row.id),
    ["created-for-row-0", "created-for-row-1", "created-for-row-2"],
  );
});

test("rejects duplicate explicit import row metadata", () => {
  const createdRows = [
    { id: "created-a", metadata: { __importOriginalIndex: 0 } },
    { id: "created-b", metadata: { __importOriginalIndex: 0 } },
  ];

  assert.throws(
    () => orderCreatedTransactionsForImport(createdRows, [0]),
    /Duplicate created import transaction marker/,
  );
});

test("strips explicit import row metadata without changing other metadata", () => {
  const metadata = stripImportOrderMetadata({
    __importOriginalIndex: 2,
    parserId: "dbs_posb_consolidated",
  });

  assert.deepEqual(metadata, { parserId: "dbs_posb_consolidated" });
});
