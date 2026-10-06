"use client";

import type { Wallet } from "@/app/actions/trips";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { NumberInput } from "@/components/ui/NumberInput";
import { Select } from "@/components/ui/Select";
import { TextInput } from "@/components/ui/TextInput";
import type { FundingInputMode } from "@/lib/fundingMath";

interface TripEditFundingModalProps {
  isOpen: boolean;
  onClose: () => void;
  isBusy: boolean;
  wallets: Wallet[];
  form: {
    walletId: string;
    sourceCurrency: string;
    sourceAmount: string;
    destinationCurrency: string;
    destinationAmount: string;
    fxRate: string;
    feeAmount: string;
    feeCurrency: string;
    baseAmount: string;
  };
  setForm: (
    updater: (
      prev: TripEditFundingModalProps["form"],
    ) => TripEditFundingModalProps["form"],
  ) => void;
  inputMode: FundingInputMode;
  setInputMode: (mode: FundingInputMode) => void;
  lockSourceFields?: boolean;
  lockDestinationCurrency?: boolean;
  feeCurrencyOptions?: string[];
  // Trip base currency; enables the base amount field when neither currency matches it.
  baseCurrency?: string;
  onSave: () => void;
}

export function TripEditFundingModal({
  isOpen,
  onClose,
  isBusy,
  wallets,
  form,
  setForm,
  inputMode,
  setInputMode,
  lockSourceFields = false,
  lockDestinationCurrency = false,
  feeCurrencyOptions = [],
  baseCurrency,
  onSave,
}: TripEditFundingModalProps) {
  if (!isOpen) return null;

  const base = baseCurrency?.trim().toUpperCase() || "";
  const sourceCurrency = form.sourceCurrency.trim().toUpperCase();
  const destinationCurrency = form.destinationCurrency.trim().toUpperCase();
  const showBaseAmount =
    !!base &&
    !!sourceCurrency &&
    !!destinationCurrency &&
    sourceCurrency !== base &&
    destinationCurrency !== base;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 p-4 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-2xl bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 shadow-card-2"
      >
        <div className="px-6 py-4 border-b border-stroke dark:border-dark-3">
          <h3 className="text-lg font-semibold text-dark dark:text-white">
            Edit Funding
          </h3>
        </div>
        <div className="p-6 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
              Destination wallet
            </label>
            <Select
              value={form.walletId}
              onChange={(value) =>
                setForm((prev) => ({
                  ...prev,
                  walletId: value,
                  destinationCurrency:
                    wallets.find((wallet) => wallet.id === value)?.currency ||
                    prev.destinationCurrency,
                }))
              }
              className="w-full"
              buttonClassName="w-full"
              options={[
                { value: "", label: "No wallet" },
                ...wallets.map((wallet) => ({
                  value: wallet.id,
                  label: `${wallet.name} (${wallet.currency})`,
                })),
              ]}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                Source currency
              </label>
              <TextInput
                value={form.sourceCurrency}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    sourceCurrency: e.target.value.toUpperCase(),
                  }))
                }
                placeholder="Source currency"
                disabled={lockSourceFields}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                Source amount
              </label>
              <NumberInput
                value={form.sourceAmount}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    sourceAmount: e.target.value,
                  }))
                }
                placeholder="Source amount"
                disabled={lockSourceFields}
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                Destination currency
              </label>
              <TextInput
                value={form.destinationCurrency}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    destinationCurrency: e.target.value.toUpperCase(),
                  }))
                }
                placeholder="Destination currency"
                disabled={lockDestinationCurrency}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                Destination amount
              </label>
              <NumberInput
                value={form.destinationAmount}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    destinationAmount: e.target.value,
                  }))
                }
                placeholder="Destination amount"
                disabled={inputMode === "fxRate"}
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-2 rounded-md border border-stroke px-3 py-2 dark:border-dark-3">
              <Checkbox
                checked={inputMode === "amount"}
                onChange={() => setInputMode("amount")}
              />
              <span className="text-xs text-dark dark:text-white">
                Edit destination amount
              </span>
            </label>
            <label className="flex items-center gap-2 rounded-md border border-stroke px-3 py-2 dark:border-dark-3">
              <Checkbox
                checked={inputMode === "fxRate"}
                onChange={() => setInputMode("fxRate")}
              />
              <span className="text-xs text-dark dark:text-white">
                Edit FX rate
              </span>
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                FX rate
              </label>
              <NumberInput
                value={form.fxRate}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    fxRate: e.target.value,
                  }))
                }
                placeholder="FX rate"
                disabled={inputMode !== "fxRate"}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                Fee amount
              </label>
              <NumberInput
                value={form.feeAmount}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    feeAmount: e.target.value,
                  }))
                }
                placeholder="Fee amount"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                Fee currency
              </label>
              <Select
                value={form.feeCurrency}
                onChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    feeCurrency: value.toUpperCase(),
                  }))
                }
                options={
                  feeCurrencyOptions.length > 0
                    ? feeCurrencyOptions.map((currency) => ({
                        value: currency,
                        label: currency,
                      }))
                    : [
                        {
                          value: form.sourceCurrency.toUpperCase(),
                          label: form.sourceCurrency.toUpperCase(),
                        },
                        {
                          value: form.destinationCurrency.toUpperCase(),
                          label: form.destinationCurrency.toUpperCase(),
                        },
                      ]
                }
                className="w-full"
                buttonClassName="w-full"
              />
            </div>
          </div>
          {showBaseAmount && (
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                Base amount ({base})
              </label>
              <NumberInput
                value={form.baseAmount}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    baseAmount: e.target.value,
                  }))
                }
                placeholder={`Amount in ${base}`}
              />
              <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                Needed when neither currency is {base}.
              </p>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-stroke dark:border-dark-3 flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSave} disabled={isBusy}>
            {isBusy ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
