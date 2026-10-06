"use client";

import { useEffect, useMemo, useState } from "react";
import { GitMerge, Trash2 } from "lucide-react";
import type { TripWallet, WalletAccount } from "@/app/actions/tripWallets";
import {
  createWalletAccount,
  deleteTripWallet,
  mergeTripWallet,
  updateTripWallet,
} from "@/lib/tripWalletMutations";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { ColorSelect } from "@/components/ui/ColorSelect";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { TextInput } from "@/components/ui/TextInput";

const NO_ACCOUNT = "__none__";
const NEW_ACCOUNT = "__new__";

const labelClass =
  "mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6";

interface TripWalletSettingsCardProps {
  tripId: string;
  wallet: TripWallet;
  wallets: TripWallet[];
  accounts: WalletAccount[];
  /** Entries and fundings in this wallet, or null while they load. */
  usage: { entries: number; fundings: number } | null;
  onAccountsChanged: (accounts: WalletAccount[]) => void;
  /** Reload wallets after a change. `selectWalletId` picks the wallet to show next. */
  onChanged: (selectWalletId?: string) => Promise<void>;
  onError: (title: string, message: string) => void;
  onSuccess: (title: string, message: string) => void;
}

export function TripWalletSettingsCard({
  tripId,
  wallet,
  wallets,
  accounts,
  usage,
  onAccountsChanged,
  onChanged,
  onError,
  onSuccess,
}: TripWalletSettingsCardProps) {
  const [name, setName] = useState(wallet.name);
  const [color, setColor] = useState(wallet.color);
  const [accountChoice, setAccountChoice] = useState(wallet.accountId || NO_ACCOUNT);
  const [newAccountName, setNewAccountName] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [confirm, setConfirm] = useState<"merge" | "delete" | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    setName(wallet.name);
    setColor(wallet.color);
    setAccountChoice(wallet.accountId || NO_ACCOUNT);
    setNewAccountName("");
    setMergeTargetId("");
  }, [wallet.id, wallet.name, wallet.color, wallet.accountId]);

  const accountOptions = useMemo(() => {
    const visible = accounts.filter(
      (account) => !account.archivedAt || account.id === wallet.accountId,
    );
    return [
      { value: NO_ACCOUNT, label: "No account" },
      ...visible.map((account) => ({
        value: account.id,
        label: account.archivedAt ? `${account.name} (archived)` : account.name,
      })),
      { value: NEW_ACCOUNT, label: "New account…" },
    ];
  }, [accounts, wallet.accountId]);

  const mergeOptions = useMemo(
    () =>
      wallets
        .filter(
          (other) =>
            other.id !== wallet.id &&
            other.currency.toUpperCase() === wallet.currency.toUpperCase(),
        )
        .map((other) => ({ value: other.id, label: other.name })),
    [wallets, wallet.id, wallet.currency],
  );
  const mergeTarget = wallets.find((other) => other.id === mergeTargetId) || null;

  const isDirty =
    name.trim() !== wallet.name ||
    color !== wallet.color ||
    (accountChoice !== NEW_ACCOUNT &&
      (accountChoice === NO_ACCOUNT ? null : accountChoice) !== wallet.accountId) ||
    (accountChoice === NEW_ACCOUNT && Boolean(newAccountName.trim()));

  const inUse = usage ? usage.entries > 0 || usage.fundings > 0 : false;
  const deleteReason = !usage
    ? "Checking whether this wallet is in use…"
    : inUse
      ? `This wallet has ${usage.entries} ${usage.entries === 1 ? "entry" : "entries"} and ${usage.fundings} ${usage.fundings === 1 ? "funding" : "fundings"}. Merge it into another wallet instead.`
      : null;

  const handleSave = async () => {
    if (!name.trim()) {
      onError("Name Required", "A wallet needs a name.");
      return;
    }
    setIsBusy(true);
    try {
      let accountId: string | null =
        accountChoice === NO_ACCOUNT ? null : accountChoice;
      if (accountChoice === NEW_ACCOUNT) {
        if (!newAccountName.trim()) {
          onError("Account Name Required", "Enter a name for the new account.");
          return;
        }
        const account = await createWalletAccount({ name: newAccountName.trim(), color });
        onAccountsChanged([...accounts, account]);
        accountId = account.id;
      }
      await updateTripWallet(tripId, wallet.id, {
        ...(name.trim() !== wallet.name ? { name: name.trim() } : {}),
        ...(color !== wallet.color ? { color } : {}),
        ...(accountId !== wallet.accountId ? { accountId } : {}),
      });
      await onChanged(wallet.id);
    } catch (error) {
      onError(
        "Save Failed",
        error instanceof Error ? error.message : "Could not update the wallet.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleMerge = async () => {
    if (!mergeTarget) return;
    setIsBusy(true);
    try {
      await mergeTripWallet(tripId, wallet.id, mergeTarget.id);
      await onChanged(mergeTarget.id);
      onSuccess("Wallets Merged", `${wallet.name} was merged into ${mergeTarget.name}.`);
    } catch (error) {
      onError(
        "Merge Failed",
        error instanceof Error ? error.message : "Could not merge the wallets.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = async () => {
    setIsBusy(true);
    try {
      await deleteTripWallet(tripId, wallet.id);
      await onChanged(wallets.find((other) => other.id !== wallet.id)?.id || "");
      onSuccess("Wallet Deleted", `${wallet.name} was deleted.`);
    } catch (error) {
      onError(
        "Delete Failed",
        error instanceof Error ? error.message : "Could not delete the wallet.",
      );
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div>
          <h4 className="text-sm font-semibold text-dark dark:text-white">
            Wallet settings
          </h4>
          <p className="text-xs text-dark-5 dark:text-dark-6">
            Account: {wallet.accountName || "None"} • Currency stays {wallet.currency}.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,220px)_auto] md:items-end">
          <div>
            <label className={labelClass}>Name</label>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Color</label>
            <ColorSelect value={color} onChange={setColor} />
          </div>
          <div>
            <label className={labelClass}>Account</label>
            <Select
              value={accountChoice}
              onChange={setAccountChoice}
              options={accountOptions}
              className="w-full"
              buttonClassName="w-full"
            />
          </div>
          <Button
            variant="primary"
            onClick={() => void handleSave()}
            disabled={isBusy || !isDirty}
          >
            Save
          </Button>
        </div>
        {accountChoice === NEW_ACCOUNT && (
          <div className="md:max-w-sm">
            <label className={labelClass}>New account name</label>
            <TextInput
              value={newAccountName}
              onChange={(e) => setNewAccountName(e.target.value)}
              placeholder="e.g. Revolut"
            />
          </div>
        )}

        <div className="grid gap-3 border-t border-stroke pt-4 dark:border-dark-3 md:grid-cols-[minmax(0,260px)_auto_1fr_auto] md:items-center">
          <Select
            value={mergeTargetId}
            onChange={setMergeTargetId}
            options={mergeOptions}
            placeholder={
              mergeOptions.length
                ? "Merge into…"
                : `No other ${wallet.currency} wallet`
            }
            disabled={mergeOptions.length === 0}
            className="w-full"
            buttonClassName="w-full"
          />
          <Button
            variant="secondary"
            leftIcon={<GitMerge className="h-4 w-4" />}
            onClick={() => setConfirm("merge")}
            disabled={isBusy || !mergeTarget}
          >
            Merge
          </Button>
          <div />
          <div className="flex flex-col items-start gap-1 md:items-end">
            <Button
              variant="danger"
              leftIcon={<Trash2 className="h-4 w-4" />}
              onClick={() => setConfirm("delete")}
              disabled={isBusy || Boolean(deleteReason)}
              title={deleteReason || undefined}
            >
              Delete wallet
            </Button>
          </div>
        </div>
        {deleteReason && usage && (
          <p className="text-xs text-dark-5 dark:text-dark-6">{deleteReason}</p>
        )}
      </CardContent>

      <Modal
        isOpen={confirm === "merge" && Boolean(mergeTarget)}
        onClose={() => setConfirm(null)}
        type="warning"
        title="Merge Wallets?"
        message={`All entries and funding in ${wallet.name} move to ${mergeTarget?.name}, and ${wallet.name} is deleted. ${mergeTarget?.name}'s rate is then recalculated from the combined funding. This can't be undone.`}
        confirmText="Merge"
        onConfirm={() => void handleMerge()}
      />
      <Modal
        isOpen={confirm === "delete"}
        onClose={() => setConfirm(null)}
        type="warning"
        title="Delete Wallet?"
        message={`${wallet.name} will be removed from this trip.`}
        confirmText="Delete"
        onConfirm={() => void handleDelete()}
      />
    </Card>
  );
}
