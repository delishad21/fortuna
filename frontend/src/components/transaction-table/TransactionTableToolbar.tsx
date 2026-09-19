import { CheckCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { AccountIdentifierSelect } from "@/components/ui/AccountIdentifierSelect";
import { ParseResult } from "./types";

interface AccountIdentifier {
  id: string;
  accountIdentifier: string;
  color: string;
}

interface TransactionTableToolbarProps {
  parsedData: ParseResult;
  accountIdentifier: string;
  accountColor?: string;
  accountIdentifiers: AccountIdentifier[];
  isNewAccount?: boolean;
  selectedCount: number;
  totalCount: number;
  duplicateCount: number;
  showDuplicatesOnly: boolean;
  showAccountSelector?: boolean;
  isCheckingDuplicates: boolean;
  isImporting: boolean;
  onBack?: () => void;
  onImport: () => void;
  onConfirmImport?: () => void;
  onAccountIdentifierChange: (value: string) => void;
  onAccountColorChange?: (color: string) => void;
  onAddAccountIdentifier?: () => void;
  reviewActionLeft?: ReactNode;
  primaryActionLabel?: string;
}

export function TransactionTableToolbar({
  parsedData,
  accountIdentifier,
  accountColor = "#6366f1",
  accountIdentifiers,
  isNewAccount = false,
  selectedCount,
  totalCount,
  duplicateCount,
  showDuplicatesOnly,
  showAccountSelector = true,
  isCheckingDuplicates,
  isImporting,
  onBack,
  onImport,
  onConfirmImport,
  onAccountIdentifierChange,
  onAccountColorChange,
  onAddAccountIdentifier,
  reviewActionLeft,
  primaryActionLabel,
}: TransactionTableToolbarProps) {
  return (
    <div className="shrink-0 py-3 mb-3">
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
                ? `${duplicateCount} Potential Duplicate${duplicateCount !== 1 ? "s" : ""}`
                : `${totalCount} Transaction${totalCount !== 1 ? "s" : ""}`}
            </span>
          </div>
          <div className="h-6 w-px bg-stroke dark:bg-dark-3" />
          <div className="text-sm text-dark-5 dark:text-dark-6">
            <span>{parsedData.parserId}</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {!showDuplicatesOnly && showAccountSelector && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-dark dark:text-white whitespace-nowrap">
                Account:
              </span>
              <div className="w-64">
                <AccountIdentifierSelect
                  value={accountIdentifier}
                  accountIdentifiers={accountIdentifiers}
                  onChange={onAccountIdentifierChange}
                  onAddClick={onAddAccountIdentifier || (() => {})}
                  newAccountBadge={isNewAccount}
                />
              </div>
            </div>
          )}

          {showDuplicatesOnly ? (
            /* Duplicate handling stage */
            <div className="flex items-center gap-2">
              <span className="text-sm text-orange-dark dark:text-orange-light font-medium">
                {selectedCount} selected to import
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
            /* Review stage */
            <div className="flex items-end gap-3">
              {reviewActionLeft}
              <Button
                variant="success"
                onClick={onImport}
                disabled={isCheckingDuplicates || selectedCount === 0}
                leftIcon={<CheckCircle className="h-4 w-4" />}
              >
                {isCheckingDuplicates
                  ? "Checking..."
                  : primaryActionLabel || `Import Selected (${selectedCount})`}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
