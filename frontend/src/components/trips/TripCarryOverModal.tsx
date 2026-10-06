"use client";

import { useEffect, useMemo, useState } from "react";
import { getTrips, type Trip } from "@/app/actions/trips";
import type {
  CarryOverCandidate,
  CarryOverCandidatesResponse,
  TripWallet,
} from "@/app/actions/tripWallets";
import {
  carryOverWallets,
  getCarryOverCandidates,
} from "@/lib/tripWalletMutations";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { DatePicker } from "@/components/ui/DatePicker";
import { NumberInput } from "@/components/ui/NumberInput";
import { Select } from "@/components/ui/Select";

const labelClass =
  "mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6";

/** "¥12,340" or "SGD 113.20"; falls back to "12,340.00 XYZ" for unknown codes. */
export function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;
  }
}

/** One line per leftover wallet: "Revolut JPY ¥12,340 ≈ SGD 113.20". */
export function describeCarryOverCandidate(
  candidate: CarryOverCandidate,
  baseCurrency: string,
) {
  const balance = formatMoney(candidate.balance, candidate.currency);
  const base =
    candidate.baseValue !== null
      ? ` ≈ ${formatMoney(candidate.baseValue, baseCurrency)}`
      : "";
  return `${candidate.name} ${balance}${base}`;
}

interface RowState {
  checked: boolean;
  amount: string;
  fxRate: string;
}

interface TripCarryOverModalProps {
  isOpen: boolean;
  onClose: () => void;
  trip: Trip;
  wallets: TripWallet[];
  initialSourceTripId?: string | null;
  onDone: (createdCount: number) => Promise<void> | void;
}

export function TripCarryOverModal({
  isOpen,
  onClose,
  trip,
  wallets,
  initialSourceTripId,
  onDone,
}: TripCarryOverModalProps) {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [sourceTripId, setSourceTripId] = useState(initialSourceTripId || "");
  const [result, setResult] = useState<CarryOverCandidatesResponse | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [date, setDate] = useState(String(trip.startDate || "").slice(0, 10));
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialSourceTripId) setSourceTripId(initialSourceTripId);
  }, [initialSourceTripId]);

  useEffect(() => {
    if (!isOpen || trips) return;
    getTrips()
      .then(setTrips)
      .catch(() => setTrips([]));
  }, [isOpen, trips]);

  useEffect(() => {
    if (!isOpen || !sourceTripId) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    getCarryOverCandidates(trip.id, sourceTripId)
      .then((next) => {
        if (cancelled) return;
        setResult(next);
        setRows(
          Object.fromEntries(
            next.candidates.map((candidate) => [
              candidate.sourceWalletId,
              { checked: true, amount: String(candidate.balance), fxRate: "" },
            ]),
          ),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setResult(null);
        setError(err instanceof Error ? err.message : "Could not load balances.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, sourceTripId, trip.id]);

  const sourceOptions = useMemo(
    () =>
      (trips || [])
        .filter((item) => item.id !== trip.id)
        .map((item) => ({
          value: item.id,
          label: `${item.name} (${item.baseCurrency})`,
        })),
    [trips, trip.id],
  );
  const sourceTrip = trips?.find((item) => item.id === sourceTripId) || null;

  const candidates = result?.candidates || [];
  const blocked = result ? !result.sameBaseCurrency : false;

  const rowErrors = useMemo(() => {
    const errors: Record<string, string | null> = {};
    for (const candidate of candidates) {
      const row = rows[candidate.sourceWalletId];
      if (!row?.checked) continue;
      const amount = Number(row.amount);
      if (!(amount > 0)) errors[candidate.sourceWalletId] = "Enter an amount.";
      else if (amount - candidate.balance > 0.0001)
        errors[candidate.sourceWalletId] = `At most ${formatMoney(candidate.balance, candidate.currency)}.`;
      else if (candidate.fxRate === null && !(Number(row.fxRate) > 0))
        errors[candidate.sourceWalletId] = "Enter a rate.";
    }
    return errors;
  }, [candidates, rows]);

  const selected = candidates.filter((candidate) => rows[candidate.sourceWalletId]?.checked);
  const canSubmit =
    !blocked &&
    selected.length > 0 &&
    selected.every((candidate) => !rowErrors[candidate.sourceWalletId]);

  const updateRow = (id: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSaving(true);
    setError(null);
    try {
      const { created } = await carryOverWallets(trip.id, {
        sourceTripId,
        date: date || null,
        items: selected.map((candidate) => {
          const row = rows[candidate.sourceWalletId];
          return {
            sourceWalletId: candidate.sourceWalletId,
            amount: Number(row.amount),
            destinationWalletId: candidate.destinationWalletId,
            fxRate: candidate.fxRate === null ? Number(row.fxRate) : null,
          };
        }),
      });
      setSourceTripId("");
      setResult(null);
      await onDone(created.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not carry the money over.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 p-4 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-3xl bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 shadow-card-2 max-h-[88vh] overflow-hidden flex flex-col"
      >
        <div className="border-b border-stroke px-6 py-4 dark:border-dark-3">
          <h3 className="text-lg font-semibold text-dark dark:text-white">
            Carry over from a previous trip
          </h3>
          <p className="text-sm text-dark-5 dark:text-dark-6">
            Leftover money moves here at the rate you paid for it, so it keeps its
            original cost.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px]">
            <div>
              <label className={labelClass}>From trip</label>
              <Select
                value={sourceTripId}
                onChange={setSourceTripId}
                options={sourceOptions}
                placeholder={
                  trips === null
                    ? "Loading trips…"
                    : sourceOptions.length
                      ? "Pick a trip"
                      : "No other trips"
                }
                disabled={!sourceOptions.length}
                className="w-full"
                buttonClassName="w-full"
                menuStrategy="fixed"
              />
            </div>
            <div>
              <label className={labelClass}>Date</label>
              <DatePicker
                value={date}
                onChange={setDate}
                triggerProps={{
                  className:
                    "rounded-lg border border-stroke dark:border-dark-3 bg-white dark:bg-dark-2 hover:border-primary dark:hover:border-primary",
                }}
              />
            </div>
          </div>

          {isLoading && (
            <p className="text-sm text-dark-5 dark:text-dark-6">Loading balances…</p>
          )}

          {!isLoading && blocked && (
            <div className="rounded-lg border border-orange-light-2 bg-orange-light-4 px-3 py-2 text-sm text-dark dark:border-orange-dark-1 dark:bg-orange-dark-3/20 dark:text-white">
              {sourceTrip?.name || "That trip"} uses {sourceTrip?.baseCurrency || "another"}{" "}
              as its base currency and this trip uses {trip.baseCurrency}. Money can only
              be carried over between trips with the same base currency.
            </div>
          )}

          {!isLoading && result && !blocked && candidates.length === 0 && (
            <div className="rounded-lg border border-dashed border-stroke px-3 py-4 text-sm text-dark-5 dark:border-dark-3 dark:text-dark-6">
              No wallets in {sourceTrip?.name || "that trip"} have money left.
            </div>
          )}

          {!isLoading && !blocked && candidates.length > 0 && (
            <div className="space-y-2">
              {candidates.map((candidate) => {
                const row = rows[candidate.sourceWalletId] || {
                  checked: false,
                  amount: "",
                  fxRate: "",
                };
                const destination = wallets.find(
                  (wallet) => wallet.id === candidate.destinationWalletId,
                );
                const rate = candidate.fxRate ?? (Number(row.fxRate) || null);
                const amount = Number(row.amount) || 0;
                const rowError = rowErrors[candidate.sourceWalletId];
                return (
                  <div
                    key={candidate.sourceWalletId}
                    className="rounded-lg border border-stroke px-3 py-2.5 dark:border-dark-3"
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        className="mt-1"
                        checked={row.checked}
                        onChange={(checked) =>
                          updateRow(candidate.sourceWalletId, { checked })
                        }
                        aria-label={`Carry over ${candidate.name}`}
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <div className="text-sm font-medium text-dark dark:text-white">
                            {describeCarryOverCandidate(candidate, trip.baseCurrency)}
                          </div>
                          <div className="text-xs text-dark-5 dark:text-dark-6">
                            {candidate.fxRate === null
                              ? "No funding to value it, so enter a rate"
                              : candidate.currency.toUpperCase() ===
                                  trip.baseCurrency.toUpperCase()
                                ? "Base currency"
                                : `1 ${candidate.currency} = ${candidate.fxRate.toFixed(6)} ${trip.baseCurrency}`}
                          </div>
                        </div>
                        <div className="text-xs text-dark-5 dark:text-dark-6">
                          {destination
                            ? `Goes into ${destination.name}`
                            : `Creates a new ${candidate.currency} wallet, ${candidate.name}`}
                        </div>
                        {row.checked && (
                          <div className="grid gap-2 md:grid-cols-[180px_180px_1fr] md:items-center">
                            <NumberInput
                              size="sm"
                              value={row.amount}
                              onChange={(e) =>
                                updateRow(candidate.sourceWalletId, {
                                  amount: e.target.value,
                                })
                              }
                              placeholder={`Amount (${candidate.currency})`}
                            />
                            {candidate.fxRate === null ? (
                              <NumberInput
                                size="sm"
                                value={row.fxRate}
                                onChange={(e) =>
                                  updateRow(candidate.sourceWalletId, {
                                    fxRate: e.target.value,
                                  })
                                }
                                placeholder={`${trip.baseCurrency} per ${candidate.currency}`}
                              />
                            ) : (
                              <div />
                            )}
                            <div className="text-xs">
                              {rowError ? (
                                <span className="text-red dark:text-red-light">{rowError}</span>
                              ) : rate ? (
                                <span className="text-dark-5 dark:text-dark-6">
                                  ≈ {formatMoney(amount * rate, trip.baseCurrency)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {error && (
            <p className="text-sm text-red dark:text-red-light">{error}</p>
          )}
        </div>

        <div className="border-t border-stroke px-6 py-4 flex items-center justify-end gap-2 dark:border-dark-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={isSaving || !canSubmit}
          >
            {isSaving
              ? "Carrying over..."
              : selected.length > 1
                ? `Carry over ${selected.length} wallets`
                : "Carry over"}
          </Button>
        </div>
      </div>
    </div>
  );
}
