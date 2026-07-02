"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRightCircle, Receipt, X } from "lucide-react";
import {
  searchTripEntriesForReimbursement,
  type TripReimbursementCandidate,
} from "@/app/actions/trips";
import type {
  Transaction,
  TransactionLinkage,
} from "@/components/transaction-table/types";
import { TransactionCard } from "@/components/transactions/TransactionCard";
import { AllocationEditorRow, type ReimbursementAllocationRowModel } from "@/components/reimbursement/AllocationEditorRow";
import { Button } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";
import { SearchBar } from "@/components/ui/SearchBar";
import { Select } from "@/components/ui/Select";
import { NumberInput } from "@/components/ui/NumberInput";
import { Checkbox } from "@/components/ui/Checkbox";

interface CategoryOption {
  id: string;
  name: string;
  color: string;
}

interface WalletOption {
  id: string;
  name: string;
  currency: string;
  color?: string;
}

interface TripReimbursementSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (linkage: TransactionLinkage) => void;
  tripId: string;
  currentIndex: number;
  transactions: Transaction[];
  currentLinkage?: TransactionLinkage | null;
  categories: CategoryOption[];
  wallets?: WalletOption[];
  baseCurrency: string;
  hideCurrentImportSection?: boolean;
  excludeEntryId?: string;
  showSyncToBankToggle?: boolean;
}

const PAGE_SIZE = 20;

type SelectorTab = "current" | "existing";
type AmountType = "all" | "in" | "out";

type TargetKey = string;
const toDbKey = (id: string) => `db:${id}`;
const toBatchKey = (index: number) => `batch:${index}`;

const toNumber = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toAbsAmount = (transaction?: Transaction | null) => {
  if (!transaction) return 0;
  const out = toNumber(transaction.amountOut);
  const incoming = toNumber(transaction.amountIn);
  if (out > 0) return out;
  if (incoming > 0) return incoming;
  return 0;
};

const formatDate = (date: string | Date) =>
  new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const normalizeCurrency = (value: unknown, fallback: string) => {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized || fallback.toUpperCase();
};

const getImportTransactionCurrency = (
  transaction: Transaction | undefined,
  fallback: string,
) => {
  const metadata =
    transaction?.metadata && typeof transaction.metadata === "object"
      ? (transaction.metadata as Record<string, unknown>)
      : null;
  return normalizeCurrency(
    metadata?.localCurrency ||
      metadata?.currency ||
      metadata?.statementCurrency ||
      transaction?.metadata?.toCurrency,
    fallback,
  );
};

const getImportTransactionBaseAmount = (
  transaction: Transaction,
  baseCurrency: string,
) => {
  const localAmount = toAbsAmount(transaction);
  const localCurrency = getImportTransactionCurrency(transaction, baseCurrency);
  const metadata =
    transaction.metadata && typeof transaction.metadata === "object"
      ? (transaction.metadata as Record<string, unknown>)
      : null;

  const explicitBase = toNumber(
    metadata?.baseAmount ?? metadata?.baseAmountOut ?? metadata?.baseEquivalent,
  );
  if (explicitBase > 0) return Number(explicitBase.toFixed(4));

  const explicitFx = toNumber(
    metadata?.fxRate ?? metadata?.walletFxRate ?? metadata?.intrinsicFxRate,
  );
  if (explicitFx > 0 && localAmount > 0) {
    return Number((localAmount * explicitFx).toFixed(4));
  }

  if (localCurrency === baseCurrency.toUpperCase()) {
    return Number(localAmount.toFixed(4));
  }

  return Number(localAmount.toFixed(4));
};

export function TripReimbursementSelectorModal({
  isOpen,
  onClose,
  onConfirm,
  tripId,
  currentIndex,
  transactions,
  currentLinkage,
  categories,
  wallets = [],
  baseCurrency,
  hideCurrentImportSection = false,
  excludeEntryId,
  showSyncToBankToggle = false,
}: TripReimbursementSelectorModalProps) {
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: baseCurrency.toUpperCase(),
      }),
    [baseCurrency],
  );

  const formatBase = useCallback(
    (value: number) => currencyFormatter.format(Number.isFinite(value) ? value : 0),
    [currencyFormatter],
  );

  const currentTransaction = transactions[currentIndex];
  const reimbursementLocalAmount = toAbsAmount(currentTransaction);
  const reimbursementCurrency = getImportTransactionCurrency(
    currentTransaction,
    baseCurrency,
  );
  const requiresManualValuation =
    reimbursementCurrency.toUpperCase() !== baseCurrency.toUpperCase();

  const [valuationInputMode, setValuationInputMode] = useState<"amount" | "fxRate">(
    "amount",
  );
  const [reimbursementBaseAmountInput, setReimbursementBaseAmountInput] =
    useState("");
  const [reimbursementFxInput, setReimbursementFxInput] = useState("");
  const reimbursementBaseAmountForSearch = useMemo(() => {
    if (!requiresManualValuation) return Number(reimbursementLocalAmount.toFixed(4));

    if (valuationInputMode === "amount") {
      return Number(toNumber(reimbursementBaseAmountInput).toFixed(4));
    }

    const fx = toNumber(reimbursementFxInput);
    if (!(fx > 0)) return 0;
    return Number((reimbursementLocalAmount * fx).toFixed(4));
  }, [
    requiresManualValuation,
    reimbursementLocalAmount,
    valuationInputMode,
    reimbursementBaseAmountInput,
    reimbursementFxInput,
  ]);

  const [selectedBatchIndices, setSelectedBatchIndices] = useState<Set<number>>(
    new Set(),
  );
  const [selectedDbIds, setSelectedDbIds] = useState<Set<string>>(new Set());
  const [selectedDbCache, setSelectedDbCache] = useState<
    Record<string, TripReimbursementCandidate>
  >({});
  const [allocationByTarget, setAllocationByTarget] = useState<
    Record<TargetKey, number>
  >({});
  const [leftoverCategoryId, setLeftoverCategoryId] = useState("");
  const [syncToBankLedger, setSyncToBankLedger] = useState(false);

  const [selectorTab, setSelectorTab] = useState<SelectorTab>(
    hideCurrentImportSection ? "existing" : "current",
  );

  const [currentSearch, setCurrentSearch] = useState("");
  const [currentTypeFilter, setCurrentTypeFilter] = useState<AmountType>("all");
  const [currentCategoryFilter, setCurrentCategoryFilter] = useState("");
  const [currentDateFrom, setCurrentDateFrom] = useState("");
  const [currentDateTo, setCurrentDateTo] = useState("");
  const [currentSameAmountOnly, setCurrentSameAmountOnly] = useState(false);

  const [dbSearchInput, setDbSearchInput] = useState("");
  const [dbSearchQuery, setDbSearchQuery] = useState("");
  const [dbWalletFilter, setDbWalletFilter] = useState("");
  const [dbCategoryFilter, setDbCategoryFilter] = useState("");
  const [dbDateFrom, setDbDateFrom] = useState("");
  const [dbDateTo, setDbDateTo] = useState("");
  const [dbSameAmountOnly, setDbSameAmountOnly] = useState(false);
  const [dbTransactions, setDbTransactions] = useState<TripReimbursementCandidate[]>(
    [],
  );
  const [dbTotal, setDbTotal] = useState(0);
  const [dbPage, setDbPage] = useState(1);
  const [isLoadingDb, setIsLoadingDb] = useState(false);

  const loadExistingTransactions = useCallback(
    async (
      page: number,
      query: string,
      filters?: {
        walletId?: string;
        categoryId?: string;
        dateFrom?: string;
        dateTo?: string;
        amountBaseEquals?: number;
      },
    ) => {
      setIsLoadingDb(true);
      try {
        const offset = (page - 1) * PAGE_SIZE;
        const result = await searchTripEntriesForReimbursement(tripId, {
          search: query || undefined,
          limit: PAGE_SIZE,
          offset,
          excludeEntryId,
          walletId: filters?.walletId,
          categoryId: filters?.categoryId,
          dateFrom: filters?.dateFrom,
          dateTo: filters?.dateTo,
          amountBaseEquals: filters?.amountBaseEquals,
        });

        const rows = (result?.transactions || []) as TripReimbursementCandidate[];
        setDbTransactions(rows);
        setDbTotal(typeof result?.total === "number" ? result.total : rows.length);
      } finally {
        setIsLoadingDb(false);
      }
    },
    [excludeEntryId, tripId],
  );

  useEffect(() => {
    if (!isOpen) return;

    const initialBatch = new Set<number>();
    const initialDb = new Set<string>();
    const initialAllocations: Record<TargetKey, number> = {};

    (currentLinkage?.reimbursesAllocations || []).forEach((item) => {
      const amount = toNumber(item.amountBase ?? item.amount);
      if (typeof item.transactionId === "string") {
        initialDb.add(item.transactionId);
        initialAllocations[toDbKey(item.transactionId)] = amount;
      } else if (typeof item.pendingBatchIndex === "number") {
        initialBatch.add(item.pendingBatchIndex);
        initialAllocations[toBatchKey(item.pendingBatchIndex)] = amount;
      }
    });

    setSelectedBatchIndices(initialBatch);
    setSelectedDbIds(initialDb);
    setSelectedDbCache({});
    setAllocationByTarget(initialAllocations);
    setLeftoverCategoryId(currentLinkage?.leftoverCategoryId || "");
    setSyncToBankLedger(
      showSyncToBankToggle && currentLinkage?.syncToBankLedger === true,
    );

    setSelectorTab(hideCurrentImportSection ? "existing" : "current");

    setCurrentSearch("");
    setCurrentTypeFilter("all");
    setCurrentCategoryFilter("");
    setCurrentDateFrom("");
    setCurrentDateTo("");
    setCurrentSameAmountOnly(false);

    setDbSearchInput("");
    setDbSearchQuery("");
    setDbWalletFilter("");
    setDbCategoryFilter("");
    setDbDateFrom("");
    setDbDateTo("");
    setDbSameAmountOnly(false);
    setDbPage(1);

    setValuationInputMode("amount");
    setReimbursementBaseAmountInput(
      currentLinkage?.reimbursementBaseAmount
        ? String(currentLinkage.reimbursementBaseAmount)
        : requiresManualValuation
          ? ""
          : String(reimbursementLocalAmount),
    );
    setReimbursementFxInput(
      currentLinkage?.reimbursingFxRate
        ? String(currentLinkage.reimbursingFxRate)
        : "",
    );
  }, [
    isOpen,
    currentLinkage,
    hideCurrentImportSection,
    requiresManualValuation,
    reimbursementLocalAmount,
    showSyncToBankToggle,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const page = 1;
    setDbPage(page);
    void loadExistingTransactions(page, dbSearchQuery, {
      walletId: dbWalletFilter,
      categoryId: dbCategoryFilter,
      dateFrom: dbDateFrom,
      dateTo: dbDateTo,
      amountBaseEquals:
        dbSameAmountOnly ? reimbursementBaseAmountForSearch : undefined,
    });
  }, [
    isOpen,
    dbSearchQuery,
    dbWalletFilter,
    dbCategoryFilter,
    dbDateFrom,
    dbDateTo,
    dbSameAmountOnly,
    reimbursementBaseAmountForSearch,
    loadExistingTransactions,
  ]);

  useEffect(() => {
    setSelectedDbCache((prev) => {
      let hasChange = false;
      const next = { ...prev };
      for (const row of dbTransactions) {
        if (selectedDbIds.has(row.id) && !next[row.id]) {
          next[row.id] = row;
          hasChange = true;
        }
      }
      return hasChange ? next : prev;
    });
  }, [dbTransactions, selectedDbIds]);

  const categoryOptions = useMemo(
    () => [
      { value: "", label: "All categories" },
      { value: "__uncategorized__", label: "Uncategorized" },
      ...categories.map((category) => ({
        value: category.id,
        label: category.name,
      })),
    ],
    [categories],
  );

  const walletOptions = useMemo(() => {
    const fromRows = dbTransactions
      .map((row) => row.wallet)
      .filter((wallet): wallet is NonNullable<typeof wallet> => !!wallet?.id)
      .map((wallet) => ({
        id: String(wallet.id),
        name: wallet.name || "Unnamed wallet",
        currency: wallet.currency || "",
      }));

    const merged = new Map<string, { value: string; label: string }>();
    [...wallets, ...fromRows].forEach((wallet) => {
      if (!wallet?.id || merged.has(wallet.id)) return;
      const currency = wallet.currency ? ` (${wallet.currency})` : "";
      merged.set(wallet.id, {
        value: wallet.id,
        label: `${wallet.name}${currency}`,
      });
    });

    return [
      { value: "", label: "All wallets" },
      { value: "__no_wallet__", label: "No wallet (Bank ledger)" },
      ...Array.from(merged.values()),
    ];
  }, [wallets, dbTransactions]);

  const selectableBatchTransactions = useMemo(() => {
    if (hideCurrentImportSection) return [] as Array<{
      transaction: Transaction;
      index: number;
      baseAmount: number;
      localAmount: number;
      localCurrency: string;
    }>;

    const rows = transactions
      .map((transaction, index) => ({
        transaction,
        index,
        localAmount: toAbsAmount(transaction),
        localCurrency: getImportTransactionCurrency(transaction, baseCurrency),
        baseAmount: getImportTransactionBaseAmount(transaction, baseCurrency),
      }))
      .filter((item) => {
        if (item.index === currentIndex) return false;
        if (!(toNumber(item.transaction.amountOut) > 0)) return false;
        if (item.transaction.entryTypeOverride === "funding_out") return false;
        const transactionType = String(
          (
            (item.transaction.metadata as Record<string, unknown> | null) || {}
          ).transactionType || "",
        )
          .trim()
          .toLowerCase();
        if (transactionType === "conversion" || transactionType === "topup") return false;
        if (item.transaction.linkage?.type === "reimbursement") return false;
        return true;
      });

    const afterCurrent = rows.filter((item) => item.index > currentIndex);
    const beforeCurrent = rows.filter((item) => item.index < currentIndex);
    return [...afterCurrent, ...beforeCurrent];
  }, [
    transactions,
    currentIndex,
    hideCurrentImportSection,
    baseCurrency,
  ]);

  const filteredCurrentImportItems = useMemo(() => {
    const query = currentSearch.trim().toLowerCase();
    return selectableBatchTransactions.filter((item) => {
      const txCategory = item.transaction.categoryId || "__uncategorized__";
      const amountIn = toNumber(item.transaction.amountIn);
      const amountOut = toNumber(item.transaction.amountOut);

      const matchesSearch =
        !query ||
        item.transaction.description.toLowerCase().includes(query) ||
        (item.transaction.label || "").toLowerCase().includes(query);

      const matchesType =
        currentTypeFilter === "all" ||
        (currentTypeFilter === "in" && amountIn > 0) ||
        (currentTypeFilter === "out" && amountOut > 0);

      const matchesCategory =
        !currentCategoryFilter || txCategory === currentCategoryFilter;

      const txDate = item.transaction.date || "";
      const matchesDateFrom = !currentDateFrom || txDate >= currentDateFrom;
      const matchesDateTo = !currentDateTo || txDate <= currentDateTo;
      const matchesAmount =
        !currentSameAmountOnly ||
        Math.abs(item.baseAmount - reimbursementBaseAmountForSearch) <= 0.0001;

      return (
        matchesSearch &&
        matchesType &&
        matchesCategory &&
        matchesDateFrom &&
        matchesDateTo &&
        matchesAmount
      );
    });
  }, [
    selectableBatchTransactions,
    currentSearch,
    currentTypeFilter,
    currentCategoryFilter,
    currentDateFrom,
    currentDateTo,
    currentSameAmountOnly,
    reimbursementBaseAmountForSearch,
  ]);

  const selectedBatchItems = selectableBatchTransactions.filter((item) =>
    selectedBatchIndices.has(item.index),
  );

  const selectedDbItems = useMemo(
    () =>
      Array.from(selectedDbIds)
        .map((id) => selectedDbCache[id] || dbTransactions.find((item) => item.id === id))
        .filter((item): item is TripReimbursementCandidate => !!item),
    [selectedDbIds, selectedDbCache, dbTransactions],
  );

  const stagedAllocatedByBatchIndex = useMemo(() => {
    const map = new Map<number, number>();
    transactions.forEach((transaction, index) => {
      if (index === currentIndex) return;
      if (transaction.linkage?.type !== "reimbursement") return;
      (transaction.linkage.reimbursesAllocations || []).forEach((allocation) => {
        if (typeof allocation.pendingBatchIndex !== "number") return;
        const amount = toNumber(
          (allocation as unknown as { amountBase?: number }).amountBase ??
            allocation.amount,
        );
        if (!(amount > 0)) return;
        map.set(
          allocation.pendingBatchIndex,
          Number(
            ((map.get(allocation.pendingBatchIndex) || 0) + amount).toFixed(4),
          ),
        );
      });
    });
    return map;
  }, [transactions, currentIndex]);

  const stagedAllocatedByDbId = useMemo(() => {
    const map = new Map<string, number>();
    transactions.forEach((transaction, index) => {
      if (index === currentIndex) return;
      if (transaction.linkage?.type !== "reimbursement") return;
      (transaction.linkage.reimbursesAllocations || []).forEach((allocation) => {
        if (typeof allocation.transactionId !== "string") return;
        const amount = toNumber(
          (allocation as unknown as { amountBase?: number }).amountBase ??
            allocation.amount,
        );
        if (!(amount > 0)) return;
        map.set(
          allocation.transactionId,
          Number(((map.get(allocation.transactionId) || 0) + amount).toFixed(4)),
        );
      });
    });
    return map;
  }, [transactions, currentIndex]);

  const selectedItems = [
    ...selectedBatchItems.map((item) => ({
      key: toBatchKey(item.index),
      title: item.transaction.label?.trim() || item.transaction.description,
      subtitle: `${formatDate(item.transaction.date)} · Current import`,
      reimbursableAmount: item.baseAmount,
      alreadyAllocated: Number(
        (stagedAllocatedByBatchIndex.get(item.index) || 0).toFixed(4),
      ),
      onRemove: () => {
        setSelectedBatchIndices((prev) => {
          const next = new Set(prev);
          next.delete(item.index);
          return next;
        });
      },
    })),
    ...selectedDbItems.map((item) => ({
      key: toDbKey(item.id),
      title: item.label?.trim() || item.description,
      subtitle: `${formatDate(item.date)} · Existing transaction`,
      reimbursableAmount: Number(item.baseAmount || 0),
      alreadyAllocated: Number(
        ((item.alreadyAllocatedBase || 0) + (stagedAllocatedByDbId.get(item.id) || 0)).toFixed(
          4,
        ),
      ),
      onRemove: () => {
        setSelectedDbIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        setSelectedDbCache((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
      },
    })),
  ].map((item) => ({
    ...item,
    reimbursableAmount: Number(
      Math.max(item.reimbursableAmount - item.alreadyAllocated, 0).toFixed(4),
    ),
  }));

  const reimbursementBaseAmount = reimbursementBaseAmountForSearch;

  const setAllocation = (key: string, value: number) => {
    setAllocationByTarget((prev) => ({
      ...prev,
      [key]: Number.isFinite(value) ? Number(value.toFixed(4)) : 0,
    }));
  };

  const getBudgetForKey = useCallback(
    (key: string) => {
      const allocatedByOthers = selectedItems
        .filter((item) => item.key !== key)
        .reduce((sum, item) => {
          const allocated = toNumber(allocationByTarget[item.key]);
          const clamped = Math.min(allocated, item.reimbursableAmount);
          return sum + clamped;
        }, 0);
      return Number(Math.max(reimbursementBaseAmount - allocatedByOthers, 0).toFixed(4));
    },
    [selectedItems, allocationByTarget, reimbursementBaseAmount],
  );

  const totalAllocated = selectedItems.reduce((sum, item) => {
    const maxAllowed = Math.min(item.reimbursableAmount, getBudgetForKey(item.key));
    const allocated = Math.min(toNumber(allocationByTarget[item.key]), maxAllowed);
    return sum + allocated;
  }, 0);

  const remainingBase = Number((reimbursementBaseAmount - totalAllocated).toFixed(4));

  const allocationEditorItems: ReimbursementAllocationRowModel[] = selectedItems.map((item) => {
    const maxAllowed = Math.min(item.reimbursableAmount, getBudgetForKey(item.key));
    const allocatedNow = Math.min(toNumber(allocationByTarget[item.key]), maxAllowed);
    const leftoverAfterAllocation = Number(
      Math.max(item.reimbursableAmount - allocatedNow, 0).toFixed(4),
    );

    return {
      key: item.key,
      title: item.title,
      subtitle: item.subtitle,
      reimbursableAmount: item.reimbursableAmount,
      alreadyAllocated: item.alreadyAllocated,
      allocatedNow,
      maxAllowed,
      leftoverAfterAllocation,
      onSetAllocation: (value) => {
        setAllocation(item.key, Math.min(Math.max(value, 0), maxAllowed));
      },
      onSetPercent: (percent) => {
        const normalized = Math.max(percent, 0);
        const amountFromPercent = (item.reimbursableAmount * normalized) / 100;
        setAllocation(item.key, Math.min(amountFromPercent, maxAllowed));
      },
      onSetFull: () => setAllocation(item.key, maxAllowed),
      onSetHalf: () =>
        setAllocation(item.key, Math.min(item.reimbursableAmount / 2, maxAllowed)),
      onRemove: () => {
        item.onRemove();
        setAllocationByTarget((prev) => {
          const next = { ...prev };
          delete next[item.key];
          return next;
        });
      },
    };
  });

  const handleToggleBatch = (index: number, maxAmount: number) => {
    const key = toBatchKey(index);

    if (selectedBatchIndices.has(index)) {
      setSelectedBatchIndices((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
      setAllocationByTarget((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }

    setSelectedBatchIndices((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });

    if (allocationByTarget[key] === undefined) {
      setAllocation(key, Math.min(maxAmount, getBudgetForKey(key)));
    }
  };

  const handleToggleDb = (item: TripReimbursementCandidate) => {
    const key = toDbKey(item.id);

    if (selectedDbIds.has(item.id)) {
      setSelectedDbIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      setSelectedDbCache((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      setAllocationByTarget((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }

    const maxAmount = Number(
      Math.max(
        Number(item.remainingBase || 0) - (stagedAllocatedByDbId.get(item.id) || 0),
        0,
      ).toFixed(4),
    );
    setSelectedDbIds((prev) => {
      const next = new Set(prev);
      next.add(item.id);
      return next;
    });
    setSelectedDbCache((prev) => ({ ...prev, [item.id]: item }));

    if (allocationByTarget[key] === undefined) {
      setAllocation(key, Math.min(maxAmount, getBudgetForKey(key)));
    }
  };

  const toImportCardTransaction = useCallback(
    (
      item: {
        transaction: Transaction;
        index: number;
        baseAmount: number;
        localAmount: number;
        localCurrency: string;
      },
    ) => {
      const category = categories.find((entry) => entry.id === item.transaction.categoryId);
      const secondaryAmount =
        item.localCurrency !== baseCurrency.toUpperCase() && item.localAmount > 0
          ? {
              value: item.localAmount,
              currency: item.localCurrency,
              direction: "out" as const,
              label: "Statement amount",
            }
          : undefined;

      return {
        id: `batch-${item.index}`,
        date: item.transaction.date,
        description: item.transaction.description,
        label: item.transaction.label || undefined,
        amountIn: null,
        amountOut: item.baseAmount,
        balance: item.transaction.balance ?? null,
        displayCurrency: baseCurrency,
        secondaryAmount,
        category: category
          ? {
              id: category.id,
              name: category.name,
              color: category.color,
            }
          : undefined,
        metadata:
          item.transaction.metadata && typeof item.transaction.metadata === "object"
            ? {
                ...(item.transaction.metadata as Record<string, unknown>),
                localAmount: item.localAmount,
                localCurrency: item.localCurrency,
                baseAmount: item.baseAmount,
              }
            : {
                localAmount: item.localAmount,
                localCurrency: item.localCurrency,
                baseAmount: item.baseAmount,
              },
      };
    },
    [categories, baseCurrency],
  );

  const toDbCardTransaction = useCallback(
    (item: TripReimbursementCandidate) => {
      const secondaryAmount =
        item.localCurrency?.toUpperCase() !== baseCurrency.toUpperCase() &&
        Number(item.localAmount || 0) > 0
          ? {
              value: Number(item.localAmount || 0),
              currency: String(item.localCurrency || "").toUpperCase(),
              direction: "out" as const,
              label: "Wallet amount",
            }
          : undefined;

      return {
        id: item.id,
        date: item.date,
        description: item.description,
        label: item.label || undefined,
        amountIn: null,
        amountOut: Number(item.baseAmount || 0),
        balance: null,
        displayCurrency: baseCurrency,
        secondaryAmount,
        category:
          item.category?.id && item.category?.name
            ? {
                id: String(item.category.id),
                name: item.category.name,
                color: item.category.color || "#94a3b8",
              }
            : undefined,
        accentColor: item.wallet?.color || undefined,
        metadata: {
          localAmount: item.localAmount,
          localCurrency: item.localCurrency,
          baseAmount: item.baseAmount,
          wallet: item.wallet?.name,
          walletCurrency: item.wallet?.currency,
          alreadyAllocatedBase: item.alreadyAllocatedBase,
          remainingBase: item.remainingBase,
        },
      };
    },
    [baseCurrency],
  );

  const handleConfirm = () => {
    if (
      requiresManualValuation &&
      !(reimbursementBaseAmount > 0) &&
      reimbursementLocalAmount > 0
    ) {
      return;
    }

    const reimburseAllocations = selectedItems
      .map((item) => {
        const maxAllowed = Math.min(item.reimbursableAmount, getBudgetForKey(item.key));
        const amountBase = Math.min(toNumber(allocationByTarget[item.key]), maxAllowed);
        if (amountBase <= 0) return null;

        if (item.key.startsWith("db:")) {
          return {
            transactionId: item.key.slice(3),
            amount: amountBase,
            amountBase,
          };
        }

        return {
          pendingBatchIndex: Number(item.key.slice(6)),
          amount: amountBase,
          amountBase,
        };
      })
      .filter((item): item is NonNullable<typeof item> => !!item);

    const linkage: TransactionLinkage = {
      type: "reimbursement",
      reimbursesAllocations: reimburseAllocations,
      leftoverAmount: Number(Math.max(remainingBase, 0).toFixed(4)),
      leftoverCategoryId:
        remainingBase > 0 && leftoverCategoryId ? leftoverCategoryId : null,
      reimbursementBaseAmount: Number(reimbursementBaseAmount.toFixed(4)),
      reimbursingFxRate:
        reimbursementLocalAmount > 0
          ? Number((reimbursementBaseAmount / reimbursementLocalAmount).toFixed(8))
          : undefined,
      syncToBankLedger: showSyncToBankToggle ? syncToBankLedger : undefined,
    };

    onConfirm(linkage);
    onClose();
  };

  const dbTotalPages = Math.max(1, Math.ceil(dbTotal / PAGE_SIZE));

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[92vh] w-[95vw] max-w-[1500px] flex-col overflow-hidden rounded-xl border border-stroke bg-white shadow-xl dark:border-dark-3 dark:bg-dark-2"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-stroke px-6 py-4 dark:border-dark-3">
          <div className="flex items-center gap-3">
            <Receipt className="h-6 w-6 text-green" />
            <div>
              <h3 className="text-lg font-semibold text-dark dark:text-white">
                Trip Reimbursement Allocation
              </h3>
              <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                Select reimbursed trip transactions and allocate amounts in base currency.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 transition-colors hover:bg-gray-1 dark:hover:bg-dark-3"
          >
            <X className="h-5 w-5 text-dark-5 dark:text-dark-6" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden px-6 py-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(420px,1fr)]">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-stroke dark:border-dark-3">
            {!hideCurrentImportSection ? (
              <div className="border-b border-stroke px-3 pt-2 dark:border-dark-3">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectorTab("current")}
                    className={`rounded-t-md px-3 py-2 text-sm font-medium transition-colors ${
                      selectorTab === "current"
                        ? "bg-primary/10 text-primary"
                        : "text-dark-5 hover:bg-gray-1 dark:text-dark-6 dark:hover:bg-dark-3"
                    }`}
                  >
                    Current Import
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectorTab("existing")}
                    className={`rounded-t-md px-3 py-2 text-sm font-medium transition-colors ${
                      selectorTab === "existing"
                        ? "bg-primary/10 text-primary"
                        : "text-dark-5 hover:bg-gray-1 dark:text-dark-6 dark:hover:bg-dark-3"
                    }`}
                  >
                    Existing Transactions
                  </button>
                </div>
              </div>
            ) : null}

            <div className="border-b border-stroke p-3 dark:border-dark-3">
              <div className="space-y-2">
                <div className="flex flex-wrap items-end gap-2">
                  <SearchBar
                    placeholder="Search label or description"
                    value={selectorTab === "current" ? currentSearch : dbSearchInput}
                    onChange={
                      selectorTab === "current" ? setCurrentSearch : setDbSearchInput
                    }
                    onSearch={
                      selectorTab === "current"
                        ? undefined
                        : () => setDbSearchQuery(dbSearchInput.trim())
                    }
                    showButton={selectorTab === "existing"}
                    isLoading={selectorTab === "existing" ? isLoadingDb : false}
                    className="min-w-[260px] flex-1"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant={
                      (selectorTab === "current"
                        ? currentSameAmountOnly
                        : dbSameAmountOnly)
                        ? "primary"
                        : "secondary"
                    }
                    onClick={() => {
                      if (selectorTab === "current") {
                        setCurrentSameAmountOnly((prev) => !prev);
                        return;
                      }
                      setDbPage(1);
                      setDbSameAmountOnly((prev) => !prev);
                    }}
                    disabled={reimbursementBaseAmount <= 0}
                  >
                    Same outflow amount ({formatBase(reimbursementBaseAmount)})
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (selectorTab === "current") {
                        setCurrentSearch("");
                        setCurrentTypeFilter("all");
                        setCurrentCategoryFilter("");
                        setCurrentDateFrom("");
                        setCurrentDateTo("");
                        setCurrentSameAmountOnly(false);
                        return;
                      }
                      setDbSearchInput("");
                      setDbSearchQuery("");
                      setDbWalletFilter("");
                      setDbCategoryFilter("");
                      setDbDateFrom("");
                      setDbDateTo("");
                      setDbSameAmountOnly(false);
                      setDbPage(1);
                    }}
                  >
                    Reset filters
                  </Button>
                </div>

                <div
                  className={`grid grid-cols-1 gap-2 ${
                    selectorTab === "existing" ? "md:grid-cols-5" : "md:grid-cols-4"
                  }`}
                >
                  <Select
                    value={selectorTab === "current" ? currentTypeFilter : "out"}
                    onChange={(value) => {
                      if (selectorTab === "current") {
                        setCurrentTypeFilter(value as AmountType);
                      }
                    }}
                    options={[
                      { value: "all", label: "All types" },
                      { value: "in", label: "In only" },
                      { value: "out", label: "Out only" },
                    ]}
                    disabled={selectorTab === "existing"}
                    menuStrategy="fixed"
                  />

                  <Select
                    value={selectorTab === "current" ? currentCategoryFilter : dbCategoryFilter}
                    onChange={(value) => {
                      if (selectorTab === "current") {
                        setCurrentCategoryFilter(value);
                      } else {
                        setDbCategoryFilter(value);
                      }
                    }}
                    options={categoryOptions}
                    menuStrategy="fixed"
                  />

                  {selectorTab === "existing" ? (
                    <Select
                      value={dbWalletFilter}
                      onChange={setDbWalletFilter}
                      options={walletOptions}
                      menuStrategy="fixed"
                    />
                  ) : null}

                  <DatePicker
                    value={selectorTab === "current" ? currentDateFrom : dbDateFrom}
                    onChange={(value) => {
                      if (selectorTab === "current") {
                        setCurrentDateFrom(value);
                      } else {
                        setDbDateFrom(value);
                      }
                    }}
                  />
                  <DatePicker
                    value={selectorTab === "current" ? currentDateTo : dbDateTo}
                    onChange={(value) => {
                      if (selectorTab === "current") {
                        setCurrentDateTo(value);
                      } else {
                        setDbDateTo(value);
                      }
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="space-y-2">
                {selectorTab === "current" ? (
                  filteredCurrentImportItems.length === 0 ? (
                    <div className="py-8 text-center text-sm text-dark-5 dark:text-dark-6">
                      No current-import transactions found.
                    </div>
                  ) : (
                    filteredCurrentImportItems.map((item) => (
                      (() => {
                        const stagedAlready = stagedAllocatedByBatchIndex.get(item.index) || 0;
                        const selectableAmount = Math.max(
                          Number(item.baseAmount || 0) - stagedAlready,
                          0,
                        );
                        return (
                      <TransactionCard
                        key={toBatchKey(item.index)}
                        transaction={toImportCardTransaction(item)}
                        selected={selectedBatchIndices.has(item.index)}
                        selectionTone="success"
                        onToggleSelect={() =>
                          handleToggleBatch(item.index, selectableAmount)
                        }
                        wrapText
                      />
                        );
                      })()
                    ))
                  )
                ) : isLoadingDb ? (
                  <div className="py-8 text-center text-sm text-dark-5 dark:text-dark-6">
                    Loading transactions...
                  </div>
                ) : dbTransactions.length === 0 ? (
                  <div className="py-8 text-center text-sm text-dark-5 dark:text-dark-6">
                    No existing transactions found.
                  </div>
                ) : (
                  dbTransactions.map((item) => (
                    <TransactionCard
                      key={item.id}
                      transaction={toDbCardTransaction(item)}
                      selected={selectedDbIds.has(item.id)}
                      selectionTone="success"
                      onToggleSelect={() => handleToggleDb(item)}
                      wrapText
                    />
                  ))
                )}
              </div>
            </div>

            {selectorTab === "existing" ? (
              <div className="flex items-center justify-between border-t border-stroke px-3 py-2 text-xs text-dark-5 dark:border-dark-3 dark:text-dark-6">
                <span>
                  Showing {(dbPage - 1) * PAGE_SIZE + 1} to {Math.min(dbPage * PAGE_SIZE, dbTotal)} of {dbTotal}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={dbPage <= 1 || isLoadingDb}
                    onClick={() => {
                      const page = dbPage - 1;
                      setDbPage(page);
                      void loadExistingTransactions(page, dbSearchQuery, {
                        walletId: dbWalletFilter,
                        categoryId: dbCategoryFilter,
                        dateFrom: dbDateFrom,
                        dateTo: dbDateTo,
                        amountBaseEquals:
                          dbSameAmountOnly ? reimbursementBaseAmount : undefined,
                      });
                    }}
                  >
                    Prev
                  </Button>
                  <span>
                    {dbPage}/{dbTotalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={dbPage >= dbTotalPages || isLoadingDb}
                    onClick={() => {
                      const page = dbPage + 1;
                      setDbPage(page);
                      void loadExistingTransactions(page, dbSearchQuery, {
                        walletId: dbWalletFilter,
                        categoryId: dbCategoryFilter,
                        dateFrom: dbDateFrom,
                        dateTo: dbDateTo,
                        amountBaseEquals:
                          dbSameAmountOnly ? reimbursementBaseAmount : undefined,
                      });
                    }}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-col rounded-lg border border-stroke dark:border-dark-3">
            <div className="border-b border-stroke p-3 dark:border-dark-3">
              <div className="text-sm font-semibold text-dark dark:text-white">
                Reimbursement Summary
              </div>

              <div className="mt-2 rounded-lg border border-stroke bg-gray-1/60 p-2 text-xs text-dark-5 dark:border-dark-3 dark:bg-dark-3/40 dark:text-dark-6">
                Reimbursement inflow: <span className="font-medium text-dark dark:text-white">{reimbursementLocalAmount.toFixed(2)} {reimbursementCurrency}</span>
              </div>

              {requiresManualValuation ? (
                <div className="mt-3 space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <p className="text-xs font-medium text-dark dark:text-white">
                    Cross-currency reimbursement valuation required
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-xs text-dark dark:text-white">
                      <input
                        type="radio"
                        checked={valuationInputMode === "amount"}
                        onChange={() => setValuationInputMode("amount")}
                      />
                      Base amount
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs text-dark dark:text-white">
                      <input
                        type="radio"
                        checked={valuationInputMode === "fxRate"}
                        onChange={() => setValuationInputMode("fxRate")}
                      />
                      FX rate ({reimbursementCurrency}→{baseCurrency})
                    </label>
                  </div>

                  <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                    <NumberInput
                      value={reimbursementBaseAmountInput}
                      onChange={(event) =>
                        setReimbursementBaseAmountInput(event.target.value)
                      }
                      placeholder={`Base amount (${baseCurrency})`}
                      disabled={valuationInputMode !== "amount"}
                    />
                    <NumberInput
                      value={reimbursementFxInput}
                      onChange={(event) => setReimbursementFxInput(event.target.value)}
                      placeholder="FX rate"
                      disabled={valuationInputMode !== "fxRate"}
                    />
                  </div>
                </div>
              ) : null}

              <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
                <div className="flex items-start justify-between">
                  <span className="text-dark-5 dark:text-dark-6">Reimbursable amount</span>
                  <span className="text-2xl font-semibold text-green">{formatBase(reimbursementBaseAmount)}</span>
                </div>
                <div className="flex items-start justify-between">
                  <span className="text-dark-5 dark:text-dark-6">Leftover amount</span>
                  <span className="text-xl font-semibold text-red">{formatBase(Math.max(remainingBase, 0))}</span>
                </div>
              </div>
            </div>

            <div className="border-b border-stroke p-3 dark:border-dark-3">
              <label className="mb-1 block text-xs font-medium text-dark-5 dark:text-dark-6">
                Leftover Category (optional)
              </label>
              <Select
                value={leftoverCategoryId}
                onChange={setLeftoverCategoryId}
                options={[
                  { value: "", label: "Uncategorized" },
                  ...categories.map((category) => ({
                    value: category.id,
                    label: category.name,
                  })),
                ]}
                menuStrategy="fixed"
              />

              {showSyncToBankToggle ? (
                <div className="mt-3 rounded-lg border border-stroke bg-gray-1/60 p-3 dark:border-dark-3 dark:bg-dark-3/40">
                  <label className="flex items-start gap-2">
                    <Checkbox
                      checked={syncToBankLedger}
                      onChange={setSyncToBankLedger}
                    />
                    <span className="text-xs leading-5 text-dark dark:text-white">
                      Sync to bank ledger (mark source bank credit as reimbursement with no targets)
                    </span>
                  </label>
                </div>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="space-y-2">
                {allocationEditorItems.length === 0 ? (
                  <div className="py-8 text-center text-sm text-dark-5 dark:text-dark-6">
                    Select transactions from the left panel.
                  </div>
                ) : (
                  allocationEditorItems.map((item) => (
                    <AllocationEditorRow
                      key={item.key}
                      item={item}
                      formatAmount={formatBase}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-between border-t border-stroke p-4 dark:border-dark-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="success"
            onClick={handleConfirm}
            disabled={
              remainingBase < -0.0001 ||
              (requiresManualValuation && !(reimbursementBaseAmount > 0))
            }
            leftIcon={<ArrowRightCircle className="h-4 w-4" />}
          >
            Save Reimbursement
          </Button>
        </div>
      </div>
    </div>
  );
}
