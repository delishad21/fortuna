"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "./Button";
import { ColorSelect } from "./ColorSelect";
import { Select } from "./Select";

interface NewAccountColorModalProps {
  isOpen: boolean;
  accounts: Array<{ accountIdentifier: string; defaultColor: string }>;
  /** Existing accounts a new identifier can be added to instead. */
  existingAccounts?: Array<{ id: string; name: string; color: string }>;
  onConfirm: (
    colorsByAccount: Record<string, string>,
    labelsByAccount: Record<string, string>,
    accountIdsByIdentifier: Record<string, string>,
  ) => void;
  onCancel: () => void;
}

export function NewAccountColorModal({
  isOpen,
  accounts,
  existingAccounts = [],
  onConfirm,
  onCancel,
}: NewAccountColorModalProps) {
  const [accountIds, setAccountIds] = useState<Record<string, string>>({});
  const [selectedColors, setSelectedColors] = useState<Record<string, string>>(
    {},
  );
  const [labels, setLabels] = useState<Record<string, string>>({});
  const accountsKey = accounts
    .map((account) => `${account.accountIdentifier}:${account.defaultColor}`)
    .join("|");

  useEffect(() => {
    if (!isOpen) return;
    setAccountIds({});
    setSelectedColors(
      Object.fromEntries(
        accounts.map((account) => [
          account.accountIdentifier,
          account.defaultColor,
        ]),
      ),
    );
  }, [accountsKey, isOpen]);

  if (!isOpen) return null;

  const handleColorChange = (accountIdentifier: string, color: string) => {
    setSelectedColors((prev) => ({ ...prev, [accountIdentifier]: color }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-dark-2 rounded-lg shadow-[var(--shadow-card-2)] w-full max-w-md">
        {/* Header */}
        <div className="p-6 border-b border-stroke dark:border-dark-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-dark dark:text-white">
                New Accounts Detected
              </h2>
              <p className="text-sm text-dark-5 dark:text-dark-6 mt-0.5">
                Name each new account and pick a colour
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-3 max-h-[60vh] overflow-y-auto">
          {accounts.map((account) => {
            const existing = existingAccounts.find(
              (item) => item.id === accountIds[account.accountIdentifier],
            );
            const selectedColor =
              existing?.color ||
              selectedColors[account.accountIdentifier] ||
              account.defaultColor;

            return (
              <div
                key={account.accountIdentifier}
                className="flex items-center gap-3 p-4 bg-gray-2 dark:bg-dark-3 rounded-lg"
              >
                <div
                  className="h-8 w-8 rounded-full border-2 border-white/70 shrink-0"
                  style={{ backgroundColor: selectedColor }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-dark-5 dark:text-dark-6 uppercase tracking-wide">
                    Account Identifier
                  </p>
                  <p className="text-sm font-semibold text-dark dark:text-white truncate mt-0.5">
                    {account.accountIdentifier}
                  </p>
                  {existingAccounts.length > 0 && (
                    <Select
                      value={accountIds[account.accountIdentifier] || ""}
                      options={[
                        { value: "", label: "New account" },
                        ...existingAccounts.map((item) => ({
                          value: item.id,
                          label: item.name,
                          color: item.color,
                        })),
                      ]}
                      onChange={(id) =>
                        setAccountIds((prev) => ({
                          ...prev,
                          [account.accountIdentifier]: id,
                        }))
                      }
                      size="sm"
                      menuStrategy="fixed"
                      menuPlacement="auto"
                      className="mt-2"
                    />
                  )}
                  {!existing && (
                  <input
                    aria-label={`Name for ${account.accountIdentifier}`}
                    value={labels[account.accountIdentifier] || ""}
                    maxLength={80}
                    placeholder="Name, e.g. UOB One credit card"
                    onChange={(e) =>
                      setLabels((prev) => ({
                        ...prev,
                        [account.accountIdentifier]: e.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-md border border-stroke bg-white px-2.5 py-1.5 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2"
                  />
                  )}
                </div>
                {!existing && (
                  <ColorSelect
                    value={selectedColor}
                    onChange={(color) =>
                      handleColorChange(account.accountIdentifier, color)
                    }
                  />
                )}
              </div>
            );
          })}

          {/* Preview Text */}
          <p className="text-xs text-dark-5 dark:text-dark-6 text-center">
            Names and colours help you recognise each account across Fortuna
          </p>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-stroke dark:border-dark-3 flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => onConfirm(selectedColors, labels, accountIds)}
          >
            Save Accounts
          </Button>
        </div>
      </div>
    </div>
  );
}
