"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Search,
  SkipForward,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  getFundingCandidates,
  getTripFundings,
  reviewTripFundingMatch,
  type FundingCandidate,
  type FundingCandidatesResponse,
  type Trip,
  type TripFunding,
} from "@/app/actions/trips";
import { useHeaderConfig } from "@/components/Layouts/header-context";
import { ExistingTransactionsSelector } from "@/components/ui/ExistingTransactionsSelector";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { TransactionCard } from "@/components/transactions/TransactionCard";

interface TripFundingMatchReviewClientProps {
  trip: Trip;
  fundings: TripFunding[];
  initialFundingCandidates: FundingCandidatesResponse;
}

interface MatchCandidate {
  id: string;
  date: string;
  description: string;
  label?: string | null;
  amountIn: number | null;
  amountOut: number | null;
  source: "funding_list" | "bank";
  fundingId?: string | null;
}

const isMatchCandidate = (value: unknown): value is MatchCandidate =>
  !!value &&
  typeof value === "object" &&
  typeof (value as MatchCandidate).id === "string";

const toCurrencyAmount = (candidate: MatchCandidate | null) => {
  if (!candidate) return "$0.00";
  const inValue = typeof candidate.amountIn === "number" ? candidate.amountIn : 0;
  const outValue =
    typeof candidate.amountOut === "number" ? candidate.amountOut : 0;
  const abs = Math.abs(inValue > 0 ? inValue : outValue);
  const sign = inValue > 0 ? "+" : outValue > 0 ? "-" : "";
  return `${sign}$${abs.toFixed(2)}`;
};

const toFundingAmountString = (
  value: number | null | undefined,
  currency: string | null | undefined,
) => {
  const parsed = toNumericOrNull(value);
  if (parsed === null) return "-";
  const currencyText = currency && currency.trim().length > 0 ? ` ${currency}` : "";
  return `${parsed.toFixed(2)}${currencyText}`;
};

const toDateString = (value: string) => {
  try {
    return new Date(value).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return value;
  }
};

const getFundingDisplayDate = (funding: TripFunding) => {
  const metadata =
    funding.metadata && typeof funding.metadata === "object"
      ? (funding.metadata as Record<string, unknown>)
      : {};
  const originalDate =
    typeof metadata.originalDate === "string" ? metadata.originalDate : "";
  return originalDate || funding.createdAt || new Date().toISOString();
};

const toNumericOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function TripFundingMatchReviewClient({
  trip,
  fundings: initialFundings,
  initialFundingCandidates,
}: TripFundingMatchReviewClientProps) {
  const router = useRouter();
  const { setHeaderConfig } = useHeaderConfig();

  const [fundings, setFundings] = useState(initialFundings);
  const [index, setIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [searchRows, setSearchRows] = useState<FundingCandidate[]>(
    initialFundingCandidates.transactions || [],
  );
  const [searchTotal, setSearchTotal] = useState(initialFundingCandidates.total || 0);
  const [searchPage, setSearchPage] = useState(1);
  const [isBusy, setIsBusy] = useState(false);
  const [isLoadingSearch, setIsLoadingSearch] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const [selectedCandidateSnapshot, setSelectedCandidateSnapshot] =
    useState<MatchCandidate | null>(null);
  const [isBankLedgerModalOpen, setIsBankLedgerModalOpen] = useState(false);
  const [ledgerSelectionDraftId, setLedgerSelectionDraftId] = useState<string>("");
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

  const pageSize = 20;

  useEffect(() => {
    setHeaderConfig({
      title: `${trip.name} · Funding Review`,
      showBack: true,
      backHref: `/trips/${trip.id}/manage`,
    });
    return () => setHeaderConfig(null);
  }, [setHeaderConfig, trip.id, trip.name]);

  const showModal = (
    type: "success" | "error" | "warning" | "info",
    title: string,
    message: string,
  ) => {
    setModalState({ isOpen: true, type, title, message });
  };

  const refreshFundings = async () => {
    const next = await getTripFundings(trip.id);
    setFundings(next);
    return next;
  };

  const pendingFundings = useMemo(() => {
    return fundings.filter((item) => {
      if (item.sourceType !== "imported_topup" && item.sourceType !== "opening_balance")
        return false;
      if (item.bankTransactionId) return false;
      const metadata =
        item.metadata && typeof item.metadata === "object"
          ? (item.metadata as Record<string, unknown>)
          : {};
      const status =
        typeof metadata.matchReviewStatus === "string"
          ? metadata.matchReviewStatus
          : "pending";
      return status === "pending" || status === "unmatched";
    });
  }, [fundings]);

  useEffect(() => {
    if (pendingFundings.length === 0) {
      setIndex(0);
      setSelectedCandidateId("");
      setSelectedCandidateSnapshot(null);
      return;
    }
    if (index > pendingFundings.length - 1) {
      setIndex(pendingFundings.length - 1);
    }
    setSelectedCandidateId("");
    setSelectedCandidateSnapshot(null);
  }, [pendingFundings, index]);

  const currentFunding = pendingFundings[index] || null;

  const usedBankTransactionIds = useMemo(() => {
    const ids = new Set<string>();
    fundings.forEach((item) => {
      if (item.bankTransactionId) ids.add(item.bankTransactionId);
    });
    return ids;
  }, [fundings]);

  const parsedCandidates = useMemo(() => {
    if (!currentFunding) {
      return {
        inFundingList: [] as MatchCandidate[],
        outsideFundingList: [] as MatchCandidate[],
        recommendedId: "",
      };
    }
    const metadata =
      currentFunding.metadata && typeof currentFunding.metadata === "object"
        ? (currentFunding.metadata as Record<string, unknown>)
        : {};
    const rawCandidates =
      metadata.autoMatchCandidates && typeof metadata.autoMatchCandidates === "object"
        ? (metadata.autoMatchCandidates as Record<string, unknown>)
        : {};

    const mapCandidate = (row: unknown, source: "funding_list" | "bank"): MatchCandidate | null => {
      if (!row || typeof row !== "object") return null;
      const data = row as Record<string, unknown>;
      if (typeof data.id !== "string" || data.id.length === 0) return null;
      if (usedBankTransactionIds.has(data.id)) return null;
      return {
        id: data.id,
        date:
          typeof data.date === "string"
            ? data.date
            : getFundingDisplayDate(currentFunding),
        description:
          typeof data.description === "string" && data.description.trim().length > 0
            ? data.description
            : "Bank transaction",
        label: typeof data.label === "string" ? data.label : null,
        amountIn: typeof data.amountIn === "number" ? data.amountIn : null,
        amountOut: typeof data.amountOut === "number" ? data.amountOut : null,
        source,
        fundingId: typeof data.fundingId === "string" ? data.fundingId : null,
      };
    };

    const inFundingListRaw = Array.isArray(rawCandidates.inFundingList)
      ? rawCandidates.inFundingList
      : [];
    const outsideFundingListRaw = Array.isArray(rawCandidates.outsideFundingList)
      ? rawCandidates.outsideFundingList
      : [];

    const inFundingList = inFundingListRaw
      .map((row) => mapCandidate(row, "funding_list"))
      .filter((row): row is MatchCandidate => !!row);
    const outsideFundingList = outsideFundingListRaw
      .map((row) => mapCandidate(row, "bank"))
      .filter((row): row is MatchCandidate => !!row);

    const recommendedId =
      typeof metadata.autoMatchedBankTransactionId === "string"
        ? metadata.autoMatchedBankTransactionId
        : "";

    return { inFundingList, outsideFundingList, recommendedId };
  }, [currentFunding, usedBankTransactionIds]);

  const reviewColumns = useMemo(() => {
    const asSelectable = (rows: MatchCandidate[]) =>
      rows.map((row) => ({
        id: row.id,
        date: row.date,
        description: row.description,
        label: row.label,
        amountIn: row.amountIn,
        amountOut: row.amountOut,
        category: null,
      }));

    const searchRowsFiltered = searchRows
      .filter((row) => !usedBankTransactionIds.has(row.id))
      .map((row) => ({
        id: row.id,
        date: row.date,
        description: row.description,
        label: row.label,
        amountIn: row.amountIn,
        amountOut: row.amountOut,
        category: row.category ?? null,
      }));

    const bankRows = asSelectable(parsedCandidates.outsideFundingList);
    if (
      selectedCandidateSnapshot &&
      selectedCandidateSnapshot.source === "bank" &&
      !bankRows.some((row) => row.id === selectedCandidateSnapshot.id)
    ) {
      bankRows.unshift({
        id: selectedCandidateSnapshot.id,
        date: selectedCandidateSnapshot.date,
        description: selectedCandidateSnapshot.description,
        label: selectedCandidateSnapshot.label,
        amountIn: selectedCandidateSnapshot.amountIn,
        amountOut: selectedCandidateSnapshot.amountOut,
        category: null,
      });
    }

    return {
      fundingList: asSelectable(parsedCandidates.inFundingList),
      bank: bankRows,
      search: searchRowsFiltered,
    };
  }, [
    parsedCandidates,
    searchRows,
    usedBankTransactionIds,
    selectedCandidateSnapshot,
  ]);

  const allCandidatesById = useMemo(() => {
    const map = new Map<string, MatchCandidate>();
    [...parsedCandidates.inFundingList, ...parsedCandidates.outsideFundingList].forEach(
      (row) => map.set(row.id, row),
    );
    searchRows.forEach((row) => {
      map.set(row.id, {
        id: row.id,
        date: row.date,
        description: row.description,
        label: row.label,
        amountIn: row.amountIn,
        amountOut: row.amountOut,
        source: "bank",
        fundingId: null,
      });
    });
    return map;
  }, [parsedCandidates, searchRows]);

  const recommendedCandidate = useMemo(() => {
    if (!parsedCandidates.recommendedId) return null;
    const all = [
      ...parsedCandidates.inFundingList,
      ...parsedCandidates.outsideFundingList,
      ...searchRows.map((row) => ({
        id: row.id,
        date: row.date,
        description: row.description,
        label: row.label,
        amountIn: row.amountIn,
        amountOut: row.amountOut,
        source: "bank" as const,
        fundingId: null,
      })),
    ];
    return all.find((row) => row.id === parsedCandidates.recommendedId) || null;
  }, [parsedCandidates, searchRows]);

  const selectedCandidate = useMemo(() => {
    if (!selectedCandidateId) return null;
    return (
      allCandidatesById.get(selectedCandidateId) ||
      (selectedCandidateSnapshot?.id === selectedCandidateId
        ? selectedCandidateSnapshot
        : null)
    );
  }, [selectedCandidateId, allCandidatesById, selectedCandidateSnapshot]);

  const displayCandidate = selectedCandidate || recommendedCandidate;

  const currentFundingCard = useMemo(() => {
    if (!currentFunding) return null;
    const metadata =
      currentFunding.metadata && typeof currentFunding.metadata === "object"
        ? (currentFunding.metadata as Record<string, unknown>)
        : {};
    const originalDescription =
      typeof metadata.originalDescription === "string" &&
      metadata.originalDescription.trim().length > 0
        ? metadata.originalDescription
        : currentFunding.sourceType === "opening_balance"
          ? "Opening balance funding"
          : "Imported topup";

    const sourceAmount = toNumericOrNull(currentFunding.sourceAmount);
    const destinationAmount = toNumericOrNull(currentFunding.destinationAmount);
    const fxRate = toNumericOrNull(currentFunding.fxRate);
    const feeAmount = toNumericOrNull(currentFunding.feeAmount);

    return {
      id: currentFunding.id,
      date: getFundingDisplayDate(currentFunding),
      description: originalDescription,
      label:
        currentFunding.sourceType === "opening_balance"
          ? "Opening Balance"
          : "Imported Topup",
      amountIn: destinationAmount,
      amountOut: sourceAmount,
      balance: null,
      currency: currentFunding.destinationCurrency || currentFunding.sourceCurrency || null,
      category: undefined,
      metadata: {
        sourceType: currentFunding.sourceType,
        sourceAmount: toFundingAmountString(
          sourceAmount,
          currentFunding.sourceCurrency,
        ),
        destinationAmount: toFundingAmountString(
          destinationAmount,
          currentFunding.destinationCurrency,
        ),
        fxRate: fxRate !== null ? fxRate.toFixed(6) : "-",
        feeAmount: toFundingAmountString(
          feeAmount,
          currentFunding.feeCurrency || currentFunding.sourceCurrency,
        ),
        wallet: currentFunding.wallet
          ? `${currentFunding.wallet.name} (${currentFunding.wallet.currency})`
          : "-",
        basisDate:
          typeof metadata.basisTransactionDate === "string"
            ? toDateString(metadata.basisTransactionDate)
            : "-",
      },
      linkage: null,
    };
  }, [currentFunding]);

  const selectedSet = useMemo(
    () => (selectedCandidateId ? new Set([selectedCandidateId]) : new Set<string>()),
    [selectedCandidateId],
  );
  const ledgerSelectedSet = useMemo(
    () => (ledgerSelectionDraftId ? new Set([ledgerSelectionDraftId]) : new Set<string>()),
    [ledgerSelectionDraftId],
  );

  const handleToggleCandidate = (candidateId: string) => {
    setSelectedCandidateId((prev) => {
      if (prev === candidateId) {
        setSelectedCandidateSnapshot(null);
        return "";
      }
      const resolved = allCandidatesById.get(candidateId);
      setSelectedCandidateSnapshot(isMatchCandidate(resolved) ? resolved : null);
      return candidateId;
    });
  };

  const openBankLedgerModal = () => {
    setLedgerSelectionDraftId(selectedCandidateId);
    setIsBankLedgerModalOpen(true);
  };

  const handleConfirmLedgerSelection = () => {
    const resolved = ledgerSelectionDraftId
      ? allCandidatesById.get(ledgerSelectionDraftId)
      : null;
    setSelectedCandidateId(ledgerSelectionDraftId || "");
    setSelectedCandidateSnapshot(isMatchCandidate(resolved) ? resolved : null);
    setIsBankLedgerModalOpen(false);
  };

  const loadSearchRows = async (pageValue: number, searchValue: string) => {
    setIsLoadingSearch(true);
    try {
      const result = await getFundingCandidates(trip.id, {
        search: searchValue || undefined,
        limit: pageSize,
        offset: (pageValue - 1) * pageSize,
      });
      setSearchRows(result.transactions || []);
      setSearchTotal(result.total || 0);
      setSearchPage(pageValue);
    } finally {
      setIsLoadingSearch(false);
    }
  };

  const handleResolve = async (
    action: "accept" | "reject" | "replace",
    bankTransactionId?: string,
  ) => {
    if (!currentFunding) return;
    setIsBusy(true);
    try {
      await reviewTripFundingMatch(trip.id, currentFunding.id, {
        action,
        bankTransactionId,
      });
      const next = await refreshFundings();
      const nextPending = next.filter((item) => {
        if (item.sourceType !== "imported_topup" && item.sourceType !== "opening_balance")
          return false;
        if (item.bankTransactionId) return false;
        const metadata =
          item.metadata && typeof item.metadata === "object"
            ? (item.metadata as Record<string, unknown>)
            : {};
        const status =
          typeof metadata.matchReviewStatus === "string"
            ? metadata.matchReviewStatus
            : "pending";
        return status === "pending" || status === "unmatched";
      });

      if (nextPending.length === 0) {
        showModal("success", "Review Complete", "All pending funding matches were resolved.");
      } else if (index > nextPending.length - 1) {
        setIndex(nextPending.length - 1);
      }
      setSelectedCandidateId("");
      setSelectedCandidateSnapshot(null);
    } catch (error) {
      showModal(
        "error",
        "Unable to Save Review",
        error instanceof Error ? error.message : "Could not save match review.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="h-full min-h-0 space-y-4">
      {pendingFundings.length === 0 ? (
        <Card className="rounded-lg">
          <CardContent className="py-12 text-center space-y-3">
            <p className="text-sm text-dark dark:text-white">
              No pending funding linkage reviews.
            </p>
            <Button variant="primary" onClick={() => router.push(`/trips/${trip.id}/manage`)}>
              Back to Trip Manage
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-dark-5 dark:text-dark-6">
              Reviewing {index + 1} of {pendingFundings.length} pending funding items
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIndex((prev) => Math.max(0, prev - 1))}
                disabled={index === 0}
                leftIcon={<ArrowLeft className="h-4 w-4" />}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setIndex((prev) => Math.min(pendingFundings.length - 1, prev + 1))
                }
                disabled={index >= pendingFundings.length - 1}
                rightIcon={<ArrowRight className="h-4 w-4" />}
              >
                Next
              </Button>
            </div>
          </div>

          {currentFunding && (
            <div className="grid h-[calc(100vh-16rem)] min-h-[620px] gap-4 lg:grid-cols-[minmax(420px,1.2fr)_minmax(0,1.8fr)]">
              <Card className="rounded-lg min-h-0">
                <CardContent className="p-4 h-full min-h-0 flex flex-col gap-3">
                  <div className="min-h-0 flex-1 overflow-y-auto pr-1 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                      {currentFunding.sourceType === "opening_balance"
                        ? "Opening Balance Suggestion"
                        : "Current Topup"}
                    </p>
                    {currentFundingCard ? (
                      <TransactionCard
                        transaction={currentFundingCard}
                        wrapText
                        className="border border-stroke dark:border-dark-3 rounded-lg"
                      />
                    ) : null}

                    {currentFunding.sourceType === "opening_balance" ? (
                      <div />
                    ) : (
                      <>
                        <div className="pt-1">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                              {selectedCandidate
                                ? "Selected candidate"
                                : "Recommended candidate"}
                            </p>
                            {selectedCandidate && (
                              <button
                                type="button"
                                className="text-xs text-primary hover:underline"
                                onClick={() => setSelectedCandidateId("")}
                              >
                                Deselect
                              </button>
                            )}
                          </div>
                          {displayCandidate ? (
                            <>
                              <TransactionCard
                                transaction={{
                                  id: displayCandidate.id,
                                  date: displayCandidate.date,
                                  description: displayCandidate.description,
                                  label: displayCandidate.label || undefined,
                                  amountIn: displayCandidate.amountIn,
                                  amountOut: displayCandidate.amountOut,
                                  balance: null,
                                  category: undefined,
                                  metadata: {
                                    source:
                                      displayCandidate.source === "funding_list"
                                        ? "identified_in_funding_list"
                                        : "identified_in_bank_transactions",
                                  },
                                  linkage: null,
                                }}
                                wrapText
                                className="border border-stroke dark:border-dark-3 rounded-lg"
                              />
                              <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                                Amount:{" "}
                                <span className="font-medium text-dark dark:text-white">
                                  {toCurrencyAmount(displayCandidate)}
                                </span>
                              </p>
                            </>
                          ) : (
                            <p className="text-xs text-dark-5 dark:text-dark-6">
                              No recommended candidate available for this topup.
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="shrink-0 space-y-2 pt-1">
                    {currentFunding.sourceType === "opening_balance" ? (
                      <Button
                        variant="primary"
                        onClick={() => void handleResolve("accept")}
                        disabled={isBusy}
                        className="w-full"
                        leftIcon={
                          isBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )
                        }
                      >
                        Add Opening Balance Funding
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        onClick={() => {
                          const candidateId =
                            selectedCandidateId || parsedCandidates.recommendedId;
                          if (!candidateId) {
                            showModal(
                              "warning",
                              "No Candidate Selected",
                              "No recommended match is available, and no candidate is selected.",
                            );
                            return;
                          }
                          const action =
                            selectedCandidateId &&
                            selectedCandidateId !== parsedCandidates.recommendedId
                              ? "replace"
                              : "accept";
                          void handleResolve(action, candidateId);
                        }}
                        disabled={
                          isBusy ||
                          (!parsedCandidates.recommendedId && !selectedCandidateId)
                        }
                        className="w-full"
                        leftIcon={
                          isBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )
                        }
                      >
                        {selectedCandidateId
                          ? "Link Selected Candidate"
                          : "Accept Recommended"}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      onClick={() => void handleResolve("reject")}
                      disabled={isBusy}
                      className="w-full"
                      leftIcon={<SkipForward className="h-4 w-4" />}
                    >
                      {currentFunding.sourceType === "opening_balance"
                        ? "Skip Opening Balance"
                        : "Skip Linkage (keep topup as funding)"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="min-h-0 flex flex-col gap-3">
                {currentFunding.sourceType === "opening_balance" ? (
                  <Card className="rounded-lg">
                    <CardContent className="p-4 text-sm text-dark-5 dark:text-dark-6">
                      Opening balance suggestions do not require bank transaction linkage.
                      Click <span className="font-medium text-dark dark:text-white">Add Opening Balance Funding</span> to accept this funding source, or skip it.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
                    <ExistingTransactionsSelector
                      className="h-full"
                      title="Identified in Funding List"
                      searchPlaceholder="Filter identified..."
                      searchValue=""
                      onSearchValueChange={() => {}}
                      onSearch={() => {}}
                      isLoading={false}
                      transactions={reviewColumns.fundingList}
                      selectedIds={selectedSet}
                      onToggleSelect={handleToggleCandidate}
                      totalItems={reviewColumns.fundingList.length}
                      currentPage={1}
                      pageSize={Math.max(reviewColumns.fundingList.length, 1)}
                      onPageChange={() => {}}
                      recommendedTransactionId={parsedCandidates.recommendedId}
                      emptyMessage="No identified matches in existing fundings."
                    />

                    <ExistingTransactionsSelector
                      className="h-full"
                      title="Identified Outside Funding List"
                      searchPlaceholder="Filter identified..."
                      searchValue=""
                      onSearchValueChange={() => {}}
                      onSearch={() => {}}
                      isLoading={false}
                      transactions={reviewColumns.bank}
                      selectedIds={selectedSet}
                      onToggleSelect={handleToggleCandidate}
                      totalItems={reviewColumns.bank.length}
                      currentPage={1}
                      pageSize={Math.max(reviewColumns.bank.length, 1)}
                      onPageChange={() => {}}
                      recommendedTransactionId={parsedCandidates.recommendedId}
                      footerAction={
                        <Button
                          variant="secondary"
                          size="sm"
                          className="w-full justify-center"
                          leftIcon={<Search className="h-4 w-4" />}
                          onClick={openBankLedgerModal}
                        >
                          Find from full bank ledger
                        </Button>
                      }
                      emptyMessage="No identified matches outside funding list."
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {isBankLedgerModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="relative flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-stroke bg-white shadow-xl dark:border-dark-3 dark:bg-dark-2">
            <div className="flex items-start justify-between border-b border-stroke p-6 pb-4 dark:border-dark-3">
              <div>
                <h3 className="text-xl font-semibold text-dark dark:text-white">
                  Select from Bank Ledger
                </h3>
                <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                  Search all eligible bank transactions and confirm one candidate to link.
                </p>
              </div>
              <button
                onClick={() => setIsBankLedgerModalOpen(false)}
                className="text-dark-5 hover:text-dark dark:text-dark-6 dark:hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 p-4">
              <ExistingTransactionsSelector
                className="h-full"
                title="Bank Transactions"
                searchPlaceholder="Search bank transactions..."
                searchValue={search}
                onSearchValueChange={setSearch}
                onSearch={() => void loadSearchRows(1, search)}
                isLoading={isLoadingSearch}
                transactions={reviewColumns.search}
                selectedIds={ledgerSelectedSet}
                onToggleSelect={(candidateId) =>
                  setLedgerSelectionDraftId((prev) =>
                    prev === candidateId ? "" : candidateId,
                  )
                }
                totalItems={searchTotal}
                currentPage={searchPage}
                pageSize={pageSize}
                onPageChange={(nextPage) => void loadSearchRows(nextPage, search)}
                recommendedTransactionId={parsedCandidates.recommendedId}
                emptyMessage="No bank transactions found."
              />
            </div>

            <div className="border-t border-stroke px-6 py-4 dark:border-dark-3">
              <div className="flex items-center justify-end gap-3">
                <Button
                  variant="secondary"
                  onClick={() => setIsBankLedgerModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleConfirmLedgerSelection}
                >
                  Confirm Selection
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={modalState.isOpen}
        onClose={() => setModalState((prev) => ({ ...prev, isOpen: false }))}
        type={modalState.type}
        title={modalState.title}
        message={modalState.message}
      />
    </div>
  );
}
