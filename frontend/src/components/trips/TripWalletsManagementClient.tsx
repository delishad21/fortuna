"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  createTripFunding,
  getTripEntries,
  getSourceTransactionCandidates,
  getTripFundings,
  getTripWalletSummaries,
  recalculateWalletEntriesToBase,
  updateTripFunding,
  type FundingCandidate,
  type SourceTransactionCandidatesResponse,
  type Trip,
  type TripEntry,
  type TripFunding,
  type TripPropagationTrace,
  type Wallet,
  type WalletSummary,
} from "@/app/actions/trips";
import { useHeaderConfig } from "@/components/Layouts/header-context";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { ExistingTransactionsSelector } from "@/components/ui/ExistingTransactionsSelector";
import { Modal } from "@/components/ui/Modal";
import { NumberInput } from "@/components/ui/NumberInput";
import { Select } from "@/components/ui/Select";
import { TextInput } from "@/components/ui/TextInput";
import { TripEditFundingModal } from "@/components/trips/TripEditFundingModal";
import { getCurrencyOptions } from "@/lib/currencies";
import { normalizeFundingEditInput } from "@/lib/fundingMath";
import { Wallet as WalletIcon } from "lucide-react";
import { TripPropagationTraceCard } from "@/components/trips/TripPropagationTraceCard";

interface TripWalletsManagementClientProps {
  trip: Trip;
  wallets: Wallet[];
  walletSummaries: WalletSummary[];
  fundings: TripFunding[];
  initialSourceCandidates: SourceTransactionCandidatesResponse;
}

const formatCurrencyValue = (value: number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

export function TripWalletsManagementClient({
  trip,
  wallets: initialWallets,
  walletSummaries: initialWalletSummaries,
  fundings: initialFundings,
  initialSourceCandidates,
}: TripWalletsManagementClientProps) {
  const { setHeaderConfig } = useHeaderConfig();

  const [wallets] = useState(initialWallets);
  const [walletSummaries, setWalletSummaries] = useState(initialWalletSummaries);
  const [fundings, setFundings] = useState(initialFundings);
  const [walletOutflows, setWalletOutflows] = useState<TripEntry[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState(
    initialWallets[0]?.id || "",
  );
  const [isBusy, setIsBusy] = useState(false);
  const [propagationTrace, setPropagationTrace] = useState<
    TripPropagationTrace | TripPropagationTrace[] | null
  >(null);
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    type: "success" | "error" | "warning" | "info";
    title: string;
    message: string;
  }>({
    isOpen: false,
    type: "info",
    title: "",
    message: "",
  });

  const [isAddFromBankOpen, setIsAddFromBankOpen] = useState(false);
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourceCandidates, setSourceCandidates] = useState<FundingCandidate[]>(
    initialSourceCandidates.transactions || [],
  );
  const [sourceCandidatesTotal, setSourceCandidatesTotal] = useState(
    initialSourceCandidates.total || 0,
  );
  const [sourceCandidatesPage, setSourceCandidatesPage] = useState(1);
  const sourceCandidatesPageSize = 20;
  const [isLoadingSourceCandidates, setIsLoadingSourceCandidates] =
    useState(false);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(
    new Set(),
  );
  const [fundingMode, setFundingMode] = useState<"amount" | "fxRate">("amount");
  const [topupForm, setTopupForm] = useState({
    sourceAmount: "",
    destinationAmount: "",
    fxRate: "",
    feeAmount: "",
    feeCurrency: trip.baseCurrency,
  });

  const [recalcMode, setRecalcMode] = useState<"weighted" | "manual">(
    "weighted",
  );
  const [manualFxRate, setManualFxRate] = useState("");

  const [isEditFundingModalOpen, setIsEditFundingModalOpen] = useState(false);
  const [editingFundingId, setEditingFundingId] = useState("");
  const [editingFundingForm, setEditingFundingForm] = useState({
    walletId: "",
    sourceCurrency: "",
    sourceAmount: "",
    destinationCurrency: "",
    destinationAmount: "",
    fxRate: "",
    feeAmount: "",
    feeCurrency: "",
  });
  const [editingFundingInputMode, setEditingFundingInputMode] = useState<
    "amount" | "fxRate"
  >("amount");

  useEffect(() => {
    setHeaderConfig({
      title: `${trip.name} · Wallets`,
      showBack: true,
      backHref: `/trips/${trip.id}/manage`,
    });
    return () => setHeaderConfig(null);
  }, [setHeaderConfig, trip.id, trip.name]);

  const currencyOptions = useMemo(() => getCurrencyOptions(), []);

  const selectedWallet = useMemo(
    () => wallets.find((wallet) => wallet.id === selectedWalletId) || null,
    [wallets, selectedWalletId],
  );
  const editingFundingItem = useMemo(
    () => fundings.find((item) => item.id === editingFundingId) || null,
    [fundings, editingFundingId],
  );

  const selectedWalletSummary = useMemo(
    () =>
      walletSummaries.find((wallet) => wallet.id === selectedWalletId) || null,
    [walletSummaries, selectedWalletId],
  );

  const walletFundings = useMemo(
    () =>
      fundings.filter((funding) => funding.walletId === selectedWalletId),
    [fundings, selectedWalletId],
  );

  const weightedFxPreview = useMemo(() => {
    if (!selectedWallet) return null;
    const base = trip.baseCurrency.toUpperCase();
    const walletCurrency = selectedWallet.currency.toUpperCase();

    let totalBase = 0;
    let totalLocal = 0;
    for (const funding of walletFundings) {
      const destinationAmount = Number(funding.destinationAmount || 0);
      if (!(destinationAmount > 0)) continue;
      if (String(funding.destinationCurrency || "").toUpperCase() !== walletCurrency) {
        continue;
      }
      const sourceCurrency = String(funding.sourceCurrency || "").toUpperCase();
      const destinationCurrency = String(funding.destinationCurrency || "").toUpperCase();
      if (sourceCurrency === base) {
        totalBase += Number(funding.sourceAmount || 0);
        totalLocal += destinationAmount;
      } else if (destinationCurrency === base) {
        totalBase += destinationAmount;
        totalLocal += destinationAmount;
      }
    }
    if (!(totalBase > 0) || !(totalLocal > 0)) return null;
    return totalBase / totalLocal;
  }, [walletFundings, selectedWallet, trip.baseCurrency]);

  const showModal = (
    type: "success" | "error" | "warning" | "info",
    title: string,
    message: string,
  ) =>
    setModalState({
      isOpen: true,
      type,
      title,
      message,
    });

  const closeModal = () =>
    setModalState((prev) => ({
      ...prev,
      isOpen: false,
    }));

  const refreshWalletData = async (walletId: string) => {
    const [nextSummaries, nextFundings, nextWalletEntries] = await Promise.all([
      getTripWalletSummaries(trip.id),
      getTripFundings(trip.id),
      walletId
        ? getTripEntries(trip.id, {
            walletId,
            limit: 200,
            offset: 0,
          })
        : Promise.resolve({ items: [], total: 0 }),
    ]);
    setWalletSummaries(nextSummaries);
    setFundings(nextFundings);
    setWalletOutflows(
      (nextWalletEntries.items || []).filter(
        (entry) => entry.type === "funding_out",
      ),
    );
  };

  useEffect(() => {
    if (!selectedWalletId) {
      setWalletOutflows([]);
      return;
    }
    void refreshWalletData(selectedWalletId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWalletId, trip.id]);

  const searchSourceCandidates = async (page = sourceCandidatesPage) => {
    setIsLoadingSourceCandidates(true);
    try {
      const result = await getSourceTransactionCandidates(trip.id, {
        search: sourceSearch || undefined,
        limit: sourceCandidatesPageSize,
        offset: (page - 1) * sourceCandidatesPageSize,
      });
      const filtered = (result.transactions || []).filter(
        (row) => Number(row.amountOut || 0) > 0,
      );
      setSourceCandidates(filtered);
      setSourceCandidatesTotal(result.total || 0);
      setSourceCandidatesPage(page);
    } catch (error) {
      showModal(
        "error",
        "Search Failed",
        error instanceof Error ? error.message : "Failed to fetch bank transactions.",
      );
    } finally {
      setIsLoadingSourceCandidates(false);
    }
  };

  const selectedSource = useMemo(() => {
    const selectedId = Array.from(selectedSourceIds)[0];
    return sourceCandidates.find((item) => item.id === selectedId) || null;
  }, [selectedSourceIds, sourceCandidates]);

  useEffect(() => {
    if (!isAddFromBankOpen) return;
    void searchSourceCandidates(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAddFromBankOpen]);

  useEffect(() => {
    if (!selectedSource) return;
    const sourceAmount = Number(selectedSource.amountOut || 0);
    if (!(sourceAmount > 0)) return;
    setTopupForm((prev) => ({
      ...prev,
      sourceAmount: String(sourceAmount),
      destinationAmount:
        fundingMode === "amount" && !prev.destinationAmount
          ? String(sourceAmount)
          : prev.destinationAmount,
    }));
  }, [selectedSource, fundingMode]);

  const handleAddFundingFromBank = async () => {
    if (!selectedWallet) return;
    if (!selectedSource) {
      showModal("warning", "Select Transaction", "Please select one bank transaction.");
      return;
    }
    const sourceAmount = Number(topupForm.sourceAmount || 0);
    if (!(sourceAmount > 0)) {
      showModal("warning", "Invalid Source Amount", "Source amount must be > 0.");
      return;
    }
    let destinationAmount = Number(topupForm.destinationAmount || 0);
    let fxRate = Number(topupForm.fxRate || 0);
    if (fundingMode === "amount") {
      if (!(destinationAmount > 0)) {
        showModal(
          "warning",
          "Invalid Destination Amount",
          "Destination amount must be > 0 in amount mode.",
        );
        return;
      }
      fxRate =
        String(trip.baseCurrency).toUpperCase() ===
        String(selectedWallet.currency).toUpperCase()
          ? 1
          : sourceAmount / destinationAmount;
    } else {
      if (!(fxRate > 0)) {
        showModal("warning", "Invalid FX Rate", "FX rate must be > 0 in FX mode.");
        return;
      }
      destinationAmount = sourceAmount / fxRate;
    }
    const feeAmount = topupForm.feeAmount ? Number(topupForm.feeAmount) : null;
    if (feeAmount !== null && !(feeAmount >= 0)) {
      showModal("warning", "Invalid Fee", "Fee must be zero or positive.");
      return;
    }

    setIsBusy(true);
    try {
      const fundingResult = await createTripFunding(trip.id, {
        walletId: selectedWallet.id,
        bankTransactionId: selectedSource.id,
        sourceType: "bank_wallet_topup",
        sourceCurrency: trip.baseCurrency,
        sourceAmount,
        destinationCurrency: selectedWallet.currency,
        destinationAmount,
        fxRate,
        feeAmount,
        feeCurrency: feeAmount ? topupForm.feeCurrency || trip.baseCurrency : null,
        metadata: {
          linkedFrom: "wallet_page",
        },
      });

      const recalcResult = await recalculateWalletEntriesToBase(
        trip.id,
        selectedWallet.id,
        {
          mode: "weighted",
        },
      );
      setPropagationTrace(
        recalcResult.propagationTrace || fundingResult.propagationTrace || null,
      );
      await refreshWalletData(selectedWallet.id);
      setIsAddFromBankOpen(false);
      setSelectedSourceIds(new Set());
      showModal(
        "success",
        "Funding Added",
        "Wallet funding added and wallet entries recalculated with weighted FX.",
      );
    } catch (error) {
      showModal(
        "error",
        "Add Funding Failed",
        error instanceof Error ? error.message : "Failed to add wallet funding.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleRecalculateWallet = async () => {
    if (!selectedWallet) return;
    setIsBusy(true);
    try {
      const result = await recalculateWalletEntriesToBase(
        trip.id,
        selectedWallet.id,
        {
          mode: recalcMode,
          fxRate: recalcMode === "manual" ? Number(manualFxRate || 0) : null,
        },
      );
      setPropagationTrace(result.propagationTrace || null);
      await refreshWalletData(selectedWallet.id);
      showModal(
        "success",
        "Wallet Recalculated",
        `Updated ${result.updatedCount} wallet outflow entries at FX ${result.fxRate.toFixed(6)}.`,
      );
    } catch (error) {
      showModal(
        "error",
        "Recalculation Failed",
        error instanceof Error
          ? error.message
          : "Failed to recalculate wallet entries.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const openEditFunding = (funding: TripFunding) => {
    const linkedWallet = wallets.find((wallet) => wallet.id === funding.walletId);
    const destinationCurrency =
      linkedWallet?.currency || funding.destinationCurrency || trip.baseCurrency;
    setEditingFundingId(funding.id);
    setEditingFundingForm({
      walletId: funding.walletId || selectedWalletId || "",
      sourceCurrency: funding.sourceCurrency,
      sourceAmount: String(funding.sourceAmount),
      destinationCurrency,
      destinationAmount: String(funding.destinationAmount),
      fxRate: funding.fxRate != null ? String(funding.fxRate) : "",
      feeAmount: funding.feeAmount != null ? String(funding.feeAmount) : "",
      feeCurrency:
        funding.feeCurrency ||
        funding.sourceCurrency ||
        destinationCurrency ||
        trip.baseCurrency,
    });
    setEditingFundingInputMode("amount");
    setIsEditFundingModalOpen(true);
  };

  const handleSaveFundingEdit = async () => {
    if (!editingFundingId) return;
    const funding = editingFundingItem;
    if (!funding) return;
    setIsBusy(true);
    try {
      const previousFunding =
        fundings.find((item) => item.id === editingFundingId) || null;
      const previousWalletId = previousFunding?.walletId || null;
      const nextWalletId = editingFundingForm.walletId || null;
      const selectedWallet =
        wallets.find((wallet) => wallet.id === nextWalletId) || null;
      const isBankLinked = !!funding.bankTransactionId;
      const sourceCurrency = (
        isBankLinked
          ? funding.sourceCurrency || trip.baseCurrency
          : editingFundingForm.sourceCurrency || trip.baseCurrency
      ).toUpperCase();
      const sourceAmount = isBankLinked
        ? Number(funding.sourceAmount || 0)
        : Number(editingFundingForm.sourceAmount || 0);
      const destinationCurrency = (
        isBankLinked
          ? selectedWallet?.currency ||
            funding.destinationCurrency ||
            trip.baseCurrency
          : selectedWallet?.currency ||
            editingFundingForm.destinationCurrency ||
            trip.baseCurrency
      ).toUpperCase();

      const normalized = normalizeFundingEditInput({
        sourceCurrency,
        sourceAmount,
        destinationCurrency,
        destinationAmountInput: Number(editingFundingForm.destinationAmount || 0),
        fxRateInput: Number(editingFundingForm.fxRate || 0),
        inputMode: editingFundingInputMode,
        feeAmount: Number(editingFundingForm.feeAmount || 0),
        feeCurrency: editingFundingForm.feeCurrency || sourceCurrency,
      });

      const updateResult = await updateTripFunding(trip.id, editingFundingId, {
        walletId: nextWalletId,
        sourceCurrency: normalized.sourceCurrency,
        sourceAmount: normalized.sourceAmount,
        destinationCurrency: normalized.destinationCurrency,
        destinationAmount: normalized.destinationAmount,
        fxRate: normalized.fxRate,
        feeAmount: normalized.feeAmount,
        feeCurrency: normalized.feeCurrency,
      });

      const walletIdsToRecalculate = new Set<string>();
      if (previousWalletId) walletIdsToRecalculate.add(previousWalletId);
      if (nextWalletId) walletIdsToRecalculate.add(nextWalletId);
      const recalcResults = await Promise.all(
        Array.from(walletIdsToRecalculate).map((walletId) =>
          recalculateWalletEntriesToBase(trip.id, walletId, {
            mode: "weighted",
          }).catch(() => null),
        ),
      );
      const traceFromRecalc =
        recalcResults.find((item) => item?.propagationTrace)?.propagationTrace || null;
      setPropagationTrace(
        traceFromRecalc || updateResult.propagationTrace || null,
      );

      await refreshWalletData(
        selectedWalletId || nextWalletId || previousWalletId || "",
      );
      setIsEditFundingModalOpen(false);
      setEditingFundingId("");
      showModal("success", "Funding Updated", "Funding details updated.");
    } catch (error) {
      showModal(
        "error",
        "Update Failed",
        error instanceof Error ? error.message : "Failed to update funding.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="grid h-full min-h-0 gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <section className="min-h-0 p-1">
        <h3 className="px-1 pb-2 text-sm font-semibold text-dark dark:text-white">
          Wallets
        </h3>
        <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-14rem)] pr-1">
          {wallets.map((wallet) => {
            const isSelected = wallet.id === selectedWalletId;
            const summary = walletSummaries.find((s) => s.id === wallet.id);
            return (
              <button
                key={wallet.id}
                onClick={() => setSelectedWalletId(wallet.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-stroke hover:bg-gray-1 dark:border-dark-3 dark:hover:bg-dark-3"
                }`}
                style={{
                  borderLeftWidth: 4,
                  borderLeftColor: wallet.color || "#ffffff",
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-2">
                    <WalletIcon className="h-4 w-4 shrink-0 text-dark-5 dark:text-dark-6" />
                    <div className="truncate text-sm font-semibold text-dark dark:text-white">
                      {wallet.name}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border border-stroke px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-dark-5 dark:border-dark-3 dark:text-dark-6">
                    {wallet.currency}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                  {summary?.balances.length ? (
                    summary.balances.map((balance, index) => (
                      <span
                        key={`${wallet.id}:${balance.currency}:${index}`}
                        className={
                          balance.amount >= 0
                            ? "text-green"
                            : "text-red dark:text-red-light"
                        }
                      >
                        {formatCurrencyValue(balance.amount)} {balance.currency}
                      </span>
                    ))
                  ) : (
                    <span className="text-dark-5 dark:text-dark-6">No balance yet</span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-dark-5 dark:text-dark-6">
                  <span>
                    FX to {trip.baseCurrency}:{" "}
                    {summary?.intrinsicFxRate ? summary.intrinsicFxRate.toFixed(6) : "—"}
                  </span>
                  <span>•</span>
                  <span>
                    Base value:{" "}
                    {summary?.intrinsicBaseValue !== null &&
                    summary?.intrinsicBaseValue !== undefined
                      ? `${formatCurrencyValue(summary.intrinsicBaseValue)} ${trip.baseCurrency}`
                      : "—"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="min-h-0 space-y-4">
        <TripPropagationTraceCard trace={propagationTrace} />

        {!selectedWallet && (
          <Card>
            <CardContent className="p-6 text-sm text-dark-5 dark:text-dark-6">
              Select a wallet to manage funding and FX recalculation.
            </CardContent>
          </Card>
        )}

        {selectedWallet && (
          <>
            <Card>
              <CardContent className="space-y-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold text-dark dark:text-white">
                      {selectedWallet.name} ({selectedWallet.currency})
                    </h3>
                    <p className="text-xs text-dark-5 dark:text-dark-6">
                      Base currency: {trip.baseCurrency}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => setIsAddFromBankOpen(true)}
                  >
                    Add Funding From Bank
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-stroke px-3 py-2 dark:border-dark-3">
                    <div className="text-xs text-dark-5 dark:text-dark-6">
                      Current Wallet Balance
                    </div>
                    <div className="mt-1 text-sm font-semibold text-dark dark:text-white">
                      {selectedWalletSummary?.balances
                        .map(
                          (balance) =>
                            `${formatCurrencyValue(balance.amount)} ${balance.currency}`,
                        )
                        .join(" • ") || "No balance yet"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-stroke px-3 py-2 dark:border-dark-3">
                    <div className="text-xs text-dark-5 dark:text-dark-6">
                      Weighted FX (preview)
                    </div>
                    <div className="mt-1 text-sm font-semibold text-dark dark:text-white">
                      {selectedWalletSummary?.intrinsicFxRate
                        ? selectedWalletSummary.intrinsicFxRate.toFixed(6)
                        : weightedFxPreview
                          ? weightedFxPreview.toFixed(6)
                          : "Unavailable"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-stroke px-3 py-2 dark:border-dark-3">
                    <div className="text-xs text-dark-5 dark:text-dark-6">
                      Intrinsic Base Value
                    </div>
                    <div className="mt-1 text-sm font-semibold text-dark dark:text-white">
                      {selectedWalletSummary?.intrinsicBaseValue !== null &&
                      selectedWalletSummary?.intrinsicBaseValue !== undefined
                        ? `${formatCurrencyValue(
                            selectedWalletSummary.intrinsicBaseValue,
                          )} ${trip.baseCurrency}`
                        : "Unavailable"}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-[minmax(0,220px)_minmax(0,180px)_auto]">
                  <Select
                    value={recalcMode}
                    onChange={(value) =>
                      setRecalcMode(value as "weighted" | "manual")
                    }
                    options={[
                      { value: "weighted", label: "Weighted FX from fundings" },
                      { value: "manual", label: "Manual FX rate" },
                    ]}
                    className="w-full"
                    buttonClassName="w-full"
                  />
                  <NumberInput
                    value={manualFxRate}
                    onChange={(e) => setManualFxRate(e.target.value)}
                    placeholder="Manual FX"
                    disabled={recalcMode !== "manual"}
                  />
                  <Button
                    variant="primary"
                    onClick={() => void handleRecalculateWallet()}
                    disabled={isBusy}
                  >
                    Recalculate Wallet Outflows
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="min-h-0">
              <CardContent className="p-4">
                <h4 className="mb-3 text-sm font-semibold text-dark dark:text-white">
                  Funding Rows Linked To Wallet
                </h4>
                <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-27rem)] pr-1">
                  {walletFundings.length === 0 && (
                    <div className="rounded-lg border border-dashed border-stroke px-3 py-4 text-sm text-dark-5 dark:border-dark-3 dark:text-dark-6">
                      No fundings linked to this wallet yet.
                    </div>
                  )}
                  {walletFundings.map((funding) => (
                    <div
                      key={funding.id}
                      className="rounded-lg border border-stroke px-3 py-2.5 dark:border-dark-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-dark dark:text-white">
                            {funding.bankTransaction?.description ||
                              String(funding.metadata?.originalDescription || "")
                                .trim() ||
                              "Funding"}
                          </div>
                          <div className="mt-1 truncate text-xs text-dark-5 dark:text-dark-6">
                            {format(new Date(funding.createdAt || Date.now()), "dd MMM yyyy")} •{" "}
                            {funding.sourceCurrency} {formatCurrencyValue(Number(funding.sourceAmount))}
                            {" → "}
                            {funding.destinationCurrency}{" "}
                            {formatCurrencyValue(Number(funding.destinationAmount))}
                          </div>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openEditFunding(funding)}
                        >
                          Edit
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="min-h-0">
              <CardContent className="p-4">
                <h4 className="mb-3 text-sm font-semibold text-dark dark:text-white">
                  Wallet-linked Funding Out
                </h4>
                <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-27rem)] pr-1">
                  {walletOutflows.length === 0 && (
                    <div className="rounded-lg border border-dashed border-stroke px-3 py-4 text-sm text-dark-5 dark:border-dark-3 dark:text-dark-6">
                      No funding-out entries linked to this wallet yet.
                    </div>
                  )}
                  {walletOutflows.map((entry) => {
                    const isForeign =
                      String(entry.localCurrency).toUpperCase() !==
                      String(trip.baseCurrency).toUpperCase();
                    return (
                      <div
                        key={entry.id}
                        className="rounded-lg border border-stroke px-3 py-2.5 dark:border-dark-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-dark dark:text-white">
                              {entry.label?.trim() || entry.description}
                            </div>
                            <div className="mt-1 truncate text-xs text-dark-5 dark:text-dark-6">
                              {format(new Date(entry.date), "dd MMM yyyy")} • {entry.type}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-sm font-semibold text-red dark:text-red-light">
                              {formatCurrencyValue(entry.baseAmount)} {trip.baseCurrency}
                            </div>
                            {isForeign && (
                              <div className="text-xs text-dark-5 dark:text-dark-6">
                                {formatCurrencyValue(entry.localAmount)} {entry.localCurrency}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </section>

      <Modal
        isOpen={modalState.isOpen}
        onClose={closeModal}
        title={modalState.title}
        type={modalState.type}
        message={modalState.message}
      />

      {isAddFromBankOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 p-4 flex items-center justify-center"
          onClick={() => setIsAddFromBankOpen(false)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-5xl bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 shadow-card-2 max-h-[88vh] overflow-hidden flex flex-col"
          >
            <div className="border-b border-stroke px-6 py-4 dark:border-dark-3">
              <h3 className="text-lg font-semibold text-dark dark:text-white">
                Add Wallet Funding From Bank
              </h3>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-4">
              <div className="h-[360px] overflow-hidden">
                <ExistingTransactionsSelector
                  className="h-full"
                  title="Bank Transactions (Outgoing only)"
                  searchPlaceholder="Search bank transactions..."
                  searchValue={sourceSearch}
                  onSearchValueChange={setSourceSearch}
                  onSearch={() => void searchSourceCandidates(1)}
                  isLoading={isLoadingSourceCandidates}
                  transactions={sourceCandidates.map((candidate) => ({
                    id: candidate.id,
                    date: candidate.date,
                    description: candidate.description,
                    label: candidate.label,
                    amountIn: candidate.amountIn,
                    amountOut: candidate.amountOut,
                    category: candidate.category ?? null,
                  }))}
                  selectedIds={selectedSourceIds}
                  onToggleSelect={(id) =>
                    setSelectedSourceIds((prev) => {
                      if (prev.has(id)) return new Set();
                      return new Set([id]);
                    })
                  }
                  totalItems={sourceCandidatesTotal}
                  currentPage={sourceCandidatesPage}
                  pageSize={sourceCandidatesPageSize}
                  onPageChange={(nextPage) => void searchSourceCandidates(nextPage)}
                  emptyMessage="No outgoing bank transactions found."
                />
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Source amount ({trip.baseCurrency})
                  </label>
                  <NumberInput
                    value={topupForm.sourceAmount}
                    onChange={(e) =>
                      setTopupForm((prev) => ({
                        ...prev,
                        sourceAmount: e.target.value,
                      }))
                    }
                    placeholder="0.00"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Mode
                  </label>
                  <div className="flex items-center gap-4 h-11 rounded-lg border border-stroke bg-white px-3 dark:border-dark-3 dark:bg-dark-2">
                    <label className="inline-flex items-center gap-2 text-sm text-dark dark:text-white">
                      <Checkbox
                        checked={fundingMode === "amount"}
                        onChange={() => setFundingMode("amount")}
                      />
                      Destination amount
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-dark dark:text-white">
                      <Checkbox
                        checked={fundingMode === "fxRate"}
                        onChange={() => setFundingMode("fxRate")}
                      />
                      FX rate
                    </label>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Wallet currency
                  </label>
                  <TextInput value={selectedWallet?.currency || ""} disabled />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Destination amount
                  </label>
                  <NumberInput
                    value={topupForm.destinationAmount}
                    onChange={(e) =>
                      setTopupForm((prev) => ({
                        ...prev,
                        destinationAmount: e.target.value,
                      }))
                    }
                    disabled={fundingMode !== "amount"}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    FX rate
                  </label>
                  <NumberInput
                    value={topupForm.fxRate}
                    onChange={(e) =>
                      setTopupForm((prev) => ({
                        ...prev,
                        fxRate: e.target.value,
                      }))
                    }
                    disabled={fundingMode !== "fxRate"}
                    placeholder="1.000000"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Fee amount
                  </label>
                  <NumberInput
                    value={topupForm.feeAmount}
                    onChange={(e) =>
                      setTopupForm((prev) => ({
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
                    value={topupForm.feeCurrency}
                    onChange={(value) =>
                      setTopupForm((prev) => ({
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
            <div className="border-t border-stroke px-6 py-4 flex items-center justify-end gap-2 dark:border-dark-3">
              <Button
                variant="secondary"
                onClick={() => setIsAddFromBankOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleAddFundingFromBank()}
                disabled={isBusy}
              >
                Add Funding + Rebalance
              </Button>
            </div>
          </div>
        </div>
      )}

      <TripEditFundingModal
        isOpen={isEditFundingModalOpen}
        onClose={() => {
          setIsEditFundingModalOpen(false);
          setEditingFundingId("");
        }}
        form={editingFundingForm}
        setForm={setEditingFundingForm}
        wallets={wallets}
        inputMode={editingFundingInputMode}
        setInputMode={setEditingFundingInputMode}
        lockSourceFields={!!editingFundingItem?.bankTransactionId}
        lockDestinationCurrency={!!editingFundingItem?.bankTransactionId}
        feeCurrencyOptions={Array.from(
          new Set(
            [
              (
                editingFundingItem?.bankTransactionId
                  ? editingFundingItem.sourceCurrency
                  : editingFundingForm.sourceCurrency
              )?.toUpperCase(),
              (
                editingFundingItem?.bankTransactionId
                  ? wallets.find((wallet) => wallet.id === editingFundingForm.walletId)
                      ?.currency ||
                    editingFundingItem?.destinationCurrency
                  : editingFundingForm.destinationCurrency
              )?.toUpperCase(),
            ].filter((value): value is string => Boolean(value)),
          ),
        )}
        isBusy={isBusy}
        onSave={handleSaveFundingEdit}
      />
    </div>
  );
}
