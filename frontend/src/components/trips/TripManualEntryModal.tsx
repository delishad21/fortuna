"use client";

import type { Category } from "@/app/actions/categories";
import type { Trip, Wallet } from "@/app/actions/trips";
import { Button } from "@/components/ui/Button";
import { CategorySelect } from "@/components/ui/CategorySelect";
import { Checkbox } from "@/components/ui/Checkbox";
import { DatePicker } from "@/components/ui/DatePicker";
import { NumberInput } from "@/components/ui/NumberInput";
import { Select } from "@/components/ui/Select";
import { TextInput } from "@/components/ui/TextInput";
import {
  TripFundingOutDestinationFields,
  type FundingOutDestinationType,
} from "@/components/trips/TripFundingOutDestinationFields";

export interface TripEntryForm {
  walletId: string;
  type: "spending" | "reimbursement" | "funding_out";
  date: string;
  description: string;
  label: string;
  categoryId: string;
  localCurrency: string;
  localAmount: string;
  baseAmount: string;
  fxRate: string;
  fundingOutDestinationType: FundingOutDestinationType;
  fundingOutDestinationTripId: string;
  fundingOutDestinationWalletId: string;
  fundingOutDestinationCurrency: string;
  fundingOutDestinationAmount: string;
  fundingOutFxRate: string;
  fundingOutFeeAmount: string;
  fundingOutFeeCurrency: string;
  fundingOutInputMode: "amount" | "fxRate";
}

interface TripManualEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  isBusy: boolean;
  onSubmit: () => void;
  onAddCategoryClick: () => void;
  localCategories: Category[];
  wallets: Wallet[];
  currencyOptions: { value: string; label: string }[];
  baseCurrency: string;
  form: TripEntryForm;
  setForm: (updater: (prev: TripEntryForm) => TripEntryForm) => void;
  resetForm: () => void;
  availableTrips: Pick<Trip, "id" | "name">[];
  /** "edit" changes an existing entry; its type can't change. */
  mode?: "create" | "edit";
  /** The entry comes from a bank transaction, so its amount and currency are fixed. */
  lockAmounts?: boolean;
  onEditReimbursementLinks?: () => void;
}

export function TripManualEntryModal({
  isOpen,
  onClose,
  isBusy,
  onSubmit,
  onAddCategoryClick,
  localCategories,
  wallets,
  currencyOptions,
  baseCurrency,
  form,
  setForm,
  resetForm,
  availableTrips,
  mode = "create",
  lockAmounts = false,
  onEditReimbursementLinks,
}: TripManualEntryModalProps) {
  if (!isOpen) return null;

  const isEdit = mode === "edit";
  const localCurrencyLabel =
    form.type === "reimbursement"
      ? "Received currency"
      : form.type === "funding_out"
        ? "Outgoing currency"
        : "Spent currency";
  const localAmountLabel =
    form.type === "reimbursement"
      ? "Received amount"
      : form.type === "funding_out"
        ? "Outgoing amount"
        : "Spent amount";
  const selectedWallet = wallets.find((wallet) => wallet.id === form.walletId);
  const localCurrency = form.localCurrency.toUpperCase();
  const isBaseCurrency = localCurrency === baseCurrency.toUpperCase();
  const valuationHint = lockAmounts
    ? "Amounts come from the bank transaction. Change them there."
    : isBaseCurrency
      ? `Already in ${baseCurrency}.`
      : selectedWallet && selectedWallet.currency.toUpperCase() === localCurrency
        ? "Leave blank to use this wallet's average rate."
        : `Leave blank to use the average rate of a ${localCurrency} wallet, or enter the ${baseCurrency} amount or a rate.`;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 p-4 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-3xl bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 shadow-card-2 max-h-[85vh] overflow-hidden flex flex-col"
      >
        <div className="px-6 py-4 border-b border-stroke dark:border-dark-3">
          <h3 className="text-lg font-semibold text-dark dark:text-white">
            {isEdit ? "Edit entry" : "Add entry"}
          </h3>
          <p className="text-sm text-dark-5 dark:text-dark-6">
            {isEdit
              ? "Change this trip entry."
              : "Create a trip transaction directly, and choose whether it should deduct from a wallet."}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                Entry type
              </label>
              <Select
                value={form.type}
                onChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    type: value as "spending" | "reimbursement" | "funding_out",
                    categoryId: value === "reimbursement" ? "" : prev.categoryId,
                  }))
                }
                disabled={isEdit}
                className="w-full"
                buttonClassName="w-full"
                menuPlacement="down"
                options={[
                  { value: "spending", label: "Spending" },
                  { value: "reimbursement", label: "Reimbursement" },
                  { value: "funding_out", label: "Funding Out" },
                ]}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                Wallet
              </label>
              <Select
                value={form.walletId}
                onChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    walletId: value,
                  }))
                }
                disabled={lockAmounts}
                className="w-full"
                buttonClassName="w-full"
                menuPlacement="down"
                options={[
                  { value: "__none__", label: "No wallet" },
                  ...wallets.map((wallet) => ({
                    value: wallet.id,
                    label: `${wallet.name} (${wallet.currency})`,
                  })),
                ]}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                Date
              </label>
              <div className="h-11 rounded-lg border border-stroke bg-white dark:border-dark-3 dark:bg-dark-2">
                <DatePicker
                  value={form.date}
                  onChange={(value: string) =>
                    setForm((prev) => ({ ...prev, date: value }))
                  }
                  className="h-full"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                Label (optional)
              </label>
              <TextInput
                value={form.label}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    label: e.target.value,
                  }))
                }
                placeholder="Optional short label"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
              Description
            </label>
            <TextInput
              value={form.description}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  description: e.target.value,
                }))
              }
              placeholder="Transaction description"
            />
          </div>

          {form.type === "spending" && (
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                Trip category
              </label>
              <div className="h-11 rounded-lg border border-stroke bg-white dark:border-dark-3 dark:bg-dark-2">
                <CategorySelect
                  value={form.categoryId}
                  categories={localCategories}
                  onChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      categoryId: value,
                    }))
                  }
                  onAddClick={onAddCategoryClick}
                  emptyLabel="Select category"
                  triggerProps={{
                    className:
                      "h-full rounded-lg border-0 bg-transparent px-3 py-0 hover:bg-transparent dark:hover:bg-transparent",
                  }}
                />
              </div>
            </div>
          )}

          {isEdit && form.type === "reimbursement" && onEditReimbursementLinks && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-stroke dark:border-dark-3 p-3">
              <p className="text-sm text-dark-5 dark:text-dark-6">
                Choose which spending this pays back.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={onEditReimbursementLinks}
              >
                Edit reimbursement links
              </Button>
            </div>
          )}

          {form.type === "funding_out" && (
            <div className="rounded-lg border border-stroke dark:border-dark-3 p-3 space-y-3">
              <TripFundingOutDestinationFields
                value={{
                  destinationType: form.fundingOutDestinationType,
                  destinationTripId: form.fundingOutDestinationTripId,
                  destinationWalletId: form.fundingOutDestinationWalletId,
                  destinationCurrency: form.fundingOutDestinationCurrency,
                }}
                onChange={(patch) =>
                  setForm((prev) => ({
                    ...prev,
                    ...(patch.destinationType !== undefined
                      ? { fundingOutDestinationType: patch.destinationType }
                      : {}),
                    ...(patch.destinationTripId !== undefined
                      ? { fundingOutDestinationTripId: patch.destinationTripId }
                      : {}),
                    ...(patch.destinationWalletId !== undefined
                      ? {
                          fundingOutDestinationWalletId:
                            patch.destinationWalletId,
                        }
                      : {}),
                    ...(patch.destinationCurrency !== undefined
                      ? {
                          fundingOutDestinationCurrency:
                            patch.destinationCurrency,
                        }
                      : {}),
                  }))
                }
                wallets={wallets}
                sourceWalletId={
                  form.walletId === "__none__" ? null : form.walletId
                }
                availableTrips={availableTrips}
                currencyOptions={currencyOptions}
                baseCurrency={baseCurrency}
              />

              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 text-sm text-dark dark:text-white">
                  <Checkbox
                    checked={form.fundingOutInputMode === "amount"}
                    onChange={() =>
                      setForm((prev) => ({
                        ...prev,
                        fundingOutInputMode: "amount",
                      }))
                    }
                  />
                  Use destination amount
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-dark dark:text-white">
                  <Checkbox
                    checked={form.fundingOutInputMode === "fxRate"}
                    onChange={() =>
                      setForm((prev) => ({
                        ...prev,
                        fundingOutInputMode: "fxRate",
                      }))
                    }
                  />
                  Use FX rate
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Destination amount
                  </label>
                  <NumberInput
                    value={form.fundingOutDestinationAmount}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        fundingOutDestinationAmount: e.target.value,
                      }))
                    }
                    disabled={form.fundingOutInputMode !== "amount"}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    FX rate
                  </label>
                  <NumberInput
                    value={form.fundingOutFxRate}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        fundingOutFxRate: e.target.value,
                      }))
                    }
                    disabled={form.fundingOutInputMode !== "fxRate"}
                    placeholder="1.00"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Fee amount
                  </label>
                  <NumberInput
                    value={form.fundingOutFeeAmount}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        fundingOutFeeAmount: e.target.value,
                      }))
                    }
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Fee currency
                  </label>
                  <Select
                    value={form.fundingOutFeeCurrency}
                    onChange={(value) =>
                      setForm((prev) => ({
                        ...prev,
                        fundingOutFeeCurrency: value,
                      }))
                    }
                    options={currencyOptions}
                    className="w-full"
                    buttonClassName="w-full"
                    menuPlacement="up"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                {localCurrencyLabel}
              </label>
              <Select
                value={form.localCurrency}
                onChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    localCurrency: value,
                  }))
                }
                disabled={lockAmounts}
                options={currencyOptions}
                className="w-full"
                buttonClassName="w-full"
                menuPlacement="up"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                {localAmountLabel}
              </label>
              <NumberInput
                value={form.localAmount}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    localAmount: e.target.value,
                  }))
                }
                disabled={lockAmounts}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                {baseCurrency} amount (optional)
              </label>
              <NumberInput
                value={form.baseAmount}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    baseAmount: e.target.value,
                  }))
                }
                disabled={lockAmounts || isBaseCurrency}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                FX rate (optional)
              </label>
              <NumberInput
                value={form.fxRate}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    fxRate: e.target.value,
                  }))
                }
                disabled={lockAmounts || isBaseCurrency}
                placeholder={`${baseCurrency} per 1 ${localCurrency || "unit"}`}
              />
            </div>
          </div>
          <p className="text-xs text-dark-5 dark:text-dark-6">{valuationHint}</p>
          {!isEdit && (
            <p className="text-xs text-dark-5 dark:text-dark-6">
              Fees are recorded as separate transactions. Add a dedicated fee
              entry if needed.
            </p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-stroke dark:border-dark-3 flex items-center justify-end gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              onClose();
              resetForm();
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" onClick={onSubmit} disabled={isBusy}>
            {isEdit
              ? isBusy
                ? "Saving..."
                : "Save changes"
              : isBusy
                ? "Adding..."
                : "Add entry"}
          </Button>
        </div>
      </div>
    </div>
  );
}
