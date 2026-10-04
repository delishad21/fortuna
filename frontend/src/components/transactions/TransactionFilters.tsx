"use client";
import { accountDisplay } from "@/lib/accounts";

import { useEffect, useRef, useState } from "react";
import { Filter, X, ChevronDown } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { NumberInput } from "@/components/ui/NumberInput";
import { SearchBar } from "@/components/ui/SearchBar";
import { Button } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";

interface Category {
  id: string;
  name: string;
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

interface TransactionFiltersProps {
  categories: Category[];
  accountNumbers: {
    accountIdentifier: string;
    label?: string | null;
    color: string;
  }[];
  availableYears: number[];
  onFilterChange: (filters: FilterValues) => void;
  initialFilters?: Partial<FilterValues>;
}

export function TransactionFilters({
  categories,
  accountNumbers,
  availableYears,
  onFilterChange,
  initialFilters = {},
}: TransactionFiltersProps) {
  const normalizedCategories = categories.some(
    (category) => category.name === "Uncategorized",
  )
    ? categories
    : [
        ...categories,
        {
          id: "__uncategorized__",
          name: "Uncategorized",
          color: "var(--color-gray-5)",
        },
      ];
  const filteredCategories = normalizedCategories;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  const advancedRef = useRef<HTMLDivElement>(null);
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [filters, setFilters] = useState<FilterValues>({
    search: initialFilters.search || "",
    categoryIds: initialFilters.categoryIds || [],
    month: initialFilters.month || "",
    year: initialFilters.year || "",
    accountIdentifier: initialFilters.accountIdentifier || "",
    dateFrom: initialFilters.dateFrom || "",
    dateTo: initialFilters.dateTo || "",
    amountMin: initialFilters.amountMin || "",
    amountMax: initialFilters.amountMax || "",
    transactionType: initialFilters.transactionType || "all",
    dateOrder: initialFilters.dateOrder || "desc",
  });

  const updateFilter = <K extends keyof FilterValues>(
    key: K,
    value: FilterValues[K],
  ) => {
    let nextFilters: FilterValues = { ...filters, [key]: value };

    if (key === "month" || key === "year") {
      const monthValue =
        key === "month" ? (value as string) : nextFilters.month;
      const yearValue = key === "year" ? (value as string) : nextFilters.year;

      if (key === "month" && !monthValue) {
        nextFilters = { ...nextFilters, year: "" };
      }
      if (key === "year" && !yearValue) {
        nextFilters = { ...nextFilters, month: "" };
      }

      if (monthValue && yearValue) {
        const year = Number(yearValue);
        const monthIndex = Number(monthValue) - 1;
        const start = new Date(Date.UTC(year, monthIndex, 1));
        const end = new Date(Date.UTC(year, monthIndex + 1, 0));
        nextFilters = {
          ...nextFilters,
          dateFrom: start.toISOString().slice(0, 10),
          dateTo: end.toISOString().slice(0, 10),
        };
      } else {
        nextFilters = { ...nextFilters, dateFrom: "", dateTo: "" };
      }
    }

    setFilters(nextFilters);
    onFilterChange(nextFilters);
  };

  const clearFilters = () => {
    const clearedFilters: FilterValues = {
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
    };
    setFilters(clearedFilters);
    onFilterChange(clearedFilters);
  };

  const hasActiveFilters =
    filters.search ||
    filters.categoryIds.length > 0 ||
    filters.month ||
    filters.year ||
    filters.accountIdentifier ||
    filters.dateFrom ||
    filters.dateTo ||
    filters.amountMin ||
    filters.amountMax ||
    filters.transactionType !== "all" ||
    filters.dateOrder !== "desc";

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        categoryDropdownRef.current &&
        !categoryDropdownRef.current.contains(event.target as Node)
      ) {
        setIsCategoryOpen(false);
      }
      if (
        advancedRef.current &&
        !advancedRef.current.contains(event.target as Node)
      ) {
        setShowAdvanced(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-70">
          <label className="text-xs font-medium text-dark-5 dark:text-dark-6">
            Search
          </label>
          <SearchBar
            value={filters.search}
            onChange={(value) => updateFilter("search", value)}
            placeholder="Search transactions..."
            className="w-full mt-1"
            inputClassName="w-full bg-white dark:bg-dark-3"
          />
        </div>

        <div className="w-65 relative">
          <label className="text-xs font-medium text-dark-5 dark:text-dark-6">
            Category
          </label>
          <div ref={categoryDropdownRef}>
            <button
              type="button"
              onClick={() => setIsCategoryOpen((prev) => !prev)}
              className="mt-1 w-full h-11 px-4 text-sm flex items-center gap-2 rounded-lg border border-stroke dark:border-dark-3 bg-white dark:bg-dark-3 text-dark dark:text-white hover:border-primary focus:ring-2 focus:ring-primary transition-colors"
            >
              {filters.categoryIds.length > 0 ? (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="flex -space-x-1">
                    {filters.categoryIds.slice(0, 3).map((id) => {
                      const cat = filteredCategories.find((c) => c.id === id);
                      if (!cat) return null;
                      return (
                        <span
                          key={id}
                          className="w-2.5 h-2.5 rounded-full border border-white dark:border-dark-3"
                          style={{ backgroundColor: cat.color }}
                        />
                      );
                    })}
                  </div>
                  <span className="truncate">
                    {filters.categoryIds.length} selected
                  </span>
                </div>
              ) : (
                <span className="flex-1 text-left text-dark-5 dark:text-dark-6">
                  All Categories
                </span>
              )}
              <ChevronDown className="h-4 w-4 text-dark-5 dark:text-dark-6" />
            </button>

            {isCategoryOpen && (
              <div className="absolute z-20 mt-2 w-full rounded-lg border border-stroke dark:border-dark-3 bg-white dark:bg-dark-2 shadow-dropdown py-2 max-h-60 overflow-auto">
                <button
                  type="button"
                  onClick={() => updateFilter("categoryIds", [])}
                  className="w-full px-4 py-2 text-sm text-left hover:bg-gray-2 dark:hover:bg-dark-3 transition-colors text-dark dark:text-white"
                >
                  All Categories
                </button>
                    {filteredCategories.map((category) => {
                      const isChecked = filters.categoryIds.includes(category.id);
                      return (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => {
                        const next = isChecked
                          ? filters.categoryIds.filter(
                              (id) => id !== category.id,
                            )
                          : [...filters.categoryIds, category.id];
                        updateFilter("categoryIds", next);
                      }}
                      className="w-full px-4 py-2 text-sm text-left hover:bg-gray-2 dark:hover:bg-dark-3 transition-colors flex items-center gap-2"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: category.color }}
                      />
                      <span className="flex-1 text-dark dark:text-white">
                        {category.name}
                      </span>
                      {isChecked && (
                        <span className="text-xs text-primary font-semibold">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="w-80">
          <label className="text-xs font-medium text-dark-5 dark:text-dark-6">
            Month / Year
          </label>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <Select
              value={filters.month}
              onChange={(value) => updateFilter("month", value)}
              options={[
                { value: "", label: "Month" },
                { value: "01", label: "January" },
                { value: "02", label: "February" },
                { value: "03", label: "March" },
                { value: "04", label: "April" },
                { value: "05", label: "May" },
                { value: "06", label: "June" },
                { value: "07", label: "July" },
                { value: "08", label: "August" },
                { value: "09", label: "September" },
                { value: "10", label: "October" },
                { value: "11", label: "November" },
                { value: "12", label: "December" },
              ]}
              className="w-full"
              buttonClassName="w-full"
            />
            <Select
              value={filters.year}
              onChange={(value) => updateFilter("year", value)}
              options={[
                { value: "", label: "Year" },
                ...availableYears.map((year) => ({
                  value: String(year),
                  label: String(year),
                })),
              ]}
              className="w-full"
              buttonClassName="w-full"
            />
          </div>
        </div>

        <div className="ml-auto relative" ref={advancedRef}>
          <Button
            variant="primary"
            size="md"
            onClick={() => setShowAdvanced(!showAdvanced)}
            leftIcon={<Filter className="w-4 h-4" />}
            rightIcon={
              hasActiveFilters ? (
                <span className="px-1.5 py-0.5 bg-white/20 text-white text-xs rounded-full">
                  •
                </span>
              ) : undefined
            }
          >
            Filters
          </Button>

          {showAdvanced && (
            <div className="absolute right-0 z-20 mt-2 w-96 rounded-lg border border-stroke dark:border-dark-3 bg-white dark:bg-dark-2 shadow-dropdown p-4">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-dark-5 dark:text-dark-6">
                      Type
                    </label>
                    <Select
                      value={filters.transactionType}
                      onChange={(value) =>
                        updateFilter(
                          "transactionType",
                          value as FilterValues["transactionType"],
                        )
                      }
                      options={[
                        { value: "all", label: "All Transactions" },
                        { value: "income", label: "Income Only" },
                        { value: "expense", label: "Expenses Only" },
                      ]}
                      className="mt-1 w-full"
                      buttonClassName="w-full"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-dark-5 dark:text-dark-6">
                      Date Order
                    </label>
                    <Select
                      value={filters.dateOrder}
                      onChange={(value) =>
                        updateFilter(
                          "dateOrder",
                          value as FilterValues["dateOrder"],
                        )
                      }
                      options={[
                        { value: "desc", label: "Newest First" },
                        { value: "asc", label: "Oldest First" },
                      ]}
                      className="mt-1 w-full"
                      buttonClassName="w-full"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-dark-5 dark:text-dark-6">
                    Account Identifier
                  </label>
                  <Select
                    value={filters.accountIdentifier}
                    onChange={(value) =>
                      updateFilter("accountIdentifier", value)
                    }
                    options={[
                      { value: "", label: "All Identifiers" },
                      ...accountNumbers.map((account) => ({
                        value: account.accountIdentifier,
                        label: accountDisplay(account),
                      })),
                    ]}
                    className="mt-1 w-full"
                    buttonClassName="w-full"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-dark-5 dark:text-dark-6">
                      From Date
                    </label>
                    <div className="mt-1 w-full h-11 rounded-lg border border-stroke dark:border-dark-3 bg-white dark:bg-dark-3">
                      <DatePicker
                        value={filters.dateFrom}
                        onChange={(value) => updateFilter("dateFrom", value)}
                        className="h-full"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-dark-5 dark:text-dark-6">
                      To Date
                    </label>
                    <div className="mt-1 w-full h-11 rounded-lg border border-stroke dark:border-dark-3 bg-white dark:bg-dark-3">
                      <DatePicker
                        value={filters.dateTo}
                        onChange={(value) => updateFilter("dateTo", value)}
                        className="h-full"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-dark-5 dark:text-dark-6">
                      Min Amount
                    </label>
                    <NumberInput
                      step="0.01"
                      placeholder="0.00"
                      value={filters.amountMin}
                      onChange={(e) =>
                        updateFilter("amountMin", e.target.value)
                      }
                      className="w-full mt-1"
                      inputClassName="w-full bg-white dark:bg-dark-3 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-dark-5 dark:text-dark-6">
                      Max Amount
                    </label>
                    <NumberInput
                      step="0.01"
                      placeholder="0.00"
                      value={filters.amountMax}
                      onChange={(e) =>
                        updateFilter("amountMax", e.target.value)
                      }
                      className="w-full mt-1"
                      inputClassName="w-full bg-white dark:bg-dark-3 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                </div>

                {hasActiveFilters && (
                  <div className="pt-3">
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={clearFilters}
                      leftIcon={<X className="w-4 h-4" />}
                      className="w-full"
                    >
                      Clear Filters
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
