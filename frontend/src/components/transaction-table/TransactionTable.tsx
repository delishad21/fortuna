"use client";

import {
  useState,
  Fragment,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  memo,
} from "react";
import type { KeyboardEvent, FormEvent, ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowRight,
  ArrowRightToLine,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { CategorySelect } from "@/components/ui/CategorySelect";
import { DatePicker } from "@/components/ui/DatePicker";
import { Checkbox } from "@/components/ui/Checkbox";
import { HoverTooltip } from "@/components/ui/HoverTooltip";
import { resolveTransactionAccountColor } from "@/components/import/importAccountMapping";
import { ResizableHeader } from "./ResizableHeader";
import { TransactionTableToolbar } from "./TransactionTableToolbar";
import { TransactionTableFilterBar } from "./TransactionTableFilterBar";
import {
  AmountRangeFilter,
  CategoryChecklistFilter,
  ColumnFilterMenu,
  DateRangeFilter,
} from "./ColumnFilterMenu";
import {
  EMPTY_TABLE_VIEW,
  SORT_LABELS,
  applyTableView,
  buildCategoryFilterOptions,
  getSortState,
  isColumnFiltered,
  isFundingInTopup as resolveIsFundingInTopup,
  isTableViewActive,
  needsReview,
  resetColumnFilter,
  resolveDisplayCategoryId,
  updateSorts,
} from "./columnFilters";
import type {
  AmountFilter,
  CategoryContext,
  FilterableColumn,
  TableRow,
  TableViewState,
} from "./columnFilters";
import { DuplicateWarningBanner } from "./DuplicateWarningBanner";
import { TransactionRowExpanded } from "./TransactionRowExpanded";
import { DuplicateMatchList } from "./DuplicateMatchList";
import { useColumnResize } from "./hooks/useColumnResize";
import { DEFAULT_COLUMN_WIDTHS, MIN_COLUMN_WIDTHS } from "./config/columns";
import { areTransactionTablePropsEqual } from "./memo";
import {
  resizeTextareaToContent,
  shouldShowTablePreparingState,
} from "./virtualization";
import type { TransactionTableProps } from "./types";

interface DeferredTextInputProps {
  value: string;
  disabled?: boolean;
  className: string;
  placeholder?: string;
  dataRow: string;
  dataCol: string;
  onCommit: (value: string) => void;
}

const DeferredTextInput = memo(function DeferredTextInput({
  value,
  disabled,
  className,
  placeholder,
  dataRow,
  dataCol,
  onCommit,
}: DeferredTextInputProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      placeholder={placeholder}
      disabled={disabled}
      data-row={dataRow}
      data-col={dataCol}
      className={className}
    />
  );
});

interface DeferredDecimalInputProps {
  value: number | null | undefined;
  disabled?: boolean;
  className: string;
  placeholder?: string;
  dataRow: string;
  dataCol: string;
  onCommit: (value: number | undefined) => void;
}

const DeferredDecimalInput = memo(function DeferredDecimalInput({
  value,
  disabled,
  className,
  placeholder,
  dataRow,
  dataCol,
  onCommit,
}: DeferredDecimalInputProps) {
  const valueString =
    value === null || value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(valueString);

  useEffect(() => {
    setDraft(valueString);
  }, [valueString]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === valueString) return;
        const parsed = draft ? parseFloat(draft) || 0 : undefined;
        onCommit(parsed);
      }}
      placeholder={placeholder}
      disabled={disabled}
      data-row={dataRow}
      data-col={dataCol}
      className={className}
    />
  );
});

interface DeferredTextareaProps {
  value: string;
  disabled?: boolean;
  className: string;
  dataRow: string;
  dataCol: string;
  textareaRef?: (textarea: HTMLTextAreaElement | null) => void;
  onInput?: (event: FormEvent<HTMLTextAreaElement>) => void;
  onCommit: (value: string) => void;
}

const DeferredTextarea = memo(function DeferredTextarea({
  value,
  disabled,
  className,
  dataRow,
  dataCol,
  textareaRef,
  onInput,
  onCommit,
}: DeferredTextareaProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onInput={onInput}
      disabled={disabled}
      rows={1}
      data-row={dataRow}
      data-col={dataCol}
      ref={textareaRef}
      className={className}
    />
  );
});

function TransactionTableComponent({
  parsedData,
  transactions,
  categories,
  accountIdentifier,
  accountColor,
  accountIdentifiers,
  isNewAccount = false,
  duplicates,
  selectedIndices,
  nonDuplicateIndices = new Set(),
  rowValidationErrors,
  isCheckingDuplicates,
  isImporting,
  showDuplicatesOnly = false,
  showAccountSelector = true,
  pendingAccountColors = new Map(),
  onUpdateTransaction,
  onAccountIdentifierChange,
  onAccountColorChange,
  onAddAccountIdentifier,
  onTransactionAccountIdentifierChange,
  onImport,
  onConfirmImport,
  onSelectAll,
  onDeselectAll,
  onSelectVisible,
  onDeselectVisible,
  onToggleSelection,
  showSelection = true,
  onAddCategoryClick,
  onBack,
  onLinkageChange,
  onOpenReimbursementSelector,
  onOpenReimbursedBySelector,
  onOpenSplitTransaction,
  amountInHeader = "In",
  amountOutHeader = "Out",
  deferCellCommit = false,
  lockLinkedReimbursements = true,
  allowReservedCategorySelection = false,
  renderExpandedActions,
  reviewActionLeft,
  primaryActionLabel,
}: TransactionTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  // Column filters, sorts, search and toggles. Lives here so it resets when
  // the review screen unmounts.
  const [tableView, setTableView] = useState<TableViewState>(EMPTY_TABLE_VIEW);
  const [openFilterColumn, setOpenFilterColumn] =
    useState<FilterableColumn | null>(null);
  const [reapplyToken, setReapplyToken] = useState(0);
  const [isTableReady, setIsTableReady] = useState(false);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const rowVirtualizerMeasureRef = useRef<(() => void) | null>(null);
  const { columnWidths, handleResizeStart } = useColumnResize(
    DEFAULT_COLUMN_WIDTHS,
  );
  const { internalCategoryId, reimbursementCategoryId, displayCategories } =
    useMemo(() => {
      const internalCategory = categories.find(
        (category) => category.name === "Internal",
      );
      const reimbursementCategory = categories.find(
        (category) => category.name === "Reimbursement",
      );
      return {
        internalCategoryId: internalCategory?.id ?? "__internal__",
        reimbursementCategoryId:
          reimbursementCategory?.id ?? "__reimbursement__",
        displayCategories: [
          ...categories,
          ...(internalCategory
            ? []
            : [
                {
                  id: "__internal__",
                  name: "Internal",
                  color: "#9ca3af",
                },
              ]),
          ...(reimbursementCategory
            ? []
            : [
                {
                  id: "__reimbursement__",
                  name: "Reimbursement",
                  color: "#22c55e",
                },
              ]),
          {
            id: "__funding_in__",
            name: "Funding In",
            color: "#22c55e",
          },
        ],
      };
    }, [categories]);
  const isTripParser =
    parsedData?.parserId === "revolut_statement" ||
    parsedData?.parserId === "youtrip_statement";
  const categoryContext = useMemo<CategoryContext>(
    () => ({
      internalCategoryId,
      reimbursementCategoryId,
      isTripParser,
      categoryNames: new Map(
        displayCategories.map((category) => [category.id, category.name]),
      ),
    }),
    [
      internalCategoryId,
      reimbursementCategoryId,
      isTripParser,
      displayCategories,
    ],
  );

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

  const autoResizeTextarea = useCallback(
    (event: FormEvent<HTMLTextAreaElement>) => {
      if (resizeTextareaToContent(event.currentTarget)) {
        rowVirtualizerMeasureRef.current?.();
      }
    },
    [],
  );

  const autoResizeTextareaRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      if (!el) return;
      resizeTextareaToContent(el);
    },
    [],
  );

  const resizeVisibleDescriptionRows = useCallback(() => {
    const container = tableContainerRef.current;
    if (!container) return;
    const textareas = container.querySelectorAll<HTMLTextAreaElement>(
      'textarea[data-col="description"]',
    );
    textareas.forEach((el) => {
      resizeTextareaToContent(el);
    });
    rowVirtualizerMeasureRef.current?.();
  }, []);

  // Rows the table could show before any filters (duplicate mode narrows them).
  const baseRows = useMemo<TableRow[]>(
    () =>
      transactions
        .map((transaction, index) => ({ transaction, index }))
        .filter(({ index }) =>
          showDuplicatesOnly ? !!duplicates?.has(index) : true,
        ),
    [transactions, showDuplicatesOnly, duplicates],
  );
  const isViewActive = isTableViewActive(tableView);
  const liveRows = useMemo(
    () =>
      isViewActive
        ? applyTableView(baseRows, tableView, categoryContext)
        : baseRows,
    [isViewActive, baseRows, tableView, categoryContext],
  );
  const liveIndices = useMemo(
    () => liveRows.map(({ index }) => index),
    [liveRows],
  );

  // Like a spreadsheet, filters and sorts are applied when they change (or
  // the row set changes), not on every cell edit: otherwise a row would jump
  // or vanish while it is being typed into. Edits that change what matches
  // surface a "Reapply filters" action instead.
  const [appliedView, setAppliedView] = useState(() => ({
    view: tableView,
    rowCount: transactions.length,
    showDuplicatesOnly,
    duplicates,
    token: reapplyToken,
    indices: liveIndices,
    version: 0,
  }));
  const shouldReapply =
    appliedView.view !== tableView ||
    appliedView.rowCount !== transactions.length ||
    appliedView.showDuplicatesOnly !== showDuplicatesOnly ||
    appliedView.duplicates !== duplicates ||
    appliedView.token !== reapplyToken;
  if (shouldReapply) {
    // Render-phase update (React's "adjust state when props change" pattern).
    setAppliedView({
      view: tableView,
      rowCount: transactions.length,
      showDuplicatesOnly,
      duplicates,
      token: reapplyToken,
      indices: liveIndices,
      version: appliedView.version + 1,
    });
  }
  const appliedIndices =
    !isViewActive || shouldReapply ? liveIndices : appliedView.indices;
  const isViewStale =
    isViewActive &&
    !shouldReapply &&
    (appliedIndices.length !== liveIndices.length ||
      appliedIndices.some((index, position) => index !== liveIndices[position]));

  useEffect(() => {
    const raf = requestAnimationFrame(resizeVisibleDescriptionRows);
    return () => cancelAnimationFrame(raf);
  }, [
    resizeVisibleDescriptionRows,
    transactions.length,
    showDuplicatesOnly,
    tableView,
    appliedView.version,
  ]);

  useEffect(() => {
    const triggerResize = () => {
      requestAnimationFrame(resizeVisibleDescriptionRows);
    };

    window.addEventListener("resize", triggerResize);

    const container = tableContainerRef.current;
    let observer: ResizeObserver | null = null;
    if (container && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(triggerResize);
      observer.observe(container);
    }

    return () => {
      window.removeEventListener("resize", triggerResize);
      observer?.disconnect();
    };
  }, [resizeVisibleDescriptionRows]);

  // `index` is always the row's ORIGINAL index into `transactions`.
  const visibleRows = useMemo<TableRow[]>(
    () =>
      appliedIndices
        .filter((index) => index < transactions.length)
        .map((index) => ({ transaction: transactions[index], index })),
    [appliedIndices, transactions],
  );
  const visibleIndices = useMemo(
    () => visibleRows.map(({ index }) => index),
    [visibleRows],
  );

  const categoryFilterOptions = useMemo(
    () =>
      openFilterColumn === "category"
        ? buildCategoryFilterOptions(
            baseRows,
            categoryContext,
            displayCategories,
            tableView.columns.hiddenCategoryKeys,
          )
        : [],
    [
      openFilterColumn,
      baseRows,
      categoryContext,
      displayCategories,
      tableView.columns.hiddenCategoryKeys,
    ],
  );
  const needsReviewCount = useMemo(
    () =>
      baseRows.reduce(
        (count, { transaction }) => count + (needsReview(transaction) ? 1 : 0),
        0,
      ),
    [baseRows],
  );
  const hiddenSelectedCount = useMemo(() => {
    if (!showSelection || !selectedIndices || selectedIndices.size === 0) {
      return 0;
    }
    if (visibleRows.length === baseRows.length) return 0;
    const visible = new Set(visibleIndices);
    return baseRows.reduce(
      (count, { index }) =>
        count + (selectedIndices.has(index) && !visible.has(index) ? 1 : 0),
      0,
    );
  }, [
    showSelection,
    selectedIndices,
    visibleRows.length,
    baseRows,
    visibleIndices,
  ]);

  const handleSortChange = useCallback(
    (column: FilterableColumn, direction: "asc" | "desc" | null) => {
      setTableView((view) => ({
        ...view,
        sorts: updateSorts(view.sorts, column, direction),
      }));
    },
    [],
  );
  const handleResetColumn = useCallback((column: FilterableColumn) => {
    setTableView((view) => ({
      ...view,
      columns: resetColumnFilter(view.columns, column),
      sorts: updateSorts(view.sorts, column, null),
    }));
  }, []);
  const updateColumnFilters = useCallback(
    (patch: Partial<TableViewState["columns"]>) => {
      setTableView((view) => ({
        ...view,
        columns: { ...view.columns, ...patch },
      }));
    },
    [],
  );
  const handleResetAllFilters = useCallback(() => {
    setTableView(EMPTY_TABLE_VIEW);
    setOpenFilterColumn(null);
  }, []);

  const renderColumnMenu = (
    column: FilterableColumn,
    columnLabel: string,
    filterContent?: ReactNode,
  ) => {
    const sortState = getSortState(tableView.sorts, column);
    return (
      <ColumnFilterMenu
        columnLabel={columnLabel}
        isOpen={openFilterColumn === column}
        onOpenChange={(open) =>
          setOpenFilterColumn((current) =>
            open ? column : current === column ? null : current,
          )
        }
        sortLabels={SORT_LABELS[column]}
        sortDirection={sortState?.direction ?? null}
        sortPriority={sortState?.priority ?? null}
        sortCount={tableView.sorts.length}
        isFiltered={isColumnFiltered(column, tableView.columns)}
        onSortChange={(direction) => handleSortChange(column, direction)}
        onReset={() => handleResetColumn(column)}
      >
        {filterContent}
      </ColumnFilterMenu>
    );
  };

  const renderAmountFilter = (
    key: "amountIn" | "amountOut",
    onlyWithValueLabel: string,
  ) => (
    <AmountRangeFilter
      filter={tableView.columns[key]}
      onlyWithValueLabel={onlyWithValueLabel}
      onChange={(filter: AmountFilter) =>
        updateColumnFilters({ [key]: filter })
      }
    />
  );
  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 52,
    overscan: 12,
  });
  rowVirtualizerMeasureRef.current = () => rowVirtualizer.measure();
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalVirtualSize = rowVirtualizer.getTotalSize();
  const topSpacerHeight = virtualRows[0]?.start ?? 0;
  const bottomSpacerHeight =
    virtualRows.length > 0
      ? Math.max(totalVirtualSize - virtualRows[virtualRows.length - 1].end, 0)
      : 0;
  const showPreparingState = shouldShowTablePreparingState(
    visibleRows.length,
    isTableReady,
  );
  const selectedVisibleCount = visibleIndices.filter((index) =>
    selectedIndices?.has(index),
  ).length;
  const allVisibleSelected =
    visibleIndices.length > 0 && selectedVisibleCount === visibleIndices.length;
  const partiallyVisibleSelected =
    selectedVisibleCount > 0 && selectedVisibleCount < visibleIndices.length;

  const handleTableKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const target = event.target as HTMLElement;
    const rowAttr = target.getAttribute("data-row");
    const colAttr = target.getAttribute("data-col");
    if (!rowAttr || !colAttr) return;

    event.preventDefault();
    const currentRow = Number(rowAttr);
    if (!event.shiftKey && colAttr === "label") {
      const nextEl = tableContainerRef.current?.querySelector<HTMLElement>(
        `[data-row="${currentRow}"][data-col="category"]`,
      );
      nextEl?.focus();
      return;
    }
    if (!event.shiftKey && colAttr === "category") {
      const nextEl = tableContainerRef.current?.querySelector<HTMLElement>(
        `[data-row="${currentRow + 1}"][data-col="label"]`,
      );
      nextEl?.focus();
      return;
    }

    const direction = event.shiftKey ? -1 : 1;

    let nextRow = currentRow + direction;
    while (nextRow >= 0 && nextRow < visibleRows.length) {
      const nextEl = tableContainerRef.current?.querySelector<HTMLElement>(
        `[data-row="${nextRow}"][data-col="${colAttr}"]`,
      );
      if (nextEl) {
        const isDisabled =
          nextEl instanceof HTMLInputElement ||
          nextEl instanceof HTMLButtonElement
            ? nextEl.disabled
            : nextEl.getAttribute("aria-disabled") === "true";
        if (!isDisabled) {
          nextEl.focus();
          break;
        }
      }
      nextRow += direction;
    }
  };

  useEffect(() => {
    setIsTableReady(false);
    const raf = requestAnimationFrame(() => setIsTableReady(true));
    return () => cancelAnimationFrame(raf);
  }, [visibleRows.length, showDuplicatesOnly]);

  return (
    <div className="h-full flex-1 flex flex-col min-h-0 overflow-hidden">
      <TransactionTableToolbar
        parsedData={parsedData}
        accountIdentifier={accountIdentifier}
        accountColor={accountColor}
        accountIdentifiers={accountIdentifiers}
        isNewAccount={isNewAccount}
        selectedCount={selectedIndices?.size || 0}
        totalCount={transactions.length}
        duplicateCount={duplicates?.size || 0}
        showDuplicatesOnly={showDuplicatesOnly}
        showAccountSelector={showAccountSelector}
        isCheckingDuplicates={isCheckingDuplicates || false}
        isImporting={isImporting || false}
        onBack={onBack}
        onImport={onImport}
        onConfirmImport={onConfirmImport}
        onAccountIdentifierChange={onAccountIdentifierChange}
        onAccountColorChange={onAccountColorChange}
        onAddAccountIdentifier={onAddAccountIdentifier}
        reviewActionLeft={reviewActionLeft}
        primaryActionLabel={primaryActionLabel}
      />

      <TransactionTableFilterBar
        search={tableView.search}
        onSearchChange={(search) =>
          setTableView((view) => ({ ...view, search }))
        }
        needsReviewOnly={tableView.needsReviewOnly}
        onNeedsReviewChange={(needsReviewOnly) =>
          setTableView((view) => ({ ...view, needsReviewOnly }))
        }
        needsReviewCount={needsReviewCount}
        visibleCount={visibleRows.length}
        totalCount={baseRows.length}
        hiddenSelectedCount={hiddenSelectedCount}
        isActive={isViewActive}
        onReset={handleResetAllFilters}
        isStale={isViewStale}
        onReapply={() => setReapplyToken((token) => token + 1)}
      />

      {showDuplicatesOnly && duplicates && duplicates.size > 0 && (
        <DuplicateWarningBanner
          duplicateCount={duplicates.size}
          nonDuplicateCount={nonDuplicateIndices.size}
        />
      )}

      {/* Table */}
      <div
        ref={tableContainerRef}
        onKeyDown={handleTableKeyDown}
        className="relative flex-1 min-h-0 overflow-auto bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3"
      >
        {showPreparingState && (
          <div className="sticky top-0 z-20 border-b border-primary/20 bg-primary/10 px-4 py-2 backdrop-blur-sm">
            <div className="flex items-center justify-between text-xs font-medium text-primary">
              <span>Preparing review table</span>
              <span>{visibleRows.length.toLocaleString()} rows</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-primary/15">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
            </div>
          </div>
        )}
        <table
          className="w-full border-collapse"
          style={{ tableLayout: "fixed" }}
        >
          <thead className="sticky top-0 z-10 bg-gray-1 dark:bg-dark-2">
            <tr className="border-b border-stroke dark:border-dark-3">
              {/* Checkbox column */}
              <th
                className="py-3 px-4 font-medium text-dark dark:text-white"
                style={{ width: columnWidths.checkbox }}
              >
                <div className="flex items-center justify-center">
                  {showSelection && (
                    <Checkbox
                      checked={allVisibleSelected}
                      indeterminate={partiallyVisibleSelected}
                      onChange={(checked) => {
                        if (checked) {
                          if (onSelectVisible) {
                            onSelectVisible(visibleIndices);
                          } else {
                            onSelectAll?.();
                          }
                        } else {
                          if (onDeselectVisible) {
                            onDeselectVisible(visibleIndices);
                          } else {
                            onDeselectAll?.();
                          }
                        }
                      }}
                    />
                  )}
                </div>
              </th>
              <th
                className="py-3 px-2 font-medium text-dark dark:text-white"
                style={{ width: columnWidths.expand }}
              />
              <ResizableHeader
                columnKey="date"
                columnWidth={columnWidths.date}
                minWidth={MIN_COLUMN_WIDTHS.date}
                onResizeStart={handleResizeStart}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate">Date</span>
                  {renderColumnMenu(
                    "date",
                    "Date",
                    <DateRangeFilter
                      from={tableView.columns.dateFrom}
                      to={tableView.columns.dateTo}
                      onChange={({ from, to }) =>
                        updateColumnFilters({ dateFrom: from, dateTo: to })
                      }
                    />,
                  )}
                </div>
              </ResizableHeader>
              <ResizableHeader
                columnKey="description"
                columnWidth={columnWidths.description}
                minWidth={MIN_COLUMN_WIDTHS.description}
                onResizeStart={handleResizeStart}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate">Description</span>
                  <div className="flex shrink-0 items-center gap-1">
                    {!showDuplicatesOnly && (
                      <button
                        type="button"
                        onClick={handleCopyAllDescriptionsToLabels}
                        className="p-1 hover:bg-gray-2 dark:hover:bg-dark-3 rounded transition-colors"
                        title="Copy all descriptions to labels"
                      >
                        <ArrowRightToLine className="h-3.5 w-3.5 text-primary" />
                      </button>
                    )}
                    {renderColumnMenu("description", "Description")}
                  </div>
                </div>
              </ResizableHeader>
              <ResizableHeader
                columnKey="label"
                columnWidth={columnWidths.label}
                minWidth={MIN_COLUMN_WIDTHS.label}
                onResizeStart={handleResizeStart}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate">Label</span>
                  {renderColumnMenu("label", "Label")}
                </div>
              </ResizableHeader>
              <ResizableHeader
                columnKey="category"
                columnWidth={columnWidths.category}
                minWidth={MIN_COLUMN_WIDTHS.category}
                onResizeStart={handleResizeStart}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate">Category</span>
                  {renderColumnMenu(
                    "category",
                    "Category",
                    <CategoryChecklistFilter
                      options={categoryFilterOptions}
                      hiddenKeys={tableView.columns.hiddenCategoryKeys}
                      onChange={(hiddenCategoryKeys) =>
                        updateColumnFilters({ hiddenCategoryKeys })
                      }
                    />,
                  )}
                </div>
              </ResizableHeader>
              <ResizableHeader
                columnKey="amountIn"
                columnWidth={columnWidths.amountIn}
                minWidth={MIN_COLUMN_WIDTHS.amountIn}
                onResizeStart={handleResizeStart}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate">{amountInHeader}</span>
                  {renderColumnMenu(
                    "amountIn",
                    amountInHeader,
                    renderAmountFilter("amountIn", "Only rows with money in"),
                  )}
                </div>
              </ResizableHeader>
              <ResizableHeader
                columnKey="amountOut"
                columnWidth={columnWidths.amountOut}
                minWidth={MIN_COLUMN_WIDTHS.amountOut}
                resizable={false}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate">{amountOutHeader}</span>
                  {renderColumnMenu(
                    "amountOut",
                    amountOutHeader,
                    renderAmountFilter("amountOut", "Only rows with money out"),
                  )}
                </div>
              </ResizableHeader>
            </tr>
          </thead>
          <tbody>
            {topSpacerHeight > 0 && (
              <tr aria-hidden="true">
                <td colSpan={8} style={{ height: topSpacerHeight }} />
              </tr>
            )}
            {virtualRows.map((virtualRow) => {
              const visibleIndex = virtualRow.index;
              const { transaction, index } = visibleRows[visibleIndex];
              const rowDuplicates = duplicates?.get(index);
              const hasDuplicates = rowDuplicates && rowDuplicates.length > 0;
              const validationMessages = rowValidationErrors?.get(index) || [];
              const hasValidationErrors = validationMessages.length > 0;
              const isSelected = selectedIndices?.has(index);
              const rowAccountColor = resolveTransactionAccountColor(
                transaction.accountIdentifier,
                accountIdentifiers,
                pendingAccountColors,
              );
              const isNewRowAccount = !!(
                transaction.accountIdentifier &&
                pendingAccountColors.has(transaction.accountIdentifier)
              );

              const linkageType = transaction.linkage?.type;
              const metadata =
                transaction.metadata && typeof transaction.metadata === "object"
                  ? (transaction.metadata as Record<string, unknown>)
                  : {};
              const isFundingInTopup = resolveIsFundingInTopup(
                transaction,
                isTripParser,
              );
              // Shared with the category column filter/sort.
              const displayCategoryId = resolveDisplayCategoryId(
                transaction,
                categoryContext,
              );
              const isReimbursementLinkage =
                linkageType === "reimbursement" || linkageType === "reimbursed";
              const isLockedByLinkage =
                !allowReservedCategorySelection &&
                !!linkageType &&
                (!isReimbursementLinkage || lockLinkedReimbursements);
              const hasSuggestionMetadata = !!transaction.suggestionSource;
              const suggestionConfidencePct = Math.round(
                Number(transaction.suggestionConfidence || 0) * 100,
              );
              const suggestionReason = String(
                (transaction.metadata as Record<string, unknown>)
                  ?.suggestionReason || "",
              ).trim();
              const reviewTint = String(metadata.reviewTint || "");
              const requiresLabelling =
                !String(transaction.label || "").trim() ||
                (!transaction.categoryId && !transaction.linkage);
              const rowTintClass =
                reviewTint === "needs_label" || requiresLabelling
                  ? "bg-orange-light-4/70 dark:bg-orange-dark-3/15"
                  : reviewTint === "llm"
                    ? "bg-primary/10 dark:bg-primary/10"
                    : reviewTint === "algorithm" ||
                        transaction.suggestionApplied
                      ? "bg-blue-50/70 dark:bg-blue-950/15"
                      : "";
              const labelMatchesSuggestion =
                !!transaction.suggestedLabel &&
                String(transaction.label || "")
                  .trim()
                  .toLowerCase() ===
                  String(transaction.suggestedLabel || "")
                    .trim()
                    .toLowerCase();
              const categoryMatchesSuggestion =
                !!transaction.suggestedCategoryId &&
                String(displayCategoryId || "") ===
                  String(transaction.suggestedCategoryId || "");
              const suggestionTooltipBlock = (
                fieldLabel: "Label" | "Category",
                suggestedValue?: string,
              ) => (
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                    Applied Rule
                  </div>
                  {hasSuggestionMetadata && (
                    <>
                      <div>
                        <span className="text-dark-6">Source:</span>{" "}
                        <span className="font-medium text-white">
                          {transaction.suggestionSource}
                        </span>
                      </div>
                      <div>
                        <span className="text-dark-6">Confidence:</span>{" "}
                        <span className="font-medium text-white">
                          {suggestionConfidencePct}%
                        </span>
                      </div>
                      <div>
                        <span className="text-dark-6">Status:</span>{" "}
                        <span className="font-medium text-white">
                          {transaction.suggestionApplied
                            ? "Auto-applied"
                            : "Not applied"}
                        </span>
                      </div>
                    </>
                  )}
                  {suggestedValue && (
                    <div>
                      <span className="text-dark-6">{fieldLabel}:</span>{" "}
                      <span className="font-medium text-white">
                        {suggestedValue}
                      </span>
                    </div>
                  )}
                  {suggestionReason && (
                    <div className="leading-relaxed">
                      <span className="text-dark-6">Reason:</span>{" "}
                      <span className="text-white">{suggestionReason}</span>
                    </div>
                  )}
                </div>
              );

              return (
                <Fragment key={`transaction-${index}`}>
                  <tr
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    title={
                      hasValidationErrors
                        ? validationMessages.join("\n")
                        : undefined
                    }
                    className={`border-b hover:bg-gray-1 dark:hover:bg-dark-3/50 transition-colors group ${rowTintClass} ${
                      hasValidationErrors
                        ? "border-2 border-red bg-red/5 dark:border-red-light dark:bg-red/10"
                        : hasDuplicates
                          ? "border-2 border-red dark:border-red-light"
                          : "border-stroke dark:border-dark-3"
                    }`}
                  >
                    {/* Checkbox column */}
                    <td
                      className="relative py-0 px-4"
                      style={{ width: columnWidths.checkbox }}
                    >
                      <div
                        className="absolute left-0 top-0 h-full w-1"
                        style={{ backgroundColor: rowAccountColor }}
                      />
                      <div className="flex items-center justify-center">
                        {showSelection && (
                          <Checkbox
                            checked={isSelected || false}
                            onChange={(_, event) =>
                              onToggleSelection?.(index, event)
                            }
                          />
                        )}
                      </div>
                    </td>

                    <td
                      className="py-0 px-2"
                      style={{ width: columnWidths.expand }}
                    >
                      <div className="flex min-h-[44px] items-center justify-center">
                        <button
                          type="button"
                          onClick={() => toggleRowExpanded(index)}
                          aria-expanded={expandedRows.has(index)}
                          aria-label={`${expandedRows.has(index) ? "Hide" : "Show"} details for ${transaction.label || transaction.description}`}
                          className="p-1 hover:bg-gray-2 dark:hover:bg-dark-3 rounded"
                        >
                          {expandedRows.has(index) ? (
                            <ChevronDown className="h-4 w-4 text-dark-5 dark:text-dark-6" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-dark-5 dark:text-dark-6" />
                          )}
                        </button>
                      </div>
                    </td>

                    <td
                      className="py-0 px-0 focus-within:ring-2 focus-within:ring-inset focus-within:ring-primary"
                      style={{ width: columnWidths.date }}
                    >
                      <div className="w-full h-full min-h-[44px] flex items-stretch">
                        <DatePicker
                          value={transaction.date}
                          onChange={(date) =>
                            onUpdateTransaction(index, "date", date)
                          }
                          disabled={showDuplicatesOnly}
                          triggerProps={{
                            "data-row": `${visibleIndex}`,
                            "data-col": "date",
                            className:
                              "py-2 min-h-[44px] items-center hover:bg-transparent dark:hover:bg-transparent",
                          }}
                        />
                      </div>
                    </td>

                    <td
                      className="py-0 px-0 focus-within:ring-2 focus-within:ring-inset focus-within:ring-primary"
                      style={{ width: columnWidths.description }}
                    >
                      <div className="relative flex w-full min-h-[44px] items-center">
                        {deferCellCommit ? (
                          <DeferredTextarea
                            value={transaction.description}
                            onCommit={(nextValue) =>
                              onUpdateTransaction(
                                index,
                                "description",
                                nextValue,
                              )
                            }
                            onInput={autoResizeTextarea}
                            textareaRef={autoResizeTextareaRef}
                            disabled={showDuplicatesOnly}
                            dataRow={`${visibleIndex}`}
                            dataCol="description"
                            className="block w-full min-h-[44px] overflow-hidden px-3 py-3 pr-10 text-sm leading-5 border-0 bg-transparent text-dark dark:text-white outline-none focus:ring-0 resize-none disabled:cursor-not-allowed"
                          />
                        ) : (
                          <textarea
                            value={transaction.description}
                            onChange={(e) =>
                              onUpdateTransaction(
                                index,
                                "description",
                                e.target.value,
                              )
                            }
                            onInput={autoResizeTextarea}
                            disabled={showDuplicatesOnly}
                            rows={1}
                            data-row={`${visibleIndex}`}
                            data-col="description"
                            ref={autoResizeTextareaRef}
                            className="block w-full min-h-[44px] overflow-hidden px-3 py-3 pr-10 text-sm leading-5 border-0 bg-transparent text-dark dark:text-white outline-none focus:ring-0 resize-none disabled:cursor-not-allowed"
                          />
                        )}
                        {!showDuplicatesOnly && (
                          <button
                            onClick={() => handleCopyDescriptionToLabel(index)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 opacity-0 group-hover:opacity-100 hover:bg-gray-2 dark:hover:bg-dark-3 rounded transition-opacity"
                            title="Copy description to label"
                          >
                            <ArrowRight className="h-3.5 w-3.5 text-dark-5 dark:text-dark-6" />
                          </button>
                        )}
                      </div>
                    </td>

                    <td
                      className="py-0 px-0 focus-within:ring-2 focus-within:ring-inset focus-within:ring-primary"
                      style={{ width: columnWidths.label }}
                    >
                      <div className="relative flex w-full min-h-[44px] items-center">
                        {deferCellCommit ? (
                          <DeferredTextInput
                            value={transaction.label || ""}
                            onCommit={(nextValue) =>
                              onUpdateTransaction(index, "label", nextValue)
                            }
                            placeholder="Add label..."
                            disabled={showDuplicatesOnly}
                            dataRow={`${visibleIndex}`}
                            dataCol="label"
                            className={`flex-1 h-auto min-h-[44px] px-3 py-3 text-sm leading-5 border-0 bg-transparent text-dark dark:text-white outline-none focus:ring-0 disabled:cursor-not-allowed ${
                              labelMatchesSuggestion ? "pr-8" : ""
                            }`}
                          />
                        ) : (
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
                            data-row={`${visibleIndex}`}
                            data-col="label"
                            className={`flex-1 h-auto min-h-[44px] px-3 py-3 text-sm leading-5 border-0 bg-transparent text-dark dark:text-white outline-none focus:ring-0 disabled:cursor-not-allowed ${
                              labelMatchesSuggestion ? "pr-8" : ""
                            }`}
                          />
                        )}
                        {labelMatchesSuggestion && (
                          <span className="absolute right-2 top-1/2 -translate-y-1/2">
                            <HoverTooltip
                              content={suggestionTooltipBlock(
                                "Label",
                                transaction.suggestedLabel,
                              )}
                              align="end"
                            >
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-primary/50 bg-primary/10 text-sm font-bold leading-none text-primary">
                                *
                              </span>
                            </HoverTooltip>
                          </span>
                        )}
                      </div>
                    </td>

                    <td
                      className="py-0 px-0 focus-within:ring-2 focus-within:ring-inset focus-within:ring-primary"
                      style={{ width: columnWidths.category }}
                    >
                      <div className="w-full h-full min-h-[44px] flex items-stretch">
                        <CategorySelect
                          value={displayCategoryId}
                          categories={displayCategories}
                          onChange={(categoryId) => {
                            const isInternalSelection =
                              categoryId === internalCategoryId ||
                              categoryId === "__internal__";
                            const isReimbursementSelection =
                              categoryId === reimbursementCategoryId ||
                              categoryId === "__reimbursement__";

                            if (
                              allowReservedCategorySelection &&
                              isInternalSelection
                            ) {
                              if (onLinkageChange) {
                                onLinkageChange(index, {
                                  type: "internal",
                                  autoDetected: false,
                                });
                              } else {
                                onUpdateTransaction(
                                  index,
                                  "categoryId",
                                  internalCategoryId,
                                );
                              }
                              return;
                            }

                            if (
                              allowReservedCategorySelection &&
                              isReimbursementSelection
                            ) {
                              if (onOpenReimbursementSelector) {
                                onOpenReimbursementSelector(index);
                                return;
                              }
                              if (onLinkageChange) {
                                onLinkageChange(index, {
                                  type: "reimbursement",
                                  reimbursesAllocations: [],
                                });
                                return;
                              }
                              onUpdateTransaction(
                                index,
                                "categoryId",
                                reimbursementCategoryId,
                              );
                              return;
                            }

                            if (
                              allowReservedCategorySelection &&
                              transaction.linkage &&
                              transaction.linkage.type !== "reimbursed" &&
                              onLinkageChange
                            ) {
                              onLinkageChange(index, null);
                            }

                            onUpdateTransaction(
                              index,
                              "categoryId",
                              categoryId,
                            );
                          }}
                          onAddClick={onAddCategoryClick}
                          variant="borderless"
                          excludeReserved={
                            !allowReservedCategorySelection &&
                            !transaction.linkage
                          }
                          dropdownPlacement="fixed"
                          openOnFocus
                          disabled={
                            showDuplicatesOnly ||
                            isLockedByLinkage ||
                            isFundingInTopup
                          }
                          lockedByLinkage={
                            isLockedByLinkage || isFundingInTopup
                          }
                          showOpenRing={false}
                          suggestionMarker={{
                            show: categoryMatchesSuggestion,
                            tooltipContent: suggestionTooltipBlock(
                              "Category",
                              transaction.suggestedCategoryId,
                            ),
                          }}
                          triggerProps={{
                            "data-row": `${visibleIndex}`,
                            "data-col": "category",
                            className:
                              "py-2 min-h-[44px] items-center hover:bg-transparent dark:hover:bg-transparent",
                          }}
                        />
                      </div>
                    </td>

                    <td
                      className="py-0 px-0 focus-within:ring-2 focus-within:ring-inset focus-within:ring-primary"
                      style={{ width: columnWidths.amountIn }}
                    >
                      <div className="w-full h-full min-h-[44px] flex items-stretch">
                        {deferCellCommit ? (
                          <DeferredDecimalInput
                            value={transaction.amountIn ?? undefined}
                            onCommit={(nextValue) =>
                              onUpdateTransaction(index, "amountIn", nextValue)
                            }
                            placeholder="-"
                            disabled={showDuplicatesOnly}
                            dataRow={`${visibleIndex}`}
                            dataCol="amountIn"
                            className="w-full h-full min-h-[44px] px-3 py-2 text-sm border-0 bg-transparent text-green font-medium outline-none focus:ring-0 disabled:cursor-not-allowed"
                          />
                        ) : (
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
                            data-row={`${visibleIndex}`}
                            data-col="amountIn"
                            className="w-full h-full min-h-[44px] px-3 py-2 text-sm border-0 bg-transparent text-green font-medium outline-none focus:ring-0 disabled:cursor-not-allowed"
                          />
                        )}
                      </div>
                    </td>

                    <td
                      className="py-0 px-0 focus-within:ring-2 focus-within:ring-inset focus-within:ring-primary"
                      style={{ width: columnWidths.amountOut }}
                    >
                      <div className="w-full h-full min-h-[44px] flex items-stretch">
                        {deferCellCommit ? (
                          <DeferredDecimalInput
                            value={transaction.amountOut ?? undefined}
                            onCommit={(nextValue) =>
                              onUpdateTransaction(index, "amountOut", nextValue)
                            }
                            placeholder="-"
                            disabled={showDuplicatesOnly}
                            dataRow={`${visibleIndex}`}
                            dataCol="amountOut"
                            className="w-full h-full min-h-[44px] px-3 py-2 text-sm border-0 bg-transparent text-red font-medium outline-none focus:ring-0 disabled:cursor-not-allowed"
                          />
                        ) : (
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
                            data-row={`${visibleIndex}`}
                            data-col="amountOut"
                            className="w-full h-full min-h-[44px] px-3 py-2 text-sm border-0 bg-transparent text-red font-medium outline-none focus:ring-0 disabled:cursor-not-allowed"
                          />
                        )}
                      </div>
                    </td>
                  </tr>

                  {expandedRows.has(index) && (
                    <TransactionRowExpanded
                      transaction={transaction}
                      colSpan={8}
                      linkage={transaction.linkage || null}
                      showOptions={!showDuplicatesOnly && !!onLinkageChange}
                      disabled={isImporting}
                      linkedCount={
                        transaction.linkage?.reimbursesAllocations?.length || 0
                      }
                      reimbursedByCount={
                        transaction.linkage?.reimbursedByAllocations?.length || 0
                      }
                      accountIdentifiers={accountIdentifiers}
                      isNewAccount={isNewRowAccount}
                      renderExpandedActions={
                        renderExpandedActions
                          ? () => renderExpandedActions(index, transaction)
                          : undefined
                      }
                      onAccountIdentifierChange={
                        onTransactionAccountIdentifierChange &&
                        !showDuplicatesOnly
                          ? (accountIdentifier) =>
                              onTransactionAccountIdentifierChange(
                                index,
                                accountIdentifier,
                              )
                          : undefined
                      }
                      onAddAccountIdentifier={onAddAccountIdentifier}
                      onLinkageChange={
                        onLinkageChange
                          ? (linkage) => onLinkageChange(index, linkage)
                          : undefined
                      }
                      onSelectReimbursement={
                        onOpenReimbursementSelector
                          ? () => onOpenReimbursementSelector(index)
                          : undefined
                      }
                      onSelectReimbursedBy={
                        onOpenReimbursedBySelector
                          ? () => onOpenReimbursedBySelector(index)
                          : undefined
                      }
                      onSplitTransaction={
                        onOpenSplitTransaction
                          ? () => onOpenSplitTransaction(index)
                          : undefined
                      }
                    />
                  )}

                  {hasDuplicates && (
                    <DuplicateMatchList matches={rowDuplicates} colSpan={8} />
                  )}
                </Fragment>
              );
            })}
            {bottomSpacerHeight > 0 && (
              <tr aria-hidden="true">
                <td colSpan={8} style={{ height: bottomSpacerHeight }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const TransactionTable = memo(
  TransactionTableComponent,
  areTransactionTablePropsEqual,
);
