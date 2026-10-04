"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { accountDisplay } from "@/lib/accounts";
import { ChevronDown, Plus, Check, Sparkles } from "lucide-react";

interface AccountIdentifier {
  id: string;
  accountIdentifier: string;
  label?: string | null;
  color: string;
}

interface AccountIdentifierSelectProps {
  value?: string;
  accountIdentifiers: AccountIdentifier[];
  onChange: (accountIdentifier: string) => void;
  onAddClick: () => void;
  disabled?: boolean;
  newAccountBadge?: boolean; // Show "New" badge for new accounts
}

export function AccountIdentifierSelect({
  value,
  accountIdentifiers,
  onChange,
  onAddClick,
  disabled = false,
  newAccountBadge = false,
}: AccountIdentifierSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });
  const [showAbove, setShowAbove] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedAccount = accountIdentifiers.find(
    (a) => a.accountIdentifier === value,
  );

  const updateDropdownPosition = () => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const dropdownHeight = 240; // max-h-60 = 240px
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    // Determine if dropdown should show above or below
    const shouldShowAbove =
      spaceBelow < dropdownHeight && spaceAbove > spaceBelow;

    setShowAbove(shouldShowAbove);
    setDropdownPosition({
      top: shouldShowAbove ? rect.top - 4 : rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen) {
      updateDropdownPosition();

      // Update position on scroll
      const handleScroll = () => {
        updateDropdownPosition();
      };

      // Listen to scroll on all scrollable parents
      window.addEventListener("scroll", handleScroll, true);
      window.addEventListener("resize", handleScroll);

      return () => {
        window.removeEventListener("scroll", handleScroll, true);
        window.removeEventListener("resize", handleScroll);
      };
    }
  }, [isOpen]);

  const handleSelect = (accountIdentifier: string) => {
    onChange(accountIdentifier);
    setIsOpen(false);
  };

  const handleAddNew = () => {
    setIsOpen(false);
    onAddClick();
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          // Position before the first frame so the menu never flashes at 0,0.
          if (!isOpen) updateDropdownPosition();
          setIsOpen(!isOpen);
        }}
        disabled={disabled}
        className={`w-full flex items-center px-4 py-3 text-sm text-left bg-white dark:bg-dark-2 border border-stroke dark:border-dark-3 rounded-lg outline-none cursor-pointer hover:border-primary dark:hover:border-primary transition-all disabled:cursor-not-allowed disabled:hover:border-stroke disabled:dark:hover:border-dark-3 ${
          isOpen ? "ring-2 ring-inset ring-primary border-primary" : ""
        }`}
      >
        {selectedAccount ? (
          <>
            <div
              className="w-2.5 h-2.5 rounded-full mr-2 shrink-0"
              style={{ backgroundColor: selectedAccount.color }}
            />
            <span className="flex-1 truncate font-medium text-dark dark:text-white">
              {accountDisplay(selectedAccount)}
            </span>
            {newAccountBadge && (
              <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded-full flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                New
              </span>
            )}
          </>
        ) : value ? (
          <>
            <div className="w-2.5 h-2.5 rounded-full mr-2 shrink-0 bg-primary" />
            <span className="flex-1 truncate font-medium text-dark dark:text-white">
              {value}
            </span>
            {newAccountBadge && (
              <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded-full flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                New
              </span>
            )}
          </>
        ) : (
          <span className="flex-1 text-dark-5 dark:text-dark-6">
            No Account
          </span>
        )}
        <ChevronDown
          className={`h-4 w-4 text-dark-5 dark:text-dark-6 ml-2 shrink-0 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dropdown Menu: portalled so transformed or clipped ancestors cannot offset it */}
      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[90] py-1 bg-white dark:bg-dark-2 border border-stroke dark:border-dark-3 rounded-lg shadow-dropdown max-h-60 overflow-auto"
            style={{
              top: showAbove ? "auto" : dropdownPosition.top,
              bottom: showAbove
                ? window.innerHeight - dropdownPosition.top
                : "auto",
              left: dropdownPosition.left,
              width: dropdownPosition.width,
              transformOrigin: showAbove ? "bottom" : "top",
            }}
          >
            {/* No Account Option */}
            <button
              type="button"
              onClick={() => handleSelect("")}
              className="w-full flex items-center px-4 py-2.5 text-sm text-left hover:bg-gray-2 dark:hover:bg-dark-3 transition-colors"
            >
              <div className="w-2.5 h-2.5 rounded-full mr-2 shrink-0 bg-dark-5 dark:bg-dark-6" />
              <span className="flex-1 text-dark dark:text-white">
                No Account
              </span>
              {!value && <Check className="h-4 w-4 text-primary ml-2" />}
            </button>

            {/* Divider */}
            {accountIdentifiers.length > 0 && (
              <div className="h-px bg-stroke dark:bg-dark-3 my-1" />
            )}

            {/* Account Options */}
            {accountIdentifiers.map((account) => (
              <button
                key={account.id}
                type="button"
                onClick={() => handleSelect(account.accountIdentifier)}
                className="w-full flex items-center px-4 py-2.5 text-sm text-left hover:bg-gray-2 dark:hover:bg-dark-3 transition-colors"
              >
                <div
                  className="w-2.5 h-2.5 rounded-full mr-2 shrink-0"
                  style={{ backgroundColor: account.color }}
                />
                <span className="flex-1 text-dark dark:text-white">
                  {account.label?.trim() ? (
                    <>
                      {account.label}
                      <span className="ml-1.5 text-xs text-dark-5 dark:text-dark-6">
                        {account.accountIdentifier}
                      </span>
                    </>
                  ) : (
                    account.accountIdentifier
                  )}
                </span>
                {value === account.accountIdentifier && (
                  <Check className="h-4 w-4 text-primary ml-2" />
                )}
              </button>
            ))}

            {/* Divider */}
            <div className="h-px bg-stroke dark:bg-dark-3 my-1" />

            {/* Add New Account */}
            <button
              type="button"
              onClick={handleAddNew}
              className="w-full flex items-center px-4 py-2.5 text-sm text-left text-primary hover:bg-gray-2 dark:hover:bg-dark-3 transition-colors font-medium"
            >
              <Plus className="h-4 w-4 mr-2" />
              <span>New Account</span>
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
