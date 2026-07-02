"use client";

import { useMemo, useState, useEffect } from "react";
import { X, ArrowLeftRight, Receipt, Scissors } from "lucide-react";
import { TextInput } from "@/components/ui/TextInput";
import { DatePicker } from "@/components/ui/DatePicker";
import { Button } from "@/components/ui/Button";
import { CategorySelect } from "@/components/ui/CategorySelect";
import { AccountIdentifierSelect } from "@/components/ui/AccountIdentifierSelect";
import { ReimbursementSelectorModal } from "@/components/import/ReimbursementSelectorModal";
import { Modal } from "@/components/ui/Modal";
import {
  SplitTransactionModal,
  type SplitTransactionChildInput,
} from "@/components/transactions/SplitTransactionModal";
import type { TransactionLinkage } from "@/components/transaction-table/types";

interface Transaction {
  id: string;
  date: string;
  description: string;
  label?: string;
  amountIn: number | null;
  amountOut: number | null;
  balance: number | null;
  accountIdentifier?: string | null;
  category?: {
    id: string;
    name: string;
    color: string;
  };
  metadata?: Record<string, any>;
  linkage?: {
    type: "internal" | "reimbursement" | "reimbursed";
    reimbursesAllocations?: Array<{
      transactionId?: string;
      pendingBatchIndex?: number;
      amount: number;
    }>;
    reimbursedByAllocations?: Array<{
      transactionId: string;
      amount: number;
    }>;
    leftoverAmount?: number;
    leftoverCategoryId?: string | null;
    autoDetected?: boolean;
    detectionReason?: string;
  } | null;
  linkedTransactions?: {
    reimburses: Array<{
      id: string;
      date: string;
      label?: string | null;
      description: string;
      amountIn: number | null;
      amountOut: number | null;
      reimbursementAmount?: number | null;
    }>;
    reimbursedBy: Array<{
      id: string;
      date: string;
      label?: string | null;
      description: string;
      amountIn: number | null;
      amountOut: number | null;
      reimbursementAmount?: number | null;
    }>;
  };
}

interface Category {
  id: string;
  name: string;
  color: string;
}

interface AccountIdentifier {
  id: string;
  accountIdentifier: string;
  color: string;
}

interface EditTransactionModalProps {
  isOpen: boolean;
  transaction: Transaction;
  categories: Category[];
  accountIdentifiers: AccountIdentifier[];
  onClose: () => void;
  onSave: (transaction: Transaction) => Promise<void>;
  onSplit: (
    transactionId: string,
    children: [SplitTransactionChildInput, SplitTransactionChildInput],
  ) => Promise<void>;
  onAddCategory: () => void;
  onAddAccountIdentifier: () => void;
}

export function EditTransactionModal({
  isOpen,
  transaction,
  categories,
  accountIdentifiers,
  onClose,
  onSave,
  onSplit,
  onAddCategory,
  onAddAccountIdentifier,
}: EditTransactionModalProps) {
  // Helper to format date from ISO timestamp to YYYY-MM-DD
  const formatDateForPicker = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const [formData, setFormData] = useState({
    ...transaction,
    date: formatDateForPicker(transaction.date),
  });
  const [linkageType, setLinkageType] = useState<
    "none" | "internal" | "reimbursement"
  >(
    transaction.linkage?.type === "internal"
      ? "internal"
      : transaction.linkage?.type === "reimbursement"
        ? "reimbursement"
        : "none",
  );
  const [selectedReimbursedIds, setSelectedReimbursedIds] = useState<string[]>(
    (transaction.linkage?.reimbursesAllocations || [])
      .map((item) => item.transactionId)
      .filter((id): id is string => typeof id === "string"),
  );
  const [reimbursementLinkage, setReimbursementLinkage] =
    useState<TransactionLinkage | null>(
      transaction.linkage?.type === "reimbursement"
        ? ({
            type: "reimbursement",
            reimbursesAllocations:
              transaction.linkage?.reimbursesAllocations || [],
            leftoverAmount: transaction.linkage?.leftoverAmount,
            leftoverCategoryId: transaction.linkage?.leftoverCategoryId ?? null,
          } as TransactionLinkage)
        : null,
    );
  const [isReimbursementSelectorOpen, setIsReimbursementSelectorOpen] =
    useState(false);
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);
  const [showSplitWarning, setShowSplitWarning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setFormData({
      ...transaction,
      date: formatDateForPicker(transaction.date),
    });
    setLinkageType(
      transaction.linkage?.type === "internal"
        ? "internal"
        : transaction.linkage?.type === "reimbursement"
          ? "reimbursement"
          : "none",
    );
    setSelectedReimbursedIds(
      (transaction.linkage?.reimbursesAllocations || [])
        .map((item) => item.transactionId)
        .filter((id): id is string => typeof id === "string"),
    );
    setReimbursementLinkage(
      transaction.linkage?.type === "reimbursement"
        ? ({
            type: "reimbursement",
            reimbursesAllocations:
              transaction.linkage?.reimbursesAllocations || [],
            leftoverAmount: transaction.linkage?.leftoverAmount,
            leftoverCategoryId: transaction.linkage?.leftoverCategoryId ?? null,
          } as TransactionLinkage)
        : null,
    );
    setIsReimbursementSelectorOpen(false);
    setIsSplitModalOpen(false);
    setShowSplitWarning(false);
  }, [transaction]);

  const initialSelectedDbTransactions = useMemo(
    () =>
      transaction.linkedTransactions?.reimburses.map((linked) => ({
        id: linked.id,
        date: linked.date,
        description: linked.description,
        label: linked.label,
        amountIn: linked.amountIn,
        amountOut: linked.amountOut,
      })) || [],
    [transaction.linkedTransactions?.reimburses],
  );

  if (!isOpen) return null;

  const parseAmount = (value: number | string | null | undefined) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = typeof value === "number" ? value : Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const formatAmount = (value: number | string | null | undefined) => {
    const parsed = parseAmount(value);
    return parsed === null ? "" : parsed.toFixed(2);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      let linkage: Transaction["linkage"] | undefined = null;
      if (linkageType === "internal") {
        linkage = { type: "internal", autoDetected: false };
      } else if (linkageType === "reimbursement") {
        linkage = {
          type: "reimbursement",
          reimbursesAllocations:
            reimbursementLinkage?.reimbursesAllocations || [],
          leftoverAmount: reimbursementLinkage?.leftoverAmount,
          leftoverCategoryId: reimbursementLinkage?.leftoverCategoryId ?? null,
        };
      } else if (transaction.linkage?.type === "reimbursed") {
        // Preserve existing reimbursed linkage unless explicitly cleared via linkage actions.
        linkage = undefined;
      }
      const payload = {
        ...formData,
        amountIn: parseAmount(formData.amountIn),
        amountOut: parseAmount(formData.amountOut),
        balance: parseAmount(formData.balance),
        linkage,
      };
      await onSave(payload);
      onClose();
    } catch (error) {
      console.error("Failed to save transaction:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAmountChange = (
    field: "amountIn" | "amountOut",
    value: string,
  ) => {
    const numValue = value ? parseFloat(value) : null;

    // When setting one amount, clear the other
    if (field === "amountIn") {
      setFormData({
        ...formData,
        amountIn: numValue,
        amountOut: null,
      });
    } else {
      setFormData({
        ...formData,
        amountIn: null,
        amountOut: numValue,
      });
      if (linkageType === "reimbursement") {
        setLinkageType("none");
        setSelectedReimbursedIds([]);
      }
    }
  };

  const handleOpenReimbursementSelector = () => {
    if (!parseAmount(formData.amountIn)) return;
    setIsReimbursementSelectorOpen(true);
  };

  const handleConfirmReimbursement = (linkage: TransactionLinkage) => {
    setReimbursementLinkage(linkage);
    setSelectedReimbursedIds(
      (linkage.reimbursesAllocations || [])
        .map((item) => item.transactionId)
        .filter((id): id is string => typeof id === "string"),
    );
    setLinkageType("reimbursement");
    setIsReimbursementSelectorOpen(false);
  };

  const handleOpenSplitModal = () => {
    const currentLinkage = formData.linkage || transaction.linkage;
    if (
      currentLinkage?.type === "reimbursement" ||
      currentLinkage?.type === "reimbursed" ||
      linkageType === "reimbursement"
    ) {
      setShowSplitWarning(true);
      return;
    }
    setIsSplitModalOpen(true);
  };

  const handleConfirmSplit = async (
    children: [SplitTransactionChildInput, SplitTransactionChildInput],
  ) => {
    await onSplit(transaction.id, children);
    setIsSplitModalOpen(false);
    onClose();
  };

  // Extract source from metadata
  const source = formData.metadata?.source || formData.metadata?.parserId;

  // Get additional metadata fields (exclude source, parserId, and common fields)
  const additionalMetadata = formData.metadata
    ? Object.entries(formData.metadata).filter(
        ([key]) =>
          !["source", "parserId", "bank", "transactionType"].includes(key),
      )
    : [];

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-dark-2 rounded-lg shadow-card-2 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-dark-2 border-b border-stroke dark:border-dark-3 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-xl font-semibold text-dark dark:text-white">
            Edit Transaction
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-dark-5 hover:text-dark dark:text-dark-6 dark:hover:text-white hover:bg-gray-2 dark:hover:bg-dark-3 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-dark dark:text-white mb-2">
              Date
            </label>
            <DatePicker
              value={formData.date}
              onChange={(date) => setFormData({ ...formData, date })}
              triggerProps={{
                className:
                  "rounded-lg border border-stroke dark:border-dark-3 bg-white dark:bg-dark-2 hover:border-primary dark:hover:border-primary",
              }}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-dark dark:text-white mb-2">
              Description
            </label>
            <TextInput
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              placeholder="Transaction description"
            />
          </div>

          {/* Label */}
          <div>
            <label className="block text-sm font-medium text-dark dark:text-white mb-2">
              Label (Optional)
            </label>
            <TextInput
              value={formData.label || ""}
              onChange={(e) =>
                setFormData({ ...formData, label: e.target.value || undefined })
              }
              placeholder="Custom label"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-dark dark:text-white mb-2">
              Category
            </label>
            <CategorySelect
              value={formData.category?.id}
              categories={categories}
              onChange={(categoryId) =>
                setFormData({
                  ...formData,
                  category: categories.find((c) => c.id === categoryId),
                })
              }
              onAddClick={onAddCategory}
              excludeReserved
              disabled={linkageType === "internal" || linkageType === "reimbursement"}
            />
            {(linkageType === "internal" || linkageType === "reimbursement") && (
              <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                Category is managed automatically for linkage types.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-dark dark:text-white mb-2">
              Linkage
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Button
                type="button"
                variant={linkageType === "none" ? "primary" : "secondary"}
                onClick={() => setLinkageType("none")}
              >
                None
              </Button>
              <Button
                type="button"
                variant={linkageType === "internal" ? "primary" : "secondary"}
                onClick={() => setLinkageType("internal")}
                leftIcon={<ArrowLeftRight className="h-4 w-4" />}
              >
                Internal
              </Button>
              <Button
                type="button"
                variant={linkageType === "reimbursement" ? "success" : "secondary"}
                onClick={handleOpenReimbursementSelector}
                leftIcon={<Receipt className="h-4 w-4" />}
                disabled={!parseAmount(formData.amountIn)}
              >
                Reimbursement
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleOpenSplitModal}
                leftIcon={<Scissors className="h-4 w-4" />}
              >
                Split
              </Button>
            </div>
            {!parseAmount(formData.amountIn) && (
              <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                Reimbursement is available only for positive inflow transactions.
              </p>
            )}
            {linkageType === "reimbursement" && (
              <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                Linked reimbursements: {selectedReimbursedIds.length}. Click
                "Reimbursement" to edit selections.
              </p>
            )}
          </div>

          {/* Account Identifier */}
          <div>
            <label className="block text-sm font-medium text-dark dark:text-white mb-2">
              Account Identifier
            </label>
            <AccountIdentifierSelect
              value={formData.accountIdentifier || ""}
              accountIdentifiers={accountIdentifiers}
              onChange={(accountIdentifier) =>
                setFormData({
                  ...formData,
                  accountIdentifier: accountIdentifier || null,
                })
              }
              onAddClick={onAddAccountIdentifier}
            />
          </div>

          {/* Amount Type - Income or Expense */}
          <div className="grid grid-cols-2 gap-4">
            {/* Income */}
            <div>
              <label className="block text-sm font-medium text-dark dark:text-white mb-2">
                Income
              </label>
              <TextInput
                type="text"
                inputMode="decimal"
                value={formatAmount(formData.amountIn)}
                onChange={(e) => handleAmountChange("amountIn", e.target.value)}
                placeholder="0.00"
                disabled={formData.amountOut !== null}
              />
            </div>

            {/* Expense */}
            <div>
              <label className="block text-sm font-medium text-dark dark:text-white mb-2">
                Expense
              </label>
              <TextInput
                type="text"
                inputMode="decimal"
                value={formatAmount(formData.amountOut)}
                onChange={(e) =>
                  handleAmountChange("amountOut", e.target.value)
                }
                placeholder="0.00"
                disabled={formData.amountIn !== null}
              />
            </div>
          </div>

          {/* Balance */}
          <div>
            <label className="block text-sm font-medium text-dark dark:text-white mb-2">
              Balance
            </label>
            <TextInput
              type="text"
              inputMode="decimal"
              value={formatAmount(formData.balance)}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  balance: e.target.value ? parseFloat(e.target.value) : null,
                })
              }
              placeholder="0.00"
            />
          </div>

          {/* Source (Read-only) */}
          {source && (
            <div>
              <label className="block text-sm font-medium text-dark dark:text-white mb-2">
                Source
              </label>
              <div className="px-4 py-3 bg-gray-2 dark:bg-dark-3 rounded-lg text-sm text-dark dark:text-white">
                {source}
              </div>
            </div>
          )}

          {/* Additional Metadata (Read-only) */}
          {additionalMetadata.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-dark dark:text-white mb-2">
                Additional Details
              </label>
              <div className="px-4 py-3 bg-gray-2 dark:bg-dark-3 rounded-lg">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                  {additionalMetadata.map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <dt className="text-dark-5 dark:text-dark-6">
                        {key.replace(/([A-Z])/g, " $1").trim()}:
                      </dt>
                      <dd className="text-dark dark:text-white font-medium truncate">
                        {String(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white dark:bg-dark-2 border-t border-stroke dark:border-dark-3 px-6 py-4 flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={isSaving || !formData.description.trim()}
          >
            {isSaving ? (
              <>
                <span className="inline-block animate-spin mr-2">⏳</span>
                Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </div>
      </div>

      <ReimbursementSelectorModal
        isOpen={isReimbursementSelectorOpen}
        onClose={() => setIsReimbursementSelectorOpen(false)}
        onConfirm={handleConfirmReimbursement}
        currentIndex={0}
        transactions={[
          {
            date: formData.date,
            description: formData.description,
            label: formData.label,
            categoryId: formData.category?.id,
            amountIn: parseAmount(formData.amountIn) ?? undefined,
            amountOut: parseAmount(formData.amountOut) ?? undefined,
            balance: parseAmount(formData.balance) ?? undefined,
            accountIdentifier: formData.accountIdentifier || undefined,
            metadata: formData.metadata || {},
            linkage: null,
          },
        ]}
        includeCurrentImport={false}
        excludeTransactionId={transaction.id}
        currentLinkage={{
          type: "reimbursement",
          reimbursesAllocations:
            reimbursementLinkage?.reimbursesAllocations ||
            formData.linkage?.reimbursesAllocations ||
            [],
          leftoverAmount:
            reimbursementLinkage?.leftoverAmount ??
            formData.linkage?.leftoverAmount,
          leftoverCategoryId:
            reimbursementLinkage?.leftoverCategoryId ??
            formData.linkage?.leftoverCategoryId ??
            null,
        }}
        categories={categories}
        currentReimbursementId={transaction.id}
        initialSelectedDbTransactions={initialSelectedDbTransactions}
      />

      <SplitTransactionModal
        isOpen={isSplitModalOpen}
        transaction={formData}
        categories={categories}
        onClose={() => setIsSplitModalOpen(false)}
        onConfirm={handleConfirmSplit}
      />

      <Modal
        isOpen={showSplitWarning}
        onClose={() => setShowSplitWarning(false)}
        type="warning"
        title="Cannot Split Reimbursement"
        message="Reimbursement transactions cannot be split. To split this transaction, first remove the reimbursements, then redo the reimbursements on the split transactions."
      />
    </div>
  );
}
