"use client";

import { useEffect, useRef, useState } from "react";
import { TransactionFilters } from "@/components/transactions/TransactionFilters";
import { Pagination } from "@/components/transactions/Pagination";
import { ExpandableTransactionList } from "@/components/transactions/ExpandableTransactionList";
import {
  Loader2,
  AlertCircle,
  Receipt,
  MoreHorizontal,
  Trash2,
  Download,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Checkbox } from "@/components/ui/Checkbox";
import { Select } from "@/components/ui/Select";
import { TextInput } from "@/components/ui/TextInput";
import { Button } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";
import { EditTransactionModal } from "@/components/transactions/EditTransactionModal";
import { AddCategoryModal } from "@/components/ui/AddCategoryModal";
import {
  bulkDeleteTransactionsByFilter,
  bulkDeleteTransactionsByIds,
  bulkUpdateTransactionsByFilter,
  bulkUpdateTransactionsByIds,
  deleteTransaction,
  exportTransactionsCsv,
  getTransactions,
  splitTransaction,
  updateTransaction,
} from "@/app/actions/transactions";
import { createCategory } from "@/app/actions/categories";

interface Transaction {
  id: string;
  date: string;
  description: string;
  label?: string;
  amountIn: number | null;
  amountOut: number | null;
  balance: number | null;
  currency?: string | null;
  accountIdentifier?: string | null;
  category?: {
    id: string;
    name: string;
    color: string;
  };
  tripFundings?: Array<{
    id: string;
    trip: { id: string; name: string };
  }>;
  linkedTransactions?: {
    reimburses: Array<{
      id: string;
      date: string;
      label?: string | null;
      description: string;
      amountIn: number | null;
      amountOut: number | null;
      reimbursementAmount?: number | null;
    }>;
    reimbursedBy: Array<{
      id: string;
      date: string;
      label?: string | null;
      description: string;
      amountIn: number | null;
      amountOut: number | null;
      reimbursementAmount?: number | null;
    }>;
  };
  metadata?: Record<string, any>;
  linkage?: {
    type: "internal" | "reimbursement" | "reimbursed";
    reimbursesAllocations?: Array<{
      transactionId?: string;
      pendingBatchIndex?: number;
      amount: number;
    }>;
    reimbursedByAllocations?: Array<{
      transactionId: string;
      amount: number;
    }>;
    autoDetected?: boolean;
    detectionReason?: string;
  } | null;
}

interface Category {
  id: string;
  name: string;
  color: string;
}

interface AccountNumber {
  id: string;
  accountIdentifier: string;
  color: string;
}

interface FilterValues {
  search: string;
  categoryIds: string[];
  month: string;
  year: string;
  accountIdentifier: string;
  dateFrom: string;
  dateTo: string;
  amountMin: string;
  amountMax: string;
  transactionType: "all" | "income" | "expense";
  dateOrder: "desc" | "asc";
}

interface TransactionsClientProps {
  initialTransactions: Transaction[];
  initialTotal: number;
  initialTotalPages: number;
  categories: Category[];
  accountNumbers: AccountNumber[];
  availableYears: number[];
}

export function TransactionsClient({
  initialTransactions,
  initialTotal,
  initialTotalPages,
  categories,
  accountNumbers,
  availableYears,
}: TransactionsClientProps) {
  const [transactions, setTransactions] =
    useState<Transaction[]>(initialTransactions);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showBulkMenu, setShowBulkMenu] = useState(false);
  const bulkMenuRef = useRef<HTMLDivElement>(null);

  // Edit modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] =
    useState<Transaction | null>(null);
  const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState(false);
  const [localCategories, setLocalCategories] =
    useState<Category[]>(categories);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [totalItems, setTotalItems] = useState(initialTotal);
  const itemsPerPage = 20;

  // Filters
  const [filters, setFilters] = useState<FilterValues>({
    search: "",
    categoryIds: [],
    month: "",
    year: "",
    accountIdentifier: "",
    dateFrom: "",
    dateTo: "",
    amountMin: "",
    amountMax: "",
    transactionType: "all",
    dateOrder: "desc",
  });

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
  const [deselectedIds, setDeselectedIds] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkDate, setBulkDate] = useState("");

  const accountColorMap = accountNumbers.reduce<Record<string, string>>(
    (acc, account) => {
      acc[account.accountIdentifier] = account.color;
      return acc;
    },
    {},
  );

  // Modal state
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    type: "success" | "error" | "warning" | "info";
    title: string;
    message: string;
    onConfirm?: () => void;
  }>({
    isOpen: false,
    type: "info",
    title: "",
    message: "",
  });

  const selectedCount = allFilteredSelected
    ? Math.max(totalItems - deselectedIds.size, 0)
    : selectedIds.size;

  const isSelected = (id: string) =>
    allFilteredSelected ? !deselectedIds.has(id) : selectedIds.has(id);

  const clearSelection = () => {
    setSelectedIds(new Set());
    setAllFilteredSelected(false);
    setDeselectedIds(new Set());
  };

  const toggleSelection = (id: string) => {
    if (allFilteredSelected) {
      setDeselectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      return;
    }

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const buildFilterPayload = () => ({
    search: filters.search || undefined,
    categoryIds:
      filters.categoryIds.length > 0 ? filters.categoryIds : undefined,
    dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
    dateTo: filters.dateTo ? new Date(filters.dateTo) : undefined,
    minAmount: filters.amountMin ? parseFloat(filters.amountMin) : undefined,
    maxAmount: filters.amountMax ? parseFloat(filters.amountMax) : undefined,
    transactionType:
      filters.transactionType !== "all" ? filters.transactionType : undefined,
    dateOrder: filters.dateOrder,
    accountIdentifier: filters.accountIdentifier || undefined,
  });

  const fetchTransactions = async (
    page: number,
    currentFilters: FilterValues,
  ) => {
    setLoading(true);
    setError(null);

    try {
      const offset = (page - 1) * itemsPerPage;
      const data = await getTransactions({
        search: currentFilters.search || undefined,
        categoryIds:
          currentFilters.categoryIds.length > 0
            ? currentFilters.categoryIds
            : undefined,
        dateFrom: currentFilters.dateFrom
          ? new Date(currentFilters.dateFrom)
          : undefined,
        dateTo: currentFilters.dateTo
          ? new Date(currentFilters.dateTo)
          : undefined,
        accountIdentifier: currentFilters.accountIdentifier || undefined,
        minAmount: currentFilters.amountMin
          ? parseFloat(currentFilters.amountMin)
          : undefined,
        maxAmount: currentFilters.amountMax
          ? parseFloat(currentFilters.amountMax)
          : undefined,
        transactionType:
          currentFilters.transactionType !== "all"
            ? currentFilters.transactionType
            : undefined,
        dateOrder: currentFilters.dateOrder,
        limit: itemsPerPage,
        offset,
      });

      setTransactions(data.transactions || []);
      const total = data.total || 0;
      setTotalItems(total);
      setTotalPages(Math.max(1, Math.ceil(total / itemsPerPage)));
    } catch (err) {
      console.error("Error fetching transactions:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load transactions",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (newFilters: FilterValues) => {
    setFilters(newFilters);
    setCurrentPage(1);
    clearSelection();
    fetchTransactions(1, newFilters);
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

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    fetchTransactions(page, filters);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleEdit = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    setEditModalOpen(true);
  };

  const handleSaveEdit = async (updatedTransaction: Transaction) => {
    try {
      await updateTransaction(updatedTransaction.id, {
        date: new Date(updatedTransaction.date).toISOString(),
        description: updatedTransaction.description,
        label: updatedTransaction.label,
        categoryId: updatedTransaction.category?.id || null,
        amountIn: updatedTransaction.amountIn ?? undefined,
        amountOut: updatedTransaction.amountOut ?? undefined,
        balance: updatedTransaction.balance ?? undefined,
        accountIdentifier: updatedTransaction.accountIdentifier ?? undefined,
        linkage: updatedTransaction.linkage ?? null,
      });

      // Refresh transactions
      await fetchTransactions(currentPage, filters);

      setModalState({
        isOpen: true,
        type: "success",
        title: "Success",
        message: "Transaction updated successfully",
      });
    } catch (error) {
      setModalState({
        isOpen: true,
        type: "error",
        title: "Error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to update transaction",
      });
      throw error;
    }
  };

  const handleSplitTransaction = async (
    transactionId: string,
    children: Parameters<typeof splitTransaction>[1],
  ) => {
    try {
      await splitTransaction(transactionId, children);
      await fetchTransactions(currentPage, filters);

      setModalState({
        isOpen: true,
        type: "success",
        title: "Transaction Split",
        message: "Transaction split successfully",
      });
    } catch (error) {
      setModalState({
        isOpen: true,
        type: "error",
        title: "Split Failed",
        message:
          error instanceof Error
            ? error.message
            : "Failed to split transaction",
      });
      throw error;
    }
  };

  const handleAddCategory = async (name: string, color: string) => {
    try {
      const newCategory = await createCategory(name, color);
      setLocalCategories([...localCategories, newCategory]);
    } catch (error) {
      console.error("Failed to create category:", error);
      setModalState({
        isOpen: true,
        type: "error",
        title: "Error",
        message:
          error instanceof Error ? error.message : "Failed to create category",
      });
    }
  };

  const handleAddAccountIdentifier = () => {
    setModalState({
      isOpen: true,
      type: "info",
      title: "Add Account",
      message: "Account creation feature coming soon!",
    });
  };

  const handleDelete = (id: string) => {
    setModalState({
      isOpen: true,
      type: "warning",
      title: "Delete Transaction",
      message:
        "Are you sure you want to delete this transaction? This action cannot be undone.",
      onConfirm: async () => {
        try {
          await deleteTransaction(id);

          // Refresh transactions
          setTransactions(transactions.filter((t) => t.id !== id));
          setTotalItems(totalItems - 1);

          setModalState({
            isOpen: true,
            type: "success",
            title: "Success",
            message: "Transaction deleted successfully.",
          });
        } catch (err) {
          setModalState({
            isOpen: true,
            type: "error",
            title: "Error",
            message:
              err instanceof Error
                ? err.message
                : "Failed to delete transaction",
          });
        }
      },
    });
  };

  const handleBulkDelete = () => {
    if (selectedCount === 0) return;

    setModalState({
      isOpen: true,
      type: "warning",
      title: "Delete Transactions",
      message: `Are you sure you want to delete ${selectedCount} transaction${
        selectedCount === 1 ? "" : "s"
      }? This action cannot be undone.`,
      onConfirm: async () => {
        try {
          setBulkLoading(true);
          if (allFilteredSelected) {
            await bulkDeleteTransactionsByFilter(
              buildFilterPayload(),
              Array.from(deselectedIds),
            );
          } else {
            await bulkDeleteTransactionsByIds(Array.from(selectedIds));
          }
          clearSelection();
          await fetchTransactions(currentPage, filters);
          setModalState({
            isOpen: true,
            type: "success",
            title: "Deleted",
            message: "Transactions deleted successfully.",
          });
        } catch (err) {
          setModalState({
            isOpen: true,
            type: "error",
            title: "Error",
            message:
              err instanceof Error
                ? err.message
                : "Failed to delete transactions",
          });
        } finally {
          setBulkLoading(false);
        }
      },
    });
  };

  const handleBulkCategoryUpdate = async () => {
    if (!bulkCategoryId || selectedCount === 0) return;

    try {
      setBulkLoading(true);
      const updates = { categoryId: bulkCategoryId };
      if (allFilteredSelected) {
        await bulkUpdateTransactionsByFilter(
          buildFilterPayload(),
          Array.from(deselectedIds),
          updates,
        );
      } else {
        await bulkUpdateTransactionsByIds(Array.from(selectedIds), updates);
      }
      await fetchTransactions(currentPage, filters);
      setBulkCategoryId("");
      clearSelection();
      setModalState({
        isOpen: true,
        type: "success",
        title: "Updated",
        message: "Categories updated successfully.",
      });
    } catch (err) {
      setModalState({
        isOpen: true,
        type: "error",
        title: "Error",
        message:
          err instanceof Error ? err.message : "Failed to update categories",
      });
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkDateUpdate = async () => {
    if (!bulkDate || selectedCount === 0) return;

    try {
      setBulkLoading(true);
      const updates = { date: bulkDate };
      if (allFilteredSelected) {
        await bulkUpdateTransactionsByFilter(
          buildFilterPayload(),
          Array.from(deselectedIds),
          updates,
        );
      } else {
        await bulkUpdateTransactionsByIds(Array.from(selectedIds), updates);
      }
      await fetchTransactions(currentPage, filters);
      setBulkDate("");
      clearSelection();
      setModalState({
        isOpen: true,
        type: "success",
        title: "Updated",
        message: "Dates updated successfully.",
      });
    } catch (err) {
      setModalState({
        isOpen: true,
        type: "error",
        title: "Error",
        message: err instanceof Error ? err.message : "Failed to update dates",
      });
    } finally {
      setBulkLoading(false);
    }
  };

  const handleExportCsv = async () => {
    if (selectedCount === 0) return;

    try {
      setBulkLoading(true);
      const csv = allFilteredSelected
        ? await exportTransactionsCsv({
            filters: buildFilterPayload(),
            excludeIds: Array.from(deselectedIds),
          })
        : await exportTransactionsCsv({ ids: Array.from(selectedIds) });

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `transactions-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setModalState({
        isOpen: true,
        type: "error",
        title: "Error",
        message:
          err instanceof Error ? err.message : "Failed to export transactions",
      });
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden">
      {/* Filters */}
      <div className="shrink-0">
        <TransactionFilters
          categories={categories}
          accountNumbers={accountNumbers}
          availableYears={availableYears}
          onFilterChange={handleFilterChange}
          initialFilters={filters}
        />
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="bg-red-light-5 dark:bg-red/20 border border-red-light-3 dark:border-red-dark rounded-lg p-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red dark:text-red-light-1 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-red-dark dark:text-red-light-2">
              Error Loading Transactions
            </h3>
            <p className="mt-1 text-sm text-red-dark dark:text-red-light-1">
              {error}
            </p>
          </div>
          </div>
        ) : transactions.length === 0 ? (
          <div className="bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 p-12 text-center">
          <Receipt className="w-16 h-16 text-dark-5 dark:text-dark-6 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-dark dark:text-white mb-2">
            No transactions found
          </h3>
          <p className="text-dark-5 dark:text-dark-6">
            {filters.search ||
            filters.categoryIds.length > 0 ||
            filters.dateFrom ||
            filters.dateTo
              ? "Try adjusting your filters to see more results."
              : "Import your first transaction to get started."}
          </p>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
          {/* Pagination (Top) */}
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            itemsPerPage={itemsPerPage}
            onPageChange={handlePageChange}
            compact
            leftContent={
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={allFilteredSelected && deselectedIds.size === 0}
                  indeterminate={allFilteredSelected && deselectedIds.size > 0}
                  onChange={(checked) => {
                    if (checked) {
                      setAllFilteredSelected(true);
                      setDeselectedIds(new Set());
                      setSelectedIds(new Set());
                    } else {
                      clearSelection();
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
                    variant="primary"
                    size="sm"
                    onClick={handleExportCsv}
                    disabled={selectedCount === 0 || bulkLoading}
                    className="border border-primary"
                    title="Export selected"
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleBulkDelete}
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
                            ...categories.map((category) => ({
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
                          onClick={handleBulkCategoryUpdate}
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
                          onClick={handleBulkDateUpdate}
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

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <ExpandableTransactionList
                transactions={transactions}
                accountColorMap={accountColorMap}
                selectedIds={
                  allFilteredSelected
                    ? new Set(
                        transactions
                          .filter((transaction) => !deselectedIds.has(transaction.id))
                          .map((transaction) => transaction.id),
                      )
                    : selectedIds
                }
                onToggleSelect={toggleSelection}
                onEdit={handleEdit}
                onDelete={handleDelete}
                linkedTransactionsById={Object.fromEntries(
                  transactions.map((tx) => [
                    tx.id,
                    tx.linkedTransactions || {
                      reimburses: [],
                      reimbursedBy: [],
                    },
                  ]),
                )}
              />
            </div>
          </div>
        )}
      </div>

      {/* Edit Transaction Modal */}
      {editingTransaction && (
        <EditTransactionModal
          isOpen={editModalOpen}
          transaction={editingTransaction}
          categories={localCategories}
          accountIdentifiers={accountNumbers}
          onClose={() => {
            setEditModalOpen(false);
            setEditingTransaction(null);
          }}
          onSave={handleSaveEdit}
          onSplit={handleSplitTransaction}
          onAddCategory={() => setIsAddCategoryModalOpen(true)}
          onAddAccountIdentifier={handleAddAccountIdentifier}
        />
      )}

      {/* Add Category Modal */}
      <AddCategoryModal
        isOpen={isAddCategoryModalOpen}
        onClose={() => setIsAddCategoryModalOpen(false)}
        onAdd={handleAddCategory}
      />

      {/* Modal */}
      <Modal
        isOpen={modalState.isOpen}
        onClose={() => setModalState({ ...modalState, isOpen: false })}
        title={modalState.title}
        message={modalState.message}
        type={modalState.type}
        onConfirm={modalState.onConfirm}
      />
    </div>
  );
}
