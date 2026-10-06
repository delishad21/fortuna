"use client";

import Link from "next/link";
import { ArrowRightLeft } from "lucide-react";
import type { Trip } from "@/app/actions/trips";
import type { CarryOverSource } from "@/app/actions/tripWallets";
import { Button } from "@/components/ui/Button";
import { describeCarryOverCandidate } from "@/components/trips/TripCarryOverModal";

interface TripCarryOverPromptProps {
  trip: Trip | null;
  sources: CarryOverSource[];
  onClose: () => void;
}

/** Shown after a trip is created when earlier trips still hold money. */
export function TripCarryOverPrompt({ trip, sources, onClose }: TripCarryOverPromptProps) {
  if (!trip || sources.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 p-4 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 shadow-card-2 max-h-[88vh] overflow-hidden flex flex-col"
      >
        <div className="border-b border-stroke px-6 py-4 dark:border-dark-3">
          <h3 className="text-lg font-semibold text-dark dark:text-white">
            Bring leftover money?
          </h3>
          <p className="text-sm text-dark-5 dark:text-dark-6">
            These trips still have money in their wallets. Carry it into {trip.name} and
            it keeps its original cost.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-2">
          {sources.map((source) => (
            <div
              key={source.trip.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-stroke px-3 py-2.5 dark:border-dark-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-dark dark:text-white">
                  {source.trip.name}
                </div>
                <ul className="mt-1 space-y-0.5 text-xs text-dark-5 dark:text-dark-6">
                  {source.candidates.map((candidate) => (
                    <li key={candidate.sourceWalletId}>
                      {describeCarryOverCandidate(candidate, trip.baseCurrency)}
                    </li>
                  ))}
                </ul>
              </div>
              <Link
                href={`/trips/${trip.id}/manage/wallets?carryFrom=${source.trip.id}`}
                className="shrink-0"
              >
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<ArrowRightLeft className="h-4 w-4" />}
                >
                  Carry over
                </Button>
              </Link>
            </div>
          ))}
        </div>
        <div className="border-t border-stroke px-6 py-4 flex justify-end dark:border-dark-3">
          <Button variant="secondary" onClick={onClose}>
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
}
