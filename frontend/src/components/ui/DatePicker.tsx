"use client";

import { useState, useRef, useEffect } from "react";
import type { HTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";

interface DatePickerProps {
  value: string; // ISO date string (YYYY-MM-DD)
  onChange: (date: string) => void;
  className?: string;
  disabled?: boolean;
  triggerProps?: HTMLAttributes<HTMLButtonElement> & {
    [key: `data-${string}`]: string;
  };
}

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function DatePicker({
  value,
  onChange,
  className = "",
  disabled = false,
  triggerProps,
}: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    bottom: "auto" as number | "auto",
    left: 0,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Parse the value into a Date object
  const selectedDate = value ? new Date(value + "T00:00:00") : new Date();
  const [viewMonth, setViewMonth] = useState(selectedDate.getMonth());
  const [viewYear, setViewYear] = useState(selectedDate.getFullYear());

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        !dropdownRef.current?.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const updateDropdownPosition = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dropdownHeight = 340;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const showAbove = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;
    setDropdownPosition({
      top: showAbove ? 0 : rect.bottom + 4,
      bottom: showAbove ? window.innerHeight - rect.top + 4 : "auto",
      left: rect.left,
    });
  };

  useEffect(() => {
    if (!isOpen) return;
    updateDropdownPosition();
    window.addEventListener("scroll", updateDropdownPosition, true);
    window.addEventListener("resize", updateDropdownPosition);
    return () => {
      window.removeEventListener("scroll", updateDropdownPosition, true);
      window.removeEventListener("resize", updateDropdownPosition);
    };
  }, [isOpen]);

  // Reset view to selected date when opening
  useEffect(() => {
    if (isOpen && value) {
      const date = new Date(value + "T00:00:00");
      setViewMonth(date.getMonth());
      setViewYear(date.getFullYear());
    }
  }, [isOpen, value]);

  const getDaysInMonth = (month: number, year: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (month: number, year: number) => {
    return new Date(year, month, 1).getDay();
  };

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const handleSelectDate = (day: number) => {
    const newDate = new Date(viewYear, viewMonth, day);
    const isoDate = formatDateLocal(newDate);
    onChange(isoDate);
    setIsOpen(false);
  };

  const formatDateLocal = (date: Date) => {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const formatDisplayDate = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("en-SG", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const renderCalendar = () => {
    const daysInMonth = getDaysInMonth(viewMonth, viewYear);
    const firstDay = getFirstDayOfMonth(viewMonth, viewYear);
    const days = [];

    // Empty cells for days before the first day of the month
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="w-8 h-8" />);
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const isSelected =
        value &&
        selectedDate.getDate() === day &&
        selectedDate.getMonth() === viewMonth &&
        selectedDate.getFullYear() === viewYear;

      const isToday =
        new Date().getDate() === day &&
        new Date().getMonth() === viewMonth &&
        new Date().getFullYear() === viewYear;

      days.push(
        <button
          key={day}
          type="button"
          onClick={() => handleSelectDate(day)}
          className={`w-8 h-8 rounded-full text-sm font-medium transition-colors
            ${
              isSelected
                ? "bg-primary text-white"
                : isToday
                  ? "bg-primary/20 text-primary dark:text-primary"
                  : "text-dark dark:text-white hover:bg-gray-2 dark:hover:bg-dark-3"
            }`}
        >
          {day}
        </button>,
      );
    }

    return days;
  };

  const { className: triggerClassNameProp, ...triggerRestProps } =
    triggerProps || {};
  const triggerClassName = [
    "w-full h-full flex items-center px-4 py-3 text-sm text-left bg-transparent text-dark dark:text-white outline-none cursor-pointer hover:bg-gray-2 dark:hover:bg-dark-3 transition-colors disabled:cursor-not-allowed disabled:hover:bg-transparent",
    triggerClassNameProp,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={containerRef} className={`relative w-full h-full ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        {...triggerRestProps}
        className={triggerClassName}
      >
        <Calendar className="h-4 w-4 text-dark-5 dark:text-dark-6 mr-3 shrink-0" />
        <span className="flex-1 font-medium">
          {value ? formatDisplayDate(value) : "Select date"}
        </span>
      </button>

      {/* Calendar Dropdown */}
      {isOpen && !disabled &&
        createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[90] p-3 bg-white dark:bg-dark-2 border border-stroke dark:border-dark-3 rounded-lg shadow-dropdown min-w-70"
          style={{
            top: dropdownPosition.bottom === "auto" ? dropdownPosition.top : "auto",
            bottom: dropdownPosition.bottom,
            left: dropdownPosition.left,
          }}
        >
          {/* Month/Year Navigation */}
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1.5 rounded-full hover:bg-gray-2 dark:hover:bg-dark-3 transition-colors"
            >
              <ChevronLeft className="h-4 w-4 text-dark dark:text-white" />
            </button>
            <span className="text-sm font-semibold text-dark dark:text-white">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1.5 rounded-full hover:bg-gray-2 dark:hover:bg-dark-3 transition-colors"
            >
              <ChevronRight className="h-4 w-4 text-dark dark:text-white" />
            </button>
          </div>

          {/* Day Headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {DAYS.map((day) => (
              <div
                key={day}
                className="w-8 h-8 flex items-center justify-center text-xs font-medium text-dark-5 dark:text-dark-6"
              >
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1">{renderCalendar()}</div>

          {/* Today Button */}
          <div className="mt-3 pt-3 border-t border-stroke dark:border-dark-3">
            <button
              type="button"
              onClick={() => {
                const today = formatDateLocal(new Date());
                onChange(today);
                setIsOpen(false);
              }}
              className="w-full py-2 text-sm font-medium text-primary hover:bg-gray-2 dark:hover:bg-dark-3 rounded-lg transition-colors"
            >
              Today
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
