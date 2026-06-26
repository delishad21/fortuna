import type { TransactionTableProps } from "./types";

export function areTransactionTablePropsEqual(
  previous: TransactionTableProps,
  next: TransactionTableProps,
) {
  return (
    previous.transactions === next.transactions &&
    previous.categories === next.categories &&
    previous.accountIdentifier === next.accountIdentifier &&
    previous.accountColor === next.accountColor &&
    previous.accountIdentifiers === next.accountIdentifiers &&
    previous.isNewAccount === next.isNewAccount &&
    previous.duplicates === next.duplicates &&
    previous.selectedIndices === next.selectedIndices &&
    previous.nonDuplicateIndices === next.nonDuplicateIndices &&
    previous.isCheckingDuplicates === next.isCheckingDuplicates &&
    previous.isImporting === next.isImporting &&
    previous.showDuplicatesOnly === next.showDuplicatesOnly &&
    previous.showAccountSelector === next.showAccountSelector &&
    previous.pendingAccountColors === next.pendingAccountColors &&
    previous.onTransactionAccountIdentifierChange ===
      next.onTransactionAccountIdentifierChange &&
    previous.amountInHeader === next.amountInHeader &&
    previous.amountOutHeader === next.amountOutHeader &&
    previous.deferCellCommit === next.deferCellCommit &&
    previous.lockLinkedReimbursements === next.lockLinkedReimbursements &&
    previous.allowReservedCategorySelection === next.allowReservedCategorySelection &&
    previous.renderExpandedActions === next.renderExpandedActions &&
    previous.reviewActionLeft === next.reviewActionLeft &&
    previous.parsedData.success === next.parsedData.success &&
    previous.parsedData.filename === next.parsedData.filename &&
    previous.parsedData.parserId === next.parsedData.parserId &&
    previous.parsedData.count === next.parsedData.count &&
    previous.parsedData.transactions === next.parsedData.transactions
  );
}
