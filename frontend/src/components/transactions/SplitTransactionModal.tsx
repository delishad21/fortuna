"use client";

import { useEffect, useMemo, useState } from "react";
import { Scissors, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { CategorySelect } from "@/components/ui/CategorySelect";

interface Category {
  id: string;
  name: string;
  color: string;
}

export interface SplitTransactionChildInput {
  description: string;
  label?: string;
  categoryId?: string | null;
  amountIn?: number | null;
  amountOut?: number | null;
}

interface SplitTransactionModalProps {
  isOpen: boolean;
  transaction: {
    description: string;
    label?: string | null;
    amountIn?: number | null;
    amountOut?: number | null;
    categoryId?: string | null;
    category?: { id: string } | null;
  };
  categories: Category[];
  onClose: () => void;
  onConfirm: (children: [SplitTransactionChildInput, SplitTransactionChildInput]) => void | Promise<void>;
}

type SplitDraft = {
  description: string;
  label: string;
  categoryId: string;
  amountIn: string;
  amountOut: string;
};

const toNumber = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatAmount = (value: number | string | null | undefined) => {
  const parsed = toNumber(value);
  return parsed > 0 ? parsed.toFixed(2) : "";
};

const parseOptionalAmount = (value: string) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : null;
};

const netAmount = (child: Pick<SplitDraft, "amountIn" | "amountOut">) =>
  Number((toNumber(child.amountIn) - toNumber(child.amountOut)).toFixed(2));

export function SplitTransactionModal({
  isOpen,
  transaction,
  categories,
  onClose,
  onConfirm,
}: SplitTransactionModalProps) {
  const originalNet = useMemo(
    () =>
      Number(
        (toNumber(transaction.amountIn) - toNumber(transaction.amountOut)).toFixed(2),
      ),
    [transaction.amountIn, transaction.amountOut],
  );
  const originalCategoryId = transaction.categoryId || transaction.category?.id || "";

  const buildInitialDrafts = (): [SplitDraft, SplitDraft] => [
    {
      description: transaction.description,
      label: transaction.label || "",
      categoryId: originalCategoryId,
      amountIn: formatAmount(transaction.amountIn ?? null),
      amountOut: formatAmount(transaction.amountOut ?? null),
    },
    {
      description: transaction.description,
      label: transaction.label || "",
      categoryId: originalCategoryId,
      amountIn: "",
      amountOut: "",
    },
  ];

  const [drafts, setDrafts] = useState<[SplitDraft, SplitDraft]>(buildInitialDrafts);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setDrafts(buildInitialDrafts());
      setIsSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, transaction.description, transaction.label, originalCategoryId, transaction.amountIn, transaction.amountOut]);

  if (!isOpen) return null;

  const splitNet = Number((netAmount(drafts[0]) + netAmount(drafts[1])).toFixed(2));
  const difference = Number((splitNet - originalNet).toFixed(2));
  const hasEmptyDescription = drafts.some((draft) => !draft.description.trim());
  const hasBothSides = drafts.some(
    (draft) => toNumber(draft.amountIn) > 0 && toNumber(draft.amountOut) > 0,
  );
  const hasZeroChild = drafts.some((draft) => netAmount(draft) === 0);
  const isValid =
    Math.abs(difference) <= 0.01 &&
    !hasEmptyDescription &&
    !hasBothSides &&
    !hasZeroChild;

  const updateDraft = (index: 0 | 1, patch: Partial<SplitDraft>) => {
    setDrafts((prev) => {
      const next: [SplitDraft, SplitDraft] = [{ ...prev[0] }, { ...prev[1] }];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const handleConfirm = async () => {
    if (!isValid) return;
    setIsSaving(true);
    try {
      await onConfirm(
        drafts.map((draft) => ({
          description: draft.description.trim(),
          label: draft.label.trim() || undefined,
          categoryId: draft.categoryId || null,
          amountIn: parseOptionalAmount(draft.amountIn),
          amountOut: parseOptionalAmount(draft.amountOut),
        })) as [SplitTransactionChildInput, SplitTransactionChildInput],
      );
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 dark:bg-black/70">
      <div className="w-full max-w-3xl rounded-lg border border-stroke bg-white shadow-card-2 dark:border-dark-3 dark:bg-dark-2">
        <div className="flex items-start justify-between border-b border-stroke px-6 py-4 dark:border-dark-3">
          <div className="flex items-center gap-3">
            <Scissors className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-lg font-semibold text-dark dark:text-white">
                Split Transaction
              </h2>
              <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                Create two transactions whose net total matches the original.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-dark-5 transition-colors hover:bg-gray-2 hover:text-dark dark:text-dark-6 dark:hover:bg-dark-3 dark:hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div className="rounded-lg border border-stroke bg-gray-1 px-4 py-3 text-sm dark:border-dark-3 dark:bg-dark-3/40">
            <div className="flex items-center justify-between gap-4">
              <span className="text-dark-5 dark:text-dark-6">Original net</span>
              <span className="font-semibold text-dark dark:text-white">
                {originalNet.toFixed(2)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-4">
              <span className="text-dark-5 dark:text-dark-6">Split net</span>
              <span
                className={`font-semibold ${
                  Math.abs(difference) <= 0.01
                    ? "text-green"
                    : "text-red dark:text-red-light"
                }`}
              >
                {splitNet.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {drafts.map((draft, index) => (
              <div
                key={index}
                className="rounded-lg border border-stroke p-4 dark:border-dark-3"
              >
                <h3 className="mb-4 text-sm font-semibold text-dark dark:text-white">
                  Transaction {index + 1}
                </h3>
                <div className="space-y-3">
                  <TextInput
                    value={draft.description}
                    onChange={(event) =>
                      updateDraft(index as 0 | 1, {
                        description: event.target.value,
                      })
                    }
                    placeholder="Description"
                  />
                  <TextInput
                    value={draft.label}
                    onChange={(event) =>
                      updateDraft(index as 0 | 1, { label: event.target.value })
                    }
                    placeholder="Label"
                  />
                  <CategorySelect
                    value={draft.categoryId}
                    categories={categories}
                    onChange={(categoryId) =>
                      updateDraft(index as 0 | 1, { categoryId })
                    }
                    onAddClick={() => {}}
                    emptyLabel="Uncategorized"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <TextInput
                      value={draft.amountIn}
                      onChange={(event) =>
                        updateDraft(index as 0 | 1, {
                          amountIn: event.target.value,
                          amountOut: event.target.value ? "" : draft.amountOut,
                        })
                      }
                      placeholder="Amount in"
                      type="number"
                      step="0.01"
                    />
                    <TextInput
                      value={draft.amountOut}
                      onChange={(event) =>
                        updateDraft(index as 0 | 1, {
                          amountOut: event.target.value,
                          amountIn: event.target.value ? "" : draft.amountIn,
                        })
                      }
                      placeholder="Amount out"
                      type="number"
                      step="0.01"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {!isValid && (
            <div className="rounded-lg border border-red/30 bg-red/10 px-4 py-3 text-sm text-red dark:text-red-light">
              {hasEmptyDescription
                ? "Each split transaction needs a description."
                : hasBothSides
                  ? "Each split transaction can only have either amount in or amount out."
                  : hasZeroChild
                    ? "Each split transaction needs a non-zero net amount."
                    : "The two split transactions must add up to the original net amount."}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-stroke px-6 py-4 dark:border-dark-3">
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!isValid || isSaving}>
            {isSaving ? "Splitting..." : "Split Transaction"}
          </Button>
        </div>
      </div>
    </div>
  );
}
