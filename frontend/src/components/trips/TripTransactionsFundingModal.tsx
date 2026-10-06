"use client";

import { format } from "date-fns";
import { Button } from "@/components/ui/Button";
import { CategorySelect } from "@/components/ui/CategorySelect";
import { Checkbox } from "@/components/ui/Checkbox";
import { ExistingTransactionsSelector } from "@/components/ui/ExistingTransactionsSelector";
import { NumberInput } from "@/components/ui/NumberInput";
import { Select } from "@/components/ui/Select";
import { TextInput } from "@/components/ui/TextInput";
import type { Category } from "@/app/actions/categories";
import type { FundingCandidate, TripFunding, Wallet } from "@/app/actions/trips";

interface TripTransactionsFundingModalProps {
  isOpen: boolean;
  onClose: () => void;
  fundingModalTab: "review" | "bank" | "fromTrip" | "manual";
  setFundingModalTab: (tab: "review" | "bank" | "fromTrip" | "manual") => void;
  setManualFunding: (value: boolean) => void;
  pendingAutoMatchedFundings: TripFunding[];
  selectedReviewFundingId: string;
  setSelectedReviewFundingId: (id: string) => void;
  selectedPendingFunding: TripFunding | null;
  suggestedReviewCandidate: FundingCandidate | null;
  formatCurrencyValue: (value: number) => string;
  isBusy: boolean;
  onReviewMatch: (action: "accept" | "reject" | "replace") => Promise<void>;
  mergeTargetFundingId: string;
  setMergeTargetFundingId: (id: string) => void;
  mergeTargetOptions: TripFunding[];
  onMergeImportedFunding: () => Promise<void>;
  reviewSearch: string;
  setReviewSearch: (value: string) => void;
  onSearchReviewCandidates: () => Promise<void>;
  isLoadingReviewCandidates: boolean;
  reviewCandidates: FundingCandidate[];
  selectedReviewReplacementIds: Set<string>;
  onToggleReviewReplacementId: (id: string) => void;
  reviewCandidatesTotal: number;
  reviewCandidatesPage: number;
  fundingCandidatesPageSize: number;
  onReviewCandidatesPageChange: (nextPage: number) => Promise<void>;
  selectedImportedFundingForAttach: boolean;
  selectedFundingFromList: TripFunding | null;
  fundingSearch: string;
  setFundingSearch: (value: string) => void;
  onSearchFundingCandidates: () => Promise<void>;
  isLoadingFundingCandidates: boolean;
  fundingCandidates: FundingCandidate[];
  selectedFundingIds: Set<string>;
  onToggleFundingId: (id: string) => void;
  fundingCandidatesTotal: number;
  fundingCandidatesPage: number;
  onFundingCandidatesPageChange: (nextPage: number) => Promise<void>;
  outgoingSourceTripId: string;
  setOutgoingSourceTripId: (value: string) => void;
  availableTrips: Array<{ id: string; name: string }>;
  outgoingSearch: string;
  setOutgoingSearch: (value: string) => void;
  onSearchOutgoingCandidates: () => Promise<void>;
  isLoadingOutgoingCandidates: boolean;
  outgoingCandidates: FundingCandidate[];
  selectedOutgoingIds: Set<string>;
  onToggleOutgoingId: (id: string) => void;
  outgoingCandidatesTotal: number;
  outgoingCandidatesPage: number;
  outgoingCandidatesPageSize: number;
  onOutgoingCandidatesPageChange: (nextPage: number) => Promise<void>;
  onImportFromOutgoingEntries: () => Promise<void>;
  fundingForm: {
    sourceCurrency: string;
    sourceAmount: string;
    destinationAmount: string;
    fxRate: string;
    feeMode: "none" | "amount" | "percent";
    feeValue: string;
    feeCurrency: string;
    // Value in the trip base currency; needed when neither currency is the base.
    baseAmount: string;
  };
  setFundingForm: (
    updater: (
      prev: TripTransactionsFundingModalProps["fundingForm"],
    ) => TripTransactionsFundingModalProps["fundingForm"],
  ) => void;
  selectedWalletId: string;
  setSelectedWalletId: (id: string) => void;
  wallets: Wallet[];
  selectedFundingWallet: Wallet | null;
  fundingInputMode: "amount" | "fxRate";
  setFundingInputMode: (mode: "amount" | "fxRate") => void;
  baseCurrency: string;
  onLinkFunding: () => Promise<void>;
  localCategories: Category[];
  sourceCategoryId: string;
  setSourceCategoryId: (value: string) => void;
  onAddCategoryClick: () => void;
}

export function TripTransactionsFundingModal({
  isOpen,
  onClose,
  fundingModalTab,
  setFundingModalTab,
  setManualFunding,
  pendingAutoMatchedFundings,
  selectedReviewFundingId,
  setSelectedReviewFundingId,
  selectedPendingFunding,
  suggestedReviewCandidate,
  formatCurrencyValue,
  isBusy,
  onReviewMatch,
  mergeTargetFundingId,
  setMergeTargetFundingId,
  mergeTargetOptions,
  onMergeImportedFunding,
  reviewSearch,
  setReviewSearch,
  onSearchReviewCandidates,
  isLoadingReviewCandidates,
  reviewCandidates,
  selectedReviewReplacementIds,
  onToggleReviewReplacementId,
  reviewCandidatesTotal,
  reviewCandidatesPage,
  fundingCandidatesPageSize,
  onReviewCandidatesPageChange,
  selectedImportedFundingForAttach,
  selectedFundingFromList,
  fundingSearch,
  setFundingSearch,
  onSearchFundingCandidates,
  isLoadingFundingCandidates,
  fundingCandidates,
  selectedFundingIds,
  onToggleFundingId,
  fundingCandidatesTotal,
  fundingCandidatesPage,
  onFundingCandidatesPageChange,
  outgoingSourceTripId,
  setOutgoingSourceTripId,
  availableTrips,
  outgoingSearch,
  setOutgoingSearch,
  onSearchOutgoingCandidates,
  isLoadingOutgoingCandidates,
  outgoingCandidates,
  selectedOutgoingIds,
  onToggleOutgoingId,
  outgoingCandidatesTotal,
  outgoingCandidatesPage,
  outgoingCandidatesPageSize,
  onOutgoingCandidatesPageChange,
  onImportFromOutgoingEntries,
  fundingForm,
  setFundingForm,
  selectedWalletId,
  setSelectedWalletId,
  wallets,
  selectedFundingWallet,
  fundingInputMode,
  setFundingInputMode,
  baseCurrency,
  onLinkFunding,
}: TripTransactionsFundingModalProps) {
  if (!isOpen) return null;

  const base = baseCurrency.trim().toUpperCase();
  const fundingSourceCurrency = (fundingForm.sourceCurrency || baseCurrency)
    .trim()
    .toUpperCase();
  const fundingDestinationCurrency = (selectedFundingWallet?.currency || "")
    .trim()
    .toUpperCase();
  const showBaseAmount =
    (fundingModalTab === "bank" || fundingModalTab === "manual") &&
    !!fundingDestinationCurrency &&
    fundingSourceCurrency !== base &&
    fundingDestinationCurrency !== base;

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
            Link Funding Sources
          </h3>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <Button
              variant={fundingModalTab === "review" ? "primary" : "secondary"}
              size="sm"
              onClick={() => {
                setFundingModalTab("review");
                setManualFunding(false);
              }}
              disabled={pendingAutoMatchedFundings.length === 0}
            >
              Review Matches
            </Button>
            <Button
              variant={fundingModalTab === "fromTrip" ? "primary" : "secondary"}
              size="sm"
              onClick={() => {
                setFundingModalTab("fromTrip");
                setManualFunding(false);
              }}
            >
              From Other Trips
            </Button>
            <Button
              variant={fundingModalTab === "bank" ? "primary" : "secondary"}
              size="sm"
              onClick={() => {
                setFundingModalTab("bank");
                setManualFunding(false);
              }}
            >
              Link From Bank
            </Button>
            <Button
              variant={fundingModalTab === "manual" ? "primary" : "secondary"}
              size="sm"
              onClick={() => {
                setFundingModalTab("manual");
                setManualFunding(true);
              }}
            >
              Manual Funding
            </Button>
          </div>

          {fundingModalTab === "review" && (
            <div className="rounded-lg border border-stroke dark:border-dark-3 p-4 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-dark dark:text-white">
                  Review Auto-Matched Funding ({pendingAutoMatchedFundings.length})
                </h4>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                  Imported funding row
                </label>
                <Select
                  value={selectedReviewFundingId}
                  onChange={setSelectedReviewFundingId}
                  className="w-full"
                  buttonClassName="w-full"
                  options={pendingAutoMatchedFundings.map((item) => ({
                    value: item.id,
                    label: `${item.destinationAmount} ${item.destinationCurrency} • ${
                      item.metadata && typeof item.metadata === "object"
                        ? String(
                            (item.metadata as Record<string, unknown>)
                              .originalDescription ||
                              item.metadata.autoMatchedReason ||
                              item.sourceType,
                          )
                        : item.sourceType
                    }`,
                  }))}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-stroke dark:border-dark-3 p-3 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Left: Selected imported funding
                  </p>
                  <p className="text-sm font-medium text-dark dark:text-white">
                    {selectedPendingFunding
                      ? `${formatCurrencyValue(selectedPendingFunding.destinationAmount)} ${selectedPendingFunding.destinationCurrency}`
                      : "No funding selected"}
                  </p>
                  <p className="text-xs text-dark-5 dark:text-dark-6 break-words">
                    {selectedPendingFunding?.metadata?.originalDescription ||
                      selectedPendingFunding?.sourceType ||
                      "-"}
                  </p>
                </div>
                <div className="rounded-lg border border-primary/40 dark:border-primary p-3 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Right: Suggested bank transaction
                  </p>
                  <p className="text-sm font-medium text-dark dark:text-white">
                    {suggestedReviewCandidate
                      ? `${format(new Date(suggestedReviewCandidate.date), "dd MMM yyyy")} • ${formatCurrencyValue(
                          Number(
                            suggestedReviewCandidate.amountOut ??
                              suggestedReviewCandidate.amountIn ??
                              0,
                          ),
                        )}`
                      : "No suggestion found"}
                  </p>
                  <p className="text-xs text-dark-5 dark:text-dark-6 break-words">
                    {suggestedReviewCandidate?.description || "-"}
                  </p>
                </div>
              </div>

              <div className="flex items-end justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => void onReviewMatch("reject")}
                  disabled={isBusy || !selectedReviewFundingId}
                >
                  Reject
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void onReviewMatch("accept")}
                  disabled={isBusy || !selectedReviewFundingId}
                >
                  Accept Suggestion
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Merge into existing funding
                  </label>
                  <Select
                    value={mergeTargetFundingId}
                    onChange={setMergeTargetFundingId}
                    className="w-full"
                    buttonClassName="w-full"
                    options={[
                      { value: "", label: "Select existing funding" },
                      ...mergeTargetOptions.map((item) => ({
                        value: item.id,
                        label: `${item.destinationAmount} ${item.destinationCurrency} • ${
                          item.bankTransaction?.description ||
                          String(
                            (item.metadata as Record<string, unknown> | null)
                              ?.originalDescription || item.sourceType,
                          )
                        }`,
                      })),
                    ]}
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    variant="secondary"
                    onClick={() => void onMergeImportedFunding()}
                    disabled={isBusy || !selectedReviewFundingId || !mergeTargetFundingId}
                  >
                    Merge
                  </Button>
                </div>
              </div>

              <div className="h-[320px] min-h-[240px] overflow-hidden">
                <ExistingTransactionsSelector
                  className="h-full"
                  title="Replace With Another Bank Transaction"
                  searchPlaceholder="Search bank transactions..."
                  searchValue={reviewSearch}
                  onSearchValueChange={setReviewSearch}
                  onSearch={() => void onSearchReviewCandidates()}
                  isLoading={isLoadingReviewCandidates}
                  transactions={reviewCandidates.map((candidate) => ({
                    id: candidate.id,
                    date: candidate.date,
                    description: candidate.description,
                    label: candidate.label,
                    amountIn: candidate.amountIn,
                    amountOut: candidate.amountOut,
                    category: candidate.category ?? null,
                  }))}
                  selectedIds={selectedReviewReplacementIds}
                  onToggleSelect={onToggleReviewReplacementId}
                  totalItems={reviewCandidatesTotal}
                  currentPage={reviewCandidatesPage}
                  pageSize={fundingCandidatesPageSize}
                  onPageChange={(nextPage) =>
                    void onReviewCandidatesPageChange(nextPage)
                  }
                  emptyMessage="No replacement candidates found."
                />
              </div>

              <div className="flex items-center justify-end">
                <Button
                  variant="secondary"
                  onClick={() => void onReviewMatch("replace")}
                  disabled={
                    isBusy ||
                    !selectedReviewFundingId ||
                    selectedReviewReplacementIds.size === 0
                  }
                >
                  Replace Match
                </Button>
              </div>
            </div>
          )}

          {fundingModalTab === "fromTrip" && (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-[minmax(220px,320px)_1fr]">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Source trip
                  </label>
                  <Select
                    value={outgoingSourceTripId}
                    onChange={setOutgoingSourceTripId}
                    className="w-full"
                    buttonClassName="w-full"
                    menuPlacement="up"
                    options={[
                      { value: "", label: "All trips" },
                      ...availableTrips.map((item) => ({
                        value: item.id,
                        label: item.name,
                      })),
                    ]}
                  />
                </div>
                <div className="rounded-lg border border-stroke dark:border-dark-3 px-3 py-2 text-xs text-dark-5 dark:text-dark-6">
                  Select outgoing funding entries from other trips and import
                  them as funding sources into this trip.
                </div>
              </div>
              <div className="h-[420px] min-h-[320px] overflow-hidden">
                <ExistingTransactionsSelector
                  className="h-full"
                  title="Outgoing Funding Entries"
                  searchPlaceholder="Search outgoing entries..."
                  searchValue={outgoingSearch}
                  onSearchValueChange={setOutgoingSearch}
                  onSearch={() => void onSearchOutgoingCandidates()}
                  isLoading={isLoadingOutgoingCandidates}
                  transactions={outgoingCandidates.map((candidate) => ({
                    id: candidate.id,
                    date: candidate.date,
                    description: candidate.description,
                    label: candidate.label,
                    amountIn: candidate.amountIn,
                    amountOut: candidate.amountOut,
                    category: candidate.category ?? null,
                  }))}
                  selectedIds={selectedOutgoingIds}
                  onToggleSelect={onToggleOutgoingId}
                  totalItems={outgoingCandidatesTotal}
                  currentPage={outgoingCandidatesPage}
                  pageSize={outgoingCandidatesPageSize}
                  onPageChange={(nextPage) =>
                    void onOutgoingCandidatesPageChange(nextPage)
                  }
                  emptyMessage="No outgoing entries found."
                />
              </div>
            </div>
          )}

          {fundingModalTab === "bank" && (
            <div className="h-[420px] min-h-[320px] overflow-hidden">
              <div className="mb-2 rounded-lg border border-stroke dark:border-dark-3 px-3 py-2 text-xs text-dark-5 dark:text-dark-6">
                {selectedImportedFundingForAttach && selectedFundingFromList
                  ? "Mode: Link selected imported funding to exactly one bank transaction."
                  : "Mode: Create funding row(s) from selected bank transaction(s)."}
              </div>
              <ExistingTransactionsSelector
                className="h-full"
                title="Bank Ledger Transactions"
                searchPlaceholder="Search bank transactions..."
                searchValue={fundingSearch}
                onSearchValueChange={setFundingSearch}
                onSearch={() => void onSearchFundingCandidates()}
                isLoading={isLoadingFundingCandidates}
                transactions={fundingCandidates.map((candidate) => ({
                  id: candidate.id,
                  date: candidate.date,
                  description: candidate.description,
                  label: candidate.label,
                  amountIn: candidate.amountIn,
                  amountOut: candidate.amountOut,
                  category: candidate.category ?? null,
                }))}
                selectedIds={selectedFundingIds}
                onToggleSelect={onToggleFundingId}
                totalItems={fundingCandidatesTotal}
                currentPage={fundingCandidatesPage}
                pageSize={fundingCandidatesPageSize}
                onPageChange={(nextPage) => void onFundingCandidatesPageChange(nextPage)}
                emptyMessage="No funding candidates found."
              />
            </div>
          )}

          {fundingModalTab === "manual" && (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                  Source currency
                </label>
                <TextInput
                  value={fundingForm.sourceCurrency}
                  onChange={(e) =>
                    setFundingForm((prev) => ({
                      ...prev,
                      sourceCurrency: e.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="SGD"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                  Source amount
                </label>
                <NumberInput
                  value={fundingForm.sourceAmount}
                  onChange={(e) =>
                    setFundingForm((prev) => ({
                      ...prev,
                      sourceAmount: e.target.value,
                    }))
                  }
                  placeholder="1000"
                />
              </div>
            </div>
          )}

          {fundingModalTab !== "review" && (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Destination wallet
                  </label>
                  <Select
                    value={selectedWalletId}
                    onChange={setSelectedWalletId}
                    placeholder="Select wallet"
                    className="w-full"
                    buttonClassName="w-full"
                    menuPlacement="up"
                    options={[
                      { value: "", label: "Select wallet" },
                      ...wallets.map((wallet) => ({
                        value: wallet.id,
                        label: `${wallet.name} (${wallet.currency})`,
                      })),
                    ]}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Destination currency
                  </label>
                  <TextInput
                    value={selectedFundingWallet?.currency || ""}
                    disabled
                    placeholder="Select wallet first"
                  />
                </div>
              </div>

              {showBaseAmount && (
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Base amount ({base})
                  </label>
                  <NumberInput
                    value={fundingForm.baseAmount}
                    onChange={(e) =>
                      setFundingForm((prev) => ({
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

              <div className="grid gap-3 md:grid-cols-3">
                <div className="md:col-span-3">
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Conversion input mode
                  </label>
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="inline-flex items-center gap-2 text-sm text-dark dark:text-white">
                      <Checkbox
                        checked={fundingInputMode === "amount"}
                        onChange={() => setFundingInputMode("amount")}
                      />
                      Enter destination amount
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-dark dark:text-white">
                      <Checkbox
                        checked={fundingInputMode === "fxRate"}
                        onChange={() => setFundingInputMode("fxRate")}
                      />
                      Enter FX rate
                    </label>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Destination amount
                  </label>
                  <NumberInput
                    value={fundingForm.destinationAmount}
                    onChange={(e) =>
                      setFundingForm((prev) => ({
                        ...prev,
                        destinationAmount: e.target.value,
                      }))
                    }
                    placeholder={
                      fundingInputMode === "amount"
                        ? "Optional (defaults to source)"
                        : "Calculated from FX rate"
                    }
                    disabled={fundingInputMode !== "amount"}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    FX rate
                  </label>
                  <NumberInput
                    value={fundingForm.fxRate}
                    onChange={(e) =>
                      setFundingForm((prev) => ({
                        ...prev,
                        fxRate: e.target.value,
                      }))
                    }
                    placeholder={
                      fundingInputMode === "fxRate"
                        ? "Required in FX mode"
                        : "Auto from amounts"
                    }
                    disabled={fundingInputMode !== "fxRate"}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Fee type
                  </label>
                  <Select
                    value={fundingForm.feeMode}
                    onChange={(value) =>
                      setFundingForm((prev) => ({
                        ...prev,
                        feeMode: value as "none" | "amount" | "percent",
                      }))
                    }
                    className="w-full"
                    buttonClassName="w-full"
                    menuPlacement="up"
                    options={[
                      { value: "none", label: "No fee" },
                      { value: "amount", label: "Absolute amount" },
                      { value: "percent", label: "Percentage" },
                    ]}
                  />
                </div>
              </div>

              {fundingForm.feeMode !== "none" && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                      Fee value
                    </label>
                    <NumberInput
                      value={fundingForm.feeValue}
                      onChange={(e) =>
                        setFundingForm((prev) => ({
                          ...prev,
                          feeValue: e.target.value,
                        }))
                      }
                      placeholder={
                        fundingForm.feeMode === "percent" ? "e.g. 1.5" : "e.g. 2.50"
                      }
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                      Fee currency
                    </label>
                    <TextInput
                      value={fundingForm.feeCurrency}
                      onChange={(e) =>
                        setFundingForm((prev) => ({
                          ...prev,
                          feeCurrency: e.target.value.toUpperCase(),
                        }))
                      }
                      placeholder={baseCurrency}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        {fundingModalTab === "review" ? (
          <div className="px-6 py-4 border-t border-stroke dark:border-dark-3 flex items-center justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <div className="px-6 py-4 border-t border-stroke dark:border-dark-3 flex items-center justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            {fundingModalTab === "fromTrip" ? (
              <Button
                variant="primary"
                onClick={() => void onImportFromOutgoingEntries()}
                disabled={isBusy}
              >
                {isBusy ? "Importing..." : "Import Selected"}
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => void onLinkFunding()}
                disabled={isBusy}
              >
                {isBusy
                  ? "Linking..."
                  : selectedImportedFundingForAttach
                    ? "Link To Selected Funding"
                    : "Link Funding"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
