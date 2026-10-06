"use client";

import { useEffect, useState } from "react";
import { getWallets, type Trip, type Wallet } from "@/app/actions/trips";
import { Select } from "@/components/ui/Select";

export type FundingOutDestinationType = "bank" | "trip" | "wallet" | "external";

export interface FundingOutDestinationValue {
  destinationType: FundingOutDestinationType;
  destinationTripId: string;
  destinationWalletId: string;
  destinationCurrency: string;
}

interface TripFundingOutDestinationFieldsProps {
  value: FundingOutDestinationValue;
  onChange: (patch: Partial<FundingOutDestinationValue>) => void;
  /** Wallets of the current trip. */
  wallets: Wallet[];
  /** The wallet the money leaves; it can't also be the destination. */
  sourceWalletId?: string | null;
  availableTrips: Pick<Trip, "id" | "name">[];
  currencyOptions: { value: string; label: string }[];
  baseCurrency: string;
}

const labelClassName =
  "mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6";

export function TripFundingOutDestinationFields({
  value,
  onChange,
  wallets,
  sourceWalletId,
  availableTrips,
  currencyOptions,
  baseCurrency,
}: TripFundingOutDestinationFieldsProps) {
  const [destinationTripWallets, setDestinationTripWallets] = useState<Wallet[]>(
    [],
  );

  const destinationTripId =
    value.destinationType === "trip" ? value.destinationTripId : "";
  useEffect(() => {
    if (!destinationTripId) {
      setDestinationTripWallets([]);
      return;
    }
    let cancelled = false;
    getWallets(destinationTripId)
      .then((rows) => {
        if (!cancelled) setDestinationTripWallets(rows);
      })
      .catch(() => {
        if (!cancelled) setDestinationTripWallets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [destinationTripId]);

  const sameTripWallets = wallets.filter(
    (wallet) => wallet.id !== sourceWalletId,
  );
  const receivingWallet =
    value.destinationType === "wallet"
      ? wallets.find((wallet) => wallet.id === value.destinationWalletId)
      : value.destinationType === "trip"
        ? destinationTripWallets.find(
            (wallet) => wallet.id === value.destinationWalletId,
          )
        : undefined;
  // The receiving wallet decides the currency; bank funding returns in the base currency.
  const lockedCurrency =
    value.destinationType === "bank"
      ? baseCurrency
      : receivingWallet
        ? receivingWallet.currency.toUpperCase()
        : value.destinationType === "wallet"
          ? ""
          : null;

  const handleTypeChange = (next: FundingOutDestinationType) => {
    onChange({
      destinationType: next,
      destinationTripId: next === "trip" ? value.destinationTripId : "",
      destinationWalletId: "",
      destinationCurrency:
        next === "bank" ? baseCurrency : value.destinationCurrency,
    });
  };

  const handleWalletChange = (walletId: string, pool: Wallet[]) => {
    const wallet = pool.find((item) => item.id === walletId);
    onChange({
      destinationWalletId: walletId,
      ...(wallet ? { destinationCurrency: wallet.currency.toUpperCase() } : {}),
    });
  };

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div>
        <label className={labelClassName}>Destination</label>
        <Select
          value={value.destinationType}
          onChange={(next) => handleTypeChange(next as FundingOutDestinationType)}
          className="w-full"
          buttonClassName="w-full"
          menuPlacement="up"
          options={[
            { value: "bank", label: "Back to Bank" },
            { value: "trip", label: "Another Trip" },
            { value: "wallet", label: "Another wallet in this trip" },
            { value: "external", label: "External" },
          ]}
        />
      </div>

      {value.destinationType === "wallet" ? (
        <div>
          <label className={labelClassName}>Destination wallet</label>
          <Select
            value={value.destinationWalletId}
            onChange={(walletId) => handleWalletChange(walletId, wallets)}
            className="w-full"
            buttonClassName="w-full"
            menuPlacement="up"
            options={[
              { value: "", label: "Select wallet" },
              ...sameTripWallets.map((wallet) => ({
                value: wallet.id,
                label: `${wallet.name} (${wallet.currency})`,
              })),
            ]}
          />
        </div>
      ) : (
        <div>
          <label className={labelClassName}>Destination trip</label>
          <Select
            value={value.destinationTripId}
            onChange={(tripId) =>
              onChange({ destinationTripId: tripId, destinationWalletId: "" })
            }
            className="w-full"
            buttonClassName="w-full"
            menuPlacement="up"
            options={[
              ...(value.destinationType === "trip"
                ? [{ value: "", label: "Select trip" }]
                : [{ value: "", label: "Destination is not a trip" }]),
              ...(value.destinationType === "trip"
                ? availableTrips.map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))
                : []),
            ]}
          />
        </div>
      )}

      <div>
        <label className={labelClassName}>Destination currency</label>
        <Select
          value={lockedCurrency ?? value.destinationCurrency}
          onChange={(currency) =>
            lockedCurrency !== null
              ? undefined
              : onChange({ destinationCurrency: currency })
          }
          options={
            lockedCurrency !== null
              ? [{ value: lockedCurrency, label: lockedCurrency || "Set by wallet" }]
              : currencyOptions
          }
          className="w-full"
          buttonClassName={`w-full ${
            lockedCurrency !== null ? "pointer-events-none opacity-70" : ""
          }`}
          menuPlacement="up"
        />
      </div>

      {value.destinationType === "trip" && value.destinationTripId && (
        <div>
          <label className={labelClassName}>Receiving wallet</label>
          <Select
            value={value.destinationWalletId}
            onChange={(walletId) =>
              handleWalletChange(walletId, destinationTripWallets)
            }
            className="w-full"
            buttonClassName="w-full"
            menuPlacement="up"
            options={[
              { value: "", label: "Any wallet in that currency" },
              ...destinationTripWallets.map((wallet) => ({
                value: wallet.id,
                label: `${wallet.name} (${wallet.currency})`,
              })),
            ]}
          />
        </div>
      )}
    </div>
  );
}
