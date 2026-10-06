"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  FileUp,
  Link2,
  Loader2,
  MoreHorizontal,
  Plus,
  Trash2,
  Users,
  WalletCards,
} from "lucide-react";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import {
  getFundingCandidates,
  getOutgoingFundingEntryCandidates,
  getSourceTransactionCandidates,
  getTripEntries,
  getTripFundings,
  getTripWalletSummaries,
  type FundingCandidate,
  type FundingCandidatesResponse,
  type SourceTransactionCandidate,
  type SourceTransactionCandidatesResponse,
  type Trip,
  type TripEntry,
  type TripFunding,
  type TripFundingOutInput,
  type Wallet,
  type WalletSummary,
} from "@/app/actions/trips";
import {
  addEntriesFromSourceTransactions,
  createTripEntry,
  createTripFunding,
  createTripReimbursementLink,
  deleteTripFunding,
  bulkDeleteTripEntriesByFilter,
  bulkDeleteTripEntriesByIds,
  bulkUpdateTripEntriesByFilter,
  bulkUpdateTripEntriesByIds,
  createWallet,
  mergeTripFunding,
  reviewTripFundingMatch,
  updateTripEntry,
  updateTripFunding,
  addFundingsFromOutgoingEntries,
} from "@/lib/tripMutations";
import type {
  TripParticipant,
  TripSharedOverview,
} from "@/app/actions/tripSharing";
import {
  addBankSettlements,
  asPeopleEntry,
  createTripParticipant,
  createTripPeopleEntry,
  getTripParticipants,
  getTripSharedOverview,
  tripSharingOf,
} from "@/lib/tripSharingMutations";
import { createCategory, type Category } from "@/app/actions/categories";
import { getCurrencyOptions } from "@/lib/currencies";
import { normalizeFundingEditInput } from "@/lib/fundingMath";
import { getRandomWalletColor } from "@/lib/walletColors";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { AddCategoryModal } from "@/components/ui/AddCategoryModal";
import { CategorySelect } from "@/components/ui/CategorySelect";
import { Checkbox } from "@/components/ui/Checkbox";
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
import {
  TripAddFromBankModal,
  type TripBankEntryType,
} from "@/components/trips/TripAddFromBankModal";
import { TripEditFundingModal } from "@/components/trips/TripEditFundingModal";
import { TripTransactionsFundingModal } from "@/components/trips/TripTransactionsFundingModal";
import { TripTransactionsSideRail } from "@/components/trips/TripTransactionsSideRail";
import {
  TripManualEntryModal,
  type TripEntryForm,
} from "@/components/trips/TripManualEntryModal";
import type { FundingOutDestinationType } from "@/components/trips/TripFundingOutDestinationFields";
import { TripReimbursementSelectorModal } from "@/components/trips/TripReimbursementSelectorModal";
import { TripSettleModal } from "@/components/trips/TripSettleModal";
import { TripShareCostModal } from "@/components/trips/TripShareCostModal";
import { TripWalletModal } from "@/components/trips/TripWalletModal";
import type {
  Transaction as ImportTransaction,
  TransactionLinkage as ImportTransactionLinkage,
} from "@/components/transaction-table/types";

interface TripTransactionsClientProps {
  trip: Trip;
  fundings: TripFunding[];
  wallets: Wallet[];
  walletSummaries: WalletSummary[];
  categories: Category[];
  initialEntries: TripEntry[];
  initialFundingOutEntries: TripEntry[];
  initialEntriesTotal: number;
  initialFundingCandidates: FundingCandidatesResponse;
  allTrips: Trip[];
  /** People on the trip, for IOUs and settlements. Loaded on mount when left out. */
  initialParticipants?: TripParticipant[];
}

interface EntryFilters {
  search: string;
  walletId: string;
  categoryId: string;
  dateFrom: string;
  dateTo: string;
}

type FundingModalTab = "review" | "bank" | "fromTrip" | "manual";

const formatCurrencyValue = (value: number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const TRIP_SPECIAL_FILTER_CATEGORIES = [
  { id: "__funding_in__", name: "Funding In", color: "#3b82f6" },
  { id: "__funding_out__", name: "Funding Out", color: "#f59e0b" },
  { id: "__reimbursement__", name: "Reimbursement", color: "#22c55e" },
] as const;

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const toPositiveNumber = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const parseTripEntryLinkage = (
  metadata: Record<string, unknown> | null | undefined,
  fallbackBaseAmount?: number,
  fallbackFxRate?: number,
): ImportTransactionLinkage | null => {
  const raw = toRecord(metadata?.linkage);
  if (!raw) return null;

  const type = String(raw.type || "").toLowerCase();
  if (type !== "internal" && type !== "reimbursement" && type !== "reimbursed") {
    return null;
  }

  if (type === "internal") {
    return {
      type: "internal",
      autoDetected: Boolean(raw.autoDetected),
      detectionReason:
        typeof raw.detectionReason === "string" ? raw.detectionReason : undefined,
    };
  }

  if (type === "reimbursed") {
    const reimbursedByAllocations = Array.isArray(raw.reimbursedByAllocations)
      ? raw.reimbursedByAllocations
          .map((item) => {
            const parsed = toRecord(item);
            if (!parsed) return null;
            const transactionId =
              typeof parsed.transactionId === "string"
                ? parsed.transactionId
                : undefined;
            const amount = toPositiveNumber(parsed.amountBase ?? parsed.amount);
            if (!transactionId || !(amount > 0)) return null;
            return {
              transactionId,
              amount,
              amountBase: amount,
            };
          })
          .filter(
            (
              item,
            ): item is {
              transactionId: string;
              amount: number;
              amountBase: number;
            } => !!item,
          )
      : [];
    return {
      type: "reimbursed",
      reimbursedByAllocations,
    };
  }

  const reimbursesAllocations = Array.isArray(raw.reimbursesAllocations)
    ? raw.reimbursesAllocations
        .map((item) => {
          const parsed = toRecord(item);
          if (!parsed) return null;
          const transactionId =
            typeof parsed.transactionId === "string"
              ? parsed.transactionId
              : undefined;
          const amount = toPositiveNumber(parsed.amountBase ?? parsed.amount);
          if (!(amount > 0)) return null;
          if (!transactionId) return null;
          return {
            transactionId,
            amount,
            amountBase: amount,
          };
        })
        .filter(
          (
            item,
          ): item is {
            transactionId: string;
            amount: number;
            amountBase: number;
          } => !!item,
        )
    : [];

  return {
    type: "reimbursement",
    reimbursesAllocations,
    leftoverAmount: toPositiveNumber(raw.leftoverBaseAmount ?? raw.leftoverAmount),
    leftoverCategoryId:
      typeof raw.leftoverCategoryId === "string"
        ? raw.leftoverCategoryId
        : raw.leftoverCategoryId === null
          ? null
          : undefined,
    reimbursementBaseAmount:
      typeof fallbackBaseAmount === "number" && fallbackBaseAmount > 0
        ? fallbackBaseAmount
        : undefined,
    reimbursingFxRate:
      typeof fallbackFxRate === "number" && fallbackFxRate > 0
        ? fallbackFxRate
        : undefined,
  };
};

const buildEmptyEntryForm = (baseCurrency: string): TripEntryForm => ({
  walletId: "__none__",
  type: "spending",
  paidByParticipantId: "",
  counterpartyId: "",
  date: format(new Date(), "yyyy-MM-dd"),
  description: "",
  label: "",
  categoryId: "",
  localCurrency: baseCurrency,
  localAmount: "",
  baseAmount: "",
  fxRate: "",
  fundingOutDestinationType: "bank",
  fundingOutDestinationTripId: "",
  fundingOutDestinationWalletId: "",
  fundingOutDestinationCurrency: baseCurrency,
  fundingOutDestinationAmount: "",
  fundingOutFxRate: "",
  fundingOutFeeAmount: "",
  fundingOutFeeCurrency: baseCurrency,
  fundingOutInputMode: "amount",
});

const toFormNumber = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "";
};

const isFundingOutDestinationType = (
  value: unknown,
): value is FundingOutDestinationType =>
  value === "bank" ||
  value === "trip" ||
  value === "wallet" ||
  value === "external";

/** Edit form for a saved entry. Base amount and rate stay blank unless the entry was locked to them. */
const buildEntryEditForm = (
  entry: TripEntry,
  baseCurrency: string,
): TripEntryForm => {
  const metadata = toRecord(entry.metadata) || {};
  const fundingOut = toRecord(metadata.fundingOut) || {};
  const locked =
    metadata.baseAmountLocked === true ||
    metadata.manualBaseAmount !== undefined ||
    metadata.manualFxRate !== undefined;
  const destinationAmount = toFormNumber(fundingOut.destinationAmount);
  const people = asPeopleEntry(entry);
  return {
    walletId: entry.wallet.id === "__external__" ? "__none__" : entry.wallet.id,
    type: people.type === "funding_in" ? "spending" : people.type,
    paidByParticipantId: people.isIou ? people.counterparty?.id || "" : "",
    counterpartyId:
      people.type === "settlement" ? people.counterparty?.id || "" : "",
    date: String(entry.date).slice(0, 10),
    description: entry.description,
    label: entry.label || "",
    categoryId: entry.type === "spending" ? entry.category?.id || "" : "",
    localCurrency: entry.localCurrency.toUpperCase(),
    localAmount: toFormNumber(entry.localAmount),
    baseAmount: locked ? toFormNumber(entry.baseAmount) : "",
    fxRate: "",
    fundingOutDestinationType: isFundingOutDestinationType(
      fundingOut.destinationType,
    )
      ? fundingOut.destinationType
      : "external",
    fundingOutDestinationTripId: String(fundingOut.destinationTripId || ""),
    fundingOutDestinationWalletId: String(fundingOut.destinationWalletId || ""),
    fundingOutDestinationCurrency: String(
      fundingOut.destinationCurrency || entry.localCurrency,
    ).toUpperCase(),
    fundingOutDestinationAmount: destinationAmount,
    fundingOutFxRate: toFormNumber(fundingOut.fxRate),
    fundingOutFeeAmount: toFormNumber(fundingOut.feeAmount),
    fundingOutFeeCurrency: String(
      fundingOut.feeCurrency || baseCurrency,
    ).toUpperCase(),
    fundingOutInputMode: destinationAmount ? "amount" : "fxRate",
  };
};

const buildFundingOutPayload = (
  form: TripEntryForm,
  baseCurrency: string,
): TripFundingOutInput => ({
  destinationType: form.fundingOutDestinationType,
  destinationTripId:
    form.fundingOutDestinationType === "trip"
      ? form.fundingOutDestinationTripId || null
      : null,
  destinationWalletId:
    form.fundingOutDestinationType === "wallet" ||
    form.fundingOutDestinationType === "trip"
      ? form.fundingOutDestinationWalletId || null
      : null,
  destinationCurrency: form.fundingOutDestinationCurrency || null,
  destinationAmount:
    form.fundingOutInputMode === "amount"
      ? Number(form.fundingOutDestinationAmount || 0) || null
      : null,
  fxRate:
    form.fundingOutInputMode === "fxRate"
      ? Number(form.fundingOutFxRate || 0) || null
      : null,
  feeAmount: Number(form.fundingOutFeeAmount || 0) || null,
  feeCurrency: form.fundingOutFeeCurrency || baseCurrency,
});

const FUNDING_OUT_FORM_FIELDS = [
  "fundingOutDestinationType",
  "fundingOutDestinationTripId",
  "fundingOutDestinationWalletId",
  "fundingOutDestinationCurrency",
  "fundingOutDestinationAmount",
  "fundingOutFxRate",
  "fundingOutFeeAmount",
  "fundingOutFeeCurrency",
  "fundingOutInputMode",
] as const;

/** Checks the amount fields shared by adding and editing; returns a warning or null. */
const validateEntryAmounts = (form: TripEntryForm) => {
  if (!(Number(form.localAmount) > 0)) {
    return "Enter an amount greater than 0.";
  }
  if (!/^[A-Z]{3}$/.test(form.localCurrency.trim().toUpperCase())) {
    return "Currency must be a 3-letter code, like JPY.";
  }
  if (form.baseAmount.trim() && !(Number(form.baseAmount) > 0)) {
    return "The base amount must be greater than 0, or left blank.";
  }
  if (form.fxRate.trim() && !(Number(form.fxRate) > 0)) {
    return "The FX rate must be greater than 0, or left blank.";
  }
  if (
    form.type === "funding_out" &&
    form.fundingOutDestinationType === "wallet" &&
    !form.fundingOutDestinationWalletId
  ) {
    return "Choose the wallet the money moves into.";
  }
  return null;
};

const DETACHED_SOURCE_NOTICES: Record<string, string> = {
  deleted: "Bank transaction removed — relink or delete",
  split: "Bank transaction was split — relink or delete",
  direction_changed: "Bank transaction changed direction — relink or delete",
};

const getDetachedNotice = (metadata: Record<string, unknown> | null) => {
  const detached = toRecord(metadata?.sourceDetached);
  if (!detached) return undefined;
  return (
    DETACHED_SOURCE_NOTICES[String(detached.reason || "")] ||
    DETACHED_SOURCE_NOTICES.deleted
  );
};

export function TripTransactionsClient({
  trip,
  fundings: initialFundings,
  wallets: initialWallets,
  walletSummaries: initialWalletSummaries,
  categories,
  initialEntries,
  initialFundingOutEntries,
  initialEntriesTotal,
  initialFundingCandidates,
  allTrips,
  initialParticipants,
}: TripTransactionsClientProps) {
  const { setHeaderConfig } = useHeaderConfig();
  const router = useRouter();
  const sharing = tripSharingOf(trip);
  // Viewers of a shared trip can't change it; the server rejects their writes.
  const isViewer = sharing?.role === "viewer";
  const [participants, setParticipants] = useState<TripParticipant[]>(
    initialParticipants || [],
  );
  const [sharedOverview, setSharedOverview] =
    useState<TripSharedOverview | null>(null);
  const [settlingEntryId, setSettlingEntryId] = useState<string | null>(null);
  const [sharingEntryId, setSharingEntryId] = useState<string | null>(null);
  const [sourceCounterpartyId, setSourceCounterpartyId] = useState("");

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
  const [outgoingCandidates, setOutgoingCandidates] = useState<
    FundingCandidate[]
  >([]);
  const [outgoingCandidatesTotal, setOutgoingCandidatesTotal] = useState(0);
  const [outgoingCandidatesPage, setOutgoingCandidatesPage] = useState(1);
  const outgoingCandidatesPageSize = 20;
  const [isLoadingOutgoingCandidates, setIsLoadingOutgoingCandidates] =
    useState(false);
  const [outgoingSearch, setOutgoingSearch] = useState("");
  const [outgoingSourceTripId, setOutgoingSourceTripId] = useState("");
  const [selectedOutgoingIds, setSelectedOutgoingIds] = useState<Set<string>>(
    new Set(),
  );
  const [entries, setEntries] = useState(initialEntries);
  const [fundingOutEntries, setFundingOutEntries] = useState(
    initialFundingOutEntries,
  );
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
    baseAmount: "",
  });
  const [editingFundingInputMode, setEditingFundingInputMode] = useState<
    "amount" | "fxRate"
  >("amount");

  const [isBusy, setIsBusy] = useState(false);
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
  const [activeReimbursementEntryId, setActiveReimbursementEntryId] = useState<
    string | null
  >(null);

  const [fundingSearch, setFundingSearch] = useState("");
  const [selectedFundingIds, setSelectedFundingIds] = useState<Set<string>>(
    new Set(),
  );
  const [sourceSearch, setSourceSearch] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(
    new Set(),
  );
  const [sourceEntryType, setSourceEntryType] =
    useState<TripBankEntryType>("spending");
  const [sourceFundingOut, setSourceFundingOut] = useState({
    destinationType: "bank" as FundingOutDestinationType,
    destinationTripId: "",
    destinationWalletId: "",
    destinationCurrency: trip.baseCurrency,
    destinationAmount: "",
    fxRate: "",
    feeAmount: "",
    feeCurrency: trip.baseCurrency,
  });
  const [sourceFundingOutInputMode, setSourceFundingOutInputMode] = useState<
    "amount" | "fxRate"
  >("amount");
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
    baseAmount: "",
  });

  const [walletForm, setWalletForm] = useState({
    name: "",
    currency: trip.baseCurrency,
    color: getRandomWalletColor(),
  });
  const [manualEntryForm, setManualEntryForm] = useState<TripEntryForm>(() =>
    buildEmptyEntryForm(trip.baseCurrency),
  );
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [entryEditForm, setEntryEditForm] = useState<TripEntryForm>(() =>
    buildEmptyEntryForm(trip.baseCurrency),
  );
  const [entryEditInitial, setEntryEditInitial] = useState<TripEntryForm | null>(
    null,
  );
  const [fundingInNoticeOpen, setFundingInNoticeOpen] = useState(false);

  const totalPages = Math.max(1, Math.ceil(entriesTotal / pageSize));
  const currencyOptions = useMemo(() => getCurrencyOptions(), []);
  const filterCategories = useMemo(
    () => [...TRIP_SPECIAL_FILTER_CATEGORIES, ...localCategories],
    [localCategories],
  );
  const walletColorMap = useMemo(
    () =>
      wallets.reduce<Record<string, string>>((acc, wallet) => {
        acc[wallet.id] = wallet.color || "#ffffff";
        return acc;
      }, {}),
    [wallets],
  );
  const fundingTransactions = useMemo<TransactionCardTransaction[]>(
    () => [
      ...fundings.map((item) => ({
        id: `in:${item.id}`,
        date:
          String(
            (item.metadata as Record<string, unknown> | null)?.originalDate || "",
          ) ||
          item.bankTransaction?.date ||
          item.createdAt ||
          new Date().toISOString().slice(0, 10),
        description:
          item.bankTransaction?.description ||
          String(
            (item.metadata as Record<string, unknown> | null)
              ?.originalDescription || "",
          ).trim() ||
          "Funding In",
        label: item.sourceType === "manual" ? "Manual Funding In" : "Funding In",
        amountIn: item.destinationAmount,
        amountOut: null,
        balance: null,
        displayCurrency: item.destinationCurrency,
        metadata: {
          fundingDirection: "in",
          sourceType: item.sourceType,
          sourceAmount: `${formatCurrencyValue(item.sourceAmount)} ${item.sourceCurrency}`,
          destinationAmount: `${formatCurrencyValue(item.destinationAmount)} ${item.destinationCurrency}`,
          fxRate: item.fxRate,
          feeAmount: item.feeAmount,
          feeCurrency: item.feeCurrency,
          bankTransactionId: item.bankTransactionId,
          walletName: item.wallet?.name,
          walletCurrency: item.wallet?.currency,
          walletColor: item.wallet?.color || "#ffffff",
          ...(item.metadata || {}),
        },
      })),
      ...fundingOutEntries.map((entry) => ({
        id: `out:${entry.id}`,
        date: entry.date,
        description: entry.description,
        label: entry.label || "Funding Out",
        amountIn: null,
        amountOut: entry.localAmount,
        balance: null,
        displayCurrency: entry.localCurrency,
        metadata: {
          fundingDirection: "out",
          entryType: entry.type,
          walletName: entry.wallet.name,
          walletCurrency: entry.wallet.currency,
          walletColor: entry.wallet.color || "#ffffff",
          spentAmount: `${formatCurrencyValue(entry.localAmount)} ${entry.localCurrency}`,
          baseAmount: `${formatCurrencyValue(entry.baseAmount)} ${trip.baseCurrency}`,
          fxRate: entry.fxRate,
          ...(entry.metadata || {}),
        },
      })),
    ],
    [fundings, fundingOutEntries, trip.baseCurrency],
  );
  const sharesByEntryId = useMemo(
    () =>
      new Map(
        (sharedOverview?.entries || [])
          .filter((item) => item.shares.length > 0)
          .map((item) => [item.id, item.shares]),
      ),
    [sharedOverview],
  );
  const tripTransactions = useMemo<TransactionCardTransaction[]>(
    () =>
      entries.map((entry) => {
        const people = asPeopleEntry(entry);
        const isInflow =
          entry.type === "reimbursement" || entry.type === "funding_in";
        const isOutflow =
          people.type === "spending" ||
          people.type === "funding_out" ||
          people.type === "settlement";
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
        const parsedLinkage = parseTripEntryLinkage(
          entryMetadata,
          entry.baseAmount,
          entry.fxRate,
        );
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
        // IOUs, settlements and shares say who else is involved next to the category.
        const personName = people.counterparty?.name || "someone";
        const shares = sharesByEntryId.get(entry.id);
        const peopleNote =
          people.type === "settlement"
            ? `Paid ${personName}`
            : people.isIou
              ? `Owed to ${personName}`
              : shares
                ? `Shared with ${shares.map((share) => share.name).join(", ")}`
                : null;
        const category =
          people.type === "settlement"
            ? {
                id: entry.category?.id || "__settlement__",
                name: peopleNote as string,
                color: entry.category?.color || "#8b5cf6",
              }
            : peopleNote
              ? entry.category
                ? { ...entry.category, name: `${entry.category.name} · ${peopleNote}` }
                : { id: "__iou__", name: peopleNote, color: "#8b5cf6" }
              : entry.category || undefined;

        return {
          id: entry.id,
          date: entry.date,
          description: entry.description,
          label: entry.label || undefined,
          amountIn: isInflow ? primaryAmount : null,
          amountOut: isOutflow ? primaryAmount : null,
          balance: null,
          displayCurrency: primaryCurrency,
          category,
          secondaryAmount: hasForeignWalletAmount
            ? {
                value: entry.localAmount,
                currency: entry.localCurrency,
                direction: isInflow ? "in" : "out",
                label: "Wallet Amount",
              }
            : hasMerchantSecondaryAmount
              ? {
                  value: merchantForeignAmount,
                  currency: merchantForeignCurrency,
                  direction: isInflow ? "in" : "out",
                  label: "Merchant Amount",
                }
            : undefined,
          accentColor,
          notice: getDetachedNotice(entryMetadata),
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
            ...(peopleNote ? { people: peopleNote } : {}),
            ...entryMetadata,
          },
          linkage: parsedLinkage || undefined,
        };
      }),
    [entries, trip.baseCurrency, walletColorMap, sharesByEntryId],
  );

  const activeReimbursementEntry = useMemo(
    () =>
      activeReimbursementEntryId
        ? entries.find((entry) => entry.id === activeReimbursementEntryId) || null
        : null,
    [activeReimbursementEntryId, entries],
  );

  const activeReimbursementImportTransaction = useMemo<ImportTransaction | null>(
    () => {
      if (!activeReimbursementEntry) return null;
      const metadata =
        activeReimbursementEntry.metadata &&
        typeof activeReimbursementEntry.metadata === "object"
          ? { ...(activeReimbursementEntry.metadata as Record<string, unknown>) }
          : {};
      const linkage = parseTripEntryLinkage(
        metadata,
        activeReimbursementEntry.baseAmount,
        activeReimbursementEntry.fxRate,
      );
      return {
        date: activeReimbursementEntry.date,
        description: activeReimbursementEntry.description,
        label: activeReimbursementEntry.label || undefined,
        categoryId: activeReimbursementEntry.category?.id || undefined,
        amountIn:
          activeReimbursementEntry.type === "reimbursement"
            ? activeReimbursementEntry.localAmount
            : undefined,
        amountOut:
          activeReimbursementEntry.type !== "reimbursement"
            ? activeReimbursementEntry.localAmount
            : undefined,
        balance: undefined,
        metadata: {
          ...metadata,
          currency: activeReimbursementEntry.localCurrency,
          statementCurrency: activeReimbursementEntry.localCurrency,
        },
        linkage: linkage || undefined,
      };
    },
    [activeReimbursementEntry],
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
      title: `${trip.name} · Manage`,
      showBack: true,
      backHref: `/trips/${trip.id}`,
    });
    return () => setHeaderConfig(null);
  }, [setHeaderConfig, trip.id, trip.name]);

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
    const [
      nextFundings,
      nextWalletSummaries,
      nextCandidates,
      nextWallets,
      nextFundingOutEntries,
    ] =
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
        getTripEntries(trip.id, {
          type: "funding_out",
          limit: 200,
          offset: 0,
        }),
      ]);
    setFundings(nextFundings);
    setWalletSummaries(nextWalletSummaries);
    setFundingCandidates(nextCandidates.transactions || []);
    setFundingCandidatesTotal(nextCandidates.total || 0);
    setWallets(nextWallets);
    setFundingOutEntries(nextFundingOutEntries.items || []);
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

  useEffect(() => {
    if (initialParticipants) return;
    getTripParticipants(trip.id)
      .then(setParticipants)
      .catch(() => undefined);
  }, [initialParticipants, trip.id]);

  const sharingGroupId = sharing?.groupId;
  const refreshSharedOverview = useCallback(async () => {
    if (!sharingGroupId) return;
    try {
      setSharedOverview(await getTripSharedOverview(trip.id));
    } catch {
      // Share labels are extra; the list works without them.
    }
  }, [sharingGroupId, trip.id]);

  useEffect(() => {
    void refreshSharedOverview();
  }, [refreshSharedOverview]);

  const handleAddPerson = async (name: string) => {
    const person = await createTripParticipant(trip.id, name);
    setParticipants((prev) =>
      [...prev, person].sort((a, b) => a.name.localeCompare(b.name)),
    );
    return person;
  };

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

  const loadOutgoingCandidates = useCallback(
    async (
      nextPage: number,
      searchValue: string,
      sourceTripIdValue: string,
    ) => {
      setIsLoadingOutgoingCandidates(true);
      try {
        const result = await getOutgoingFundingEntryCandidates(trip.id, {
          sourceTripId: sourceTripIdValue || undefined,
          search: searchValue || undefined,
          limit: outgoingCandidatesPageSize,
          offset: (nextPage - 1) * outgoingCandidatesPageSize,
        });
        setOutgoingCandidates(result.transactions || []);
        setOutgoingCandidatesTotal(result.total || 0);
        setOutgoingCandidatesPage(nextPage);
      } finally {
        setIsLoadingOutgoingCandidates(false);
      }
    },
    [trip.id],
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

  const handleSearchOutgoingCandidates = async () => {
    try {
      await loadOutgoingCandidates(1, outgoingSearch, outgoingSourceTripId);
    } catch (error) {
      showModal(
        "error",
        "Failed to Search",
        error instanceof Error
          ? error.message
          : "Unable to load outgoing funding entries.",
      );
    }
  };

  const handleOutgoingCandidatesPageChange = async (nextPage: number) => {
    const totalPages = Math.max(
      1,
      Math.ceil(outgoingCandidatesTotal / outgoingCandidatesPageSize),
    );
    if (
      nextPage < 1 ||
      nextPage > totalPages ||
      nextPage === outgoingCandidatesPage
    ) {
      return;
    }
    try {
      await loadOutgoingCandidates(nextPage, outgoingSearch, outgoingSourceTripId);
    } catch (error) {
      showModal(
        "error",
        "Failed to Load Page",
        error instanceof Error
          ? error.message
          : "Unable to load outgoing funding entries.",
      );
    }
  };

  const handleImportFromOutgoingEntries = async () => {
    if (selectedOutgoingIds.size === 0) {
      showModal(
        "warning",
        "No Transactions Selected",
        "Select at least one outgoing funding transaction.",
      );
      return;
    }
    setIsBusy(true);
    try {
      const result = await addFundingsFromOutgoingEntries(trip.id, {
        sourceEntryIds: Array.from(selectedOutgoingIds),
        walletId: selectedWalletId || null,
      });
      setSelectedOutgoingIds(new Set());
      await refreshFundingsAndWallets();
      await loadOutgoingCandidates(1, outgoingSearch, outgoingSourceTripId);
      showModal(
        "success",
        "Imported",
        `${result.created} funding source${result.created === 1 ? "" : "s"} imported from other trips.`,
      );
    } catch (error) {
      showModal(
        "error",
        "Import Failed",
        error instanceof Error
          ? error.message
          : "Unable to import selected outgoing entries.",
      );
    } finally {
      setIsBusy(false);
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
    if (!isFundingModalOpen || fundingModalTab !== "fromTrip") return;
    void loadOutgoingCandidates(1, outgoingSearch, outgoingSourceTripId);
  }, [
    isFundingModalOpen,
    fundingModalTab,
    outgoingSearch,
    outgoingSourceTripId,
    loadOutgoingCandidates,
  ]);

  useEffect(() => {
    if (!isFundingModalOpen) return;
    if (pendingAutoMatchedFundings.length > 0) {
      setFundingModalTab("review");
      return;
    }
    setFundingModalTab(manualFunding ? "manual" : "bank");
  }, [
    isFundingModalOpen,
    pendingAutoMatchedFundings.length,
    manualFunding,
  ]);

  useEffect(() => {
    if (!isFundingModalOpen || pendingAutoMatchedFundings.length === 0) return;
    void loadReviewCandidates(1, reviewSearch);
  }, [
    isFundingModalOpen,
    pendingAutoMatchedFundings.length,
    loadReviewCandidates,
    reviewSearch,
  ]);

  useEffect(() => {
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
    setSelectedFundingManageIds((prev) => {
      const validIds = new Set(fundings.map((item) => item.id));
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id);
      });
      return next;
    });
  }, [fundings]);

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

  // The server needs the base value when neither currency is the trip's.
  const resolveFundingBaseAmount = (
    sourceCurrency: string,
    destinationCurrency: string,
  ) => {
    const base = trip.baseCurrency.toUpperCase();
    if (
      sourceCurrency.toUpperCase() === base ||
      destinationCurrency.toUpperCase() === base
    ) {
      return null;
    }
    const amount = Number(fundingForm.baseAmount || 0);
    if (!(amount > 0)) {
      throw new Error(`Enter the ${trip.baseCurrency} amount for this funding.`);
    }
    return amount;
  };

  const handleLinkFunding = async () => {
    setIsBusy(true);
    try {
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
        await createTripFunding(trip.id, {
          walletId: selectedWalletId,
          bankTransactionId: null,
          sourceType: "manual",
          sourceCurrency,
          sourceAmount,
          destinationCurrency,
          destinationAmount,
          fxRate,
          baseAmount: resolveFundingBaseAmount(
            sourceCurrency,
            destinationCurrency,
          ),
          feeAmount: buildFeeAmount(sourceAmount),
          feeCurrency:
            fundingForm.feeMode === "none"
              ? null
              : fundingForm.feeCurrency || trip.baseCurrency,
        });
      } else {
        if (!selectedWalletId) return;
        if (!selectedFundingWallet) return;
        const selected = fundingCandidates.filter((candidate) =>
          selectedFundingIds.has(candidate.id),
        );
        if (selected.length === 0) {
          throw new Error("Select at least one bank transaction to link.");
        }
        if (
          selected.length > 1 &&
          resolveFundingBaseAmount(
            fundingForm.sourceCurrency || trip.baseCurrency,
            selectedFundingWallet.currency,
          ) !== null
        ) {
          throw new Error(
            "Select one bank transaction at a time when a base amount is needed.",
          );
        }

        await Promise.all(
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
            await createTripFunding(trip.id, {
              walletId: selectedWalletId,
              bankTransactionId: candidate.id,
              sourceType: "transfer",
              sourceCurrency,
              sourceAmount,
              destinationCurrency,
              destinationAmount,
              fxRate,
              baseAmount: resolveFundingBaseAmount(
                sourceCurrency,
                destinationCurrency,
              ),
              feeAmount: buildFeeAmount(sourceAmount),
              feeCurrency:
                fundingForm.feeMode === "none"
                  ? null
                  : fundingForm.feeCurrency || trip.baseCurrency,
            });
          }),
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
        baseAmount: "",
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
      baseAmount: funding.baseAmount != null ? String(funding.baseAmount) : "",
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

    // Neither side in the base currency: the server needs the base value.
    const needsBaseAmount =
      normalized.sourceCurrency.toUpperCase() !== trip.baseCurrency.toUpperCase() &&
      normalized.destinationCurrency.toUpperCase() !==
        trip.baseCurrency.toUpperCase();
    const baseAmount = Number(editingFundingForm.baseAmount || 0);
    if (needsBaseAmount && !(baseAmount > 0)) {
      showModal(
        "warning",
        "Base Amount Needed",
        `Enter the ${trip.baseCurrency} amount for this funding.`,
      );
      return;
    }

    setIsBusy(true);
    try {
      await updateTripFunding(trip.id, editingFundingId, {
        baseAmount: needsBaseAmount ? baseAmount : null,
        walletId: editingFundingForm.walletId || null,
        sourceCurrency: normalized.sourceCurrency,
        sourceAmount: normalized.sourceAmount,
        destinationCurrency: normalized.destinationCurrency,
        destinationAmount: normalized.destinationAmount,
        fxRate: normalized.fxRate,
        feeAmount: normalized.feeAmount,
        feeCurrency: normalized.feeCurrency,
      });
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
      await deleteTripFunding(trip.id, fundingId);
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
      await Promise.all(
        Array.from(selectedFundingManageIds).map((id) =>
          deleteTripFunding(trip.id, id),
        ),
      );
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
    const activeFunding = selectedFundingFromList;
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
    if (sourceEntryType === "settlement" && !sourceCounterpartyId) {
      showModal(
        "warning",
        "Who did you pay?",
        "Choose the person this payment paid back.",
      );
      return;
    }

    setIsBusy(true);
    try {
      const result =
        sourceEntryType === "settlement"
          ? await addBankSettlements(trip.id, {
              transactionIds: Array.from(selectedSourceIds),
              counterpartyId: sourceCounterpartyId,
            })
          : await addEntriesFromSourceTransactions(trip.id, {
        transactionIds: Array.from(selectedSourceIds),
        categoryId:
          sourceEntryType === "spending" ? sourceCategoryId || null : null,
        entryType: sourceEntryType,
        fundingOut:
          sourceEntryType === "funding_out"
            ? {
                destinationType: sourceFundingOut.destinationType,
                destinationTripId:
                  sourceFundingOut.destinationType === "trip"
                    ? sourceFundingOut.destinationTripId || null
                    : null,
                destinationWalletId:
                  sourceFundingOut.destinationType === "wallet" ||
                  sourceFundingOut.destinationType === "trip"
                    ? sourceFundingOut.destinationWalletId || null
                    : null,
                destinationCurrency: sourceFundingOut.destinationCurrency || null,
                destinationAmount:
                  sourceFundingOutInputMode === "amount"
                    ? Number(sourceFundingOut.destinationAmount || 0) || null
                    : null,
                fxRate:
                  sourceFundingOutInputMode === "fxRate"
                    ? Number(sourceFundingOut.fxRate || 0) || null
                    : null,
                feeAmount: Number(sourceFundingOut.feeAmount || 0) || null,
                feeCurrency:
                  sourceFundingOut.feeCurrency || trip.baseCurrency,
              }
            : null,
      });

      await refreshEntries(1, filters);
      setPage(1);
      setSelectedSourceIds(new Set());
      setSourceCategoryId("");
      setSourceEntryType("spending");
      setSourceCounterpartyId("");
      setSourceFundingOut({
        destinationType: "bank",
        destinationTripId: "",
        destinationWalletId: "",
        destinationCurrency: trip.baseCurrency,
        destinationAmount: "",
        fxRate: "",
        feeAmount: "",
        feeCurrency: trip.baseCurrency,
      });
      setSourceFundingOutInputMode("amount");
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
    setManualEntryForm(buildEmptyEntryForm(trip.baseCurrency));
  };

  const handleCreateManualEntry = async () => {
    const description = manualEntryForm.description.trim();
    if (!description) {
      showModal("warning", "Missing Description", "Description is required.");
      return;
    }
    const amountWarning = validateEntryAmounts(manualEntryForm);
    if (amountWarning) {
      showModal("warning", "Check the amounts", amountWarning);
      return;
    }

    if (manualEntryForm.type === "settlement" && !manualEntryForm.counterpartyId) {
      showModal(
        "warning",
        "Who did you pay?",
        "Choose the person this settlement pays back.",
      );
      return;
    }

    const baseAmount = Number(manualEntryForm.baseAmount) || null;
    const fxRate = Number(manualEntryForm.fxRate) || null;
    const isIou =
      manualEntryForm.type === "spending" &&
      !!manualEntryForm.paidByParticipantId;

    setIsBusy(true);
    try {
      if (isIou || manualEntryForm.type === "settlement") {
        await createTripPeopleEntry(trip.id, {
          // Someone else paid for an IOU, so it never comes out of a wallet.
          walletId:
            isIou || manualEntryForm.walletId === "__none__"
              ? null
              : manualEntryForm.walletId,
          type: manualEntryForm.type,
          paidByParticipantId: isIou ? manualEntryForm.paidByParticipantId : null,
          counterpartyId:
            manualEntryForm.type === "settlement"
              ? manualEntryForm.counterpartyId
              : null,
          date: manualEntryForm.date,
          description,
          label: manualEntryForm.label.trim() || null,
          categoryId: isIou ? manualEntryForm.categoryId || null : null,
          localCurrency: manualEntryForm.localCurrency.trim().toUpperCase(),
          localAmount: Number(manualEntryForm.localAmount),
          baseAmount,
          fxRate,
          metadata: { source: "manual_trip_entry_modal" },
        });
      } else {
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
          localCurrency: manualEntryForm.localCurrency.trim().toUpperCase(),
          localAmount: Number(manualEntryForm.localAmount),
          // Left blank, the server values a wallet entry at the wallet's average rate.
          baseAmount,
          fxRate,
          feeAmount: null,
          feeCurrency: null,
          fundingOut:
            manualEntryForm.type === "funding_out"
              ? buildFundingOutPayload(manualEntryForm, trip.baseCurrency)
              : null,
          metadata: {
            source: "manual_trip_entry_modal",
          },
        });
      }

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

  const editingEntry = useMemo(
    () =>
      editingEntryId
        ? entries.find((entry) => entry.id === editingEntryId) || null
        : null,
    [editingEntryId, entries],
  );
  const sharingEntry = useMemo(
    () =>
      sharingEntryId
        ? entries.find((entry) => entry.id === sharingEntryId) || null
        : null,
    [sharingEntryId, entries],
  );
  const editingEntryFromBank = Boolean(
    toRecord(editingEntry?.metadata)?.sourceTransactionId,
  );

  const handleOpenEntryEditor = (transaction: TransactionCardTransaction) => {
    const entry = entries.find((item) => item.id === transaction.id);
    if (!entry) {
      showModal(
        "error",
        "Transaction Not Found",
        "Unable to open the editor for this row.",
      );
      return;
    }
    if (entry.type === "funding_in") {
      setFundingInNoticeOpen(true);
      return;
    }
    const form = buildEntryEditForm(entry, trip.baseCurrency);
    setEntryEditForm(form);
    setEntryEditInitial(form);
    setEditingEntryId(entry.id);
  };

  const closeEntryEditor = () => {
    setEditingEntryId(null);
    setEntryEditInitial(null);
  };

  const handleSaveEntryEdit = async () => {
    if (!editingEntry || !entryEditInitial) return;
    const form = entryEditForm;
    const initial = entryEditInitial;
    const description = form.description.trim();
    if (!description) {
      showModal("warning", "Missing Description", "Description is required.");
      return;
    }
    const amountWarning = validateEntryAmounts(form);
    if (amountWarning) {
      showModal("warning", "Check the amounts", amountWarning);
      return;
    }

    // Send only what changed, so untouched values keep their current valuation.
    const changes: Parameters<typeof updateTripEntry>[2] = {};
    if (form.date !== initial.date) changes.date = form.date;
    if (description !== initial.description.trim()) {
      changes.description = description;
    }
    if (form.label.trim() !== initial.label.trim()) {
      changes.label = form.label.trim() || null;
    }
    if (form.type === "spending" && form.categoryId !== initial.categoryId) {
      changes.categoryId = form.categoryId || null;
    }
    if (!editingEntryFromBank) {
      if (form.walletId !== initial.walletId) {
        changes.walletId = form.walletId === "__none__" ? null : form.walletId;
      }
      const currency = form.localCurrency.trim().toUpperCase();
      if (currency !== initial.localCurrency) changes.localCurrency = currency;
      if (Number(form.localAmount) !== Number(initial.localAmount)) {
        changes.localAmount = Number(form.localAmount);
      }
      if (form.baseAmount.trim() && form.baseAmount !== initial.baseAmount) {
        changes.baseAmount = Number(form.baseAmount);
      }
      if (form.fxRate.trim()) changes.fxRate = Number(form.fxRate);
    }
    if (
      form.type === "funding_out" &&
      FUNDING_OUT_FORM_FIELDS.some((field) => form[field] !== initial[field])
    ) {
      changes.fundingOut = buildFundingOutPayload(form, trip.baseCurrency);
    }

    if (Object.keys(changes).length === 0) {
      closeEntryEditor();
      return;
    }

    setIsBusy(true);
    try {
      await updateTripEntry(trip.id, editingEntry.id, changes);
      await Promise.all([
        refreshEntries(page, filters),
        refreshFundingsAndWallets(),
        refreshSharedOverview(),
      ]);
      closeEntryEditor();
      showModal("success", "Entry Updated", "Trip entry saved.");
    } catch (error) {
      showModal(
        "error",
        "Update Failed",
        error instanceof Error ? error.message : "Could not update the entry.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveTripReimbursementLinkage = async (
    linkage: ImportTransactionLinkage,
  ) => {
    if (!activeReimbursementEntry) return;

    const allocations = (linkage.reimbursesAllocations || [])
      .map((item) => {
        if (!item.transactionId) return null;
        const amountBase = Number(item.amountBase ?? item.amount ?? 0);
        if (!(amountBase > 0)) return null;
        return {
          transactionId: item.transactionId,
          amountBase,
        };
      })
      .filter(
        (
          item,
        ): item is {
          transactionId: string;
          amountBase: number;
        } => !!item,
      );

    if (allocations.length === 0) {
      showModal(
        "warning",
        "No Transactions Selected",
        "Select at least one spending transaction to reimburse.",
      );
      return;
    }

    setIsBusy(true);
    try {
      await createTripReimbursementLink(trip.id, activeReimbursementEntry.id, {
        reimbursedAllocations: allocations,
        leftoverCategoryId: linkage.leftoverCategoryId ?? null,
        reimbursementBaseAmount:
          linkage.reimbursementBaseAmount !== undefined &&
          linkage.reimbursementBaseAmount !== null
            ? Number(linkage.reimbursementBaseAmount)
            : null,
        reimbursingFxRate:
          linkage.reimbursingFxRate !== undefined &&
          linkage.reimbursingFxRate !== null
            ? Number(linkage.reimbursingFxRate)
            : null,
        syncToBankLedger: linkage.syncToBankLedger === true,
      });
      await refreshEntries(page, filters);
      setActiveReimbursementEntryId(null);
      showModal(
        "success",
        "Reimbursement Linked",
        "Reimbursement allocations were updated.",
      );
    } catch (error) {
      showModal(
        "error",
        "Failed to Link Reimbursement",
        error instanceof Error
          ? error.message
          : "Could not update reimbursement linkage.",
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

  return (
    <div className="grid h-full min-h-0 w-full max-w-full overflow-x-hidden gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <TripTransactionsSideRail
          tripId={trip.id}
          fundingTransactions={[...fundingTransactions]
            .sort(
              (a, b) =>
                new Date(b.date).getTime() - new Date(a.date).getTime(),
            )
            .map((item) => ({
              kind:
                (item.metadata as Record<string, unknown> | undefined)
                  ?.fundingDirection === "out"
                  ? ("out" as const)
                  : ("in" as const),
              id: item.id,
              fundingId: item.id.startsWith("in:")
                ? item.id.replace(/^in:/, "")
                : undefined,
              date: item.date,
              description: item.description,
              currency: item.displayCurrency || trip.baseCurrency,
              amount: Number(item.amountIn ?? item.amountOut ?? 0),
              notice: (() => {
                const detached = toRecord(
                  (item.metadata as Record<string, unknown> | undefined)
                    ?.detachedBankTransaction,
                );
                return detached
                  ? DETACHED_SOURCE_NOTICES[String(detached.reason || "")] ||
                      DETACHED_SOURCE_NOTICES.deleted
                  : undefined;
              })(),
              walletColor: String(
                (item.metadata as Record<string, unknown> | undefined)
                  ?.walletColor || "#ffffff",
              ),
            }))}
          walletSummaries={walletSummaries}
          onEditFunding={isViewer ? undefined : handleOpenEditFunding}
          onDeleteFunding={
            isViewer
              ? undefined
              : (fundingId) => void handleDeleteFunding(fundingId)
          }
          onManageWallets={() => router.push(`/trips/${trip.id}/manage/wallets`)}
          formatCurrencyValue={formatCurrencyValue}
        />

        <section className="min-w-0 space-y-4 lg:order-1">
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
              {sharing && (
                <Button
                  variant="secondary"
                  onClick={() => router.push(`/trips/${trip.id}/shared`)}
                  leftIcon={<Users className="h-4 w-4" />}
                >
                  Shared trip
                </Button>
              )}
              {!isViewer && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => setIsAddFromMainModalOpen(true)}
                    leftIcon={<Link2 className="h-4 w-4" />}
                  >
                    Add from bank
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setIsManualEntryModalOpen(true)}
                    leftIcon={<Plus className="h-4 w-4" />}
                  >
                    Add entry
                  </Button>
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => router.push(`/trips/${trip.id}/import`)}
                    leftIcon={<FileUp className="h-4 w-4" />}
                  >
                    Import statement
                  </Button>
                </>
              )}
            </div>
          </div>
          {isViewer && (
            <p className="rounded-lg bg-gray-1 px-3 py-2 text-xs text-dark-5 dark:bg-dark-3 dark:text-dark-6">
              You can only view this shared trip.
            </p>
          )}

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
                  categories={filterCategories}
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
                  isViewer ? undefined : (
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
                  )
                }
                rightContent={
                  isViewer ? undefined : (
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
                  )
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
                onToggleSelect={isViewer ? undefined : toggleEntrySelection}
                onEdit={isViewer ? undefined : handleOpenEntryEditor}
              />
            </>
          )}
        </section>

      <TripTransactionsFundingModal
        isOpen={isFundingModalOpen}
        onClose={() => setIsFundingModalOpen(false)}
        fundingModalTab={fundingModalTab}
        setFundingModalTab={setFundingModalTab}
        setManualFunding={setManualFunding}
        pendingAutoMatchedFundings={pendingAutoMatchedFundings}
        selectedReviewFundingId={selectedReviewFundingId}
        setSelectedReviewFundingId={setSelectedReviewFundingId}
        selectedPendingFunding={selectedPendingFunding}
        suggestedReviewCandidate={suggestedReviewCandidate}
        formatCurrencyValue={formatCurrencyValue}
        isBusy={isBusy}
        onReviewMatch={handleReviewFundingMatch}
        mergeTargetFundingId={mergeTargetFundingId}
        setMergeTargetFundingId={setMergeTargetFundingId}
        mergeTargetOptions={mergeTargetOptions}
        onMergeImportedFunding={handleMergeImportedFunding}
        reviewSearch={reviewSearch}
        setReviewSearch={setReviewSearch}
        onSearchReviewCandidates={handleSearchReviewCandidates}
        isLoadingReviewCandidates={isLoadingReviewCandidates}
        reviewCandidates={reviewCandidates}
        selectedReviewReplacementIds={selectedReviewReplacementIds}
        onToggleReviewReplacementId={(id) =>
          setSelectedReviewReplacementIds((prev) => {
            if (prev.has(id)) return new Set();
            return new Set([id]);
          })
        }
        reviewCandidatesTotal={reviewCandidatesTotal}
        reviewCandidatesPage={reviewCandidatesPage}
        fundingCandidatesPageSize={fundingCandidatesPageSize}
        onReviewCandidatesPageChange={handleReviewCandidatesPageChange}
        selectedImportedFundingForAttach={selectedImportedFundingForAttach}
        selectedFundingFromList={selectedFundingFromList}
        fundingSearch={fundingSearch}
        setFundingSearch={setFundingSearch}
        onSearchFundingCandidates={handleSearchFundingCandidates}
        isLoadingFundingCandidates={isLoadingFundingCandidates}
        fundingCandidates={fundingCandidates}
        selectedFundingIds={selectedFundingIds}
        onToggleFundingId={(id) =>
          setSelectedFundingIds((prev) => {
            if (selectedImportedFundingForAttach) {
              if (prev.has(id)) return new Set();
              return new Set([id]);
            }
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        fundingCandidatesTotal={fundingCandidatesTotal}
        fundingCandidatesPage={fundingCandidatesPage}
        onFundingCandidatesPageChange={handleFundingCandidatesPageChange}
        outgoingSourceTripId={outgoingSourceTripId}
        setOutgoingSourceTripId={setOutgoingSourceTripId}
        availableTrips={allTrips.filter((item) => item.id !== trip.id)}
        outgoingSearch={outgoingSearch}
        setOutgoingSearch={setOutgoingSearch}
        onSearchOutgoingCandidates={handleSearchOutgoingCandidates}
        isLoadingOutgoingCandidates={isLoadingOutgoingCandidates}
        outgoingCandidates={outgoingCandidates}
        selectedOutgoingIds={selectedOutgoingIds}
        onToggleOutgoingId={(id) =>
          setSelectedOutgoingIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        outgoingCandidatesTotal={outgoingCandidatesTotal}
        outgoingCandidatesPage={outgoingCandidatesPage}
        outgoingCandidatesPageSize={outgoingCandidatesPageSize}
        onOutgoingCandidatesPageChange={handleOutgoingCandidatesPageChange}
        onImportFromOutgoingEntries={handleImportFromOutgoingEntries}
        fundingForm={fundingForm}
        setFundingForm={setFundingForm}
        selectedWalletId={selectedWalletId}
        setSelectedWalletId={setSelectedWalletId}
        wallets={wallets}
        selectedFundingWallet={selectedFundingWallet}
        fundingInputMode={fundingInputMode}
        setFundingInputMode={setFundingInputMode}
        baseCurrency={trip.baseCurrency}
        onLinkFunding={handleLinkFunding}
        localCategories={localCategories}
        sourceCategoryId={sourceCategoryId}
        setSourceCategoryId={setSourceCategoryId}
        onAddCategoryClick={() => setIsAddCategoryModalOpen(true)}
      />

      <TripAddFromBankModal
        isOpen={isAddFromMainModalOpen}
        onClose={() => setIsAddFromMainModalOpen(false)}
        sourceSearch={sourceSearch}
        onSourceSearchChange={setSourceSearch}
        onSearch={handleSearchSourceCandidates}
        isLoading={isLoadingSourceCandidates}
        sourceCandidates={sourceCandidates}
        selectedSourceIds={selectedSourceIds}
        onToggleSourceId={(id) =>
          setSelectedSourceIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        sourceCandidatesTotal={sourceCandidatesTotal}
        sourceCandidatesPage={sourceCandidatesPage}
        sourceCandidatesPageSize={sourceCandidatesPageSize}
        onSourceCandidatesPageChange={handleSourceCandidatesPageChange}
        sourceEntryType={sourceEntryType}
        onSourceEntryTypeChange={setSourceEntryType}
        sourceCounterpartyId={sourceCounterpartyId}
        onSourceCounterpartyIdChange={setSourceCounterpartyId}
        participants={participants}
        onAddPerson={handleAddPerson}
        sourceCategoryId={sourceCategoryId}
        onSourceCategoryIdChange={setSourceCategoryId}
        sourceFundingOut={sourceFundingOut}
        setSourceFundingOut={setSourceFundingOut}
        sourceFundingOutInputMode={sourceFundingOutInputMode}
        setSourceFundingOutInputMode={setSourceFundingOutInputMode}
        availableTrips={allTrips.filter((item) => item.id !== trip.id)}
        wallets={wallets}
        currencyOptions={currencyOptions}
        baseCurrency={trip.baseCurrency}
        localCategories={localCategories}
        onAddCategoryClick={() => setIsAddCategoryModalOpen(true)}
        isBusy={isBusy}
        onConfirmAdd={handleAddFromBankLedger}
      />

      <TripManualEntryModal
        isOpen={isManualEntryModalOpen}
        onClose={() => setIsManualEntryModalOpen(false)}
        isBusy={isBusy}
        onSubmit={handleCreateManualEntry}
        onAddCategoryClick={() => setIsAddCategoryModalOpen(true)}
        localCategories={localCategories}
        wallets={wallets}
        currencyOptions={currencyOptions}
        baseCurrency={trip.baseCurrency}
        form={manualEntryForm}
        setForm={setManualEntryForm}
        resetForm={resetManualEntryForm}
        availableTrips={allTrips.filter((item) => item.id !== trip.id)}
        participants={participants}
        onAddPerson={handleAddPerson}
      />

      <TripManualEntryModal
        mode="edit"
        isOpen={!!editingEntry}
        onClose={closeEntryEditor}
        isBusy={isBusy}
        onSubmit={() => void handleSaveEntryEdit()}
        onAddCategoryClick={() => setIsAddCategoryModalOpen(true)}
        localCategories={localCategories}
        wallets={wallets}
        currencyOptions={currencyOptions}
        baseCurrency={trip.baseCurrency}
        form={entryEditForm}
        setForm={setEntryEditForm}
        resetForm={() => undefined}
        availableTrips={allTrips.filter((item) => item.id !== trip.id)}
        lockAmounts={editingEntryFromBank}
        onEditReimbursementLinks={
          editingEntry?.type === "reimbursement"
            ? () => {
                setActiveReimbursementEntryId(editingEntry.id);
                closeEntryEditor();
              }
            : undefined
        }
        participants={participants}
        onChooseSettlementIous={
          editingEntry && asPeopleEntry(editingEntry).type === "settlement"
            ? () => {
                setSettlingEntryId(editingEntry.id);
                closeEntryEditor();
              }
            : undefined
        }
        onShareCost={
          sharing &&
          editingEntry &&
          editingEntry.type === "spending" &&
          !asPeopleEntry(editingEntry).isIou
            ? () => {
                setSharingEntryId(editingEntry.id);
                closeEntryEditor();
              }
            : undefined
        }
      />

      <TripSettleModal
        isOpen={!!settlingEntryId}
        onClose={() => setSettlingEntryId(null)}
        tripId={trip.id}
        baseCurrency={trip.baseCurrency}
        settlementEntryId={settlingEntryId}
        onSaved={() => {
          void refreshEntries(page, filters);
          showModal("success", "Settlement Updated", "Saved what this settlement pays off.");
        }}
      />

      {sharingEntry && (
        <TripShareCostModal
          key={sharingEntry.id}
          isOpen={true}
          onClose={() => setSharingEntryId(null)}
          tripId={trip.id}
          entry={{
            id: sharingEntry.id,
            title: sharingEntry.label?.trim() || sharingEntry.description,
            localAmount: sharingEntry.localAmount,
            localCurrency: sharingEntry.localCurrency,
            baseAmount: sharingEntry.baseAmount,
          }}
          members={sharedOverview?.members || []}
          existingShares={sharesByEntryId.get(sharingEntry.id) || []}
          onSaved={(overview) => {
            setSharedOverview(overview);
            void refreshEntries(page, filters);
            showModal("success", "Cost Shared", "Shares saved. They show up as IOUs for the others.");
          }}
        />
      )}

      <Modal
        isOpen={fundingInNoticeOpen}
        onClose={() => setFundingInNoticeOpen(false)}
        type="info"
        title="Edit on the funding page"
        message="Money coming into this trip is edited on the funding page."
        confirmText="Go to funding"
        cancelText="Cancel"
        onConfirm={() => {
          setFundingInNoticeOpen(false);
          router.push(`/trips/${trip.id}/manage/funding`);
        }}
      />

      <TripWalletModal
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
        walletSummaries={walletSummaries}
        walletForm={walletForm}
        setWalletForm={setWalletForm}
        currencyOptions={currencyOptions}
        isBusy={isBusy}
        onCreateWallet={handleCreateWallet}
        formatCurrencyValue={formatCurrencyValue}
      />

      <TripEditFundingModal
        isOpen={isEditFundingModalOpen}
        onClose={() => setIsEditFundingModalOpen(false)}
        isBusy={isBusy}
        wallets={wallets}
        form={editingFundingForm}
        setForm={setEditingFundingForm}
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
        baseCurrency={trip.baseCurrency}
        onSave={() => void handleSaveEditFunding()}
      />


      {activeReimbursementEntry && activeReimbursementImportTransaction && (
        <TripReimbursementSelectorModal
          isOpen={true}
          onClose={() => setActiveReimbursementEntryId(null)}
          onConfirm={(linkage) => void handleSaveTripReimbursementLinkage(linkage)}
          tripId={trip.id}
          currentIndex={0}
          transactions={[activeReimbursementImportTransaction]}
          currentLinkage={activeReimbursementImportTransaction.linkage || null}
          categories={localCategories}
          wallets={wallets}
          baseCurrency={trip.baseCurrency}
          hideCurrentImportSection
          excludeEntryId={activeReimbursementEntry.id}
          showSyncToBankToggle
        />
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
