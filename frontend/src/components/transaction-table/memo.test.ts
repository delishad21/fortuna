import assert from "node:assert/strict";
import test from "node:test";
import { areTransactionTablePropsEqual } from "./memo";
import type { TransactionTableProps } from "./types";

const noop = () => {};

function createProps(
  overrides: Partial<TransactionTableProps> = {},
): TransactionTableProps {
  const transactions = [
    {
      date: "2026-01-01",
      description: "Coffee",
      amountOut: 4.5,
      metadata: {},
    },
  ];

  return {
    parsedData: {
      success: true,
      filename: "statement.csv",
      parserId: "generic_csv",
      transactions,
      count: transactions.length,
    },
    transactions,
    categories: [{ id: "food", name: "Food", color: "#000000" }],
    accountIdentifier: "main",
    accountColor: "#6366f1",
    accountIdentifiers: [],
    isNewAccount: false,
    duplicates: undefined,
    selectedIndices: new Set([0]),
    nonDuplicateIndices: new Set(),
    isCheckingDuplicates: false,
    isImporting: false,
    showDuplicatesOnly: false,
    showAccountSelector: true,
    onUpdateTransaction: noop,
    onAccountIdentifierChange: noop,
    onAccountColorChange: noop,
    onAddAccountIdentifier: noop,
    onImport: noop,
    onConfirmImport: noop,
    onSelectAll: noop,
    onDeselectAll: noop,
    onSelectVisible: noop,
    onDeselectVisible: noop,
    onToggleSelection: noop,
    onAddCategoryClick: noop,
    onBack: noop,
    onLinkageChange: noop,
    onOpenReimbursementSelector: noop,
    deferCellCommit: true,
    lockLinkedReimbursements: false,
    allowReservedCategorySelection: true,
    ...overrides,
  };
}

test("keeps the transaction table memoized across modal-only parent renders", () => {
  const previous = createProps();
  const next = {
    ...previous,
    parsedData: { ...previous.parsedData },
    onUpdateTransaction: () => {},
    onAddCategoryClick: () => {},
    onOpenReimbursementSelector: () => {},
  };

  assert.equal(areTransactionTablePropsEqual(previous, next), true);
});

test("rerenders the transaction table when table data changes", () => {
  const previous = createProps();
  const next = {
    ...previous,
    transactions: [
      ...previous.transactions,
      {
        date: "2026-01-02",
        description: "Lunch",
        amountOut: 12,
        metadata: {},
      },
    ],
  };

  assert.equal(areTransactionTablePropsEqual(previous, next), false);
});
