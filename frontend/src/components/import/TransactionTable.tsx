"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CheckCircle,
  ArrowLeft,
  ArrowLeftToLine,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { CategorySelect } from "@/components/ui/CategorySelect";
import { DatePicker } from "@/components/ui/DatePicker";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { Checkbox } from "@/components/ui/Checkbox";
import { ResizableHeader } from "./ResizableHeader";

interface Transaction {
  date: string;
  description: string;
  label?: string;
  categoryId?: string;
  amountIn?: number;
  amountOut?: number;
  balance?: number;
  metadata: Record<string, any>;
}

interface Category {
  id: string;
  name: string;
  color: string;
}

interface ParseResult {
  success: boolean;
  filename: string;
  parserId: string;
  transactions: Transaction[];
  count: number;
}

interface DuplicateMatch {
  transaction: {
    id: string;
    date: Date;
    description: string;
    amountIn: number | null;
    amountOut: number | null;
    category?: {
      name: string;
      color: string;
    };
  };
  matchScore: number;
  matchReasons: string[];
}

interface TransactionTableProps {
  parsedData: ParseResult;
  transactions: Transaction[];
  categories: Category[];
  accountIdentifier: string;
  duplicates?: Map<number, DuplicateMatch[]>;
  selectedIndices?: Set<number>;
  nonDuplicateIndices?: Set<number>;
  isCheckingDuplicates?: boolean;
  isImporting?: boolean;
  showDuplicatesOnly?: boolean;
  onUpdateTransaction: (index: number, field: string, value: any) => void;
  onAccountIdentifierChange: (value: string) => void;
  onImport: () => void;
  onConfirmImport?: () => void;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  onToggleSelection?: (index: number) => void;
  onAddCategoryClick: () => void;
  onBack?: () => void;
}

const DEFAULT_COLUMN_WIDTHS = {
  checkbox: 50,
  expand: 40,
  date: 140,
  label: 200,
  description: 350,
  category: 180,
  amountIn: 120,
  amountOut: 120,
};

const NEXT_COLUMN: Record<string, string | null> = {
  checkbox: "expand",
  expand: "date",
  date: "label",
  label: "description",
  description: "category",
  category: "amountIn",
  amountIn: "amountOut",
  amountOut: null,
};

const MIN_COLUMN_WIDTH = 60;
const BASE_ROW_HEIGHT = 52;

export function TransactionTable({
  parsedData,
  transactions,
  categories,
  accountIdentifier,
  duplicates,
  selectedIndices,
  nonDuplicateIndices = new Set(),
  isCheckingDuplicates,
  isImporting,
  showDuplicatesOnly = false,
  onUpdateTransaction,
  onAccountIdentifierChange,
  onImport,
  onConfirmImport,
  onSelectAll,
  onDeselectAll,
  onToggleSelection,
  onAddCategoryClick,
  onBack,
}: TransactionTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [columnWidths, setColumnWidths] = useState(DEFAULT_COLUMN_WIDTHS);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const resizingColumn = useRef<string | null>(null);
  const nextColumn = useRef<string | null>(null);
  const startX = useRef<number>(0);
  const startWidthLeft = useRef<number>(0);
  const startWidthRight = useRef<number>(0);

  const filteredData = useMemo(() => {
    return transactions
      .map((transaction, index) => ({ transaction, index }))
      .filter(({ index }) =>
        showDuplicatesOnly ? duplicates?.has(index) : true,
      );
  }, [transactions, showDuplicatesOnly, duplicates]);

  const rowheights = useMemo(() => {
    const heights: number[] = [];
    filteredData.forEach(({ index }) => {
      let height = BASE_ROW_HEIGHT;
      if (expandedRows.has(index)) {
        height += 180;
      }
      if (duplicates?.has(index)) {
        height += 120;
      }
      heights.push(height);
    });
    return heights;
  }, [filteredData, expandedRows, duplicates]);

  const virtualizer = useVirtualizer({
    count: filteredData.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (i) => rowheights[i] || BASE_ROW_HEIGHT,
    overscan: 5,
  });

  const toggleRowExpanded = (index: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedRows(newExpanded);
  };

  const handleCopyDescriptionToLabel = (index: number) => {
    onUpdateTransaction(index, "label", transactions[index].description);
  };

  const handleCopyAllDescriptionsToLabels = () => {
    transactions.forEach((transaction, index) => {
      onUpdateTransaction(index, "label", transaction.description);
    });
  };

  const handleResizeStart = (columnKey: string, e: React.MouseEvent) => {
    e.preventDefault();
    const rightColumn = NEXT_COLUMN[columnKey];
    if (!rightColumn) return;

    resizingColumn.current = columnKey;
    nextColumn.current = rightColumn;
    startX.current = e.clientX;
    startWidthLeft.current =
      columnWidths[columnKey as keyof typeof columnWidths];
    startWidthRight.current =
      columnWidths[rightColumn as keyof typeof columnWidths];

    document.addEventListener("mousemove", handleResizeMove);
    document.addEventListener("mouseup", handleResizeEnd);
  };

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!resizingColumn.current || !nextColumn.current) return;

    const diff = e.clientX - startX.current;

    let newLeftWidth = startWidthLeft.current + diff;
    let newRightWidth = startWidthRight.current - diff;

    if (newLeftWidth < MIN_COLUMN_WIDTH) {
      newLeftWidth = MIN_COLUMN_WIDTH;
      newRightWidth =
        startWidthLeft.current + startWidthRight.current - MIN_COLUMN_WIDTH;
    }
    if (newRightWidth < MIN_COLUMN_WIDTH) {
      newRightWidth = MIN_COLUMN_WIDTH;
      newLeftWidth =
        startWidthLeft.current + startWidthRight.current - MIN_COLUMN_WIDTH;
    }

    setColumnWidths((prev) => ({
      ...prev,
      [resizingColumn.current!]: newLeftWidth,
      [nextColumn.current!]: newRightWidth,
    }));
  }, []);

  const handleResizeEnd = useCallback(() => {
    resizingColumn.current = null;
    document.removeEventListener("mousemove", handleResizeMove);
    document.removeEventListener("mouseup", handleResizeEnd);
  }, [handleResizeMove]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Toolbar */}
      <div className="flex-shrink-0 py-3 mb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {onBack && (
              <Button variant="secondary" size="sm" onClick={onBack}>
                ← Back
              </Button>
            )}
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green" />
              <span className="font-semibold text-dark dark:text-white">
                {showDuplicatesOnly
                  ? `${duplicates?.size || 0} Potential Duplicate${(duplicates?.size || 0) !== 1 ? "s" : ""}`
                  : `${transactions.length} Transaction${transactions.length !== 1 ? "s" : ""}`}
              </span>
            </div>
            <div className="h-6 w-px bg-stroke dark:bg-dark-3" />
            <div className="text-sm text-dark-5 dark:text-dark-6">
              <span>{parsedData.parserId}</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {!showDuplicatesOnly && (
            <TextInput
              label="Account Identifier:"
              size="sm"
              value={accountIdentifier}
              onChange={(e) => onAccountIdentifierChange(e.target.value)}
              placeholder="Enter account identifier"
            />
            )}

            {showDuplicatesOnly ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-orange-dark dark:text-orange-light font-medium">
                  {selectedIndices?.size || 0} selected to import
                </span>
                <Button
                  variant="success"
                  onClick={onConfirmImport}
                  disabled={isImporting}
                  leftIcon={<CheckCircle className="h-4 w-4" />}
                >
                  {isImporting ? "Importing..." : "Import All"}
                </Button>
              </div>
            ) : (
              <Button
                variant="success"
                onClick={onImport}
                disabled={
                  isCheckingDuplicates || (selectedIndices?.size || 0) === 0
                }
                leftIcon={<CheckCircle className="h-4 w-4" />}
              >
                {isCheckingDuplicates
                  ? "Checking..."
                  : `Import Selected (${selectedIndices?.size || 0})`}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Info banner for duplicates view */}
      {showDuplicatesOnly && duplicates && duplicates.size > 0 && (
        <div className="flex-shrink-0 mb-3 p-4 bg-orange-light-4 dark:bg-orange-dark-3/20 border border-orange-light-2 dark:border-orange-dark-1 rounded-lg">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              <svg
                className="h-5 w-5 text-orange-dark dark:text-orange-light"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-orange-dark-2 dark:text-orange-light-3 mb-1">
                Potential Duplicates Detected
              </h3>
              <p className="text-sm text-orange-dark-1 dark:text-orange-light-2">
                These transactions may already exist in your account. Review
                each one and select which ones you want to import. Your other{" "}
                {nonDuplicateIndices.size} transaction
                {nonDuplicateIndices.size !== 1 ? "s" : ""} will be imported
                automatically.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 min-h-0 bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 overflow-hidden">
        <div ref={scrollContainerRef} className="h-full overflow-auto">
          <table
            className="w-full border-collapse"
            style={{ tableLayout: "fixed" }}
          >
            <thead className="sticky top-0 z-10 bg-gray-1 dark:bg-dark-2">
              <tr className="border-b border-stroke dark:border-dark-3">
                <th
                  className="py-3 px-4 font-medium text-dark dark:text-white"
                  style={{ width: columnWidths.checkbox }}
                >
                  <div className="flex items-center justify-center">
                    <Checkbox
                      checked={
                        selectedIndices?.size === transactions.length &&
                        transactions.length > 0
                      }
                      indeterminate={
                        (selectedIndices?.size || 0) > 0 &&
                        selectedIndices?.size !== transactions.length
                      }
                      onChange={(checked) => {
                        if (checked) {
                          onSelectAll?.();
                        } else {
                          onDeselectAll?.();
                        }
                      }}
                    />
                  </div>
                </th>
                <th
                  className="py-3 px-2 font-medium text-dark dark:text-white"
                  style={{ width: columnWidths.expand }}
                ></th>
                <ResizableHeader
                  columnKey="date"
                  columnWidth={columnWidths.date}
                  onResizeStart={handleResizeStart}
                >
                  Date
                </ResizableHeader>
                <ResizableHeader
                  columnKey="label"
                  columnWidth={columnWidths.label}
                  onResizeStart={handleResizeStart}
                >
                  <div className="flex items-center gap-2">
                    Label
                    {!showDuplicatesOnly && (
                      <button
                        onClick={handleCopyAllDescriptionsToLabels}
                        className="p-1 hover:bg-gray-2 dark:hover:bg-dark-3 rounded transition-colors"
                        title="Copy all descriptions to labels"
                      >
                        <ArrowLeftToLine className="h-3.5 w-3.5 text-primary" />
                      </button>
                    )}
                  </div>
                </ResizableHeader>
                <ResizableHeader
                  columnKey="description"
                  columnWidth={columnWidths.description}
                  onResizeStart={handleResizeStart}
                >
                  Description
                </ResizableHeader>
                <ResizableHeader
                  columnKey="category"
                  columnWidth={columnWidths.category}
                  onResizeStart={handleResizeStart}
                >
                  Category
                </ResizableHeader>
                <ResizableHeader
                  columnKey="amountIn"
                  columnWidth={columnWidths.amountIn}
                  align="right"
                  onResizeStart={handleResizeStart}
                >
                  In
                </ResizableHeader>
                <ResizableHeader
                  columnKey="amountOut"
                  columnWidth={columnWidths.amountOut}
                  align="right"
                  resizable={false}
                >
                  Out
                </ResizableHeader>
              </tr>
            </thead>
            <tbody>
              {virtualItems.map((virtualRow) => {
                const { transaction, index } = filteredData[virtualRow.index];
                const rowDuplicates = duplicates?.get(index);
                const hasDuplicates = rowDuplicates && rowDuplicates.length > 0;
                const isSelected = selectedIndices?.has(index);
                const isExpanded = expandedRows.has(index);

                return (
                  <>
                    <tr
                      key={`row-${index}`}
                      className={`border-b border-stroke dark:border-dark-3 hover:bg-gray-1 dark:hover:bg-dark-3/50 transition-colors group ${
                        hasDuplicates
                          ? "bg-orange-light-4 dark:bg-orange-dark-3/20"
                          : ""
                      }`}
                    >
                      <td
                        className="py-0 px-4"
                        style={{ width: columnWidths.checkbox }}
                      >
                        <div className="flex items-center justify-center">
                          <Checkbox
                            checked={isSelected || false}
                            onChange={() => onToggleSelection?.(index)}
                          />
                        </div>
                      </td>

                      <td
                        className="py-0 px-2"
                        style={{ width: columnWidths.expand }}
                      >
                        <button
                          onClick={() => toggleRowExpanded(index)}
                          className="p-1 hover:bg-gray-2 dark:hover:bg-dark-3 rounded"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-dark-5 dark:text-dark-6" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-dark-5 dark:text-dark-6" />
                          )}
                        </button>
                      </td>

                      <td
                        className="py-0 px-0"
                        style={{ width: columnWidths.date }}
                      >
                        <DatePicker
                          value={transaction.date}
                          onChange={(date) =>
                            onUpdateTransaction(index, "date", date)
                          }
                          disabled={showDuplicatesOnly}
                        />
                      </td>

                      <td
                        className="py-0 px-0"
                        style={{ width: columnWidths.label }}
                      >
                        <div className="flex items-center h-full">
                          <input
                            type="text"
                            value={transaction.label || ""}
                            onChange={(e) =>
                              onUpdateTransaction(
                                index,
                                "label",
                                e.target.value,
                              )
                            }
                            placeholder="Add label..."
                            disabled={showDuplicatesOnly}
                            className="flex-1 h-full px-3 py-3 text-sm border-0 bg-transparent text-dark dark:text-white outline-none focus:ring-2 focus:ring-inset focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                          {!showDuplicatesOnly && (
                            <button
                              onClick={() =>
                                handleCopyDescriptionToLabel(index)
                              }
                              className="p-2 opacity-0 group-hover:opacity-100 hover:bg-gray-2 dark:hover:bg-dark-3 rounded transition-opacity"
                              title="Copy description to label"
                            >
                              <ArrowLeft className="h-3.5 w-3.5 text-dark-5 dark:text-dark-6" />
                            </button>
                          )}
                        </div>
                      </td>

                      <td
                        className="py-0 px-0"
                        style={{ width: columnWidths.description }}
                      >
                        <input
                          type="text"
                          value={transaction.description}
                          onChange={(e) =>
                            onUpdateTransaction(
                              index,
                              "description",
                              e.target.value,
                            )
                          }
                          disabled={showDuplicatesOnly}
                          className="w-full h-full px-3 py-3 text-sm border-0 bg-transparent text-dark dark:text-white outline-none focus:ring-2 focus:ring-inset focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </td>

                      <td
                        className="py-0 px-0"
                        style={{ width: columnWidths.category }}
                      >
                        <CategorySelect
                          value={transaction.categoryId}
                          categories={categories}
                          onChange={(categoryId) =>
                            onUpdateTransaction(index, "categoryId", categoryId)
                          }
                          onAddClick={onAddCategoryClick}
                          disabled={showDuplicatesOnly}
                        />
                      </td>

                      <td
                        className="py-0 px-0"
                        style={{ width: columnWidths.amountIn }}
                      >
                        <input
                          type="text"
                          inputMode="decimal"
                          value={transaction.amountIn || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            onUpdateTransaction(
                              index,
                              "amountIn",
                              val ? parseFloat(val) || 0 : undefined,
                            );
                          }}
                          placeholder="-"
                          disabled={showDuplicatesOnly}
                          className="w-full h-full px-3 py-3 text-sm text-right border-0 bg-transparent text-green font-medium outline-none focus:ring-2 focus:ring-inset focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </td>

                      <td
                        className="py-0 px-0"
                        style={{ width: columnWidths.amountOut }}
                      >
                        <input
                          type="text"
                          inputMode="decimal"
                          value={transaction.amountOut || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            onUpdateTransaction(
                              index,
                              "amountOut",
                              val ? parseFloat(val) || 0 : undefined,
                            );
                          }}
                          placeholder="-"
                          disabled={showDuplicatesOnly}
                          className="w-full h-full px-3 py-3 text-sm text-right border-0 bg-transparent text-red font-medium outline-none focus:ring-2 focus:ring-inset focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="border-b border-stroke dark:border-dark-3 bg-gray-1 dark:bg-dark-3/30">
                        <td colSpan={8} className="py-3 px-4">
                          <div className="text-sm space-y-1 pl-8">
                            <div className="font-medium text-dark dark:text-white mb-2">
                              Raw Data
                            </div>
                            {Object.entries(transaction.metadata).map(
                              ([key, value]) => (
                                <div
                                  key={key}
                                  className="flex gap-2 text-dark-5 dark:text-dark-6"
                                >
                                  <span className="font-medium capitalize">
                                    {key.replace(/([A-Z])/g, " $1").trim()}:
                                  </span>
                                  <span className="text-dark dark:text-white">
                                    {JSON.stringify(value)}
                                  </span>
                                </div>
                              ),
                            )}
                          </div>
                        </td>
                      </tr>
                    )}

                    {hasDuplicates && (
                      <tr className="bg-orange-light-3 dark:bg-orange-dark-3/30 border-b border-orange-light-2 dark:border-orange-dark-1">
                        <td
                          colSpan={8}
                          className="py-2 px-4"
                        >
                          <div className="flex items-start gap-2">
                            <div className="text-orange-dark dark:text-orange-light font-semibold text-sm mt-0.5">
                              Potential Duplicate
                              {rowDuplicates.length > 1 ? "s" : ""}:
                            </div>
                            <div className="flex-1 space-y-2">
                              {rowDuplicates
                                .slice(0, 3)
                                .map((match, matchIndex) => (
                                  <div
                                    key={matchIndex}
                                    className="text-sm text-dark dark:text-white"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium">
                                        Match{" "}
                                        {(match.matchScore * 100).toFixed(0)}%:
                                      </span>
                                      <span>
                                        {new Date(
                                          match.transaction.date,
                                        ).toLocaleDateString()}
                                      </span>
                                      <span className="text-dark-5">•</span>
                                      <span className="truncate">
                                        {match.transaction.description}
                                      </span>
                                      <span className="text-dark-5">•</span>
                                      <span className="font-mono">
                                        {match.transaction.amountIn
                                          ? `+$${match.transaction.amountIn}`
                                          : `-$${match.transaction.amountOut}`}
                                      </span>
                                    </div>
                                    <div className="text-xs text-dark-5 dark:text-dark-6 mt-1">
                                      {match.matchReasons.join(", ")}
                                    </div>
                                  </div>
                                ))}
                              {rowDuplicates.length > 3 && (
                                <div className="text-xs text-dark-5 dark:text-dark-6">
                                  +{rowDuplicates.length - 3} more match
                                  {rowDuplicates.length - 3 > 1 ? "es" : ""}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}