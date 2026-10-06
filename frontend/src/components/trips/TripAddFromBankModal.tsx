"use client";

import type { Category } from "@/app/actions/categories";
import type {
  SourceTransactionCandidate,
  Trip,
  Wallet,
} from "@/app/actions/trips";
import type { TripParticipant } from "@/app/actions/tripSharing";
import { Button } from "@/components/ui/Button";
import { CategorySelect } from "@/components/ui/CategorySelect";
import { Checkbox } from "@/components/ui/Checkbox";
import { ExistingTransactionsSelector } from "@/components/ui/ExistingTransactionsSelector";
import { NumberInput } from "@/components/ui/NumberInput";
import { Select } from "@/components/ui/Select";
import {
  TripFundingOutDestinationFields,
  type FundingOutDestinationType,
} from "@/components/trips/TripFundingOutDestinationFields";
import { TripPeoplePicker } from "@/components/trips/TripPeoplePicker";

export type TripBankEntryType =
  | "spending"
  | "reimbursement"
  | "funding_out"
  | "settlement";

interface TripAddFromBankModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceSearch: string;
  onSourceSearchChange: (value: string) => void;
  onSearch: () => void;
  isLoading: boolean;
  sourceCandidates: SourceTransactionCandidate[];
  selectedSourceIds: Set<string>;
  onToggleSourceId: (id: string) => void;
  sourceCandidatesTotal: number;
  sourceCandidatesPage: number;
  sourceCandidatesPageSize: number;
  onSourceCandidatesPageChange: (nextPage: number) => void;
  sourceEntryType: TripBankEntryType;
  onSourceEntryTypeChange: (value: TripBankEntryType) => void;
  /** For settlements: the person the bank payment paid back. */
  sourceCounterpartyId?: string;
  onSourceCounterpartyIdChange?: (participantId: string) => void;
  participants?: TripParticipant[];
  onAddPerson?: (name: string) => Promise<TripParticipant>;
  sourceCategoryId: string;
  onSourceCategoryIdChange: (value: string) => void;
  sourceFundingOut: {
    destinationType: FundingOutDestinationType;
    destinationTripId: string;
    destinationWalletId: string;
    destinationCurrency: string;
    destinationAmount: string;
    fxRate: string;
    feeAmount: string;
    feeCurrency: string;
  };
  setSourceFundingOut: (
    updater: (
      prev: TripAddFromBankModalProps["sourceFundingOut"],
    ) => TripAddFromBankModalProps["sourceFundingOut"],
  ) => void;
  sourceFundingOutInputMode: "amount" | "fxRate";
  setSourceFundingOutInputMode: (mode: "amount" | "fxRate") => void;
  availableTrips: Pick<Trip, "id" | "name">[];
  wallets: Wallet[];
  currencyOptions: { value: string; label: string }[];
  baseCurrency: string;
  localCategories: Category[];
  onAddCategoryClick: () => void;
  isBusy: boolean;
  onConfirmAdd: () => void;
}

export function TripAddFromBankModal({
  isOpen,
  onClose,
  sourceSearch,
  onSourceSearchChange,
  onSearch,
  isLoading,
  sourceCandidates,
  selectedSourceIds,
  onToggleSourceId,
  sourceCandidatesTotal,
  sourceCandidatesPage,
  sourceCandidatesPageSize,
  onSourceCandidatesPageChange,
  sourceEntryType,
  onSourceEntryTypeChange,
  sourceCategoryId,
  onSourceCategoryIdChange,
  sourceCounterpartyId = "",
  onSourceCounterpartyIdChange,
  participants = [],
  onAddPerson,
  sourceFundingOut,
  setSourceFundingOut,
  sourceFundingOutInputMode,
  setSourceFundingOutInputMode,
  availableTrips,
  wallets,
  currencyOptions,
  baseCurrency,
  localCategories,
  onAddCategoryClick,
  isBusy,
  onConfirmAdd,
}: TripAddFromBankModalProps) {
  if (!isOpen) return null;

  const displayedSourceCandidates = sourceCandidates.filter((candidate) => {
    const amountIn = Number(candidate.amountIn || 0);
    const amountOut = Number(candidate.amountOut || 0);
    if (sourceEntryType === "spending" || sourceEntryType === "settlement") {
      return amountOut > 0;
    }
    return amountIn > 0;
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 p-4 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-4xl bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 shadow-card-2 max-h-[85vh] overflow-hidden flex flex-col"
      >
        <div className="px-6 py-4 border-b border-stroke dark:border-dark-3">
          <h3 className="text-lg font-semibold text-dark dark:text-white">
            Add from bank
          </h3>
          <p className="text-sm text-dark-5 dark:text-dark-6">
            Added transactions keep their original category in your main ledger,
            and use a trip-specific category only inside this trip.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-4">
          <div className="h-[420px] min-h-[320px] overflow-hidden">
            <ExistingTransactionsSelector
              className="h-full"
              title="Main Ledger Transactions"
              searchPlaceholder="Search transactions..."
              searchValue={sourceSearch}
              onSearchValueChange={onSourceSearchChange}
              onSearch={onSearch}
              isLoading={isLoading}
              transactions={displayedSourceCandidates.map((candidate) => ({
                id: candidate.id,
                date: candidate.date,
                description: candidate.description,
                label: candidate.label,
                amountIn: candidate.amountIn,
                amountOut: candidate.amountOut,
                category: candidate.category ?? null,
              }))}
              selectedIds={selectedSourceIds}
              onToggleSelect={onToggleSourceId}
              totalItems={displayedSourceCandidates.length}
              currentPage={sourceCandidatesPage}
              pageSize={sourceCandidatesPageSize}
              onPageChange={onSourceCandidatesPageChange}
              emptyMessage={
                sourceEntryType === "spending" || sourceEntryType === "settlement"
                  ? "No debit (amount out) bank transactions available."
                  : "No credit (amount in) bank transactions available."
              }
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                Trip entry type
              </label>
              <Select
                value={sourceEntryType}
                onChange={(value) =>
                  onSourceEntryTypeChange(value as TripBankEntryType)
                }
                className="w-full"
                buttonClassName="w-full"
                menuPlacement="up"
                options={[
                  { value: "spending", label: "Spending" },
                  { value: "reimbursement", label: "Reimbursement" },
                  { value: "funding_out", label: "Funding Out" },
                  ...(onSourceCounterpartyIdChange
                    ? [{ value: "settlement", label: "Settlement" }]
                    : []),
                ]}
              />
            </div>
            {sourceEntryType === "settlement" && onSourceCounterpartyIdChange ? (
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                  Paid to
                </label>
                <TripPeoplePicker
                  value={sourceCounterpartyId}
                  onChange={onSourceCounterpartyIdChange}
                  participants={participants}
                  onAddPerson={onAddPerson}
                  menuPlacement="up"
                />
                <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                  A payment paying someone back, like a PayNow to a friend. It
                  isn&apos;t counted as spending again.
                </p>
              </div>
            ) : (
            <div className={sourceEntryType === "spending" ? "" : "opacity-60"}>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                Trip category
              </label>
              <div className="h-11 rounded-lg border border-stroke bg-white dark:border-dark-3 dark:bg-dark-2">
                <CategorySelect
                  value={sourceCategoryId}
                  categories={localCategories}
                  onChange={onSourceCategoryIdChange}
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
          </div>

          {sourceEntryType === "funding_out" && (
            <div className="rounded-lg border border-stroke dark:border-dark-3 p-3 space-y-3">
              <TripFundingOutDestinationFields
                value={sourceFundingOut}
                onChange={(patch) =>
                  setSourceFundingOut((prev) => ({ ...prev, ...patch }))
                }
                wallets={wallets}
                availableTrips={availableTrips}
                currencyOptions={currencyOptions}
                baseCurrency={baseCurrency}
              />

              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 text-sm text-dark dark:text-white">
                  <Checkbox
                    checked={sourceFundingOutInputMode === "amount"}
                    onChange={() => setSourceFundingOutInputMode("amount")}
                  />
                  Use destination amount
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-dark dark:text-white">
                  <Checkbox
                    checked={sourceFundingOutInputMode === "fxRate"}
                    onChange={() => setSourceFundingOutInputMode("fxRate")}
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
                    value={sourceFundingOut.destinationAmount}
                    onChange={(e) =>
                      setSourceFundingOut((prev) => ({
                        ...prev,
                        destinationAmount: e.target.value,
                      }))
                    }
                    disabled={sourceFundingOutInputMode !== "amount"}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    FX rate
                  </label>
                  <NumberInput
                    value={sourceFundingOut.fxRate}
                    onChange={(e) =>
                      setSourceFundingOut((prev) => ({
                        ...prev,
                        fxRate: e.target.value,
                      }))
                    }
                    disabled={sourceFundingOutInputMode !== "fxRate"}
                    placeholder="1.00"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Fee amount
                  </label>
                  <NumberInput
                    value={sourceFundingOut.feeAmount}
                    onChange={(e) =>
                      setSourceFundingOut((prev) => ({
                        ...prev,
                        feeAmount: e.target.value,
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
                    value={sourceFundingOut.feeCurrency}
                    onChange={(value) =>
                      setSourceFundingOut((prev) => ({
                        ...prev,
                        feeCurrency: value,
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
        </div>

        <div className="px-6 py-4 border-t border-stroke dark:border-dark-3 flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirmAdd} disabled={isBusy}>
            {isBusy ? "Adding..." : "Add to trip"}
          </Button>
        </div>
      </div>
    </div>
  );
}
