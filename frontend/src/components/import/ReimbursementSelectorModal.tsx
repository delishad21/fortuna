"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowRightCircle, Receipt, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";
import { SearchBar } from "@/components/ui/SearchBar";
import { Select } from "@/components/ui/Select";
import {
  AllocationEditorRow,
  type ReimbursementAllocationRowModel,
} from "@/components/reimbursement/AllocationEditorRow";
import {
  Transaction,
  TransactionLinkage,
} from "@/components/transaction-table/types";
import { TransactionCard } from "@/components/transactions/TransactionCard";
import { searchTransactionsForReimbursement } from "@/app/actions/transactions";

interface Category {
  id: string;
  name: string;
  color: string;
}

interface DatabaseTransaction {
  id: string;
  date: string;
  description: string;
  label?: string | null;
  amountIn: number | null;
  amountOut: number | null;
  balance?: number | null;
  metadata?: Record<string, unknown> | null;
  category?: {
    id?: string;
    name: string;
    color: string;
  } | null;
  linkage?: TransactionLinkage | null;
}

interface ReimbursementSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (linkage: TransactionLinkage) => void;
  currentIndex: number;
  transactions: Transaction[];
  currentLinkage?: TransactionLinkage | null;
  includeCurrentImport?: boolean;
  excludeTransactionId?: string;
  categories?: Category[];
  currentReimbursementId?: string;
  initialSelectedDbTransactions?: DatabaseTransaction[];
}

const PAGE_SIZE = 20;
const DEFAULT_INITIAL_SELECTED_DB_TRANSACTIONS: DatabaseTransaction[] = [];

export const getDefaultInitialSelectedDbTransactions = () =>
  DEFAULT_INITIAL_SELECTED_DB_TRANSACTIONS;

type SelectorTab = "current" | "existing";
type AmountType = "all" | "in" | "out";

const toNumber = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toAbsTransactionAmount = (
  amountIn?: number | null,
  amountOut?: number | null,
) => {
  const inValue = toNumber(amountIn);
  const outValue = toNumber(amountOut);
  if (outValue > 0) return outValue;
  if (inValue > 0) return inValue;
  return 0;
};

const formatDate = (date: string | Date) =>
  new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const formatAmount = (amount: number) => `$${amount.toFixed(2)}`;

type TargetKey = string;
const toDbKey = (id: string) => `db:${id}`;
const toBatchKey = (index: number) => `batch:${index}`;

export function buildCurrentImportReimbursementItems(
  transactions: Transaction[],
  currentIndex: number,
) {
  return transactions
    .map((transaction, index) => ({
      ...transaction,
      index,
      dateLabel: formatDate(transaction.date),
    }))
    .filter(
      (transaction) =>
        transaction.index !== currentIndex &&
        transaction.linkage?.type !== "reimbursement",
    );
}

export function ReimbursementSelectorModal({
  isOpen,
  onClose,
  onConfirm,
  currentIndex,
  transactions,
  currentLinkage,
  includeCurrentImport = true,
  excludeTransactionId,
  categories = [],
  currentReimbursementId,
  initialSelectedDbTransactions = getDefaultInitialSelectedDbTransactions(),
}: ReimbursementSelectorModalProps) {
  const currentImportListRef = useRef<HTMLDivElement>(null);
  const positionedCurrentImportRef = useRef(false);
  const reimbursementAmount = toAbsTransactionAmount(
    transactions[currentIndex]?.amountIn,
    transactions[currentIndex]?.amountOut,
  );

  const [selectedBatchIndices, setSelectedBatchIndices] = useState<Set<number>>(
    new Set(),
  );
  const [selectedDbIds, setSelectedDbIds] = useState<Set<string>>(new Set());
  const [selectedDbCache, setSelectedDbCache] = useState<
    Record<string, DatabaseTransaction>
  >({});
  const [allocationByTarget, setAllocationByTarget] = useState<
    Record<TargetKey, number>
  >({});
  const [leftoverCategoryId, setLeftoverCategoryId] = useState("");

  const [selectorTab, setSelectorTab] = useState<SelectorTab>(
    includeCurrentImport ? "current" : "existing",
  );

  const [currentSearch, setCurrentSearch] = useState("");
  const [currentTypeFilter, setCurrentTypeFilter] = useState<AmountType>("all");
  const [currentCategoryFilter, setCurrentCategoryFilter] = useState("");
  const [currentDateFrom, setCurrentDateFrom] = useState("");
  const [currentDateTo, setCurrentDateTo] = useState("");
  const [currentSameAmountOnly, setCurrentSameAmountOnly] = useState(false);

  const [dbSearchInput, setDbSearchInput] = useState("");
  const [dbSearchQuery, setDbSearchQuery] = useState("");
  const [dbTypeFilter, setDbTypeFilter] = useState<AmountType>("all");
  const [dbCategoryFilter, setDbCategoryFilter] = useState("");
  const [dbDateFrom, setDbDateFrom] = useState("");
  const [dbDateTo, setDbDateTo] = useState("");
  const [dbSameAmountOnly, setDbSameAmountOnly] = useState(false);
  const [dbTransactions, setDbTransactions] = useState<DatabaseTransaction[]>([]);
  const [dbTotal, setDbTotal] = useState(0);
  const [dbPage, setDbPage] = useState(1);
  const [isLoadingDb, setIsLoadingDb] = useState(false);

  const loadExistingTransactions = useCallback(
    async (
      page: number,
      query: string,
      filters?: {
        transactionType?: "all" | "in" | "out";
        categoryId?: string;
        dateFrom?: string;
        dateTo?: string;
        amountEquals?: number;
      },
    ) => {
      setIsLoadingDb(true);
      try {
        const offset = (page - 1) * PAGE_SIZE;
        const result = await searchTransactionsForReimbursement(
          query || undefined,
          PAGE_SIZE,
          offset,
          filters,
        );
        const allResults = (result?.transactions || []) as DatabaseTransaction[];
        const filtered = excludeTransactionId
          ? allResults.filter((item) => item.id !== excludeTransactionId)
          : allResults;
        setDbTransactions(filtered);
        setDbTotal(typeof result?.total === "number" ? result.total : filtered.length);
      } finally {
        setIsLoadingDb(false);
      }
    },
    [excludeTransactionId],
  );

  useEffect(() => {
    if (!isOpen) return;
    positionedCurrentImportRef.current = false;

    const initialBatch = new Set<number>();
    const initialDb = new Set<string>();
    const initialAllocations: Record<TargetKey, number> = {};
    const initialDbCache: Record<string, DatabaseTransaction> = Object.fromEntries(
      initialSelectedDbTransactions.map((transaction) => [
        transaction.id,
        transaction,
      ]),
    );

    (currentLinkage?.reimbursesAllocations || []).forEach((item) => {
      if (typeof item.transactionId === "string") {
        initialDb.add(item.transactionId);
        initialAllocations[toDbKey(item.transactionId)] = toNumber(item.amount);
        if (!initialDbCache[item.transactionId]) {
          initialDbCache[item.transactionId] = {
            id: item.transactionId,
            date: item.targetDate || new Date().toISOString(),
            description: item.targetDescription || "Existing transaction",
            label: null,
            amountIn: null,
            amountOut:
              typeof item.targetRemainingReimbursable === "number"
                ? item.targetRemainingReimbursable
                : toNumber(item.amount),
            balance: null,
            metadata: {},
            category: null,
            linkage: null,
          };
        }
      } else if (typeof item.pendingBatchIndex === "number") {
        initialBatch.add(item.pendingBatchIndex);
        initialAllocations[toBatchKey(item.pendingBatchIndex)] = toNumber(item.amount);
      }
    });

    setSelectedBatchIndices(initialBatch);
    setSelectedDbIds(initialDb);
    setSelectedDbCache(initialDbCache);
    setAllocationByTarget(initialAllocations);
    setLeftoverCategoryId(currentLinkage?.leftoverCategoryId || "");

    setSelectorTab(includeCurrentImport ? "current" : "existing");

    setCurrentSearch("");
    setCurrentTypeFilter("all");
    setCurrentCategoryFilter("");
    setCurrentDateFrom("");
    setCurrentDateTo("");
    setCurrentSameAmountOnly(false);

    setDbSearchInput("");
    setDbSearchQuery("");
    setDbTypeFilter("all");
    setDbCategoryFilter("");
    setDbDateFrom("");
    setDbDateTo("");
    setDbSameAmountOnly(false);
    setDbPage(1);
  }, [isOpen, currentLinkage, includeCurrentImport, initialSelectedDbTransactions]);

  useEffect(() => {
    if (!isOpen) return;
    const nextPage = 1;
    setDbPage(nextPage);
    void loadExistingTransactions(nextPage, dbSearchQuery, {
      transactionType: dbTypeFilter,
        categoryId: dbCategoryFilter,
        dateFrom: dbDateFrom,
        dateTo: dbDateTo,
        amountEquals: dbSameAmountOnly ? reimbursementAmount : undefined,
      });
  }, [
    isOpen,
    dbSearchQuery,
    dbTypeFilter,
    dbCategoryFilter,
    dbDateFrom,
    dbDateTo,
    dbSameAmountOnly,
    reimbursementAmount,
    loadExistingTransactions,
  ]);

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

  const selectableBatchTransactions = useMemo(() => {
    return buildCurrentImportReimbursementItems(transactions, currentIndex);
  }, [transactions, currentIndex]);

  const filteredCurrentImportItems = useMemo(() => {
    const query = currentSearch.trim().toLowerCase();
    return selectableBatchTransactions.filter((item) => {
      const amountIn = toNumber(item.amountIn);
      const amountOut = toNumber(item.amountOut);
      const txCategory = item.categoryId || "__uncategorized__";

      const matchesSearch =
        !query ||
        item.description.toLowerCase().includes(query) ||
        (item.label || "").toLowerCase().includes(query);

      const matchesType =
        currentTypeFilter === "all" ||
        (currentTypeFilter === "in" && amountIn > 0) ||
        (currentTypeFilter === "out" && amountOut > 0);

      const matchesCategory =
        !currentCategoryFilter || txCategory === currentCategoryFilter;

      const txDate = item.date || "";
      const matchesDateFrom = !currentDateFrom || txDate >= currentDateFrom;
      const matchesDateTo = !currentDateTo || txDate <= currentDateTo;
      const txAmount = toAbsTransactionAmount(item.amountIn, item.amountOut);
      const matchesAmount =
        !currentSameAmountOnly || Math.abs(txAmount - reimbursementAmount) <= 0.01;

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
    reimbursementAmount,
  ]);
  const currentImportVirtualizer = useVirtualizer({
    count: filteredCurrentImportItems.length,
    getScrollElement: () => currentImportListRef.current,
    estimateSize: () => 92,
    overscan: 8,
  });
  const currentImportVirtualRows = currentImportVirtualizer.getVirtualItems();
  const currentImportTopSpacer = currentImportVirtualRows[0]?.start ?? 0;
  const currentImportBottomSpacer =
    currentImportVirtualRows.length > 0
      ? Math.max(
          currentImportVirtualizer.getTotalSize() -
            currentImportVirtualRows[currentImportVirtualRows.length - 1].end,
          0,
        )
      : 0;

  useEffect(() => {
    if (!isOpen || selectorTab !== "current") return;
    if (positionedCurrentImportRef.current) return;
    const firstAfterCurrentIndex = filteredCurrentImportItems.findIndex(
      (item) => item.index > currentIndex,
    );
    if (firstAfterCurrentIndex < 0) return;

    const frame = requestAnimationFrame(() => {
      currentImportVirtualizer.scrollToIndex(firstAfterCurrentIndex, {
        align: "start",
      });
      positionedCurrentImportRef.current = true;
    });

    return () => cancelAnimationFrame(frame);
  }, [
    isOpen,
    selectorTab,
    currentIndex,
    filteredCurrentImportItems,
    currentImportVirtualizer,
  ]);

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
          Number(((map.get(allocation.pendingBatchIndex) || 0) + amount).toFixed(2)),
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
          Number(((map.get(allocation.transactionId) || 0) + amount).toFixed(2)),
        );
      });
    });
    return map;
  }, [transactions, currentIndex]);

  const selectedBatchItems = selectableBatchTransactions.filter((item) =>
    selectedBatchIndices.has(item.index),
  );

  const selectedDbItems = useMemo(
    () =>
      Array.from(selectedDbIds)
        .map((id) => selectedDbCache[id] || dbTransactions.find((item) => item.id === id))
        .filter((item): item is DatabaseTransaction => !!item),
    [selectedDbIds, selectedDbCache, dbTransactions],
  );

  const selectedItems = [
    ...selectedBatchItems.map((item) => ({
      key: toBatchKey(item.index),
      title: item.label?.trim() || item.description,
      subtitle: `${formatDate(item.date)} · Current import`,
      reimbursableAmount: toAbsTransactionAmount(item.amountIn, item.amountOut),
      alreadyAllocated: Number(
        (stagedAllocatedByBatchIndex.get(item.index) || 0).toFixed(2),
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
      reimbursableAmount: toAbsTransactionAmount(item.amountIn, item.amountOut),
      alreadyAllocated: Number(
        (
          (item.linkage?.reimbursedByAllocations || [])
            .filter((allocation) => allocation.transactionId !== currentReimbursementId)
            .reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0) +
          (stagedAllocatedByDbId.get(item.id) || 0)
        )
          .toFixed(2),
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
      Math.max(item.reimbursableAmount - item.alreadyAllocated, 0).toFixed(2),
    ),
  }));

  const setAllocation = (key: string, value: number) => {
    setAllocationByTarget((prev) => ({
      ...prev,
      [key]: Number.isFinite(value) ? Number(value.toFixed(2)) : 0,
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
      return Number(Math.max(reimbursementAmount - allocatedByOthers, 0).toFixed(2));
    },
    [selectedItems, allocationByTarget, reimbursementAmount],
  );

  const totalAllocated = selectedItems.reduce((sum, item) => {
    const maxAllowed = Math.min(item.reimbursableAmount, getBudgetForKey(item.key));
    const allocated = Math.min(toNumber(allocationByTarget[item.key]), maxAllowed);
    return sum + allocated;
  }, 0);

  const remaining = Number((reimbursementAmount - totalAllocated).toFixed(2));

  const allocationEditorItems: ReimbursementAllocationRowModel[] = selectedItems.map((item) => {
    const maxAllowed = Math.min(item.reimbursableAmount, getBudgetForKey(item.key));
    const allocatedNow = Math.min(toNumber(allocationByTarget[item.key]), maxAllowed);
    const leftoverAfterAllocation = Number(
      Math.max(item.reimbursableAmount - allocatedNow, 0).toFixed(2),
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
      onSetHalf: () => setAllocation(item.key, Math.min(item.reimbursableAmount / 2, maxAllowed)),
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

  const handleToggleDb = (item: DatabaseTransaction) => {
    const key = toDbKey(item.id);
    const id = item.id;
    const alreadyAllocated = Number(
      (
        (item.linkage?.reimbursedByAllocations || [])
          .filter((allocation) => allocation.transactionId !== currentReimbursementId)
          .reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0) +
        (stagedAllocatedByDbId.get(item.id) || 0)
      ).toFixed(2),
    );
    const remainingReimbursable = Number(
      Math.max(toAbsTransactionAmount(item.amountIn, item.amountOut) - alreadyAllocated, 0).toFixed(
        2,
      ),
    );

    if (selectedDbIds.has(id)) {
      setSelectedDbIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setSelectedDbCache((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setAllocationByTarget((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }

    setSelectedDbIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setSelectedDbCache((prev) => ({ ...prev, [id]: item }));

    if (allocationByTarget[key] === undefined) {
      setAllocation(key, Math.min(remainingReimbursable, getBudgetForKey(key)));
    }
  };

  const toCardTransaction = useCallback(
    (transaction: Transaction, index?: number) => ({
      id: String(index ?? transaction.description),
      date: transaction.date,
      description: transaction.description,
      label: transaction.label || undefined,
      amountIn: transaction.amountIn ?? null,
      amountOut: transaction.amountOut ?? null,
      balance: transaction.balance ?? null,
      metadata:
        transaction.metadata && typeof transaction.metadata === "object"
          ? transaction.metadata
          : {},
      category: categories.find((category) => category.id === transaction.categoryId)
        ? {
            id: String(transaction.categoryId),
            name: categories.find((category) => category.id === transaction.categoryId)!.name,
            color: categories.find((category) => category.id === transaction.categoryId)!.color,
          }
        : undefined,
    }),
    [categories],
  );

  const toDbCardTransaction = (transaction: DatabaseTransaction) => ({
    id: transaction.id,
    date: transaction.date,
    description: transaction.description,
    label: transaction.label || undefined,
    amountIn: transaction.amountIn,
    amountOut: transaction.amountOut,
    balance: transaction.balance ?? null,
    metadata:
      transaction.metadata && typeof transaction.metadata === "object"
        ? (transaction.metadata as Record<string, unknown>)
        : {},
    category: transaction.category
      ? {
          id: transaction.category.id || transaction.category.name,
          name: transaction.category.name,
          color: transaction.category.color,
        }
      : undefined,
    linkage: transaction.linkage || undefined,
  });

  const handleConfirm = () => {
    const reimburseAllocations = selectedItems
      .map((item) => {
        const maxAllowed = Math.min(item.reimbursableAmount, getBudgetForKey(item.key));
        const amount = Math.min(toNumber(allocationByTarget[item.key]), maxAllowed);
        if (amount <= 0) return null;
        if (item.key.startsWith("db:")) {
          const target = selectedDbItems.find(
            (dbItem) => dbItem.id === item.key.slice(3),
          );
          const alreadyCommitted = Number(
            (
              (target?.linkage?.reimbursedByAllocations || [])
                .filter(
                  (allocation) => allocation.transactionId !== currentReimbursementId,
                )
                .reduce(
                  (sum, allocation) => sum + Number(allocation.amount || 0),
                  0,
                )
            ).toFixed(2),
          );
          const committedRemaining = Number(
            Math.max(
              toAbsTransactionAmount(target?.amountIn, target?.amountOut) -
                alreadyCommitted,
              0,
            ).toFixed(2),
          );
          return {
            transactionId: item.key.slice(3),
            amount,
            targetDescription: target?.label?.trim() || target?.description,
            targetDate: target?.date,
            targetRemainingReimbursable: committedRemaining,
          };
        }
        return {
          pendingBatchIndex: Number(item.key.slice(6)),
          amount,
        };
      })
      .filter((item): item is NonNullable<typeof item> => !!item);

    const linkage: TransactionLinkage = {
      type: "reimbursement",
      reimbursesAllocations: reimburseAllocations,
      leftoverAmount: Number(Math.max(remaining, 0).toFixed(2)),
      leftoverCategoryId:
        remaining > 0 && leftoverCategoryId ? leftoverCategoryId : null,
    };

    onConfirm(linkage);
    onClose();
  };

  const dbTotalPages = Math.max(1, Math.ceil(dbTotal / PAGE_SIZE));

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[92vh] w-[95vw] max-w-[1500px] flex-col overflow-hidden rounded-xl border border-stroke bg-white shadow-xl dark:border-dark-3 dark:bg-dark-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-stroke px-6 py-4 dark:border-dark-3">
          <div className="flex items-center gap-3">
            <Receipt className="h-6 w-6 text-green" />
            <div>
              <h3 className="text-lg font-semibold text-dark dark:text-white">
                Reimbursement Allocation
              </h3>
              <p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
                Select reimbursed transactions and allocate amounts.
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

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden px-6 py-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(380px,1fr)]">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-stroke dark:border-dark-3">
            {includeCurrentImport ? (
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
                  >
                    Same outflow amount ({formatAmount(reimbursementAmount)})
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
                      setDbTypeFilter("all");
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

                <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-stroke bg-white dark:border-dark-3 dark:bg-dark-2 md:grid-cols-4 md:divide-x md:divide-stroke md:dark:divide-dark-3">
                  <div className="border-b border-stroke dark:border-dark-3 md:border-b-0">
                    <Select
                      value={selectorTab === "current" ? currentTypeFilter : dbTypeFilter}
                      onChange={(value) => {
                        if (selectorTab === "current") {
                          setCurrentTypeFilter(value as AmountType);
                        } else {
                          setDbTypeFilter(value as AmountType);
                        }
                      }}
                      options={[
                        { value: "all", label: "All types" },
                        { value: "in", label: "In only" },
                        { value: "out", label: "Out only" },
                      ]}
                      buttonClassName="rounded-none border-0"
                      menuPlacement="auto"
                      menuStrategy="fixed"
                    />
                  </div>

                  <div className="border-b border-stroke dark:border-dark-3 md:border-b-0">
                    <Select
                      value={
                        selectorTab === "current" ? currentCategoryFilter : dbCategoryFilter
                      }
                      onChange={(value) => {
                        if (selectorTab === "current") {
                          setCurrentCategoryFilter(value);
                        } else {
                          setDbCategoryFilter(value);
                        }
                      }}
                      options={categoryOptions}
                      buttonClassName="rounded-none border-0"
                      menuPlacement="auto"
                      menuStrategy="fixed"
                    />
                  </div>

                  <div className="border-b border-stroke dark:border-dark-3 md:border-b-0">
                    <DatePicker
                      value={selectorTab === "current" ? currentDateFrom : dbDateFrom}
                      onChange={(value) => {
                        if (selectorTab === "current") {
                          setCurrentDateFrom(value);
                        } else {
                          setDbDateFrom(value);
                        }
                      }}
                      triggerProps={{ className: "rounded-none" }}
                    />
                  </div>
                  <DatePicker
                    value={selectorTab === "current" ? currentDateTo : dbDateTo}
                    onChange={(value) => {
                      if (selectorTab === "current") {
                        setCurrentDateTo(value);
                      } else {
                        setDbDateTo(value);
                      }
                    }}
                    triggerProps={{ className: "rounded-none" }}
                  />
                </div>
              </div>
            </div>

            <div
              ref={currentImportListRef}
              className="min-h-0 flex-1 overflow-y-auto p-3"
            >
              <div className="space-y-2">
                {selectorTab === "current" ? (
                  filteredCurrentImportItems.length === 0 ? (
                    <div className="py-8 text-center text-sm text-dark-5 dark:text-dark-6">
                      No current-import transactions found.
                    </div>
                  ) : (
                    <>
                      {currentImportTopSpacer > 0 && (
                        <div style={{ height: currentImportTopSpacer }} />
                      )}
                      {currentImportVirtualRows.map((virtualRow) => {
                        const item = filteredCurrentImportItems[virtualRow.index];
                        if (!item) return null;
                        const stagedAlready =
                          stagedAllocatedByBatchIndex.get(item.index) || 0;
                        const selectableAmount = Math.max(
                          toAbsTransactionAmount(item.amountIn, item.amountOut) -
                            stagedAlready,
                          0,
                        );

                        return (
                          <TransactionCard
                            key={toBatchKey(item.index)}
                            transaction={toCardTransaction(item, item.index)}
                            selected={selectedBatchIndices.has(item.index)}
                            selectionTone="success"
                            onToggleSelect={() =>
                              handleToggleBatch(item.index, selectableAmount)
                            }
                            wrapText
                            showDate
                          />
                        );
                      })}
                      {currentImportBottomSpacer > 0 && (
                        <div style={{ height: currentImportBottomSpacer }} />
                      )}
                    </>
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
                      showDate
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
                        transactionType: dbTypeFilter,
                        categoryId: dbCategoryFilter,
                        dateFrom: dbDateFrom,
                        dateTo: dbDateTo,
                        amountEquals: dbSameAmountOnly ? reimbursementAmount : undefined,
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
                        transactionType: dbTypeFilter,
                        categoryId: dbCategoryFilter,
                        dateFrom: dbDateFrom,
                        dateTo: dbDateTo,
                        amountEquals: dbSameAmountOnly ? reimbursementAmount : undefined,
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
              <div className="mt-2 grid grid-cols-1 gap-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-dark-5 dark:text-dark-6">Initial amount</span>
                  <span className="font-semibold text-green">{formatAmount(reimbursementAmount)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-dark-5 dark:text-dark-6">Allocated</span>
                  <span className="font-semibold text-dark dark:text-white">{formatAmount(totalAllocated)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-dark-5 dark:text-dark-6">Remaining</span>
                  <span className={`font-semibold ${remaining < 0 ? "text-red" : "text-primary"}`}>
                    {formatAmount(remaining)}
                  </span>
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
                menuPlacement="auto"
                menuStrategy="fixed"
              />
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
                      formatAmount={formatAmount}
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
            disabled={remaining < -0.01}
            leftIcon={<ArrowRightCircle className="h-4 w-4" />}
          >
            Save Reimbursement
          </Button>
        </div>
      </div>
    </div>
  );
}
