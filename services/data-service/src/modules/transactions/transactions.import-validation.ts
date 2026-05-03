import type { ImportTransactionInput } from "../duplicates/duplicate-detector";

const toNumber = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const absoluteAmount = (transaction: ImportTransactionInput | undefined) => {
  if (!transaction) return 0;
  const amountOut = toNumber(transaction.amountOut);
  if (amountOut > 0) return amountOut;
  const amountIn = toNumber(transaction.amountIn);
  if (amountIn > 0) return amountIn;
  return 0;
};

export function validatePendingReimbursementLinks(
  transactions: ImportTransactionInput[],
  selectedIndices: number[],
) {
  const selected = new Set(selectedIndices);
  const pendingTargetAllocations = new Map<number, number>();

  for (const index of selectedIndices) {
    const transaction = transactions[index];
    const linkage = transaction?.linkage;
    if (!transaction || linkage?.type !== "reimbursement") continue;

    const reimbursementAmount = toNumber(transaction.amountIn);
    if (!(reimbursementAmount > 0)) {
      throw new Error(
        `Row ${index + 1} is marked as a reimbursement but is not a positive inflow`,
      );
    }

    const allocations = linkage.reimbursesAllocations || [];
    let totalAllocated = 0;
    for (const allocation of allocations) {
      const amount = toNumber(allocation.amount);
      totalAllocated += amount;

      if (typeof allocation.pendingBatchIndex !== "number") continue;
      const targetIndex = allocation.pendingBatchIndex;
      pendingTargetAllocations.set(
        targetIndex,
        Number(((pendingTargetAllocations.get(targetIndex) || 0) + amount).toFixed(2)),
      );
      const target = transactions[targetIndex];

      if (!target) {
        throw new Error(
          `Row ${index + 1} references a reimbursed transaction that is not in the import`,
        );
      }

      if (!selected.has(targetIndex)) {
        throw new Error(
          `Row ${index + 1} reimburses row ${targetIndex + 1}; the target transaction must also be selected`,
        );
      }

      const targetAmount = absoluteAmount(target);
      if (amount - targetAmount > 0.01) {
        throw new Error(
          `Row ${index + 1} allocates more reimbursement than row ${targetIndex + 1} can receive`,
        );
      }
    }

    if (totalAllocated - reimbursementAmount > 0.01) {
      throw new Error(
        `Row ${index + 1} allocates more than the reimbursement inflow`,
      );
    }

  }

  for (const [targetIndex, allocated] of pendingTargetAllocations.entries()) {
    const targetAmount = absoluteAmount(transactions[targetIndex]);
    if (allocated - targetAmount > 0.01) {
      throw new Error(
        `Current-import reimbursements over-allocate row ${targetIndex + 1}`,
      );
    }
  }
}
