"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import type {
  TripBalances,
  TripPeopleEntry,
} from "@/app/actions/tripSharing";
import {
  getTripPeopleEntries,
  setTripSettlementAllocations,
} from "@/lib/tripSharingMutations";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { NumberInput } from "@/components/ui/NumberInput";
import { Select } from "@/components/ui/Select";

interface TripSettleModalProps {
  isOpen: boolean;
  onClose: () => void;
  tripId: string;
  baseCurrency: string;
  /** The person being paid back. Taken from the settlement when left out. */
  participantId?: string | null;
  /** Start with this settlement selected. */
  settlementEntryId?: string | null;
  onSaved: (balances: TripBalances) => void;
}

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

const titleOf = (entry: TripPeopleEntry) =>
  entry.label?.trim() || entry.description;

/** Chooses which IOUs, and how much of each, a settlement pays off. */
export function TripSettleModal({
  isOpen,
  onClose,
  tripId,
  baseCurrency,
  participantId,
  settlementEntryId,
  onSaved,
}: TripSettleModalProps) {
  const [entries, setEntries] = useState<TripPeopleEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedSettlementId, setSelectedSettlementId] = useState("");
  const [items, setItems] = useState<
    Record<string, { checked: boolean; amount: string }>
  >({});

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    setError("");
    setItems({});
    setSelectedSettlementId(settlementEntryId || "");
    getTripPeopleEntries(tripId)
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load IOUs.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, tripId, settlementEntryId]);

  const personId = useMemo(() => {
    if (participantId) return participantId;
    const settlement = entries.find((entry) => entry.id === settlementEntryId);
    return settlement?.counterparty?.id || "";
  }, [entries, participantId, settlementEntryId]);

  const personName =
    entries.find((entry) => entry.counterparty?.id === personId)?.counterparty
      ?.name || "them";

  const settlements = useMemo(
    () =>
      entries.filter(
        (entry) =>
          entry.type === "settlement" && entry.counterparty?.id === personId,
      ),
    [entries, personId],
  );
  const ious = useMemo(
    () =>
      entries
        .filter((entry) => entry.isIou && entry.counterparty?.id === personId)
        .sort((a, b) => String(a.date).localeCompare(String(b.date))),
    [entries, personId],
  );

  useEffect(() => {
    if (!selectedSettlementId && settlements.length > 0) {
      setSelectedSettlementId(settlements[0].id);
    }
  }, [selectedSettlementId, settlements]);

  if (!isOpen) return null;

  const selectedSettlement = settlements.find(
    (entry) => entry.id === selectedSettlementId,
  );
  const chosen = ious
    .map((iou) => ({ iou, item: items[iou.id] }))
    .filter(({ item }) => item?.checked);

  const handleSave = async () => {
    if (!selectedSettlement) return;
    const payload = chosen.map(({ iou, item }) => ({
      iouEntryId: iou.id,
      localAmount: Number(item.amount),
    }));
    if (payload.length === 0) {
      setError("Pick at least one IOU this payment covers.");
      return;
    }
    if (payload.some((row) => !(row.localAmount > 0))) {
      setError("Each amount must be greater than 0.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      const balances = await setTripSettlementAllocations(
        tripId,
        selectedSettlement.id,
        payload,
      );
      onSaved(balances);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
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
        className="w-full max-w-2xl bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 shadow-card-2 max-h-[85vh] overflow-hidden flex flex-col"
      >
        <div className="px-6 py-4 border-b border-stroke dark:border-dark-3">
          <h3 className="text-lg font-semibold text-dark dark:text-white">
            Settle with {personName}
          </h3>
          <p className="text-sm text-dark-5 dark:text-dark-6">
            A settlement clears everything you owe {personName} by default.
            Pick what this payment covers instead.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-4">
          {isLoading && (
            <div className="py-6 flex items-center justify-center text-sm text-dark-5 dark:text-dark-6">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Loading...
            </div>
          )}

          {!isLoading && settlements.length === 0 && (
            <div className="rounded-lg border border-dashed border-stroke dark:border-dark-3 px-3 py-4 text-sm text-dark-5 dark:text-dark-6">
              No settlements with {personName} yet. Add a &quot;Settle up&quot;
              entry from a wallet, or add the bank payment as a Settlement, then
              come back here.
            </div>
          )}

          {!isLoading && settlements.length > 0 && (
            <>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                  Settlement
                </label>
                <Select
                  value={selectedSettlementId}
                  onChange={setSelectedSettlementId}
                  options={settlements.map((entry) => ({
                    value: entry.id,
                    label: `${format(new Date(entry.date), "dd MMM yyyy")} · ${titleOf(entry)} · ${formatAmount(entry.localAmount, entry.localCurrency)}`,
                  }))}
                  className="w-full"
                  buttonClassName="w-full"
                />
                {selectedSettlement &&
                  selectedSettlement.localCurrency.toUpperCase() !==
                    baseCurrency.toUpperCase() && (
                    <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                      ≈ {formatAmount(selectedSettlement.baseAmount, baseCurrency)}
                    </p>
                  )}
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                  What it pays off
                </div>
                {ious.length === 0 && (
                  <div className="rounded-lg border border-dashed border-stroke dark:border-dark-3 px-3 py-4 text-sm text-dark-5 dark:text-dark-6">
                    You have no IOUs with {personName}.
                  </div>
                )}
                {ious.map((iou) => {
                  const item = items[iou.id];
                  const stillOwed = Math.max(
                    Number(iou.localAmount) - Number((iou as { iouSettledLocal?: number | null }).iouSettledLocal || 0),
                    0,
                  );
                  return (
                    <div
                      key={iou.id}
                      className="flex items-center gap-3 rounded-lg border border-stroke dark:border-dark-3 px-3 py-2.5"
                    >
                      <Checkbox
                        checked={!!item?.checked}
                        onChange={(checked) =>
                          setItems((prev) => ({
                            ...prev,
                            [iou.id]: {
                              checked,
                              amount: prev[iou.id]?.amount || String(Number(stillOwed.toFixed(4))),
                            },
                          }))
                        }
                        aria-label={`Pay off ${titleOf(iou)}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-dark dark:text-white">
                          {titleOf(iou)}
                        </div>
                        <div className="text-xs text-dark-5 dark:text-dark-6">
                          {format(new Date(iou.date), "dd MMM yyyy")} · Still owed{" "}
                          {formatAmount(stillOwed, iou.localCurrency)} of{" "}
                          {formatAmount(iou.localAmount, iou.localCurrency)}
                        </div>
                      </div>
                      <div className="w-36 shrink-0">
                        <NumberInput
                          size="sm"
                          value={item?.amount ?? ""}
                          onChange={(event) =>
                            setItems((prev) => ({
                              ...prev,
                              [iou.id]: { checked: true, amount: event.target.value },
                            }))
                          }
                          disabled={!item?.checked}
                          placeholder={iou.localCurrency}
                          rightIcon={
                            <span className="text-[10px]">{iou.localCurrency}</span>
                          }
                        />
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-dark-5 dark:text-dark-6">
                  Amounts are in each IOU&apos;s own currency. You can&apos;t pay
                  off more than is still owed.
                </p>
              </div>
            </>
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
            disabled={isSaving || isLoading || !selectedSettlement}
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
