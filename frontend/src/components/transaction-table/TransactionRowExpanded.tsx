import { ArrowLeftRight, Receipt, Scissors, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { AccountIdentifierSelect } from "@/components/ui/AccountIdentifierSelect";
import { Transaction, TransactionLinkage } from "./types";

interface AccountIdentifier {
  id: string;
  accountIdentifier: string;
  color: string;
}

interface TransactionRowExpandedProps {
  transaction: Transaction;
  colSpan: number;
  linkage?: TransactionLinkage | null;
  showOptions?: boolean;
  disabled?: boolean;
  linkedCount?: number;
  accountIdentifiers?: AccountIdentifier[];
  isNewAccount?: boolean;
  renderExpandedActions?: () => ReactNode;
  onAccountIdentifierChange?: (accountIdentifier: string) => void;
  onAddAccountIdentifier?: () => void;
  onLinkageChange?: (linkage: TransactionLinkage | null) => void;
  onSelectReimbursement?: () => void;
  onSplitTransaction?: () => void;
}

export function TransactionRowExpanded({
  transaction,
  colSpan,
  linkage,
  showOptions = false,
  disabled = false,
  linkedCount = 0,
  accountIdentifiers = [],
  isNewAccount = false,
  renderExpandedActions,
  onAccountIdentifierChange,
  onAddAccountIdentifier,
  onLinkageChange,
  onSelectReimbursement,
  onSplitTransaction,
}: TransactionRowExpandedProps) {
  const canMarkReimbursement = (transaction.amountIn ?? 0) > 0;
  const suggestionReason = String(transaction.metadata?.suggestionReason || "");
  const reviewStatus = String(transaction.metadata?.reviewStatus || "");

  const handleMarkInternal = () => {
    if (!onLinkageChange) return;
    if (linkage?.type === "internal") {
      onLinkageChange(null);
    } else {
      onLinkageChange({
        type: "internal",
        autoDetected: false,
      });
    }
  };

  const handleMarkReimbursement = () => {
    if (linkage?.type === "reimbursement") {
      onLinkageChange?.(null);
    } else {
      onSelectReimbursement?.();
    }
  };

  const handleClearLinkage = () => {
    onLinkageChange?.(null);
  };

  return (
    <tr className="border-b border-stroke dark:border-dark-3 bg-gray-1 dark:bg-dark-3/30">
      <td colSpan={colSpan} className="py-3 px-4">
        <div className="text-sm pl-8">
          {onAccountIdentifierChange && (
            <div className="mb-4">
              <div className="mb-2 font-medium text-dark dark:text-white">
                Account
              </div>
              <div className="max-w-sm">
                <AccountIdentifierSelect
                  value={transaction.accountIdentifier || ""}
                  accountIdentifiers={accountIdentifiers}
                  onChange={onAccountIdentifierChange}
                  onAddClick={onAddAccountIdentifier || (() => {})}
                  disabled={disabled}
                  newAccountBadge={isNewAccount}
                />
              </div>
              <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                Changing this account only updates this transaction row.
              </p>
            </div>
          )}

          {showOptions && (
            <div className="mb-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium text-dark dark:text-white">
                  Linkage
                </span>
                {linkage && (
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      linkage.type === "internal"
                        ? "bg-gray-2 dark:bg-dark-3 text-dark-5 dark:text-dark-6"
                        : "bg-green/10 text-green dark:text-green-light"
                    }`}
                  >
                    {linkage.type === "internal" ? "Internal" : "Reimbursement"}
                    {linkage.autoDetected && " (Auto)"}
                  </span>
                )}
                <Button
                  variant={linkage?.type === "internal" ? "primary" : "secondary"}
                  size="sm"
                  onClick={handleMarkInternal}
                  disabled={disabled}
                  leftIcon={<ArrowLeftRight className="w-4 h-4" />}
                >
                  {linkage?.type === "internal"
                    ? "Marked as Internal"
                    : "Mark as Internal"}
                </Button>

                {onSplitTransaction && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onSplitTransaction}
                    disabled={disabled}
                    leftIcon={<Scissors className="w-4 h-4" />}
                  >
                    Split Transaction
                  </Button>
                )}

                <Button
                  variant={
                    linkage?.type === "reimbursement" ? "primary" : "secondary"
                  }
                  size="sm"
                  onClick={handleMarkReimbursement}
                  disabled={
                    disabled ||
                    linkage?.type === "internal" ||
                    !canMarkReimbursement
                  }
                  leftIcon={<Receipt className="w-4 h-4" />}
                  className={
                    linkage?.type === "reimbursement"
                      ? "!bg-green hover:!bg-green/90"
                      : ""
                  }
                >
                  {linkage?.type === "reimbursement"
                    ? `Reimbursement (${linkedCount} linked)`
                    : "Mark as Reimbursement"}
                </Button>

                {linkage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearLinkage}
                    disabled={disabled}
                    leftIcon={<X className="w-4 h-4" />}
                    className="text-dark-5 hover:text-dark dark:text-dark-6 dark:hover:text-white"
                  >
                    Clear
                  </Button>
                )}

                {linkage?.autoDetected && (
                  <span className="text-xs text-dark-5 dark:text-dark-6">
                    Auto-detected: {linkage.detectionReason}
                  </span>
                )}
              </div>

              {linkage?.type === "reimbursement" && linkedCount > 0 && (
                <p className="mt-2 text-sm text-dark dark:text-white">
                  This transaction reimburses{" "}
                  <span className="font-medium">{linkedCount}</span> transaction
                  {linkedCount !== 1 ? "s" : ""}.
                </p>
              )}

              {!canMarkReimbursement && (
                <p className="mt-2 text-xs text-dark-5 dark:text-dark-6">
                  Reimbursement is available only for positive inflow transactions.
                </p>
              )}
            </div>
          )}

          {renderExpandedActions && <div className="mb-4">{renderExpandedActions()}</div>}

          {(transaction.suggestionSource || suggestionReason || reviewStatus) && (
            <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="mb-1 font-medium text-dark dark:text-white">
                Review details
              </div>
              {reviewStatus && (
                <p className="text-dark-5 dark:text-dark-6">Status: {reviewStatus}</p>
              )}
              {transaction.suggestionSource && (
                <p className="text-dark-5 dark:text-dark-6">
                  Suggested by {transaction.suggestionSource} · {Math.round(Number(transaction.suggestionConfidence || 0) * 100)}% confidence
                  {transaction.suggestionApplied ? " · applied" : " · awaiting review"}
                </p>
              )}
              {suggestionReason && (
                <p className="mt-1 text-dark-5 dark:text-dark-6">{suggestionReason}</p>
              )}
            </div>
          )}

          <div className="space-y-1">
            <div className="font-medium text-dark dark:text-white mb-2">
              Raw Data
            </div>
            {Object.entries(transaction.metadata).map(([key, value]) => (
              <div key={key} className="flex gap-2 text-dark-5 dark:text-dark-6">
                <span className="font-medium capitalize min-w-[120px]">
                  {key}:
                </span>
                <span className="break-all">
                  {value === null || value === undefined
                    ? "-"
                    : typeof value === "object"
                      ? JSON.stringify(value)
                      : String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </td>
    </tr>
  );
}
