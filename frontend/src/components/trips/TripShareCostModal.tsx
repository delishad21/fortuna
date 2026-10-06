"use client";

import { useMemo, useState } from "react";
import type {
  TripMember,
  TripSharedOverview,
} from "@/app/actions/tripSharing";
import { setTripEntryShares } from "@/lib/tripSharingMutations";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { NumberInput } from "@/components/ui/NumberInput";

interface TripShareCostModalProps {
  isOpen: boolean;
  onClose: () => void;
  tripId: string;
  entry: {
    id: string;
    title: string;
    localAmount: number;
    localCurrency: string;
    baseAmount: number;
  } | null;
  /** Everyone on the shared trip; viewers and you are left out of the list. */
  members: TripMember[];
  /** Shares already set on this entry, in the trip's base currency. */
  existingShares: Array<{ userId: string; baseAmount: number }>;
  onSaved: (overview: TripSharedOverview) => void;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

const formatAmount = (value: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-SG", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
};

/** Even split between you and the chosen people, with the rounding left on your part. */
const evenSplit = (total: number, userIds: string[]) => {
  const each = round2(total / (userIds.length + 1));
  return Object.fromEntries(userIds.map((id) => [id, String(each)]));
};

/** Splits one of your entries with other members of a shared trip. */
export function TripShareCostModal({
  isOpen,
  onClose,
  tripId,
  entry,
  members,
  existingShares,
  onSaved,
}: TripShareCostModalProps) {
  const eligible = useMemo(
    () =>
      members.filter(
        (member) =>
          !member.isMe && member.status === "active" && member.role !== "viewer",
      ),
    [members],
  );
  // Mount with a `key` per entry: the form starts from the entry's current shares.
  const [initial] = useState(() => {
    if (!entry) return { checked: new Set<string>(), amounts: {} };
    if (existingShares.length > 0) {
      // Shares come back in base; show them in the entry's own currency.
      const ratio = entry.baseAmount > 0 ? entry.localAmount / entry.baseAmount : 1;
      return {
        checked: new Set(existingShares.map((share) => share.userId)),
        amounts: Object.fromEntries(
          existingShares.map((share) => [
            share.userId,
            String(round2(share.baseAmount * ratio)),
          ]),
        ) as Record<string, string>,
      };
    }
    const ids = eligible.map((member) => member.userId);
    return { checked: new Set(ids), amounts: evenSplit(entry.localAmount, ids) };
  });
  const [checked, setChecked] = useState<Set<string>>(initial.checked);
  const [amounts, setAmounts] = useState<Record<string, string>>(initial.amounts);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen || !entry) return null;

  const total = [...checked].reduce(
    (sum, userId) => sum + (Number(amounts[userId]) || 0),
    0,
  );
  const myPart = round2(entry.localAmount - total);

  const toggle = (userId: string, next: boolean) => {
    const nextChecked = new Set(checked);
    if (next) nextChecked.add(userId);
    else nextChecked.delete(userId);
    setChecked(nextChecked);
    setAmounts(evenSplit(entry.localAmount, [...nextChecked]));
  };

  const handleSave = async () => {
    const shares = [...checked]
      .filter((userId) => eligible.some((member) => member.userId === userId))
      .map((userId) => ({
        userId,
        localAmount: Number(amounts[userId]) || 0,
      }));
    if (shares.some((share) => share.localAmount < 0)) {
      setError("Amounts can't be negative.");
      return;
    }
    if (myPart < -0.005) {
      setError(
        `Shares add up to more than ${formatAmount(entry.localAmount, entry.localCurrency)}.`,
      );
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      const overview = await setTripEntryShares(
        tripId,
        entry.id,
        shares.filter((share) => share.localAmount > 0),
      );
      onSaved(overview);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not share the cost.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 p-4 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 shadow-card-2 max-h-[85vh] overflow-hidden flex flex-col"
      >
        <div className="px-6 py-4 border-b border-stroke dark:border-dark-3">
          <h3 className="text-lg font-semibold text-dark dark:text-white">
            Share cost
          </h3>
          <p className="text-sm text-dark-5 dark:text-dark-6">
            {entry.title} · {formatAmount(entry.localAmount, entry.localCurrency)}.
            Each share is owed to you and comes off your cost now.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-3">
          {eligible.length === 0 && (
            <div className="rounded-lg border border-dashed border-stroke dark:border-dark-3 px-3 py-4 text-sm text-dark-5 dark:text-dark-6">
              Nobody else on this trip can take a share. Viewers can&apos;t be
              given one.
            </div>
          )}
          {eligible.map((member) => (
            <div
              key={member.userId}
              className="flex items-center gap-3 rounded-lg border border-stroke dark:border-dark-3 px-3 py-2.5"
            >
              <Checkbox
                checked={checked.has(member.userId)}
                onChange={(next) => toggle(member.userId, next)}
                aria-label={`Share with ${member.name}`}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-dark dark:text-white">
                {member.name}
              </span>
              <div className="w-36 shrink-0">
                <NumberInput
                  size="sm"
                  value={checked.has(member.userId) ? amounts[member.userId] ?? "" : ""}
                  onChange={(event) =>
                    setAmounts((prev) => ({
                      ...prev,
                      [member.userId]: event.target.value,
                    }))
                  }
                  disabled={!checked.has(member.userId)}
                  rightIcon={
                    <span className="text-[10px]">{entry.localCurrency}</span>
                  }
                />
              </div>
            </div>
          ))}
          {eligible.length > 0 && (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-dark-5 dark:text-dark-6">
                Your part:{" "}
                <span
                  className={
                    myPart < -0.005
                      ? "font-semibold text-red"
                      : "font-semibold text-dark dark:text-white"
                  }
                >
                  {formatAmount(myPart, entry.localCurrency)}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setAmounts(evenSplit(entry.localAmount, [...checked]))
                }
                disabled={checked.size === 0}
              >
                Split evenly
              </Button>
            </div>
          )}
          {error && <p className="text-sm text-red">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-stroke dark:border-dark-3 flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSave()}
            disabled={isSaving || eligible.length === 0}
          >
            {isSaving ? "Saving..." : "Save shares"}
          </Button>
        </div>
      </div>
    </div>
  );
}
