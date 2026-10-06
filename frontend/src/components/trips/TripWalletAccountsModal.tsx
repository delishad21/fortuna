"use client";

import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, Plus } from "lucide-react";
import type { WalletAccount } from "@/app/actions/tripWallets";
import {
  createWalletAccount,
  updateWalletAccount,
} from "@/lib/tripWalletMutations";
import { Button } from "@/components/ui/Button";
import { ColorSelect } from "@/components/ui/ColorSelect";
import { TextInput } from "@/components/ui/TextInput";
import { getRandomWalletColor } from "@/lib/walletColors";

interface TripWalletAccountsModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: WalletAccount[];
  /** Called after any change. Renames can rename wallets too, so reload them. */
  onChanged: (accounts: WalletAccount[]) => Promise<void> | void;
}

export function TripWalletAccountsModal({
  isOpen,
  onClose,
  accounts,
  onChanged,
}: TripWalletAccountsModalProps) {
  const [drafts, setDrafts] = useState<Record<string, { name: string; color: string }>>({});
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(getRandomWalletColor);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDrafts(
      Object.fromEntries(
        accounts.map((account) => [account.id, { name: account.name, color: account.color }]),
      ),
    );
    setError(null);
  }, [isOpen, accounts]);

  if (!isOpen) return null;

  const replace = (next: WalletAccount) =>
    accounts.map((account) => (account.id === next.id ? next : account));

  const run = async (id: string, task: () => Promise<WalletAccount[]>) => {
    setBusyId(id);
    setError(null);
    try {
      await onChanged(await task());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the account.");
    } finally {
      setBusyId(null);
    }
  };

  const handleSave = (account: WalletAccount) => {
    const draft = drafts[account.id];
    if (!draft?.name.trim()) {
      setError("An account needs a name.");
      return;
    }
    void run(account.id, async () =>
      replace(
        await updateWalletAccount(account.id, {
          ...(draft.name.trim() !== account.name ? { name: draft.name.trim() } : {}),
          ...(draft.color !== account.color ? { color: draft.color } : {}),
        }),
      ),
    );
  };

  const handleArchive = (account: WalletAccount) =>
    void run(account.id, async () =>
      replace(await updateWalletAccount(account.id, { archived: !account.archivedAt })),
    );

  const handleCreate = () => {
    if (!newName.trim()) return;
    void run("new", async () => {
      const account = await createWalletAccount({ name: newName.trim(), color: newColor });
      setNewName("");
      setNewColor(getRandomWalletColor());
      return [...accounts, account];
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 p-4 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-2xl bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 shadow-card-2 max-h-[88vh] overflow-hidden flex flex-col"
      >
        <div className="border-b border-stroke px-6 py-4 dark:border-dark-3">
          <h3 className="text-lg font-semibold text-dark dark:text-white">
            Wallet accounts
          </h3>
          <p className="text-sm text-dark-5 dark:text-dark-6">
            An account like Revolut groups the wallets you use on every trip. Renaming
            it also renames wallets still named after it, like &quot;Revolut JPY&quot;.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-2">
          {accounts.length === 0 && (
            <div className="rounded-lg border border-dashed border-stroke px-3 py-4 text-sm text-dark-5 dark:border-dark-3 dark:text-dark-6">
              No accounts yet.
            </div>
          )}
          {accounts.map((account) => {
            const draft = drafts[account.id] || { name: account.name, color: account.color };
            const isDirty =
              draft.name.trim() !== account.name || draft.color !== account.color;
            const isBusy = busyId === account.id;
            return (
              <div
                key={account.id}
                className={`rounded-lg border border-stroke px-3 py-2.5 dark:border-dark-3 ${
                  account.archivedAt ? "opacity-70" : ""
                }`}
              >
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-center">
                  <TextInput
                    value={draft.name}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [account.id]: { ...draft, name: e.target.value },
                      }))
                    }
                  />
                  <ColorSelect
                    value={draft.color}
                    onChange={(color) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [account.id]: { ...draft, color },
                      }))
                    }
                  />
                  <Button
                    variant="primary"
                    onClick={() => handleSave(account)}
                    disabled={isBusy || !isDirty}
                  >
                    Save
                  </Button>
                  <Button
                    variant="secondary"
                    leftIcon={
                      account.archivedAt ? (
                        <ArchiveRestore className="h-4 w-4" />
                      ) : (
                        <Archive className="h-4 w-4" />
                      )
                    }
                    onClick={() => handleArchive(account)}
                    disabled={isBusy}
                  >
                    {account.archivedAt ? "Unarchive" : "Archive"}
                  </Button>
                </div>
                <div className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                  {account.walletCount} {account.walletCount === 1 ? "wallet" : "wallets"}
                  {account.archivedAt ? " • Archived, hidden when linking wallets" : ""}
                </div>
              </div>
            );
          })}

          <div className="grid gap-2 border-t border-stroke pt-3 dark:border-dark-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
            <TextInput
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New account, e.g. Revolut"
            />
            <ColorSelect value={newColor} onChange={setNewColor} />
            <Button
              variant="secondary"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={handleCreate}
              disabled={busyId === "new" || !newName.trim()}
            >
              Add
            </Button>
          </div>

          {error && <p className="text-sm text-red dark:text-red-light">{error}</p>}
        </div>

        <div className="border-t border-stroke px-6 py-4 flex justify-end dark:border-dark-3">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
