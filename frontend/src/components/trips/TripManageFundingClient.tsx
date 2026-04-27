"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  FileUp,
  Link2,
  Loader2,
  MoreHorizontal,
  PlaneTakeoff,
  Plus,
  Trash2,
  Wallet as WalletGlyph,
  WalletCards,
} from "lucide-react";
import { format } from "date-fns";
import Link from "next/link";
import { parseFile } from "@/app/actions/parser";
import {
  addEntriesFromSourceTransactions,
  createTripEntry,
  createTripFunding,
  deleteTripFunding,
  bulkDeleteTripEntriesByFilter,
  bulkDeleteTripEntriesByIds,
  bulkUpdateTripEntriesByFilter,
  bulkUpdateTripEntriesByIds,
  createWallet,
  getFundingCandidates,
  getSourceTransactionCandidates,
  getTripEntries,
  getTripFundings,
  getTripWalletSummaries,
  importTripSpendings,
  mergeTripFunding,
  reviewTripFundingMatch,
  updateTripFunding,
  type FundingCandidate,
  type FundingCandidatesResponse,
  type SourceTransactionCandidate,
  type SourceTransactionCandidatesResponse,
  type Trip,
  type TripEntry,
  type TripFunding,
  type TripPropagationTrace,
  type Wallet,
  type WalletSummary,
} from "@/app/actions/trips";
import { createCategory, type Category } from "@/app/actions/categories";
import type { ParserOption } from "@/lib/parsers";
import { getCurrencyOptions } from "@/lib/currencies";
import { normalizeFundingEditInput } from "@/lib/fundingMath";
import { getRandomWalletColor } from "@/lib/walletColors";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { FileUploadDropzone } from "@/components/import/FileUploadDropzone";
import { AddCategoryModal } from "@/components/ui/AddCategoryModal";
import { CategorySelect } from "@/components/ui/CategorySelect";
import { Checkbox } from "@/components/ui/Checkbox";
import { ColorSelect } from "@/components/ui/ColorSelect";
import { DatePicker } from "@/components/ui/DatePicker";
import { Modal } from "@/components/ui/Modal";
import { NumberInput } from "@/components/ui/NumberInput";
import { SearchBar } from "@/components/ui/SearchBar";
import { Select } from "@/components/ui/Select";
import { TextInput } from "@/components/ui/TextInput";
import { useHeaderConfig } from "@/components/Layouts/header-context";
import { Pagination } from "@/components/transactions/Pagination";
import { ExpandableTransactionList } from "@/components/transactions/ExpandableTransactionList";
import type { TransactionCardTransaction } from "@/components/transactions/TransactionCard";
import { ExistingTransactionsSelector } from "@/components/ui/ExistingTransactionsSelector";
import { TransactionTable } from "@/components/transaction-table/TransactionTable";
import { TripPropagationTraceCard } from "@/components/trips/TripPropagationTraceCard";
import type {
  ParseResult as ImportParseResult,
  Transaction as ImportTransaction,
} from "@/components/transaction-table/types";

interface TripManageFundingClientProps {
  trip: Trip;
  fundings: TripFunding[];
  wallets: Wallet[];
  walletSummaries: WalletSummary[];
  categories: Category[];
  initialEntries: TripEntry[];
  initialEntriesTotal: number;
  initialFundingCandidates: FundingCandidatesResponse;
  tripParserOptions: ParserOption[];
  viewMode?: "manage" | "funding";
}

interface EntryFilters {
  search: string;
  walletId: string;
  categoryId: string;
  dateFrom: string;
  dateTo: string;
}

type FundingModalTab = "review" | "bank" | "manual";

const formatCurrencyValue = (value: number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

export function TripManageFundingClient({
  trip,
  fundings: initialFundings,
  wallets: initialWallets,
  walletSummaries: initialWalletSummaries,
  categories,
  initialEntries,
  initialEntriesTotal,
  initialFundingCandidates,
  tripParserOptions,
  viewMode = "manage",
}: TripManageFundingClientProps) {
  const { setHeaderConfig } = useHeaderConfig();

  const [fundings, setFundings] = useState(initialFundings);
  const [wallets, setWallets] = useState(initialWallets);
  const [localCategories, setLocalCategories] = useState(categories);
  const [walletSummaries, setWalletSummaries] = useState(
    initialWalletSummaries,
  );
  const [fundingCandidates, setFundingCandidates] = useState<
    FundingCandidate[]
  >(initialFundingCandidates.transactions || []);
  const [fundingCandidatesTotal, setFundingCandidatesTotal] = useState(
    initialFundingCandidates.total || 0,
  );
  const [fundingCandidatesPage, setFundingCandidatesPage] = useState(1);
  const fundingCandidatesPageSize = 20;
  const [isLoadingFundingCandidates, setIsLoadingFundingCandidates] =
    useState(false);
  const [sourceCandidates, setSourceCandidates] = useState<
    SourceTransactionCandidate[]
  >([]);
  const [sourceCandidatesTotal, setSourceCandidatesTotal] = useState(0);
  const [sourceCandidatesPage, setSourceCandidatesPage] = useState(1);
  const sourceCandidatesPageSize = 20;
  const [isLoadingSourceCandidates, setIsLoadingSourceCandidates] =
    useState(false);
  const [entries, setEntries] = useState(initialEntries);
  const [entriesTotal, setEntriesTotal] = useState(initialEntriesTotal);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [filters, setFilters] = useState<EntryFilters>({
    search: "",
    walletId: "",
    categoryId: "",
    dateFrom: "",
    dateTo: "",
  });
  const hasInitializedFilters = useRef(false);

  const [isFundingModalOpen, setIsFundingModalOpen] = useState(false);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isAddFromMainModalOpen, setIsAddFromMainModalOpen] = useState(false);
  const [isManualEntryModalOpen, setIsManualEntryModalOpen] = useState(false);
  const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState(false);
  const [isEditFundingModalOpen, setIsEditFundingModalOpen] = useState(false);
  const [editingFundingId, setEditingFundingId] = useState<string>("");
  const [selectedFundingListId, setSelectedFundingListId] =
    useState<string>("");
  const [selectedFundingManageIds, setSelectedFundingManageIds] = useState<
    Set<string>
  >(new Set());
  const [selectedFundingManagePrimaryId, setSelectedFundingManagePrimaryId] =
    useState<string>("");
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

  const [isBusy, setIsBusy] = useState(false);
  const [propagationTrace, setPropagationTrace] = useState<
    TripPropagationTrace | TripPropagationTrace[] | null
  >(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showBulkMenu, setShowBulkMenu] = useState(false);
  const bulkMenuRef = useRef<HTMLDivElement>(null);
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

  const [fundingSearch, setFundingSearch] = useState("");
  const [selectedFundingIds, setSelectedFundingIds] = useState<Set<string>>(
    new Set(),
  );
  const [sourceSearch, setSourceSearch] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(
    new Set(),
  );
  const [sourceEntryType, setSourceEntryType] = useState<
    "spending" | "reimbursement"
  >("spending");
  const [sourceCategoryId, setSourceCategoryId] = useState("");
  const [manualFunding, setManualFunding] = useState(false);
  const [fundingModalTab, setFundingModalTab] =
    useState<FundingModalTab>("bank");
  const [fundingDetailTab, setFundingDetailTab] = useState<
    "details" | "linkage"
  >("details");
  const [selectedWalletId, setSelectedWalletId] = useState(
    initialWallets[0]?.id || "",
  );
  const [fundingInputMode, setFundingInputMode] = useState<"amount" | "fxRate">(
    "amount",
  );
  const [selectedReviewFundingId, setSelectedReviewFundingId] = useState("");
  const [reviewSearch, setReviewSearch] = useState("");
  const [reviewCandidates, setReviewCandidates] = useState<FundingCandidate[]>(
    [],
  );
  const [reviewCandidatesTotal, setReviewCandidatesTotal] = useState(0);
  const [reviewCandidatesPage, setReviewCandidatesPage] = useState(1);
  const [isLoadingReviewCandidates, setIsLoadingReviewCandidates] =
    useState(false);
  const [selectedReviewReplacementIds, setSelectedReviewReplacementIds] =
    useState<Set<string>>(new Set());
  const [mergeTargetFundingId, setMergeTargetFundingId] = useState("");
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(
    new Set(),
  );
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
  const [deselectedEntryIds, setDeselectedEntryIds] = useState<Set<string>>(
    new Set(),
  );
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkDate, setBulkDate] = useState("");
  const [fundingForm, setFundingForm] = useState({
    sourceCurrency: trip.baseCurrency,
    sourceAmount: "",
    destinationAmount: "",
    fxRate: "",
    feeMode: "none" as "none" | "amount" | "percent",
    feeValue: "",
    feeCurrency: trip.baseCurrency,
  });

  const [walletForm, setWalletForm] = useState({
    name: "",
    currency: trip.baseCurrency,
    color: getRandomWalletColor(),
  });
  const [importForm, setImportForm] = useState({
    parserId: tripParserOptions[0]?.id || "",
    walletId: "",
  });
  const [tripImportStep, setTripImportStep] = useState<"setup" | "review">(
    "setup",
  );
  const [tripImportParsedData, setTripImportParsedData] =
    useState<ImportParseResult | null>(null);
  const [tripImportEditedTransactions, setTripImportEditedTransactions] =
    useState<ImportTransaction[]>([]);
  const [tripImportSelectedIndices, setTripImportSelectedIndices] = useState<
    Set<number>
  >(new Set());
  const [manualEntryForm, setManualEntryForm] = useState({
    walletId: "__none__",
    type: "spending" as "spending" | "reimbursement",
    date: format(new Date(), "yyyy-MM-dd"),
    description: "",
    label: "",
    categoryId: "",
    localCurrency: trip.baseCurrency,
    localAmount: "",
    baseAmount: "",
    fxRate: "",
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [supplementalFile, setSupplementalFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{
    importedSpendings: number;
    importedReimbursements: number;
    importedFundings?: number;
    importedTransfers?: number;
    importedFees?: number;
    skipped: number;
  } | null>(null);

  const totalPages = Math.max(1, Math.ceil(entriesTotal / pageSize));
  const currencyOptions = useMemo(() => getCurrencyOptions(), []);
  const walletColorMap = useMemo(
    () =>
      wallets.reduce<Record<string, string>>((acc, wallet) => {
        acc[wallet.id] = wallet.color || "#ffffff";
        return acc;
      }, {}),
    [wallets],
  );
  const fundingTransactions = useMemo<TransactionCardTransaction[]>(
    () =>
      fundings.map((item) => ({
        id: item.id,
        date:
          item.createdAt ||
          item.bankTransaction?.date ||
          new Date().toISOString().slice(0, 10),
        description:
          item.bankTransaction?.description ||
          String(
            (item.metadata as Record<string, unknown> | null)
              ?.originalDescription || "",
          ).trim() ||
          "Funding",
        label: item.sourceType === "manual" ? "Manual Funding" : "Funding",
        amountIn: item.destinationAmount,
        amountOut: null,
        balance: null,
        displayCurrency: item.destinationCurrency,
        metadata: {
          sourceType: item.sourceType,
          sourceAmount: `${formatCurrencyValue(item.sourceAmount)} ${item.sourceCurrency}`,
          destinationAmount: `${formatCurrencyValue(item.destinationAmount)} ${item.destinationCurrency}`,
          fxRate: item.fxRate,
          feeAmount: item.feeAmount,
          feeCurrency: item.feeCurrency,
          bankTransactionId: item.bankTransactionId,
          walletName: item.wallet?.name,
          walletCurrency: item.wallet?.currency,
          ...(item.metadata || {}),
        },
      })),
    [fundings],
  );
  const tripTransactions = useMemo<TransactionCardTransaction[]>(
    () =>
      entries.map((entry) => {
        const isReimbursement = entry.type === "reimbursement";
        const isOutflow = entry.type === "spending" || entry.type === "funding_out";
        const hasForeignWalletAmount =
          String(entry.localCurrency || "").toUpperCase() !==
          String(trip.baseCurrency || "").toUpperCase();
        const primaryAmount = hasForeignWalletAmount
          ? entry.baseAmount
          : entry.localAmount;
        const primaryCurrency = hasForeignWalletAmount
          ? trip.baseCurrency
          : entry.localCurrency;
        const entryMetadata =
          entry.metadata && typeof entry.metadata === "object"
            ? (entry.metadata as Record<string, unknown>)
            : {};
        const merchantForeignAmount = Number(entryMetadata.foreignAmount || 0);
        const merchantForeignCurrency = String(
          entryMetadata.merchantCurrency ||
            entryMetadata.foreignCurrency ||
            "",
        ).toUpperCase();
        const hasMerchantSecondaryAmount =
          !hasForeignWalletAmount &&
          merchantForeignAmount > 0 &&
          merchantForeignCurrency.length > 0 &&
          merchantForeignCurrency !== String(primaryCurrency || "").toUpperCase();

        const sourceType = String(
          (entry.metadata as Record<string, unknown> | null)?.sourceType || "",
        ).toLowerCase();
        const noWalletSource = entry.wallet.id === "__external__";
        const bankLinkedSource =
          sourceType === "external_bank" ||
          sourceType === "external_bank_funding_out";
        const accentColor =
          noWalletSource || bankLinkedSource
            ? "#ffffff"
            : walletColorMap[entry.wallet.id] || "#ffffff";

        return {
          id: entry.id,
          date: entry.date,
          description: entry.description,
          label: entry.label || undefined,
          amountIn: isReimbursement ? primaryAmount : null,
          amountOut: isOutflow ? primaryAmount : null,
          balance: null,
          displayCurrency: primaryCurrency,
          category: entry.category || undefined,
          secondaryAmount: hasForeignWalletAmount
            ? {
                value: entry.localAmount,
                currency: entry.localCurrency,
                direction: isReimbursement ? "in" : "out",
                label: "Wallet Amount",
              }
            : hasMerchantSecondaryAmount
              ? {
                  value: merchantForeignAmount,
                  currency: merchantForeignCurrency,
                  direction: isReimbursement ? "in" : "out",
                  label: "Merchant Amount",
                }
            : undefined,
          accentColor,
          metadata: {
            entryType: entry.type,
            walletName: entry.wallet.name,
            walletCurrency: entry.wallet.currency,
            baseAmount: `${formatCurrencyValue(entry.baseAmount)} ${trip.baseCurrency}`,
            walletAmount: `${formatCurrencyValue(entry.localAmount)} ${entry.localCurrency}`,
            fxRate: entry.fxRate,
            ...(entry.feeAmount
              ? {
                  fee: `${formatCurrencyValue(entry.feeAmount)} ${
                    entry.feeCurrency || trip.baseCurrency
                  }`,
                }
              : {}),
            ...entryMetadata,
          },
        };
      }),
    [entries, trip.baseCurrency, walletColorMap],
  );

  const selectedCount = allFilteredSelected
    ? Math.max(entriesTotal - deselectedEntryIds.size, 0)
    : selectedEntryIds.size;

  const isSelected = (id: string) =>
    allFilteredSelected
      ? !deselectedEntryIds.has(id)
      : selectedEntryIds.has(id);

  const clearEntrySelection = () => {
    setSelectedEntryIds(new Set());
    setAllFilteredSelected(false);
    setDeselectedEntryIds(new Set());
  };

  const toggleEntrySelection = (id: string) => {
    if (allFilteredSelected) {
      setDeselectedEntryIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    setSelectedEntryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedFundingWallet = useMemo(
    () => wallets.find((wallet) => wallet.id === selectedWalletId) || null,
    [wallets, selectedWalletId],
  );

  const pendingAutoMatchedFundings = useMemo(
    () =>
      fundings.filter((item) => {
        const metadata =
          item.metadata && typeof item.metadata === "object"
            ? (item.metadata as Record<string, unknown>)
            : {};
        const suggestedId =
          typeof metadata.autoMatchedBankTransactionId === "string"
            ? metadata.autoMatchedBankTransactionId
            : "";
        const reviewStatus =
          typeof metadata.matchReviewStatus === "string"
            ? metadata.matchReviewStatus
            : suggestedId
              ? "pending"
              : "unmatched";

        return (
          item.sourceType === "imported_topup" &&
          !item.bankTransactionId &&
          reviewStatus === "pending" &&
          suggestedId.length > 0
        );
      }),
    [fundings],
  );

  const selectedPendingFunding = useMemo(
    () =>
      pendingAutoMatchedFundings.find(
        (item) => item.id === selectedReviewFundingId,
      ) || null,
    [pendingAutoMatchedFundings, selectedReviewFundingId],
  );

  const selectedFundingFromList = useMemo(
    () => fundings.find((item) => item.id === selectedFundingListId) || null,
    [fundings, selectedFundingListId],
  );
  const editingFundingItem = useMemo(
    () => fundings.find((item) => item.id === editingFundingId) || null,
    [fundings, editingFundingId],
  );
  const selectedFundingManageItems = useMemo(
    () => fundings.filter((item) => selectedFundingManageIds.has(item.id)),
    [fundings, selectedFundingManageIds],
  );
  const selectedFundingManageItem = useMemo(() => {
    if (selectedFundingManageItems.length !== 1) return null;
    if (
      selectedFundingManagePrimaryId &&
      selectedFundingManageIds.has(selectedFundingManagePrimaryId)
    ) {
      return (
        selectedFundingManageItems.find(
          (item) => item.id === selectedFundingManagePrimaryId,
        ) || selectedFundingManageItems[0]
      );
    }
    return selectedFundingManageItems[0];
  }, [
    selectedFundingManageItems,
    selectedFundingManagePrimaryId,
    selectedFundingManageIds,
  ]);
  const selectedImportedFundingForAttach = useMemo(
    () =>
      !!selectedFundingFromList &&
      selectedFundingFromList.sourceType === "imported_topup" &&
      !selectedFundingFromList.bankTransactionId,
    [selectedFundingFromList],
  );
  const selectedFundingManageCount = selectedFundingManageIds.size;

  const suggestedReviewCandidate = useMemo(() => {
    if (!selectedPendingFunding) return null;
    const metadata =
      selectedPendingFunding.metadata &&
      typeof selectedPendingFunding.metadata === "object"
        ? (selectedPendingFunding.metadata as Record<string, unknown>)
        : {};
    const suggestedId =
      typeof metadata.autoMatchedBankTransactionId === "string"
        ? metadata.autoMatchedBankTransactionId
        : selectedPendingFunding.suggestedBankTransaction?.id || "";
    if (!suggestedId) return null;

    const fromReview = reviewCandidates.find((item) => item.id === suggestedId);
    if (fromReview) return fromReview;

    const fromFunding = fundingCandidates.find(
      (item) => item.id === suggestedId,
    );
    if (fromFunding) return fromFunding;

    const fallback = selectedPendingFunding.suggestedBankTransaction;
    if (!fallback) return null;
    return {
      id: fallback.id,
      date: fallback.date,
      description: fallback.description,
      amountIn: fallback.amountIn,
      amountOut: fallback.amountOut,
      label: null,
      category: null,
      accountIdentifier: null,
    } satisfies FundingCandidate;
  }, [selectedPendingFunding, reviewCandidates, fundingCandidates]);

  const mergeTargetOptions = useMemo(() => {
    return fundings.filter(
      (item) =>
        item.id !== selectedReviewFundingId &&
        item.sourceType !== "imported_topup",
    );
  }, [fundings, selectedReviewFundingId]);

  useEffect(() => {
    setHeaderConfig({
      title: `${trip.name} · ${viewMode === "funding" ? "Funding" : "Manage"}`,
      subtitle:
        viewMode === "funding"
          ? "Funding sources and wallet management"
          : "Funding sources, wallets, and trip transactions",
      showBack: true,
      backHref: `/trips/${trip.id}`,
    });
    return () => setHeaderConfig(null);
  }, [setHeaderConfig, trip.id, trip.name, viewMode]);

  const showModal = (
    type: "success" | "error" | "warning" | "info",
    title: string,
    message: string,
  ) => {
    setModalState({
      isOpen: true,
      type,
      title,
      message,
    });
  };

  const closeModal = () =>
    setModalState((prev) => ({
      ...prev,
      isOpen: false,
    }));

  const refreshFundingsAndWallets = async () => {
    const [nextFundings, nextWalletSummaries, nextCandidates, nextWallets] =
      await Promise.all([
        getTripFundings(trip.id),
        getTripWalletSummaries(trip.id),
        getFundingCandidates(trip.id, {
          search: fundingSearch || undefined,
          limit: fundingCandidatesPageSize,
          offset: (fundingCandidatesPage - 1) * fundingCandidatesPageSize,
        }),
        getTripWalletSummaries(trip.id).then((rows) =>
          rows.map((row) => ({
            id: row.id,
            tripId: row.tripId,
            name: row.name,
            currency: row.currency,
            color: row.color,
          })),
        ),
      ]);
    setFundings(nextFundings);
    setWalletSummaries(nextWalletSummaries);
    setFundingCandidates(nextCandidates.transactions || []);
    setFundingCandidatesTotal(nextCandidates.total || 0);
    setWallets(nextWallets);
    return nextFundings;
  };

  const refreshEntries = useCallback(
    async (nextPage: number, nextFilters: EntryFilters) => {
      const result = await getTripEntries(trip.id, {
        search: nextFilters.search || undefined,
        walletId: nextFilters.walletId || undefined,
        categoryId: nextFilters.categoryId || undefined,
        dateFrom: nextFilters.dateFrom
          ? new Date(`${nextFilters.dateFrom}T00:00:00`)
          : undefined,
        dateTo: nextFilters.dateTo
          ? new Date(`${nextFilters.dateTo}T23:59:59`)
          : undefined,
        limit: pageSize,
        offset: (nextPage - 1) * pageSize,
      });
      setEntries(result.items);
      setEntriesTotal(result.total);
    },
    [trip.id, pageSize],
  );

  const buildEntryFilterPayload = useCallback(
    () => ({
      search: filters.search || undefined,
      walletId: filters.walletId || undefined,
      categoryId: filters.categoryId || undefined,
      dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
      dateTo: filters.dateTo ? new Date(filters.dateTo) : undefined,
    }),
    [filters],
  );

  const loadFundingCandidates = useCallback(
    async (nextPage: number, searchValue: string) => {
      setIsLoadingFundingCandidates(true);
      try {
        const candidates = await getFundingCandidates(trip.id, {
          search: searchValue || undefined,
          limit: fundingCandidatesPageSize,
          offset: (nextPage - 1) * fundingCandidatesPageSize,
        });
        setFundingCandidates(candidates.transactions || []);
        setFundingCandidatesTotal(candidates.total || 0);
        setFundingCandidatesPage(nextPage);
      } finally {
        setIsLoadingFundingCandidates(false);
      }
    },
    [trip.id],
  );

  const loadReviewCandidates = useCallback(
    async (nextPage: number, searchValue: string) => {
      setIsLoadingReviewCandidates(true);
      try {
        const candidates = await getFundingCandidates(trip.id, {
          search: searchValue || undefined,
          limit: fundingCandidatesPageSize,
          offset: (nextPage - 1) * fundingCandidatesPageSize,
        });
        setReviewCandidates(candidates.transactions || []);
        setReviewCandidatesTotal(candidates.total || 0);
        setReviewCandidatesPage(nextPage);
      } finally {
        setIsLoadingReviewCandidates(false);
      }
    },
    [trip.id, fundingCandidatesPageSize],
  );

  const handleSearchFundingCandidates = async () => {
    try {
      await loadFundingCandidates(1, fundingSearch);
    } catch (error) {
      showModal(
        "error",
        "Failed to Search Candidates",
        error instanceof Error
          ? error.message
          : "Unable to load funding candidates.",
      );
    }
  };

  const handleFundingCandidatesPageChange = async (nextPage: number) => {
    const totalPages = Math.max(
      1,
      Math.ceil(fundingCandidatesTotal / fundingCandidatesPageSize),
    );
    if (
      nextPage < 1 ||
      nextPage > totalPages ||
      nextPage === fundingCandidatesPage
    ) {
      return;
    }

    try {
      await loadFundingCandidates(nextPage, fundingSearch);
    } catch (error) {
      showModal(
        "error",
        "Failed to Load Page",
        error instanceof Error
          ? error.message
          : "Unable to load funding candidates.",
      );
    }
  };

  const handleSearchReviewCandidates = async () => {
    try {
      await loadReviewCandidates(1, reviewSearch);
    } catch (error) {
      showModal(
        "error",
        "Failed to Search Matches",
        error instanceof Error
          ? error.message
          : "Unable to load review candidates.",
      );
    }
  };

  const handleReviewCandidatesPageChange = async (nextPage: number) => {
    const totalPages = Math.max(
      1,
      Math.ceil(reviewCandidatesTotal / fundingCandidatesPageSize),
    );
    if (
      nextPage < 1 ||
      nextPage > totalPages ||
      nextPage === reviewCandidatesPage
    ) {
      return;
    }
    try {
      await loadReviewCandidates(nextPage, reviewSearch);
    } catch (error) {
      showModal(
        "error",
        "Failed to Load Page",
        error instanceof Error
          ? error.message
          : "Unable to load review candidates.",
      );
    }
  };

  const handleReviewFundingMatch = async (
    action: "accept" | "reject" | "replace",
  ) => {
    if (!selectedReviewFundingId) {
      showModal(
        "warning",
        "No Funding Selected",
        "Select a suggested funding to review.",
      );
      return;
    }

    const replacementId =
      action === "replace"
        ? Array.from(selectedReviewReplacementIds)[0] || null
        : null;

    if (action === "replace" && !replacementId) {
      showModal(
        "warning",
        "Replacement Required",
        "Select a bank transaction to replace the suggested match.",
      );
      return;
    }

    setIsBusy(true);
    try {
      await reviewTripFundingMatch(trip.id, selectedReviewFundingId, {
        action,
        bankTransactionId: replacementId,
      });
      await refreshFundingsAndWallets();
      await loadReviewCandidates(1, reviewSearch);
      showModal("success", "Match Reviewed", "Funding match review saved.");
    } catch (error) {
      showModal(
        "error",
        "Review Failed",
        error instanceof Error
          ? error.message
          : "Unable to review funding match.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleMergeImportedFunding = async () => {
    if (!selectedReviewFundingId) {
      showModal(
        "warning",
        "No Funding Selected",
        "Select an imported topup to merge.",
      );
      return;
    }
    if (!mergeTargetFundingId) {
      showModal(
        "warning",
        "No Merge Target",
        "Select an existing funding row to merge into.",
      );
      return;
    }

    setIsBusy(true);
    try {
      await mergeTripFunding(
        trip.id,
        selectedReviewFundingId,
        mergeTargetFundingId,
      );
      setMergeTargetFundingId("");
      await refreshFundingsAndWallets();
      await loadReviewCandidates(1, reviewSearch);
      showModal(
        "success",
        "Merged",
        "Imported topup merged into existing funding.",
      );
    } catch (error) {
      showModal(
        "error",
        "Merge Failed",
        error instanceof Error
          ? error.message
          : "Unable to merge funding rows.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    if (!isFundingModalOpen || manualFunding) return;
    void loadFundingCandidates(1, fundingSearch);
  }, [isFundingModalOpen, manualFunding, loadFundingCandidates]);

  useEffect(() => {
    if (!isFundingModalOpen) return;
    if (viewMode === "funding") {
      setFundingModalTab(manualFunding ? "manual" : "bank");
      return;
    }
    if (pendingAutoMatchedFundings.length > 0) {
      setFundingModalTab("review");
      return;
    }
    setFundingModalTab(manualFunding ? "manual" : "bank");
  }, [
    isFundingModalOpen,
    pendingAutoMatchedFundings.length,
    manualFunding,
    viewMode,
  ]);

  useEffect(() => {
    if (viewMode === "funding") return;
    if (!isFundingModalOpen || pendingAutoMatchedFundings.length === 0) return;
    void loadReviewCandidates(1, reviewSearch);
  }, [
    isFundingModalOpen,
    pendingAutoMatchedFundings.length,
    loadReviewCandidates,
    reviewSearch,
    viewMode,
  ]);

  useEffect(() => {
    if (viewMode === "funding") return;
    if (!isFundingModalOpen) return;
    if (pendingAutoMatchedFundings.length === 0) {
      setSelectedReviewFundingId("");
      setSelectedReviewReplacementIds(new Set());
      return;
    }
    const hasSelected = pendingAutoMatchedFundings.some(
      (item) => item.id === selectedReviewFundingId,
    );
    if (!hasSelected) {
      setSelectedReviewFundingId(pendingAutoMatchedFundings[0]?.id || "");
    }
  }, [
    isFundingModalOpen,
    pendingAutoMatchedFundings,
    selectedReviewFundingId,
    viewMode,
  ]);

  useEffect(() => {
    if (!selectedReviewFundingId) return;
    const selected = pendingAutoMatchedFundings.find(
      (item) => item.id === selectedReviewFundingId,
    );
    const metadata =
      selected?.metadata && typeof selected.metadata === "object"
        ? (selected.metadata as Record<string, unknown>)
        : {};
    const suggestedId =
      typeof metadata.autoMatchedBankTransactionId === "string"
        ? metadata.autoMatchedBankTransactionId
        : "";

    setSelectedReviewReplacementIds(
      suggestedId ? new Set([suggestedId]) : new Set(),
    );
    setMergeTargetFundingId("");
  }, [selectedReviewFundingId, pendingAutoMatchedFundings]);

  useEffect(() => {
    if (viewMode === "funding" && fundingModalTab === "review") {
      setFundingModalTab("bank");
      setManualFunding(false);
    }
  }, [viewMode, fundingModalTab]);

  useEffect(() => {
    if (!selectedFundingListId) return;
    const pending = pendingAutoMatchedFundings.some(
      (item) => item.id === selectedFundingListId,
    );
    if (pending) {
      setFundingModalTab("review");
      setSelectedReviewFundingId(selectedFundingListId);
    }
  }, [selectedFundingListId, pendingAutoMatchedFundings]);

  useEffect(() => {
    if (viewMode !== "funding") return;
    setSelectedFundingManageIds((prev) => {
      const validIds = new Set(fundings.map((item) => item.id));
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id);
      });
      return next;
    });
  }, [fundings, viewMode]);

  const loadSourceCandidates = useCallback(
    async (nextPage: number, searchValue: string) => {
      setIsLoadingSourceCandidates(true);
      try {
        const candidates = await getSourceTransactionCandidates(trip.id, {
          search: searchValue || undefined,
          limit: sourceCandidatesPageSize,
          offset: (nextPage - 1) * sourceCandidatesPageSize,
        });
        setSourceCandidates(candidates.transactions || []);
        setSourceCandidatesTotal(candidates.total || 0);
        setSourceCandidatesPage(nextPage);
      } finally {
        setIsLoadingSourceCandidates(false);
      }
    },
    [trip.id],
  );

  const handleSearchSourceCandidates = async () => {
    try {
      await loadSourceCandidates(1, sourceSearch);
    } catch (error) {
      showModal(
        "error",
        "Failed to Search Transactions",
        error instanceof Error
          ? error.message
          : "Unable to load bank ledger transactions.",
      );
    }
  };

  const handleSourceCandidatesPageChange = async (nextPage: number) => {
    const totalPages = Math.max(
      1,
      Math.ceil(sourceCandidatesTotal / sourceCandidatesPageSize),
    );
    if (
      nextPage < 1 ||
      nextPage > totalPages ||
      nextPage === sourceCandidatesPage
    ) {
      return;
    }

    try {
      await loadSourceCandidates(nextPage, sourceSearch);
    } catch (error) {
      showModal(
        "error",
        "Failed to Load Page",
        error instanceof Error
          ? error.message
          : "Unable to load bank ledger transactions.",
      );
    }
  };

  useEffect(() => {
    if (!isAddFromMainModalOpen) return;
    void loadSourceCandidates(1, sourceSearch);
  }, [isAddFromMainModalOpen, loadSourceCandidates]);

  const handleCreateWallet = async () => {
    if (!walletForm.name.trim() || !walletForm.currency) return;
    setIsBusy(true);
    try {
      const wallet = await createWallet(trip.id, {
        name: walletForm.name.trim(),
        currency: walletForm.currency,
        color: walletForm.color,
      });
      setSelectedWalletId(wallet.id);
      setWalletForm({
        name: "",
        currency: trip.baseCurrency,
        color: getRandomWalletColor(),
      });
      await refreshFundingsAndWallets();
    } catch (error) {
      showModal(
        "error",
        "Wallet Creation Failed",
        error instanceof Error ? error.message : "Failed to create wallet.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const buildFeeAmount = (sourceAmount: number) => {
    if (fundingForm.feeMode === "amount") {
      const amount = Number(fundingForm.feeValue || 0);
      return amount > 0 ? amount : null;
    }
    if (fundingForm.feeMode === "percent") {
      const percent = Number(fundingForm.feeValue || 0);
      return percent > 0 ? (sourceAmount * percent) / 100 : null;
    }
    return null;
  };

  const resolveDestinationAmount = (sourceAmount: number) => {
    if (fundingInputMode === "fxRate") {
      const fx = Number(fundingForm.fxRate || 0);
      if (!(fx > 0)) {
        throw new Error(
          "FX rate must be greater than 0 when using FX rate mode.",
        );
      }
      return sourceAmount / fx;
    }
    const amount = Number(fundingForm.destinationAmount || 0);
    return amount > 0 ? amount : sourceAmount;
  };

  const handleLinkFunding = async () => {
    setIsBusy(true);
    try {
      const traceBuffer: Array<TripPropagationTrace | TripPropagationTrace[]> = [];
      if (
        !manualFunding &&
        !isFundingModalOpen &&
        selectedImportedFundingForAttach &&
        selectedFundingFromList
      ) {
        const selected = fundingCandidates.filter((candidate) =>
          selectedFundingIds.has(candidate.id),
        );
        if (selected.length !== 1) {
          throw new Error(
            "Select exactly one bank transaction to link to the selected imported funding.",
          );
        }
        await reviewTripFundingMatch(trip.id, selectedFundingFromList.id, {
          action: "replace",
          bankTransactionId: selected[0].id,
        });
      } else if (manualFunding) {
        if (!selectedWalletId) return;
        if (!selectedFundingWallet) return;
        const sourceAmount = Number(fundingForm.sourceAmount || 0);
        if (!(sourceAmount > 0)) {
          throw new Error(
            "Manual funding needs a source amount greater than 0.",
          );
        }
        const sourceCurrency = fundingForm.sourceCurrency || trip.baseCurrency;
        const destinationAmount = resolveDestinationAmount(sourceAmount);
        const destinationCurrency = selectedFundingWallet.currency;
        const fxRate =
          String(sourceCurrency).toUpperCase() ===
          String(destinationCurrency).toUpperCase()
            ? 1
            : sourceAmount > 0
              ? sourceAmount / destinationAmount
              : null;
        const result = await createTripFunding(trip.id, {
          walletId: selectedWalletId,
          bankTransactionId: null,
          sourceType: "manual",
          sourceCurrency,
          sourceAmount,
          destinationCurrency,
          destinationAmount,
          fxRate,
          feeAmount: buildFeeAmount(sourceAmount),
          feeCurrency:
            fundingForm.feeMode === "none"
              ? null
              : fundingForm.feeCurrency || trip.baseCurrency,
        });
        if (result.propagationTrace) {
          traceBuffer.push(result.propagationTrace);
        }
      } else {
        if (!selectedWalletId) return;
        if (!selectedFundingWallet) return;
        const selected = fundingCandidates.filter((candidate) =>
          selectedFundingIds.has(candidate.id),
        );
        if (selected.length === 0) {
          throw new Error("Select at least one bank transaction to link.");
        }

        const results = await Promise.all(
          selected.map(async (candidate) => {
            const sourceAmount = Math.abs(
              Number(candidate.amountOut ?? candidate.amountIn ?? 0),
            );
            const sourceCurrency =
              fundingForm.sourceCurrency || trip.baseCurrency;
            const destinationAmount = resolveDestinationAmount(sourceAmount);
            const destinationCurrency = selectedFundingWallet.currency;
            const fxRate =
              String(sourceCurrency).toUpperCase() ===
              String(destinationCurrency).toUpperCase()
                ? 1
                : sourceAmount > 0
                  ? sourceAmount / destinationAmount
                  : null;
            return createTripFunding(trip.id, {
              walletId: selectedWalletId,
              bankTransactionId: candidate.id,
              sourceType: "transfer",
              sourceCurrency,
              sourceAmount,
              destinationCurrency,
              destinationAmount,
              fxRate,
              feeAmount: buildFeeAmount(sourceAmount),
              feeCurrency:
                fundingForm.feeMode === "none"
                  ? null
                  : fundingForm.feeCurrency || trip.baseCurrency,
            });
          }),
        );
        results.forEach((result) => {
          if (result.propagationTrace) {
            traceBuffer.push(result.propagationTrace);
          }
        });
      }

      if (traceBuffer.length === 1) {
        setPropagationTrace(traceBuffer[0]);
      } else if (traceBuffer.length > 1) {
        setPropagationTrace(
          traceBuffer.flatMap((item) => (Array.isArray(item) ? item : [item])),
        );
      }

      setSelectedFundingIds(new Set());
      setFundingForm({
        sourceCurrency: trip.baseCurrency,
        sourceAmount: "",
        destinationAmount: "",
        fxRate: "",
        feeMode: "none",
        feeValue: "",
        feeCurrency: trip.baseCurrency,
      });
      setFundingInputMode("amount");
      await refreshFundingsAndWallets();
      showModal(
        "success",
        "Funding Linked",
        selectedImportedFundingForAttach
          ? "Selected imported funding was linked to a bank transaction."
          : "Trip funding was linked successfully.",
      );
      setIsFundingModalOpen(false);
    } catch (error) {
      showModal(
        "error",
        "Funding Link Failed",
        error instanceof Error ? error.message : "Failed to link funding.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleOpenEditFunding = (fundingId: string) => {
    const funding = fundings.find((item) => item.id === fundingId);
    if (!funding) return;
    const linkedWallet = wallets.find((wallet) => wallet.id === funding.walletId);
    const destinationCurrency =
      linkedWallet?.currency || funding.destinationCurrency || trip.baseCurrency;
    setEditingFundingId(funding.id);
    setEditingFundingForm({
      walletId: funding.walletId || "",
      sourceCurrency: funding.sourceCurrency || trip.baseCurrency,
      sourceAmount: String(funding.sourceAmount ?? ""),
      destinationCurrency,
      destinationAmount: String(funding.destinationAmount ?? ""),
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

  const handleSaveEditFunding = async () => {
    if (!editingFundingId) return;
    const funding = editingFundingItem;
    if (!funding) return;

    const isBankLinked = !!funding.bankTransactionId;
    const selectedWallet =
      wallets.find((wallet) => wallet.id === editingFundingForm.walletId) || null;
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

    let normalized;
    try {
      normalized = normalizeFundingEditInput({
        sourceCurrency,
        sourceAmount,
        destinationCurrency,
        destinationAmountInput: Number(editingFundingForm.destinationAmount || 0),
        fxRateInput: Number(editingFundingForm.fxRate || 0),
        inputMode: editingFundingInputMode,
        feeAmount: Number(editingFundingForm.feeAmount || 0),
        feeCurrency: editingFundingForm.feeCurrency || sourceCurrency,
      });
    } catch (error) {
      showModal(
        "warning",
        "Invalid Funding",
        error instanceof Error ? error.message : "Invalid funding values.",
      );
      return;
    }

    setIsBusy(true);
    try {
      const result = await updateTripFunding(trip.id, editingFundingId, {
        walletId: editingFundingForm.walletId || null,
        sourceCurrency: normalized.sourceCurrency,
        sourceAmount: normalized.sourceAmount,
        destinationCurrency: normalized.destinationCurrency,
        destinationAmount: normalized.destinationAmount,
        fxRate: normalized.fxRate,
        feeAmount: normalized.feeAmount,
        feeCurrency: normalized.feeCurrency,
      });
      setPropagationTrace(result.propagationTrace || null);
      await refreshFundingsAndWallets();
      setIsEditFundingModalOpen(false);
      showModal(
        "success",
        "Funding Updated",
        "Funding was updated successfully.",
      );
    } catch (error) {
      showModal(
        "error",
        "Update Failed",
        error instanceof Error ? error.message : "Unable to update funding.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteFunding = async (fundingId: string) => {
    setIsBusy(true);
    try {
      const result = await deleteTripFunding(trip.id, fundingId);
      setPropagationTrace(result.propagationTrace || null);
      await refreshFundingsAndWallets();
      showModal("success", "Funding Deleted", "Funding source removed.");
    } catch (error) {
      showModal(
        "error",
        "Delete Failed",
        error instanceof Error ? error.message : "Unable to delete funding.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleBulkDeleteFundings = async () => {
    if (selectedFundingManageIds.size === 0) return;
    setIsBusy(true);
    try {
      const results = await Promise.all(
        Array.from(selectedFundingManageIds).map((id) =>
          deleteTripFunding(trip.id, id),
        ),
      );
      const traces = results
        .map((result) => result.propagationTrace)
        .filter((trace): trace is TripPropagationTrace => Boolean(trace));
      if (traces.length > 0) {
        setPropagationTrace(traces);
      }
      setSelectedFundingManageIds(new Set());
      setSelectedFundingManagePrimaryId("");
      await refreshFundingsAndWallets();
      showModal(
        "success",
        "Fundings Deleted",
        "Selected funding sources were removed.",
      );
    } catch (error) {
      showModal(
        "error",
        "Delete Failed",
        error instanceof Error
          ? error.message
          : "Unable to delete selected funding rows.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const toggleFundingManageSelection = (id: string) => {
    setSelectedFundingManageIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setSelectedFundingManagePrimaryId(id);
  };

  const handleAttachBankToSelectedFunding = async () => {
    const activeFunding =
      viewMode === "funding"
        ? selectedFundingManageItem
        : selectedFundingFromList;
    if (!activeFunding) {
      showModal(
        "warning",
        "No Funding Selected",
        "Select a funding row on the left first.",
      );
      return;
    }
    const activeIsImportedTopup =
      activeFunding.sourceType === "imported_topup" &&
      !activeFunding.bankTransactionId;
    if (!activeIsImportedTopup) {
      showModal(
        "warning",
        "Funding Already Linked",
        "Only imported topup fundings without a linked bank transaction can be attached here.",
      );
      return;
    }

    const selected = fundingCandidates.filter((candidate) =>
      selectedFundingIds.has(candidate.id),
    );
    if (selected.length !== 1) {
      showModal(
        "warning",
        "Select One Transaction",
        "Select exactly one bank transaction to link.",
      );
      return;
    }

    setIsBusy(true);
    try {
      await reviewTripFundingMatch(trip.id, activeFunding.id, {
        action: "replace",
        bankTransactionId: selected[0].id,
      });
      setSelectedFundingIds(new Set());
      await refreshFundingsAndWallets();
      showModal(
        "success",
        "Linked",
        "Funding linked to selected bank transaction.",
      );
    } catch (error) {
      showModal(
        "error",
        "Link Failed",
        error instanceof Error ? error.message : "Unable to link funding.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const applyFilters = useCallback(
    async (nextFilters: EntryFilters) => {
      setIsBusy(true);
      try {
        setPage(1);
        await refreshEntries(1, nextFilters);
      } finally {
        setIsBusy(false);
      }
    },
    [refreshEntries],
  );

  const handleAddTripCategory = async (name: string, color: string) => {
    try {
      const nextCategory = await createCategory(name, color);
      setLocalCategories((prev) => [...prev, nextCategory]);
      showModal("success", "Category Added", "Trip category created.");
    } catch (error) {
      showModal(
        "error",
        "Failed to Add Category",
        error instanceof Error ? error.message : "Could not add category.",
      );
    }
  };

  const handleAddFromBankLedger = async () => {
    if (selectedSourceIds.size === 0) {
      showModal(
        "warning",
        "No Transactions Selected",
        "Select at least one transaction to add into this trip.",
      );
      return;
    }

    setIsBusy(true);
    try {
      const result = await addEntriesFromSourceTransactions(trip.id, {
        transactionIds: Array.from(selectedSourceIds),
        categoryId:
          sourceEntryType === "spending" ? sourceCategoryId || null : null,
        entryType: sourceEntryType,
      });

      await refreshEntries(1, filters);
      setPage(1);
      setSelectedSourceIds(new Set());
      setSourceCategoryId("");
      setSourceEntryType("spending");
      setIsAddFromMainModalOpen(false);
      showModal(
        "success",
        "Transactions Added",
        `${result.created} transaction${result.created === 1 ? "" : "s"} added to this trip.`,
      );
    } catch (error) {
      showModal(
        "error",
        "Failed to Add Transactions",
        error instanceof Error
          ? error.message
          : "Could not add selected bank transactions.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const resetManualEntryForm = () => {
    setManualEntryForm({
      walletId: "__none__",
      type: "spending",
      date: format(new Date(), "yyyy-MM-dd"),
      description: "",
      label: "",
      categoryId: "",
      localCurrency: trip.baseCurrency,
      localAmount: "",
      baseAmount: "",
      fxRate: "",
    });
  };

  const handleCreateManualEntry = async () => {
    const description = manualEntryForm.description.trim();
    if (!description) {
      showModal("warning", "Missing Description", "Description is required.");
      return;
    }

    const localAmount = Number(manualEntryForm.localAmount);
    if (!(localAmount > 0)) {
      showModal(
        "warning",
        "Invalid Spent Amount",
        "Enter a spent amount greater than 0.",
      );
      return;
    }

    const normalizedLocalCurrency = manualEntryForm.localCurrency
      .trim()
      .toUpperCase();
    if (!normalizedLocalCurrency) {
      showModal("warning", "Missing Currency", "Spent currency is required.");
      return;
    }

    const fxRateValue = manualEntryForm.fxRate
      ? Number(manualEntryForm.fxRate)
      : null;
    if (fxRateValue !== null && !(fxRateValue > 0)) {
      showModal(
        "warning",
        "Invalid FX Rate",
        "FX rate must be greater than 0.",
      );
      return;
    }

    let baseAmount = Number(manualEntryForm.baseAmount);
    if (!(baseAmount > 0)) {
      if (normalizedLocalCurrency === trip.baseCurrency) {
        baseAmount = localAmount;
      } else if (fxRateValue !== null) {
        baseAmount = localAmount * fxRateValue;
      }
    }
    if (!(baseAmount > 0)) {
      showModal(
        "warning",
        "Invalid Base Amount",
        `Enter a base amount greater than 0 (${trip.baseCurrency}).`,
      );
      return;
    }

    setIsBusy(true);
    try {
      await createTripEntry(trip.id, {
        walletId:
          manualEntryForm.walletId === "__none__"
            ? null
            : manualEntryForm.walletId,
        type: manualEntryForm.type,
        date: manualEntryForm.date,
        description,
        label: manualEntryForm.label.trim() || null,
        categoryId:
          manualEntryForm.type === "spending"
            ? manualEntryForm.categoryId || null
            : null,
        localCurrency: normalizedLocalCurrency,
        localAmount,
        baseAmount,
        fxRate: fxRateValue,
        feeAmount: null,
        feeCurrency: null,
        metadata: {
          source: "manual_trip_entry_modal",
        },
      });

      await Promise.all([
        refreshEntries(1, filters),
        refreshFundingsAndWallets(),
      ]);
      setPage(1);
      setIsManualEntryModalOpen(false);
      resetManualEntryForm();
      showModal(
        "success",
        "Transaction Added",
        "Manual trip transaction created.",
      );
    } catch (error) {
      showModal(
        "error",
        "Failed to Add Transaction",
        error instanceof Error
          ? error.message
          : "Could not create manual trip entry.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleChangePage = async (nextPage: number) => {
    if (nextPage < 1 || nextPage > totalPages) return;
    setIsBusy(true);
    try {
      setPage(nextPage);
      await refreshEntries(nextPage, filters);
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        bulkMenuRef.current &&
        !bulkMenuRef.current.contains(event.target as Node)
      ) {
        setShowBulkMenu(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!hasInitializedFilters.current) {
      hasInitializedFilters.current = true;
      return;
    }

    const timer = window.setTimeout(() => {
      clearEntrySelection();
      void applyFilters(filters);
    }, 220);

    return () => window.clearTimeout(timer);
  }, [filters, applyFilters]);

  const handleBulkDeleteEntries = async () => {
    if (selectedCount === 0) return;

    try {
      setBulkLoading(true);
      if (allFilteredSelected) {
        await bulkDeleteTripEntriesByFilter(
          trip.id,
          buildEntryFilterPayload(),
          Array.from(deselectedEntryIds),
        );
      } else {
        await bulkDeleteTripEntriesByIds(trip.id, Array.from(selectedEntryIds));
      }
      clearEntrySelection();
      await Promise.all([
        refreshEntries(page, filters),
        refreshFundingsAndWallets(),
      ]);
      showModal(
        "success",
        "Deleted",
        "Trip transactions deleted successfully.",
      );
    } catch (error) {
      showModal(
        "error",
        "Delete Failed",
        error instanceof Error
          ? error.message
          : "Unable to delete trip transactions.",
      );
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkCategoryUpdateEntries = async () => {
    if (!bulkCategoryId || selectedCount === 0) return;
    try {
      setBulkLoading(true);
      if (allFilteredSelected) {
        await bulkUpdateTripEntriesByFilter(
          trip.id,
          buildEntryFilterPayload(),
          Array.from(deselectedEntryIds),
          { categoryId: bulkCategoryId },
        );
      } else {
        await bulkUpdateTripEntriesByIds(
          trip.id,
          Array.from(selectedEntryIds),
          { categoryId: bulkCategoryId },
        );
      }
      setBulkCategoryId("");
      clearEntrySelection();
      await refreshEntries(page, filters);
      showModal("success", "Updated", "Trip categories updated.");
    } catch (error) {
      showModal(
        "error",
        "Update Failed",
        error instanceof Error ? error.message : "Unable to update categories.",
      );
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkDateUpdateEntries = async () => {
    if (!bulkDate || selectedCount === 0) return;
    try {
      setBulkLoading(true);
      if (allFilteredSelected) {
        await bulkUpdateTripEntriesByFilter(
          trip.id,
          buildEntryFilterPayload(),
          Array.from(deselectedEntryIds),
          { date: bulkDate },
        );
      } else {
        await bulkUpdateTripEntriesByIds(
          trip.id,
          Array.from(selectedEntryIds),
          { date: bulkDate },
        );
      }
      setBulkDate("");
      clearEntrySelection();
      await refreshEntries(page, filters);
      showModal("success", "Updated", "Trip dates updated.");
    } catch (error) {
      showModal(
        "error",
        "Update Failed",
        error instanceof Error ? error.message : "Unable to update dates.",
      );
    } finally {
      setBulkLoading(false);
    }
  };

  const handleStartTripImportReview = async () => {
    if (!selectedFile || !importForm.parserId) return;
    const isRevolutParser = importForm.parserId === "revolut_statement";
    setIsBusy(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("parserId", importForm.parserId);
      if (isRevolutParser && supplementalFile) {
        formData.append("supplementalFile", supplementalFile);
      }
      const parsed = (await parseFile(formData)) as ImportParseResult;

      const normalized = (parsed.transactions || []).map((tx) => {
        const metadata =
          tx.metadata && typeof tx.metadata === "object"
            ? { ...(tx.metadata as Record<string, unknown>) }
            : {};
        const transactionType = String(metadata.transactionType || "").toLowerCase();
        const amountIn = Number(tx.amountIn ?? 0) || 0;
        const amountOut = Number(tx.amountOut ?? 0) || 0;
        const netTopupAmount =
          amountIn > 0 ? Math.max(0, amountIn - amountOut) : 0;
        const topupCurrency = String(
          metadata.currency || trip.baseCurrency,
        ).toUpperCase();
        const defaultTopupLabel =
          transactionType === "topup" && netTopupAmount > 0
            ? `Top up of (${topupCurrency}) ${netTopupAmount.toFixed(2)}`
            : undefined;
        const fundingInDisabled = metadata.fundingInDisabled === true;

        return {
          ...tx,
          label:
            tx.label && tx.label.trim().length > 0
              ? tx.label
              : defaultTopupLabel,
          entryTypeOverride:
            tx.entryTypeOverride ||
            (transactionType === "topup" && !fundingInDisabled
              ? "funding_in"
              : undefined),
          metadata,
        };
      });

      setTripImportParsedData(parsed);
      setTripImportEditedTransactions(normalized);
      setTripImportSelectedIndices(
        new Set(normalized.map((_, index) => index)),
      );
      setTripImportStep("review");
    } catch (error) {
      showModal(
        "error",
        "Parse Failed",
        error instanceof Error ? error.message : "Failed to parse statement.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleTripImportUpdateTransaction = (
    index: number,
    field: string,
    value: unknown,
  ) => {
    setTripImportEditedTransactions((prev) => {
      const next = [...prev];
      const nextRow = { ...next[index], [field]: value };
      if (field === "label") {
        nextRow.suggestedLabel = undefined;
      }
      if (field === "categoryId") {
        nextRow.suggestedCategoryId = undefined;
      }
      next[index] = nextRow;
      return next;
    });
  };

  const handleTripImportSelectAll = () => {
    setTripImportSelectedIndices(
      new Set(tripImportEditedTransactions.map((_, index) => index)),
    );
  };

  const handleTripImportDeselectAll = () => {
    setTripImportSelectedIndices(new Set());
  };

  const handleTripImportSelectVisible = (indices: number[]) => {
    setTripImportSelectedIndices((prev) => {
      const next = new Set(prev);
      indices.forEach((index) => next.add(index));
      return next;
    });
  };

  const handleTripImportDeselectVisible = (indices: number[]) => {
    setTripImportSelectedIndices((prev) => {
      const next = new Set(prev);
      indices.forEach((index) => next.delete(index));
      return next;
    });
  };

  const handleTripImportToggleSelection = (index: number) => {
    setTripImportSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleCommitTripImportReview = async () => {
    if (tripImportSelectedIndices.size === 0) {
      showModal(
        "warning",
        "No Transactions Selected",
        "Select at least one row to import.",
      );
      return;
    }

    setIsBusy(true);
    try {
      const selectedTransactions = Array.from(tripImportSelectedIndices)
        .sort((a, b) => a - b)
        .map((index) => tripImportEditedTransactions[index]);

      const result = await importTripSpendings(
        trip.id,
        {
          walletId: importForm.walletId || null,
          parserId: importForm.parserId,
        },
        selectedTransactions.map((tx) => ({
          date: tx.date,
          description: tx.description,
          label: tx.label,
          categoryId: tx.categoryId,
          amountIn: tx.amountIn ?? undefined,
          amountOut: tx.amountOut ?? undefined,
          metadata: tx.metadata,
        })),
      );
      setImportResult(result);
      const [, nextFundings] = await Promise.all([
        refreshEntries(page, filters),
        refreshFundingsAndWallets(),
      ]);
      setSelectedFile(null);
      setSupplementalFile(null);
      setTripImportParsedData(null);
      setTripImportEditedTransactions([]);
      setTripImportSelectedIndices(new Set());
      setTripImportStep("setup");

      const pendingReviewCount = (nextFundings || []).filter((item) => {
        const metadata =
          item.metadata && typeof item.metadata === "object"
            ? (item.metadata as Record<string, unknown>)
            : {};
        return (
          item.sourceType === "imported_topup" &&
          !item.bankTransactionId &&
          typeof metadata.autoMatchedBankTransactionId === "string" &&
          metadata.autoMatchedBankTransactionId.length > 0 &&
          (typeof metadata.matchReviewStatus === "string"
            ? metadata.matchReviewStatus === "pending"
            : true)
        );
      }).length;

      if (pendingReviewCount > 0) {
        showModal(
          "info",
          "Import Complete",
          `Imported successfully. ${pendingReviewCount} funding match${
            pendingReviewCount > 1 ? "es" : ""
          } require review.`,
        );
        setIsFundingModalOpen(true);
      } else {
        showModal(
          "success",
          "Import Complete",
          "Trip statement imported successfully.",
        );
      }
      setIsImportModalOpen(false);
    } catch (error) {
      showModal(
        "error",
        "Import Failed",
        error instanceof Error ? error.message : "Failed to import statement.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div
      className={
        viewMode === "funding"
          ? "h-full min-h-0 w-full max-w-full overflow-x-hidden"
          : "grid h-full min-h-0 w-full max-w-full overflow-x-hidden gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]"
      }
    >
      {viewMode === "manage" && (
        <aside className="lg:order-2 min-h-0 min-w-0 w-full max-w-full overflow-hidden overflow-x-hidden flex flex-col lg:h-[calc(100vh-11rem)] lg:w-[22rem] lg:max-w-[22rem] lg:flex-none">
          <div className="grid h-full min-h-0 min-w-0 flex-1 gap-4 overflow-x-hidden lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-h-0 min-w-0 w-full max-w-full flex flex-col gap-2">
              <div className="flex min-w-0 w-full max-w-full items-center justify-between gap-2 px-1">
                <h3 className="truncate text-sm font-semibold text-dark dark:text-white">
                  Funding Sources
                </h3>
                <Link
                href={`/trips/${trip.id}/manage/funding`}
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-stroke bg-white px-3 text-xs font-medium text-dark transition-colors visited:text-dark hover:bg-gray-2 dark:border-dark-3 dark:bg-dark-3 dark:text-white dark:visited:text-white dark:hover:bg-dark-2"
                >
                  <Link2 className="h-4 w-4" />
                  <span>Manage</span>
                </Link>
              </div>
              <Card className="min-h-0 min-w-0 w-full max-w-full flex-1 rounded-lg p-0 overflow-hidden">
                <CardContent className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden p-3 space-y-2">
                  {fundings.length === 0 && (
                    <div className="rounded-lg border border-dashed border-stroke dark:border-dark-3 px-3 py-4 text-sm text-dark-5 dark:text-dark-6">
                      No linked funding yet.
                    </div>
                  )}
                  {fundings.map((item) => (
                    <div
                      key={item.id}
                      className="min-w-0 overflow-hidden rounded-lg border border-stroke dark:border-dark-3 px-3 py-2.5 text-xs bg-white dark:bg-dark-2"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-dark dark:text-white truncate">
                            {item.bankTransaction?.description ||
                              String(
                                item.metadata?.originalDescription || "",
                              ).trim() ||
                              "Manual funding"}
                          </div>
                          <div className="mt-1 text-dark-5 dark:text-dark-6 truncate">
                            {(item.createdAt
                              ? format(new Date(item.createdAt), "dd MMM yyyy")
                              : item.bankTransaction?.date
                                ? format(
                                    new Date(item.bankTransaction.date),
                                    "dd MMM yyyy",
                                  )
                                : "-") + " • "}
                            {item.destinationCurrency}
                          </div>
                        </div>
                        <div className="max-w-[45%] shrink-0 truncate text-right font-semibold text-green">
                          +{formatCurrencyValue(item.destinationAmount)}
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <div className="min-h-0 min-w-0 w-full max-w-full flex flex-col gap-2">
              <div className="flex min-w-0 w-full max-w-full items-center justify-between gap-2 px-1">
                <h3 className="truncate text-sm font-semibold text-dark dark:text-white">
                  Wallets
                </h3>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsWalletModalOpen(true)}
                  leftIcon={<WalletCards className="h-4 w-4" />}
                  className="shrink-0 whitespace-nowrap"
                >
                  Manage
                </Button>
              </div>
              <Card className="min-h-0 min-w-0 w-full max-w-full flex-1 rounded-lg p-0 overflow-hidden">
                <CardContent className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden p-3 space-y-2">
                  {walletSummaries.length === 0 && (
                    <div className="rounded-lg border border-dashed border-stroke dark:border-dark-3 px-3 py-4 text-sm text-dark-5 dark:text-dark-6">
                      No wallets yet.
                    </div>
                  )}
                  {walletSummaries.map((wallet) => (
                    <div
                      key={wallet.id}
                      className="min-w-0 overflow-hidden rounded-lg border border-stroke dark:border-dark-3 px-3 py-2.5"
                    >
                      <div className="truncate text-sm font-medium text-dark dark:text-white">
                        {wallet.name} ({wallet.currency})
                      </div>
                      <div className="mt-1 truncate text-xs text-dark-5 dark:text-dark-6">
                        {wallet.balances.length === 0
                          ? "No balance yet"
                          : wallet.balances
                              .map(
                                (balance) =>
                                  `${formatCurrencyValue(balance.amount)} ${balance.currency}`,
                              )
                              .join(" • ")}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </aside>
      )}

      {viewMode === "manage" && (
        <section className="min-w-0 space-y-4 lg:order-1">
          <TripPropagationTraceCard trace={propagationTrace} />

          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-dark dark:text-white">
                Trip Transactions
              </h2>
              <p className="text-xs text-dark-5 dark:text-dark-6">
                Imported, linked, and manual entries recorded for this trip.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setIsAddFromMainModalOpen(true)}
                leftIcon={<Link2 className="h-4 w-4" />}
              >
                Add From Bank Ledger
              </Button>
              <Button
                variant="secondary"
                onClick={() => setIsManualEntryModalOpen(true)}
                leftIcon={<Plus className="h-4 w-4" />}
              >
                Manual Entry
              </Button>
              <Link
                href={`/trips/${trip.id}/import`}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white visited:text-white transition-colors hover:bg-primary/90"
              >
                <FileUp className="h-4 w-4" />
                <span>Import Trip Statement</span>
              </Link>
            </div>
          </div>

          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={entriesTotal}
              itemsPerPage={pageSize}
              onPageChange={handleChangePage}
              compact
              className="pt-1"
            />
            {importResult && (
              <div className="inline-flex items-center gap-1 rounded-lg border border-stroke px-2.5 py-1.5 text-xs text-dark-5 dark:border-dark-3 dark:text-dark-6">
                <PlaneTakeoff className="h-3.5 w-3.5" />
                Imported {importResult.importedSpendings} spendings /{" "}
                {importResult.importedReimbursements} reimbursements
                {(importResult.importedFundings || 0) > 0 && (
                  <> / {importResult.importedFundings} fundings</>
                )}
                {(importResult.importedTransfers || 0) > 0 && (
                  <> / {importResult.importedTransfers} transfers</>
                )}
                {(importResult.importedFees || 0) > 0 && (
                  <> / {importResult.importedFees} fees</>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-3 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                Search
              </label>
              <SearchBar
                value={filters.search}
                onChange={(value) =>
                  setFilters((prev) => ({ ...prev, search: value }))
                }
                placeholder="Search label or description"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                Wallet
              </label>
              <Select
                value={filters.walletId}
                onChange={(value) =>
                  setFilters((prev) => ({ ...prev, walletId: value }))
                }
                className="w-full"
                buttonClassName="w-full"
                options={[
                  { value: "", label: "All wallets" },
                  ...wallets.map((wallet) => ({
                    value: wallet.id,
                    label: `${wallet.name} (${wallet.currency})`,
                  })),
                ]}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                Category
              </label>
              <div className="h-11 rounded-lg border border-stroke bg-white dark:border-dark-3 dark:bg-dark-2">
                <CategorySelect
                  value={filters.categoryId}
                  categories={localCategories}
                  onChange={(value) =>
                    setFilters((prev) => ({ ...prev, categoryId: value }))
                  }
                  onAddClick={() => setIsAddCategoryModalOpen(true)}
                  emptyLabel="All categories"
                  triggerProps={{
                    className:
                      "h-full rounded-lg border-0 bg-transparent px-3 py-0 hover:bg-transparent dark:hover:bg-transparent",
                  }}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                Start date
              </label>
              <div className="h-11 rounded-lg border border-stroke bg-white dark:border-dark-3 dark:bg-dark-2">
                <DatePicker
                  value={filters.dateFrom}
                  onChange={(value: string) =>
                    setFilters((prev) => ({ ...prev, dateFrom: value }))
                  }
                  className="h-full"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                End date
              </label>
              <div className="h-11 rounded-lg border border-stroke bg-white dark:border-dark-3 dark:bg-dark-2">
                <DatePicker
                  value={filters.dateTo}
                  onChange={(value: string) =>
                    setFilters((prev) => ({ ...prev, dateTo: value }))
                  }
                  className="h-full"
                />
              </div>
            </div>
          </div>

          {isBusy && (
            <div className="py-8 flex items-center justify-center text-dark-5 dark:text-dark-6">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading...
            </div>
          )}

          {!isBusy && tripTransactions.length === 0 && (
            <div className="text-sm text-dark-5 dark:text-dark-6 py-8 text-center">
              No trip transactions found for current filters.
            </div>
          )}

          {!isBusy && tripTransactions.length > 0 && (
            <>
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                totalItems={entriesTotal}
                itemsPerPage={pageSize}
                onPageChange={handleChangePage}
                compact
                leftContent={
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={
                        allFilteredSelected && deselectedEntryIds.size === 0
                      }
                      indeterminate={
                        allFilteredSelected && deselectedEntryIds.size > 0
                      }
                      onChange={(checked) => {
                        if (checked) {
                          setAllFilteredSelected(true);
                          setDeselectedEntryIds(new Set());
                          setSelectedEntryIds(new Set());
                        } else {
                          clearEntrySelection();
                        }
                      }}
                    />
                    <span className="text-sm font-medium text-dark dark:text-white">
                      Select all
                    </span>
                    <span className="text-xs text-dark-5 dark:text-dark-6">
                      {selectedCount} selected
                    </span>
                  </div>
                }
                rightContent={
                  <div className="relative" ref={bulkMenuRef}>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => void handleBulkDeleteEntries()}
                        disabled={selectedCount === 0 || bulkLoading}
                        title="Delete selected"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowBulkMenu((prev) => !prev)}
                        className="border border-stroke dark:border-dark-3"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </div>

                    {showBulkMenu && (
                      <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-stroke dark:border-dark-3 bg-white dark:bg-dark-2 shadow-dropdown p-3">
                        <div className="text-xs font-semibold text-dark-5 dark:text-dark-6 uppercase tracking-wide mb-2">
                          Bulk Actions
                        </div>

                        <div className="space-y-3">
                          <div className="space-y-2">
                            <Select
                              value={bulkCategoryId}
                              onChange={(value) => setBulkCategoryId(value)}
                              options={[
                                { value: "", label: "Set Category" },
                                ...localCategories.map((category) => ({
                                  value: category.id,
                                  label: category.name,
                                })),
                              ]}
                              className="w-full"
                              buttonClassName="w-full"
                            />
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                void handleBulkCategoryUpdateEntries()
                              }
                              disabled={
                                !bulkCategoryId ||
                                selectedCount === 0 ||
                                bulkLoading
                              }
                              className="w-full"
                            >
                              Apply Category
                            </Button>
                          </div>

                          <div className="space-y-2">
                            <div className="w-full h-11 rounded-lg border border-stroke dark:border-dark-3 bg-white dark:bg-dark-3">
                              <DatePicker
                                value={bulkDate}
                                onChange={(value) => setBulkDate(value)}
                                className="h-full"
                              />
                            </div>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => void handleBulkDateUpdateEntries()}
                              disabled={
                                !bulkDate || selectedCount === 0 || bulkLoading
                              }
                              className="w-full"
                            >
                              Apply Date
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                }
              />

              <ExpandableTransactionList
                transactions={tripTransactions}
                accentColorById={tripTransactions.reduce<Record<string, string>>(
                  (acc, transaction) => {
                    if (transaction.accentColor) {
                      acc[transaction.id] = transaction.accentColor;
                    }
                    return acc;
                  },
                  {},
                )}
                selectedIds={
                  allFilteredSelected
                    ? new Set(
                        tripTransactions
                          .filter(
                            (transaction) =>
                              !deselectedEntryIds.has(transaction.id),
                          )
                          .map((transaction) => transaction.id),
                      )
                    : selectedEntryIds
                }
                onToggleSelect={toggleEntrySelection}
              />
            </>
          )}
        </section>
      )}

      {viewMode === "funding" && (
        <section className="space-y-4 min-h-0">
          <TripPropagationTraceCard trace={propagationTrace} />

          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-dark dark:text-white">
                Funding Management
              </h2>
              <p className="text-xs text-dark-5 dark:text-dark-6">
                Select a funding row, then manage details and linkage.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Link2 className="h-4 w-4" />}
                onClick={() => {
                  setFundingModalTab("bank");
                  setManualFunding(false);
                  setIsFundingModalOpen(true);
                }}
              >
                Import From Bank
              </Button>
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => {
                  setFundingModalTab("manual");
                  setManualFunding(true);
                  setIsFundingModalOpen(true);
                }}
              >
                Add Manual Funding
              </Button>
            </div>
          </div>

          <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:h-[calc(100vh-14rem)]">
            <div className="min-h-0 flex flex-col rounded-lg border border-stroke dark:border-dark-3 bg-white dark:bg-dark-2">
              <div className="flex items-center justify-between gap-2 border-b border-stroke px-3 py-2 dark:border-dark-3">
                <div className="text-xs font-medium text-dark-5 dark:text-dark-6">
                  {selectedFundingManageCount} selected
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => void handleBulkDeleteFundings()}
                    disabled={selectedFundingManageCount === 0 || isBusy}
                  >
                    Delete selected
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {fundingTransactions.length === 0 ? (
                  <div className="text-sm text-dark-5 dark:text-dark-6 py-8 text-center rounded-lg">
                    No funding sources linked yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {fundings.map((item) => {
                      const selected = selectedFundingManageIds.has(item.id);
                      const displayDate =
                        item.createdAt ||
                        item.bankTransaction?.date ||
                        new Date().toISOString();
                      const displayDescription =
                        item.bankTransaction?.description ||
                        String(
                          (item.metadata as Record<string, unknown> | null)
                            ?.originalDescription || "",
                        ).trim() ||
                        "Funding";
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => toggleFundingManageSelection(item.id)}
                          className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                            selected
                              ? "border-primary bg-primary/5 dark:bg-primary/10"
                              : "border-stroke dark:border-dark-3 hover:bg-gray-1/50 dark:hover:bg-dark-3/40"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-dark dark:text-white">
                                {item.sourceType === "manual"
                                  ? "Manual Funding"
                                  : "Funding"}
                              </p>
                              <p className="mt-0.5 truncate text-xs text-dark-5 dark:text-dark-6">
                                {displayDescription}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold text-green">
                                +{formatCurrencyValue(item.destinationAmount)}
                              </p>
                              <p className="text-[11px] text-dark-5 dark:text-dark-6">
                                {item.destinationCurrency}
                              </p>
                            </div>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <p className="text-[11px] text-dark-5 dark:text-dark-6">
                              {format(new Date(displayDate), "dd MMM yyyy")}
                            </p>
                            <p className="truncate text-[11px] text-dark-5 dark:text-dark-6">
                              {item.wallet?.name || "No wallet"}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-stroke dark:border-dark-3 bg-white dark:bg-dark-2 p-4 space-y-4 min-h-0">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={
                    fundingDetailTab === "details" ? "primary" : "secondary"
                  }
                  size="sm"
                  onClick={() => setFundingDetailTab("details")}
                >
                  Details
                </Button>
                <Button
                  variant={
                    fundingDetailTab === "linkage" ? "primary" : "secondary"
                  }
                  size="sm"
                  onClick={() => setFundingDetailTab("linkage")}
                >
                  Linkage
                </Button>
              </div>

              {selectedFundingManageCount === 0 ? (
                <div className="rounded-lg border border-dashed border-stroke dark:border-dark-3 px-3 py-4 text-sm text-dark-5 dark:text-dark-6">
                  Select a funding row on the left to manage it.
                </div>
              ) : selectedFundingManageCount > 1 ? (
                <div className="rounded-lg border border-dashed border-stroke dark:border-dark-3 px-3 py-4 text-sm text-dark-5 dark:text-dark-6">
                  Multiple fundings selected. Select exactly one row to edit or
                  link.
                </div>
              ) : fundingDetailTab === "details" &&
                selectedFundingManageItem ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-stroke dark:border-dark-3 px-3 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                      Funding
                    </p>
                    <p className="mt-1 text-sm font-medium text-dark dark:text-white">
                      {selectedFundingManageItem.bankTransaction?.description ||
                        String(
                          (
                            selectedFundingManageItem.metadata as Record<
                              string,
                              unknown
                            > | null
                          )?.originalDescription || "Funding",
                        )}
                    </p>
                    <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                      {formatCurrencyValue(
                        selectedFundingManageItem.sourceAmount,
                      )}{" "}
                      {selectedFundingManageItem.sourceCurrency} →{" "}
                      {formatCurrencyValue(
                        selectedFundingManageItem.destinationAmount,
                      )}{" "}
                      {selectedFundingManageItem.destinationCurrency}
                    </p>
                    <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                      Type: {selectedFundingManageItem.sourceType}
                    </p>
                  </div>
                  <div className="rounded-lg border border-stroke dark:border-dark-3 px-3 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                      Linked bank transaction
                    </p>
                    {selectedFundingManageItem.bankTransaction ? (
                      <>
                        <p className="mt-1 text-sm text-dark dark:text-white">
                          {
                            selectedFundingManageItem.bankTransaction
                              .description
                          }
                        </p>
                        <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                          {new Date(
                            selectedFundingManageItem.bankTransaction.date,
                          ).toLocaleDateString("en-GB")}
                        </p>
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                        Not linked
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      onClick={() =>
                        handleOpenEditFunding(selectedFundingManageItem.id)
                      }
                    >
                      Edit Details
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() =>
                        void handleDeleteFunding(selectedFundingManageItem.id)
                      }
                      disabled={isBusy}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-lg border border-stroke dark:border-dark-3 px-3 py-2 text-xs text-dark-5 dark:text-dark-6">
                    {selectedFundingManageItem &&
                    selectedFundingManageItem.sourceType === "imported_topup" &&
                    !selectedFundingManageItem.bankTransactionId
                      ? "Select one bank transaction below to link to this imported topup."
                      : "Only imported topup fundings without linked bank transactions are linkable here."}
                  </div>
                  <div className="h-[360px] min-h-[260px] overflow-hidden">
                    <ExistingTransactionsSelector
                      className="h-full"
                      title="Bank Ledger Transactions"
                      searchPlaceholder="Search bank transactions..."
                      searchValue={fundingSearch}
                      onSearchValueChange={setFundingSearch}
                      onSearch={handleSearchFundingCandidates}
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
                      onToggleSelect={(id) =>
                        setSelectedFundingIds((prev) => {
                          if (prev.has(id)) return new Set();
                          return new Set([id]);
                        })
                      }
                      totalItems={fundingCandidatesTotal}
                      currentPage={fundingCandidatesPage}
                      pageSize={fundingCandidatesPageSize}
                      onPageChange={handleFundingCandidatesPageChange}
                      emptyMessage="No funding candidates found."
                    />
                  </div>
                  <Button
                    variant="primary"
                    onClick={() => void handleAttachBankToSelectedFunding()}
                    disabled={
                      isBusy ||
                      !selectedFundingManageItem ||
                      selectedFundingManageItem.sourceType !==
                        "imported_topup" ||
                      !!selectedFundingManageItem.bankTransactionId
                    }
                    className="w-full"
                  >
                    Link Selected Bank Transaction
                  </Button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {isFundingModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 p-4 flex items-center justify-center"
          onClick={() => setIsFundingModalOpen(false)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-4xl bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 shadow-card-2 max-h-[85vh] overflow-hidden flex flex-col"
          >
            <div className="px-6 py-4 border-b border-stroke dark:border-dark-3">
              <h3 className="text-lg font-semibold text-dark dark:text-white">
                {viewMode === "funding"
                  ? fundingModalTab === "manual"
                    ? "Add Manual Funding"
                    : "Import Funding From Bank"
                  : "Link Funding Sources"}
              </h3>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-4">
              {viewMode !== "funding" && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Button
                    variant={
                      fundingModalTab === "review" ? "primary" : "secondary"
                    }
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
                    variant={
                      fundingModalTab === "bank" ? "primary" : "secondary"
                    }
                    size="sm"
                    onClick={() => {
                      setFundingModalTab("bank");
                      setManualFunding(false);
                    }}
                  >
                    Link From Bank
                  </Button>
                  <Button
                    variant={
                      fundingModalTab === "manual" ? "primary" : "secondary"
                    }
                    size="sm"
                    onClick={() => {
                      setFundingModalTab("manual");
                      setManualFunding(true);
                    }}
                  >
                    Manual Funding
                  </Button>
                </div>
              )}

              {viewMode !== "funding" && fundingModalTab === "review" && (
                <div className="rounded-lg border border-stroke dark:border-dark-3 p-4 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-dark dark:text-white">
                      Review Auto-Matched Funding (
                      {pendingAutoMatchedFundings.length})
                    </h4>
                  </div>

                  <div>
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
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-stroke dark:border-dark-3 p-3 space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                        Left: Selected imported funding
                      </p>
                      <p className="text-sm font-medium text-dark dark:text-white">
                        {selectedPendingFunding
                          ? `${formatCurrencyValue(selectedPendingFunding.destinationAmount)} ${
                              selectedPendingFunding.destinationCurrency
                            }`
                          : "No funding selected"}
                      </p>
                      <p className="text-xs text-dark-5 dark:text-dark-6 break-words">
                        {selectedPendingFunding?.metadata
                          ?.originalDescription ||
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
                          ? `${format(
                              new Date(suggestedReviewCandidate.date),
                              "dd MMM yyyy",
                            )} • ${formatCurrencyValue(
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
                      onClick={() => void handleReviewFundingMatch("reject")}
                      disabled={isBusy || !selectedReviewFundingId}
                    >
                      Reject
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => void handleReviewFundingMatch("accept")}
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
                                (
                                  item.metadata as Record<
                                    string,
                                    unknown
                                  > | null
                                )?.originalDescription || item.sourceType,
                              )
                            }`,
                          })),
                        ]}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        variant="secondary"
                        onClick={() => void handleMergeImportedFunding()}
                        disabled={
                          isBusy ||
                          !selectedReviewFundingId ||
                          !mergeTargetFundingId
                        }
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
                      onSearch={handleSearchReviewCandidates}
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
                      onToggleSelect={(id) =>
                        setSelectedReviewReplacementIds((prev) => {
                          if (prev.has(id)) return new Set();
                          return new Set([id]);
                        })
                      }
                      totalItems={reviewCandidatesTotal}
                      currentPage={reviewCandidatesPage}
                      pageSize={fundingCandidatesPageSize}
                      onPageChange={handleReviewCandidatesPageChange}
                      emptyMessage="No replacement candidates found."
                    />
                  </div>

                  <div className="flex items-center justify-end">
                    <Button
                      variant="secondary"
                      onClick={() => void handleReviewFundingMatch("replace")}
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
                    onSearch={handleSearchFundingCandidates}
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
                    onToggleSelect={(id) =>
                      setSelectedFundingIds((prev) => {
                        if (
                          selectedImportedFundingForAttach &&
                          viewMode !== "funding"
                        ) {
                          if (prev.has(id)) return new Set();
                          return new Set([id]);
                        }
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      })
                    }
                    totalItems={fundingCandidatesTotal}
                    currentPage={fundingCandidatesPage}
                    pageSize={fundingCandidatesPageSize}
                    onPageChange={handleFundingCandidatesPageChange}
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
                            fundingForm.feeMode === "percent"
                              ? "e.g. 1.5"
                              : "e.g. 2.50"
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
                          placeholder={trip.baseCurrency}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            {viewMode !== "funding" && fundingModalTab === "review" ? (
              <div className="px-6 py-4 border-t border-stroke dark:border-dark-3 flex items-center justify-end gap-3">
                <Button
                  variant="secondary"
                  onClick={() => setIsFundingModalOpen(false)}
                >
                  Close
                </Button>
              </div>
            ) : (
              <div className="px-6 py-4 border-t border-stroke dark:border-dark-3 flex items-center justify-end gap-3">
                <Button
                  variant="secondary"
                  onClick={() => setIsFundingModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleLinkFunding}
                  disabled={isBusy}
                >
                  {isBusy
                    ? "Linking..."
                    : selectedImportedFundingForAttach
                      ? "Link To Selected Funding"
                      : "Link Funding"}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {isAddFromMainModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 p-4 flex items-center justify-center"
          onClick={() => setIsAddFromMainModalOpen(false)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-4xl bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 shadow-card-2 max-h-[85vh] overflow-hidden flex flex-col"
          >
            <div className="px-6 py-4 border-b border-stroke dark:border-dark-3">
              <h3 className="text-lg font-semibold text-dark dark:text-white">
                Add Transactions From Bank Ledger
              </h3>
              <p className="text-sm text-dark-5 dark:text-dark-6">
                Added transactions keep their original category in your main
                ledger, and use a trip-specific category only inside this trip.
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-4">
              <div className="h-[420px] min-h-[320px] overflow-hidden">
                <ExistingTransactionsSelector
                  className="h-full"
                  title="Main Ledger Transactions"
                  searchPlaceholder="Search transactions..."
                  searchValue={sourceSearch}
                  onSearchValueChange={setSourceSearch}
                  onSearch={handleSearchSourceCandidates}
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
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                  totalItems={sourceCandidatesTotal}
                  currentPage={sourceCandidatesPage}
                  pageSize={sourceCandidatesPageSize}
                  onPageChange={handleSourceCandidatesPageChange}
                  emptyMessage="No bank transactions available."
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
                      setSourceEntryType(value as "spending" | "reimbursement")
                    }
                    className="w-full"
                    buttonClassName="w-full"
                    menuPlacement="up"
                    options={[
                      { value: "spending", label: "Spending" },
                      { value: "reimbursement", label: "Reimbursement" },
                    ]}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Trip category
                  </label>
                  <div className="h-11 rounded-lg border border-stroke bg-white dark:border-dark-3 dark:bg-dark-2">
                    <CategorySelect
                      value={sourceCategoryId}
                      categories={localCategories}
                      onChange={setSourceCategoryId}
                      onAddClick={() => setIsAddCategoryModalOpen(true)}
                      emptyLabel="Select category"
                      triggerProps={{
                        className:
                          "h-full rounded-lg border-0 bg-transparent px-3 py-0 hover:bg-transparent dark:hover:bg-transparent",
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-stroke dark:border-dark-3 flex items-center justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setIsAddFromMainModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleAddFromBankLedger}
                disabled={isBusy}
              >
                {isBusy ? "Adding..." : "Add To Trip"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {isManualEntryModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 p-4 flex items-center justify-center"
          onClick={() => setIsManualEntryModalOpen(false)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-3xl bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 shadow-card-2 max-h-[85vh] overflow-hidden flex flex-col"
          >
            <div className="px-6 py-4 border-b border-stroke dark:border-dark-3">
              <h3 className="text-lg font-semibold text-dark dark:text-white">
                Add Manual Trip Transaction
              </h3>
              <p className="text-sm text-dark-5 dark:text-dark-6">
                Create a trip transaction directly, and choose whether it should
                deduct from a wallet.
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Entry type
                  </label>
                  <Select
                    value={manualEntryForm.type}
                    onChange={(value) =>
                      setManualEntryForm((prev) => ({
                        ...prev,
                        type: value as "spending" | "reimbursement",
                        categoryId:
                          value === "reimbursement" ? "" : prev.categoryId,
                      }))
                    }
                    className="w-full"
                    buttonClassName="w-full"
                    menuPlacement="down"
                    options={[
                      { value: "spending", label: "Spending" },
                      { value: "reimbursement", label: "Reimbursement" },
                    ]}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Wallet
                  </label>
                  <Select
                    value={manualEntryForm.walletId}
                    onChange={(value) =>
                      setManualEntryForm((prev) => ({
                        ...prev,
                        walletId: value,
                      }))
                    }
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
                      value={manualEntryForm.date}
                      onChange={(value: string) =>
                        setManualEntryForm((prev) => ({ ...prev, date: value }))
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
                    value={manualEntryForm.label}
                    onChange={(e) =>
                      setManualEntryForm((prev) => ({
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
                  value={manualEntryForm.description}
                  onChange={(e) =>
                    setManualEntryForm((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                  placeholder="Transaction description"
                />
              </div>

              {manualEntryForm.type === "spending" && (
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Trip category
                  </label>
                  <div className="h-11 rounded-lg border border-stroke bg-white dark:border-dark-3 dark:bg-dark-2">
                    <CategorySelect
                      value={manualEntryForm.categoryId}
                      categories={localCategories}
                      onChange={(value) =>
                        setManualEntryForm((prev) => ({
                          ...prev,
                          categoryId: value,
                        }))
                      }
                      onAddClick={() => setIsAddCategoryModalOpen(true)}
                      emptyLabel="Select category"
                      triggerProps={{
                        className:
                          "h-full rounded-lg border-0 bg-transparent px-3 py-0 hover:bg-transparent dark:hover:bg-transparent",
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Spent currency
                  </label>
                  <Select
                    value={manualEntryForm.localCurrency}
                    onChange={(value) =>
                      setManualEntryForm((prev) => ({
                        ...prev,
                        localCurrency: value,
                      }))
                    }
                    options={currencyOptions}
                    className="w-full"
                    buttonClassName="w-full"
                    menuPlacement="up"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Spent amount
                  </label>
                  <NumberInput
                    value={manualEntryForm.localAmount}
                    onChange={(e) =>
                      setManualEntryForm((prev) => ({
                        ...prev,
                        localAmount: e.target.value,
                      }))
                    }
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Base amount ({trip.baseCurrency})
                  </label>
                  <NumberInput
                    value={manualEntryForm.baseAmount}
                    onChange={(e) =>
                      setManualEntryForm((prev) => ({
                        ...prev,
                        baseAmount: e.target.value,
                      }))
                    }
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-1">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    FX rate (optional)
                  </label>
                  <NumberInput
                    value={manualEntryForm.fxRate}
                    onChange={(e) =>
                      setManualEntryForm((prev) => ({
                        ...prev,
                        fxRate: e.target.value,
                      }))
                    }
                    placeholder="Auto if empty"
                  />
                </div>
              </div>
              <p className="text-xs text-dark-5 dark:text-dark-6">
                Fees are recorded as separate transactions. Add a dedicated fee
                entry if needed.
              </p>
            </div>

            <div className="px-6 py-4 border-t border-stroke dark:border-dark-3 flex items-center justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setIsManualEntryModalOpen(false);
                  resetManualEntryForm();
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleCreateManualEntry}
                disabled={isBusy}
              >
                {isBusy ? "Adding..." : "Add Transaction"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {isWalletModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 p-4 flex items-center justify-center"
          onClick={() => setIsWalletModalOpen(false)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-2xl bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 shadow-card-2"
          >
            <div className="px-6 py-4 border-b border-stroke dark:border-dark-3">
              <h3 className="text-lg font-semibold text-dark dark:text-white">
                Manage Wallets
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-2 max-h-[260px] overflow-y-auto">
                {walletSummaries.map((wallet) => (
                  <div
                    key={wallet.id}
                    className="rounded-lg border border-stroke dark:border-dark-3 px-3 py-2 bg-white dark:bg-dark-2"
                    style={{
                      borderLeftWidth: 4,
                      borderLeftColor: wallet.color || "#ffffff",
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex items-center gap-2">
                        <WalletGlyph className="h-4 w-4 shrink-0 text-dark-5 dark:text-dark-6" />
                        <div className="truncate text-sm font-medium text-dark dark:text-white">
                          {wallet.name}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full border border-stroke px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-dark-5 dark:border-dark-3 dark:text-dark-6">
                        {wallet.currency}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      {wallet.balances.length === 0 ? (
                        <span className="text-dark-5 dark:text-dark-6">
                          No balance yet
                        </span>
                      ) : (
                        wallet.balances.map((balance, index) => (
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
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_220px_auto_auto]">
                <TextInput
                  value={walletForm.name}
                  onChange={(e) =>
                    setWalletForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="Wallet name"
                />
                <Select
                  value={walletForm.currency}
                  onChange={(value) =>
                    setWalletForm((prev) => ({ ...prev, currency: value }))
                  }
                  options={currencyOptions}
                  placeholder="Wallet currency"
                  className="w-full"
                  buttonClassName="w-full"
                  menuPlacement="up"
                />
                <ColorSelect
                  value={walletForm.color}
                  onChange={(color) =>
                    setWalletForm((prev) => ({ ...prev, color }))
                  }
                />
                <Button
                  variant="secondary"
                  leftIcon={<Plus className="h-4 w-4" />}
                  onClick={handleCreateWallet}
                  disabled={
                    isBusy || !walletForm.name.trim() || !walletForm.currency
                  }
                >
                  Add
                </Button>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-stroke dark:border-dark-3 flex justify-end">
              <Button
                variant="secondary"
                onClick={() => setIsWalletModalOpen(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {isEditFundingModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 p-4 flex items-center justify-center"
          onClick={() => setIsEditFundingModalOpen(false)}
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
                  value={editingFundingForm.walletId}
                  onChange={(value) =>
                    setEditingFundingForm((prev) => ({
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
                    value={editingFundingForm.sourceCurrency}
                    onChange={(e) =>
                      setEditingFundingForm((prev) => ({
                        ...prev,
                        sourceCurrency: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="Source currency"
                    disabled={!!editingFundingItem?.bankTransactionId}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Source amount
                  </label>
                  <NumberInput
                    value={editingFundingForm.sourceAmount}
                    onChange={(e) =>
                      setEditingFundingForm((prev) => ({
                        ...prev,
                        sourceAmount: e.target.value,
                      }))
                    }
                    placeholder="Source amount"
                    disabled={!!editingFundingItem?.bankTransactionId}
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Destination currency
                  </label>
                  <TextInput
                    value={editingFundingForm.destinationCurrency}
                    onChange={(e) =>
                      setEditingFundingForm((prev) => ({
                        ...prev,
                        destinationCurrency: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="Destination currency"
                    disabled={!!editingFundingItem?.bankTransactionId}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Destination amount
                  </label>
                  <NumberInput
                    value={editingFundingForm.destinationAmount}
                    onChange={(e) =>
                      setEditingFundingForm((prev) => ({
                        ...prev,
                        destinationAmount: e.target.value,
                      }))
                    }
                    placeholder="Destination amount"
                    disabled={editingFundingInputMode === "fxRate"}
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex items-center gap-2 rounded-md border border-stroke px-3 py-2 dark:border-dark-3">
                  <Checkbox
                    checked={editingFundingInputMode === "amount"}
                    onChange={() => setEditingFundingInputMode("amount")}
                  />
                  <span className="text-xs text-dark dark:text-white">
                    Edit destination amount
                  </span>
                </label>
                <label className="flex items-center gap-2 rounded-md border border-stroke px-3 py-2 dark:border-dark-3">
                  <Checkbox
                    checked={editingFundingInputMode === "fxRate"}
                    onChange={() => setEditingFundingInputMode("fxRate")}
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
                    value={editingFundingForm.fxRate}
                    onChange={(e) =>
                      setEditingFundingForm((prev) => ({
                        ...prev,
                        fxRate: e.target.value,
                      }))
                    }
                    placeholder="FX rate"
                    disabled={editingFundingInputMode !== "fxRate"}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Fee amount
                  </label>
                  <NumberInput
                    value={editingFundingForm.feeAmount}
                    onChange={(e) =>
                      setEditingFundingForm((prev) => ({
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
                    value={editingFundingForm.feeCurrency}
                    onChange={(value) =>
                      setEditingFundingForm((prev) => ({
                        ...prev,
                        feeCurrency: value.toUpperCase(),
                      }))
                    }
                    options={Array.from(
                      new Set(
                        [
                          (
                            editingFundingItem?.bankTransactionId
                              ? editingFundingItem.sourceCurrency
                              : editingFundingForm.sourceCurrency
                          )?.toUpperCase(),
                          (
                            editingFundingItem?.bankTransactionId
                              ? wallets.find(
                                  (wallet) =>
                                    wallet.id === editingFundingForm.walletId,
                                )?.currency ||
                                editingFundingItem?.destinationCurrency
                              : editingFundingForm.destinationCurrency
                          )?.toUpperCase(),
                        ].filter((currency): currency is string =>
                          Boolean(currency),
                        ),
                      ),
                    ).map((currency) => ({
                      value: currency,
                      label: currency,
                    }))}
                    className="w-full"
                    buttonClassName="w-full"
                  />
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-stroke dark:border-dark-3 flex items-center justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setIsEditFundingModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleSaveEditFunding()}
                disabled={isBusy}
              >
                {isBusy ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {isImportModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 p-4 flex items-center justify-center"
          onClick={() => {
            setIsImportModalOpen(false);
            setTripImportStep("setup");
            setTripImportParsedData(null);
            setTripImportEditedTransactions([]);
            setTripImportSelectedIndices(new Set());
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className={`w-full ${
              tripImportStep === "review" ? "max-w-[95vw]" : "max-w-2xl"
            } bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 shadow-card-2 ${
              tripImportStep === "review" ? "h-[90vh]" : ""
            }`}
          >
            <div className="px-6 py-4 border-b border-stroke dark:border-dark-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-dark dark:text-white">
                {tripImportStep === "review"
                  ? "Review Trip Statement Import"
                  : "Import Trip Statement"}
              </h3>
              <div className="inline-flex items-center gap-1 text-xs text-dark-5 dark:text-dark-6">
                <PlaneTakeoff className="h-3.5 w-3.5" />
                Trip-only parsers
              </div>
            </div>
            {tripImportStep === "setup" && (
              <>
                <div className="p-6 space-y-4">
                  <div className="rounded-lg border border-stroke dark:border-dark-3 bg-gray-1/40 dark:bg-dark-3/40 px-3 py-2 text-xs text-dark-5 dark:text-dark-6">
                    Wallets are auto-created by provider and currency (for
                    example
                    <span className="font-medium text-dark dark:text-white">
                      {" "}
                      Revolut USD
                    </span>
                    ,
                    <span className="font-medium text-dark dark:text-white">
                      {" "}
                      YouTrip JPY
                    </span>
                    ) based on the imported statement transactions.
                  </div>
                  <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                        Parser
                      </label>
                      <Select
                        value={importForm.parserId}
                        onChange={(value) => {
                          setImportForm((prev) => ({
                            ...prev,
                            parserId: value,
                          }));
                          if (value !== "revolut_statement") {
                            setSupplementalFile(null);
                          }
                        }}
                        className="w-full"
                        buttonClassName="w-full"
                        options={tripParserOptions.map((parser) => ({
                          value: parser.id,
                          label: parser.name,
                        }))}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                        Target wallet
                      </label>
                      <Select
                        value={importForm.walletId}
                        onChange={(value) =>
                          setImportForm((prev) => ({
                            ...prev,
                            walletId: value,
                          }))
                        }
                        className="w-full"
                        buttonClassName="w-full"
                        options={[
                          { value: "", label: "Auto-create / auto-detect" },
                          ...wallets.map((wallet) => ({
                            value: wallet.id,
                            label: `${wallet.name} (${wallet.currency})`,
                          })),
                        ]}
                      />
                    </div>
                  </div>

                  <div
                    className={`grid gap-3 md:grid-cols-1 ${
                      importForm.parserId === "revolut_statement"
                        ? "h-[28rem] grid-rows-2"
                        : "h-56 grid-rows-1"
                    }`}
                  >
                    <div className="min-h-0 min-w-0 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                          Statement file
                        </label>
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                          Required
                        </span>
                      </div>
                      <div className="flex-1 min-h-0 min-w-0">
                        <FileUploadDropzone
                          onFilesAdd={(files) => { if (files[0]) setSelectedFile(files[0]); }}
                          accept=".pdf,.csv"
                        />
                      </div>
                    </div>
                    {importForm.parserId === "revolut_statement" && (
                      <div className="min-h-0 min-w-0 flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                            Revolut CSV merge file
                          </label>
                          <span className="rounded-full bg-dark-4/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                            Optional
                          </span>
                        </div>
                        <div className="flex-1 min-h-0 min-w-0">
                          <FileUploadDropzone
                            onFilesAdd={(files) => { if (files[0]) setSupplementalFile(files[0]); }}
                            accept=".csv"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="px-6 py-4 border-t border-stroke dark:border-dark-3 flex items-center justify-end gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setIsImportModalOpen(false);
                      setTripImportStep("setup");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleStartTripImportReview}
                    disabled={isBusy || !selectedFile || !importForm.parserId}
                  >
                    {isBusy ? "Parsing..." : "Review Import"}
                  </Button>
                </div>
              </>
            )}

            {tripImportStep === "review" && tripImportParsedData && (
              <div className="h-[calc(90vh-72px)] grid gap-4 p-4 lg:grid-cols-[minmax(0,2fr)_340px]">
                <div className="min-h-0">
                  <TransactionTable
                    parsedData={tripImportParsedData}
                    transactions={tripImportEditedTransactions}
                    categories={localCategories}
                    accountIdentifier=""
                    accountIdentifiers={[]}
                    showAccountSelector={false}
                    selectedIndices={tripImportSelectedIndices}
                    isCheckingDuplicates={false}
                    isImporting={isBusy}
                    showDuplicatesOnly={false}
                    onUpdateTransaction={handleTripImportUpdateTransaction}
                    onAccountIdentifierChange={() => {}}
                    onImport={handleCommitTripImportReview}
                    onSelectAll={handleTripImportSelectAll}
                    onDeselectAll={handleTripImportDeselectAll}
                    onSelectVisible={handleTripImportSelectVisible}
                    onDeselectVisible={handleTripImportDeselectVisible}
                    onToggleSelection={handleTripImportToggleSelection}
                    onAddCategoryClick={() => setIsAddCategoryModalOpen(true)}
                    onBack={() => setTripImportStep("setup")}
                    deferCellCommit
                  />
                </div>
                <div className="min-h-0 space-y-3">
                  <div className="rounded-lg border border-stroke dark:border-dark-3 p-3">
                    <p className="text-sm font-semibold text-dark dark:text-white">
                      Wallet Crediting
                    </p>
                    <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                      Choose where this statement should be credited by default.
                      Auto mode creates or matches wallet by provider +
                      currency.
                    </p>
                    <div className="mt-3">
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                        Target wallet
                      </label>
                      <Select
                        value={importForm.walletId}
                        onChange={(value) =>
                          setImportForm((prev) => ({
                            ...prev,
                            walletId: value,
                          }))
                        }
                        className="w-full"
                        buttonClassName="w-full"
                        options={[
                          { value: "", label: "Auto-create / auto-detect" },
                          ...wallets.map((wallet) => ({
                            value: wallet.id,
                            label: `${wallet.name} (${wallet.currency})`,
                          })),
                        ]}
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border border-stroke dark:border-dark-3 p-3">
                    <p className="text-sm font-semibold text-dark dark:text-white">
                      Funding Linkage Review
                    </p>
                    <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                      After import, topup/funding matches can be reviewed in the
                      Funding modal.
                    </p>
                    <div className="mt-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setIsFundingModalOpen(true)}
                        leftIcon={<Link2 className="h-4 w-4" />}
                      >
                        Open Funding Modal
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <Modal
        isOpen={modalState.isOpen}
        onClose={closeModal}
        type={modalState.type}
        title={modalState.title}
        message={modalState.message}
      />

      <AddCategoryModal
        isOpen={isAddCategoryModalOpen}
        onClose={() => setIsAddCategoryModalOpen(false)}
        onAdd={handleAddTripCategory}
      />
    </div>
  );
}
