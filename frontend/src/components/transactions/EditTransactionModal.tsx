"use client";

import { useMemo, useState, useEffect } from "react";
import { X, ArrowLeftRight, Receipt, Scissors } from "lucide-react";
import { TextInput } from "@/components/ui/TextInput";
import { DatePicker } from "@/components/ui/DatePicker";
import { Button } from "@/components/ui/Button";
import { CategorySelect } from "@/components/ui/CategorySelect";
import { AccountIdentifierSelect } from "@/components/ui/AccountIdentifierSelect";
import { ReimbursementLinkPicker } from "@/components/reimbursement/ReimbursementLinkPicker";
import { getLinkedTransactions, updateTransaction } from "@/app/actions/transactions";
import { Modal } from "@/components/ui/Modal";
import {
  SplitTransactionModal,
  type SplitTransactionChildInput,
} from "@/components/transactions/SplitTransactionModal";

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
  /** Links are saved straight away by the picker; the parent refreshes. */
  onLinksChanged?: (warnings: string[]) => void | Promise<void>;
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
  onLinksChanged,
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

  // Treat a stored 0 on the unused side as empty, so the other amount stays editable.
  const withAmounts = (t: Transaction) => ({
    ...t,
    amountIn: Number(t.amountIn) ? t.amountIn : null,
    amountOut: Number(t.amountOut) ? t.amountOut : null,
    date: formatDateForPicker(t.date),
  });
  const [formData, setFormData] = useState(withAmounts(transaction));
  const [linkageType, setLinkageType] = useState<
    "none" | "internal" | "reimbursement"
  >(
    transaction.linkage?.type === "internal"
      ? "internal"
      : transaction.linkage?.type === "reimbursement"
        ? "reimbursement"
        : "none",
  );
  const [pickerMode, setPickerMode] = useState<"expenses" | "reimbursements" | null>(null);
  const [linked, setLinked] = useState(transaction.linkedTransactions);
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);
  const [showSplitWarning, setShowSplitWarning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setFormData(withAmounts(transaction));
    setLinkageType(
      transaction.linkage?.type === "internal"
        ? "internal"
        : transaction.linkage?.type === "reimbursement"
          ? "reimbursement"
          : "none",
    );
    setPickerMode(null);
    setSavedType(transaction.linkage?.type ?? null);
    setMarkError("");
    setLinked(transaction.linkedTransactions);
    setIsSplitModalOpen(false);
    setShowSplitWarning(false);
  }, [transaction]);

  // The saved link type; choosing Reimbursement saves it straight away so the picker can open.
  const [savedType, setSavedType] = useState(transaction.linkage?.type ?? null);
  const [isMarking, setIsMarking] = useState(false);
  const [markError, setMarkError] = useState("");
  const reimbursedBy = linked?.reimbursedBy || [];
  const reimburses = linked?.reimburses || [];
  const reimbursedTotal = useMemo(
    () =>
      reimbursedBy.reduce(
        (sum, item) => sum + Number(item.reimbursementAmount || 0),
        0,
      ),
    [reimbursedBy],
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
      // Only a changed type is sent; links themselves are edited in the picker.
      const previousType =
        savedType === "internal" || savedType === "reimbursement" ? savedType : "none";
      let linkage: Transaction["linkage"] | undefined = undefined;
      if (linkageType !== previousType) {
        linkage =
          linkageType === "internal"
            ? { type: "internal", autoDetected: false }
            : linkageType === "reimbursement"
              ? { type: "reimbursement", leftoverCategoryId: null }
              : null;
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
      }
    }
  };

  const handleReimbursementClick = async () => {
    if (!parseAmount(formData.amountIn)) return;
    setLinkageType("reimbursement");
    if (savedType === "reimbursement") {
      setPickerMode("expenses");
      return;
    }
    // Only a saved money-in transaction can be linked; otherwise it is marked when saved.
    if (!parseAmount(transaction.amountIn)) return;
    setIsMarking(true);
    setMarkError("");
    try {
      await updateTransaction(transaction.id, {
        linkage: { type: "reimbursement", leftoverCategoryId: null },
      });
      setSavedType("reimbursement");
      setPickerMode("expenses");
      await onLinksChanged?.([]);
    } catch (error) {
      setMarkError(error instanceof Error ? error.message : "Could not mark this as a reimbursement");
    } finally {
      setIsMarking(false);
    }
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
                isLoading={isMarking}
                onClick={() => void handleReimbursementClick()}
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
            {linkageType === "reimbursement" && savedType === "reimbursement" && (
              <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                Pays back {reimburses.length}{" "}
                {reimburses.length === 1 ? "expense" : "expenses"}. Click
                &quot;Reimbursement&quot; to change them.
              </p>
            )}
            {linkageType === "reimbursement" && savedType !== "reimbursement" && (
              <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                Save the money-in amount first, then choose what it pays back.
              </p>
            )}
            {markError ? <p className="mt-1 text-xs text-red">{markError}</p> : null}
            {parseAmount(formData.amountOut) && linkageType === "none" ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stroke px-3 py-2 dark:border-dark-3">
                <p className="text-xs text-dark-5 dark:text-dark-6">
                  {reimbursedBy.length
                    ? `Reimbursed $${reimbursedTotal.toFixed(2)} by ${reimbursedBy.length} ${reimbursedBy.length === 1 ? "transaction" : "transactions"}`
                    : "Not reimbursed"}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  leftIcon={<Receipt className="h-4 w-4" />}
                  onClick={() => setPickerMode("reimbursements")}
                >
                  Reimbursed by…
                </Button>
              </div>
            ) : null}
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

      <ReimbursementLinkPicker
        isOpen={pickerMode !== null}
        subject={{ transactionId: transaction.id }}
        mode={pickerMode || "expenses"}
        subjectTitle={transaction.label || transaction.description}
        categories={pickerMode === "expenses" ? categories : undefined}
        initialLeftoverCategoryId={transaction.linkage?.leftoverCategoryId ?? null}
        onClose={() => setPickerMode(null)}
        onSaved={async ({ warnings }) => {
          setPickerMode(null);
          const fresh = await getLinkedTransactions(transaction.id).catch(() => null);
          if (fresh)
            setLinked({ reimburses: fresh.reimburses || [], reimbursedBy: fresh.reimbursedBy || [] });
          await onLinksChanged?.(warnings);
        }}
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
