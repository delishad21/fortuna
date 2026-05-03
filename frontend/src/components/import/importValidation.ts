import type { Transaction } from "@/components/transaction-table/types";

export interface ImportValidationError {
  indices: number[];
  title: string;
  message: string;
}

export interface ImportValidationResult {
  valid: boolean;
  errors: ImportValidationError[];
  errorIndices: number[];
}

const toNumber = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const transactionName = (transaction: Transaction | undefined, index: number) => {
  if (!transaction) return `Row ${index + 1}`;
  return transaction.label?.trim() || transaction.description || `Row ${index + 1}`;
};

const absoluteAmount = (transaction: Transaction | undefined) => {
  if (!transaction) return 0;
  const amountOut = toNumber(transaction.amountOut);
  if (amountOut > 0) return amountOut;
  const amountIn = toNumber(transaction.amountIn);
  if (amountIn > 0) return amountIn;
  return 0;
};

export function validateImportSelection(
  transactions: Transaction[],
  selectedIndices: Set<number>,
): ImportValidationResult {
  const errors: ImportValidationError[] = [];
  const pendingTargetAllocations = new Map<
    number,
    { total: number; reimbursementIndices: Set<number> }
  >();
  const existingTargetAllocations = new Map<
    string,
    {
      total: number;
      remaining: number;
      targetName: string;
      reimbursementIndices: Set<number>;
    }
  >();

  transactions.forEach((transaction, index) => {
    if (!selectedIndices.has(index)) return;
    const linkage = transaction.linkage;
    if (linkage?.type !== "reimbursement") return;

    const reimbursementAmount = toNumber(transaction.amountIn);
    if (!(reimbursementAmount > 0)) {
      errors.push({
        indices: [index],
        title: "Invalid reimbursement",
        message: `Row ${index + 1} (${transactionName(transaction, index)}) is marked as a reimbursement but is not a positive inflow.`,
      });
      return;
    }

    const allocations = linkage.reimbursesAllocations || [];
    let currentImportAllocated = 0;
    let totalAllocated = 0;
    allocations.forEach((allocation) => {
      const amount = toNumber(allocation.amount);
      totalAllocated += amount;

      if (typeof allocation.pendingBatchIndex !== "number") return;
      const targetIndex = allocation.pendingBatchIndex;
      currentImportAllocated += amount;
      const aggregate = pendingTargetAllocations.get(targetIndex) || {
        total: 0,
        reimbursementIndices: new Set<number>(),
      };
      aggregate.total = Number((aggregate.total + amount).toFixed(2));
      aggregate.reimbursementIndices.add(index);
      pendingTargetAllocations.set(targetIndex, aggregate);
      const target = transactions[targetIndex];

      if (!target) {
        errors.push({
          indices: [index],
          title: "Missing reimbursed transaction",
          message: `Row ${index + 1} (${transactionName(transaction, index)}) references a transaction that is no longer in the import review table.`,
        });
        return;
      }

      if (!selectedIndices.has(targetIndex)) {
        errors.push({
          indices: [index, targetIndex],
          title: "Linked transaction not selected",
          message: `Row ${index + 1} (${transactionName(transaction, index)}) reimburses row ${targetIndex + 1} (${transactionName(target, targetIndex)}). The target transaction must also be selected for the import.`,
        });
      }

      const targetAmount = absoluteAmount(target);
      if (amount - targetAmount > 0.01) {
        errors.push({
          indices: [index, targetIndex],
          title: "Reimbursement amount too high",
          message: `Row ${index + 1} allocates ${amount.toFixed(2)} to row ${targetIndex + 1}, but that transaction only has ${targetAmount.toFixed(2)} available to reimburse.`,
        });
      }
    });

    allocations.forEach((allocation) => {
      if (typeof allocation.transactionId !== "string") return;
      const remaining = toNumber(allocation.targetRemainingReimbursable);
      if (!(remaining >= 0)) return;
      const amount = toNumber(allocation.amount);
      const targetName =
        allocation.targetDescription?.trim() ||
        (allocation.targetDate
          ? `existing transaction from ${allocation.targetDate}`
          : "existing transaction");
      const aggregate = existingTargetAllocations.get(allocation.transactionId) || {
        total: 0,
        remaining,
        targetName,
        reimbursementIndices: new Set<number>(),
      };
      aggregate.total = Number((aggregate.total + amount).toFixed(2));
      aggregate.remaining = Math.max(aggregate.remaining, remaining);
      aggregate.targetName = aggregate.targetName || targetName;
      aggregate.reimbursementIndices.add(index);
      existingTargetAllocations.set(allocation.transactionId, aggregate);
    });

    if (totalAllocated - reimbursementAmount > 0.01) {
      errors.push({
        indices: [index],
        title: "Reimbursement allocation exceeds inflow",
        message: `Row ${index + 1} (${transactionName(transaction, index)}) allocates ${totalAllocated.toFixed(2)}, which exceeds the reimbursement inflow of ${reimbursementAmount.toFixed(2)}.`,
      });
    }

    if (currentImportAllocated > 0 && currentImportAllocated - reimbursementAmount > 0.01) {
      errors.push({
        indices: [index],
        title: "Current import allocation exceeds reimbursement",
        message: `Row ${index + 1} allocates more current-import reimbursement than the inflow amount.`,
      });
    }
  });

  pendingTargetAllocations.forEach((aggregate, targetIndex) => {
    const target = transactions[targetIndex];
    if (!target) return;
    const targetAmount = absoluteAmount(target);
    if (aggregate.total - targetAmount <= 0.01) return;

    errors.push({
      indices: [targetIndex, ...aggregate.reimbursementIndices],
      title: "Reimbursement target over-allocated",
      message: `Rows ${Array.from(aggregate.reimbursementIndices).map((index) => index + 1).join(", ")} allocate ${aggregate.total.toFixed(2)} to row ${targetIndex + 1} (${transactionName(target, targetIndex)}), which would over-allocate the target amount of ${targetAmount.toFixed(2)}.`,
    });
  });

  existingTargetAllocations.forEach((aggregate) => {
    if (aggregate.total - aggregate.remaining <= 0.01) return;

    const rows = Array.from(aggregate.reimbursementIndices)
      .sort((a, b) => a - b)
      .map((index) => index + 1);
    errors.push({
      indices: Array.from(aggregate.reimbursementIndices),
      title: "Existing transaction over-allocated",
      message: `Rows ${rows.join(", ")} allocate ${aggregate.total.toFixed(2)} to ${aggregate.targetName}, which only has ${aggregate.remaining.toFixed(2)} remaining to reimburse.`,
    });
  });

  const errorIndices = Array.from(
    new Set(errors.flatMap((error) => error.indices)),
  ).sort((a, b) => a - b);

  return {
    valid: errors.length === 0,
    errors,
    errorIndices,
  };
}

export function formatImportValidationErrors(errors: ImportValidationError[]) {
  return errors
    .map((error, index) => `${index + 1}. ${error.title}\n${error.message}`)
    .join("\n\n");
}
