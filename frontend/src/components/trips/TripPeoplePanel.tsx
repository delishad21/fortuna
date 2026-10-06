"use client";

import { useState } from "react";
import { Check, HandCoins, Pencil, Trash2, UserPlus, Users, X } from "lucide-react";
import type { TripBalances, TripPersonBalance } from "@/app/actions/tripSharing";
import {
  createTripParticipant,
  deleteTripParticipant,
  getTripBalances,
  renameTripParticipant,
} from "@/lib/tripSharingMutations";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { TextInput } from "@/components/ui/TextInput";
import { TripSettleModal } from "@/components/trips/TripSettleModal";

interface TripPeoplePanelProps {
  tripId: string;
  baseCurrency: string;
  initialBalances: TripBalances | null;
  /** Viewers of a shared trip can't change anything. */
  readOnly?: boolean;
  className?: string;
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

const iconButtonClass =
  "rounded-md border border-stroke p-1 text-dark-5 transition-colors hover:bg-gray-2 hover:text-dark dark:border-dark-3 dark:text-dark-6 dark:hover:bg-dark-3 dark:hover:text-white";

/** People on the trip: what you owe each of them, and settling up. */
export function TripPeoplePanel({
  tripId,
  baseCurrency,
  initialBalances,
  readOnly = false,
  className = "",
}: TripPeoplePanelProps) {
  const [people, setPeople] = useState<TripPersonBalance[]>(
    initialBalances?.people || [],
  );
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [removing, setRemoving] = useState<TripPersonBalance | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = async () => {
    const balances = await getTripBalances(tripId);
    setPeople(balances.people);
  };

  const run = async (action: () => Promise<unknown>) => {
    setIsBusy(true);
    setError("");
    try {
      await action();
      await reload();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    if (await run(() => createTripParticipant(tripId, name))) setNewName("");
  };

  const handleRename = async (participantId: string) => {
    const name = renameValue.trim();
    if (!name) return;
    if (await run(() => renameTripParticipant(tripId, participantId, name))) {
      setRenamingId(null);
    }
  };

  const handleRemove = async (person: TripPersonBalance) => {
    await run(() => deleteTripParticipant(tripId, person.participantId));
  };

  return (
    <Card
      className={`flex flex-col rounded-xl border border-stroke dark:border-dark-3 ${className}`}
    >
      <CardHeader className="mb-3 flex items-center justify-between gap-3 pb-0">
        <CardTitle className="inline-flex items-center gap-2 text-sm font-semibold text-dark dark:text-white">
          <Users className="h-4 w-4 shrink-0 text-primary" />
          People
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {people.length === 0 && (
          <div className="rounded-lg border border-dashed border-stroke px-3 py-4 text-sm text-dark-5 dark:border-dark-3 dark:text-dark-6">
            Add people who paid for something on this trip, so you can track
            what you owe them.
          </div>
        )}

        {people.map((person) => {
          const open = person.currencies.filter((row) => row.open > 0.005);
          const owedAnything = person.currencies.some((row) => row.owed > 0);
          const isRenaming = renamingId === person.participantId;
          return (
            <div
              key={person.participantId}
              className="rounded-lg border border-stroke/90 bg-gray-1/40 px-3 py-2.5 dark:border-dark-3 dark:bg-dark-2/60"
            >
              <div className="flex items-center justify-between gap-2">
                {isRenaming ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <TextInput
                      size="sm"
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void handleRename(person.participantId);
                        if (event.key === "Escape") setRenamingId(null);
                      }}
                      autoFocus
                      className="flex-1"
                    />
                    <button
                      type="button"
                      className={iconButtonClass}
                      onClick={() => void handleRename(person.participantId)}
                      disabled={isBusy}
                      aria-label="Save name"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className={iconButtonClass}
                      onClick={() => setRenamingId(null)}
                      aria-label="Cancel rename"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <span className="truncate text-sm font-semibold text-dark dark:text-white">
                    {person.name}
                  </span>
                )}
                {!readOnly && !isRenaming && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<HandCoins className="h-3.5 w-3.5" />}
                      onClick={() => setSettlingId(person.participantId)}
                      className="h-7"
                    >
                      Settle...
                    </Button>
                    <button
                      type="button"
                      className={iconButtonClass}
                      onClick={() => {
                        setRenamingId(person.participantId);
                        setRenameValue(person.name);
                      }}
                      aria-label={`Rename ${person.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-stroke p-1 text-red transition-colors hover:bg-red/10 dark:border-dark-3"
                      onClick={() => setRemoving(person)}
                      aria-label={`Remove ${person.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-1 space-y-0.5 text-xs">
                {open.map((row) => (
                  <div key={row.currency} className="text-red dark:text-red-light">
                    You owe {person.name} {formatAmount(row.open, row.currency)}
                    {row.currency.toUpperCase() !== baseCurrency.toUpperCase() &&
                      open.length === 1 &&
                      ` ≈ ${formatAmount(person.openBase, baseCurrency)}`}
                  </div>
                ))}
                {open.length > 1 && (
                  <div className="text-dark-5 dark:text-dark-6">
                    ≈ {formatAmount(person.openBase, baseCurrency)} in total
                  </div>
                )}
                {open.length === 0 && (
                  <div className="text-dark-5 dark:text-dark-6">
                    {owedAnything ? "Settled up" : "Nothing owed"}
                  </div>
                )}
                {person.paidBase > 0 && (
                  <div className="text-dark-5 dark:text-dark-6">
                    Paid back {formatAmount(person.paidBase, baseCurrency)}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {!readOnly && (
          <div className="flex items-center gap-2 pt-1">
            <TextInput
              size="sm"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleAdd();
              }}
              placeholder="Name"
              className="flex-1"
            />
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<UserPlus className="h-3.5 w-3.5" />}
              onClick={() => void handleAdd()}
              disabled={isBusy || !newName.trim()}
            >
              Add person
            </Button>
          </div>
        )}

        {error && <p className="text-xs text-red">{error}</p>}
      </CardContent>

      <Modal
        isOpen={!!removing}
        onClose={() => setRemoving(null)}
        type="warning"
        title={`Remove ${removing?.name ?? "this person"}?`}
        message="People with IOUs or settlements can't be removed. Delete those entries first."
        confirmText="Remove"
        cancelText="Cancel"
        onConfirm={() => {
          if (removing) void handleRemove(removing);
        }}
      />

      <TripSettleModal
        isOpen={!!settlingId}
        onClose={() => setSettlingId(null)}
        tripId={tripId}
        baseCurrency={baseCurrency}
        participantId={settlingId}
        onSaved={(balances) => setPeople(balances.people)}
      />
    </Card>
  );
}
