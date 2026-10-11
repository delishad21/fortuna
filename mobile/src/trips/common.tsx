import React, { useState } from "react";
import { Image, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useApi, useResource } from "../api";
import {
  Banner,
  Button,
  Choice,
  fmtDate,
  Input,
  notice,
  Pill,
  Section,
  Segmented,
  Sheet,
  styles,
  toast,
  Txt,
} from "../ui";

export type Role = "owner" | "editor" | "viewer";
export const roleOf = (trip: any): Role => trip?.sharing?.role || "owner";
export const isViewer = (trip: any) => roleOf(trip) === "viewer";
export const ENTRY_TYPES: Record<string, string> = {
  spending: "Spending",
  reimbursement: "Reimbursement",
  funding_out: "Funding out",
  funding_in: "Funding in",
  settlement: "Settle up",
};
export const SPECIAL_CATEGORIES: Record<string, string> = {
  __funding_in__: "Funding in",
  __funding_out__: "Funding out",
  __reimbursement__: "Reimbursement",
};
export const TRIP_STATUSES = ["active", "completed", "archived"];
export const tripDates = (trip: any) =>
  `${fmtDate(trip.startDate, !trip.endDate)}${trip.endDate ? ` – ${fmtDate(trip.endDate)}` : " · Ongoing"}`;
export const NO_WALLET = "__none__";
export const num = (v: any) => (v === "" || v == null ? null : Number(v));
export const positiveOrNull = (v: any) => {
  const n = Number(v);
  return n > 0 ? n : null;
};
const DEFAULT_COVER = require("../../assets/trip-cover.jpg");
export function TripCover({
  trip,
  height = 170,
  children,
}: {
  trip: any;
  height?: number;
  children?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={{ height, borderRadius: 8, overflow: "hidden" }}>
      <Image
        source={trip.coverImageUrl && !failed ? { uri: trip.coverImageUrl } : DEFAULT_COVER}
        onError={() => setFailed(true)}
        style={{ position: "absolute", width: "100%", height: "100%" }}
        resizeMode="cover"
      />
      <LinearGradient
        colors={["rgba(4,10,20,0)", "rgba(4,10,20,0.78)"]}
        style={{ flex: 1, justifyContent: "flex-end", padding: 18, gap: 6 }}
      >
        {children}
      </LinearGradient>
    </View>
  );
}
export function RolePill({ trip }: { trip: any }) {
  if (!trip?.sharing) return null;
  const role = roleOf(trip);
  return (
    <Pill
      icon="people-outline"
      tone={role === "viewer" ? "amber" : "purple"}
      label={`${role === "owner" ? "Shared" : role === "editor" ? "Editor" : "View only"} · ${trip.sharing.memberCount}`}
    />
  );
}
export function ViewerBanner({ trip }: { trip: any }) {
  if (!isViewer(trip)) return null;
  return (
    <Banner
      tone="amber"
      icon="eye-outline"
      message="You can view this shared trip but not change it."
    />
  );
}
export type FundingOutForm = {
  destinationType: "bank" | "trip" | "wallet" | "external";
  destinationTripId: string;
  destinationWalletId: string;
  destinationCurrency: string;
  destinationAmount: string;
  fxRate: string;
  feeAmount: string;
  feeCurrency: string;
  inputMode: "amount" | "fxRate";
};
export const emptyFundingOut = (baseCurrency: string): FundingOutForm => ({
  destinationType: "bank",
  destinationTripId: "",
  destinationWalletId: "",
  destinationCurrency: baseCurrency,
  destinationAmount: "",
  fxRate: "",
  feeAmount: "",
  feeCurrency: "",
  inputMode: "amount",
});
export const fundingOutFromMetadata = (raw: any, baseCurrency: string): FundingOutForm => ({
  ...emptyFundingOut(baseCurrency),
  destinationType: raw?.destinationType || "bank",
  destinationTripId: raw?.destinationTripId || "",
  destinationWalletId: raw?.destinationWalletId || "",
  destinationCurrency: raw?.destinationCurrency || baseCurrency,
  destinationAmount: raw?.destinationAmount != null ? String(raw.destinationAmount) : "",
  fxRate: raw?.fxRate != null && raw?.destinationAmount == null ? String(raw.fxRate) : "",
  feeAmount: raw?.feeAmount != null ? String(raw.feeAmount) : "",
  feeCurrency: raw?.feeCurrency || "",
  inputMode: raw?.destinationAmount == null && raw?.fxRate ? "fxRate" : "amount",
});
/** The fundingOut payload the trip actions take, as the web builds it. */
export const buildFundingOut = (f: FundingOutForm, baseCurrency: string) => ({
  destinationType: f.destinationType,
  destinationTripId: f.destinationType === "trip" ? f.destinationTripId || null : null,
  destinationWalletId:
    f.destinationType === "wallet" || f.destinationType === "trip"
      ? f.destinationWalletId || null
      : null,
  destinationCurrency: f.destinationCurrency || null,
  destinationAmount: f.inputMode === "amount" ? positiveOrNull(f.destinationAmount) : null,
  fxRate: f.inputMode === "fxRate" ? positiveOrNull(f.fxRate) : null,
  feeAmount: positiveOrNull(f.feeAmount),
  feeCurrency: f.feeCurrency || baseCurrency,
});
export const validateFundingOut = (f: FundingOutForm, sourceWalletId?: string) => {
  if (f.destinationType === "wallet") {
    if (!f.destinationWalletId) return "Choose the destination wallet";
    if (f.destinationWalletId === sourceWalletId) return "Choose a different destination wallet";
  }
  if (f.destinationType === "trip" && !f.destinationTripId) return "Choose the destination trip";
  if (f.feeAmount && Number(f.feeAmount) < 0) return "The fee cannot be negative";
  return null;
};
/** Where money leaving a wallet goes: the bank, another trip, another wallet or outside. */
export function FundingOutFields({
  value,
  onChange,
  tripId,
  baseCurrency,
  sourceWalletId,
  wallets,
  allowWallet = true,
}: {
  value: FundingOutForm;
  onChange: (v: FundingOutForm) => void;
  tripId: string;
  baseCurrency: string;
  sourceWalletId?: string;
  wallets: any[];
  allowWallet?: boolean;
}) {
  const trips = useResource("getTrips");
  const destWallets = useResource("getWallets", value.destinationTripId || tripId);
  const set = (patch: Partial<FundingOutForm>) => onChange({ ...value, ...patch });
  const lockedCurrency =
    value.destinationType === "bank"
      ? baseCurrency
      : value.destinationType === "wallet"
        ? wallets.find((w) => w.id === value.destinationWalletId)?.currency
        : value.destinationType === "trip" && value.destinationWalletId
          ? (destWallets.data || []).find((w: any) => w.id === value.destinationWalletId)?.currency
          : null;
  return (
    <Section title="Where does it go?">
      <Choice
        label="Destination"
        value={value.destinationType}
        options={[
          { label: "Back to bank", value: "bank", hint: `Lands in ${baseCurrency}` },
          { label: "Another trip", value: "trip" },
          ...(allowWallet ? [{ label: "Another wallet in this trip", value: "wallet" }] : []),
          { label: "External", value: "external", hint: "Spent or sent outside your trips" },
        ]}
        onChange={(destinationType) =>
          set({
            destinationType,
            destinationTripId: "",
            destinationWalletId: "",
            destinationCurrency: destinationType === "bank" ? baseCurrency : value.destinationCurrency,
          })
        }
      />
      {value.destinationType === "wallet" && (
        <Choice
          label="Destination wallet"
          value={value.destinationWalletId}
          options={wallets
            .filter((w) => w.id !== sourceWalletId)
            .map((w) => ({ label: `${w.name} · ${w.currency}`, value: w.id, color: w.color }))}
          onChange={(id) =>
            set({
              destinationWalletId: id,
              destinationCurrency: wallets.find((w) => w.id === id)?.currency || value.destinationCurrency,
            })
          }
        />
      )}
      {value.destinationType === "trip" && (
        <>
          <Choice
            label="Destination trip"
            value={value.destinationTripId}
            options={(trips.data || [])
              .filter((t: any) => t.id !== tripId)
              .map((t: any) => ({ label: t.name, value: t.id, hint: t.baseCurrency }))}
            onChange={(destinationTripId) => set({ destinationTripId, destinationWalletId: "" })}
          />
          {!!value.destinationTripId && (
            <Choice
              label="Receiving wallet"
              value={value.destinationWalletId}
              options={[
                { label: "Any wallet in that currency", value: "" },
                ...(destWallets.data || []).map((w: any) => ({
                  label: `${w.name} · ${w.currency}`,
                  value: w.id,
                  color: w.color,
                })),
              ]}
              onChange={(id) =>
                set({
                  destinationWalletId: id,
                  destinationCurrency:
                    (destWallets.data || []).find((w: any) => w.id === id)?.currency ||
                    value.destinationCurrency,
                })
              }
            />
          )}
        </>
      )}
      <Input
        label="Destination currency"
        value={lockedCurrency || value.destinationCurrency}
        editable={!lockedCurrency}
        autoCapitalize="characters"
        maxLength={3}
        onChangeText={(v: string) => set({ destinationCurrency: v.toUpperCase() })}
      />
      <Segmented
        values={["amount", "fxRate"]}
        labels={{ amount: "Destination amount", fxRate: "Exchange rate" }}
        value={value.inputMode}
        onChange={(inputMode) => set({ inputMode: inputMode as any })}
      />
      {value.inputMode === "amount" ? (
        <Input
          label="Amount received"
          value={value.destinationAmount}
          keyboardType="decimal-pad"
          hint="Leave blank when it's the same currency and amount."
          onChangeText={(destinationAmount: string) => set({ destinationAmount })}
        />
      ) : (
        <Input
          label="Exchange rate (source per destination unit)"
          value={value.fxRate}
          keyboardType="decimal-pad"
          onChangeText={(fxRate: string) => set({ fxRate })}
        />
      )}
      <View style={[styles.row, { alignItems: "flex-start" }]}>
        <View style={{ flex: 1 }}>
          <Input
            label="Fee"
            value={value.feeAmount}
            keyboardType="decimal-pad"
            placeholder="0"
            onChangeText={(feeAmount: string) => set({ feeAmount })}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input
            label="Fee currency"
            value={value.feeCurrency}
            placeholder={baseCurrency}
            autoCapitalize="characters"
            maxLength={3}
            onChangeText={(v: string) => set({ feeCurrency: v.toUpperCase() })}
          />
        </View>
      </View>
    </Section>
  );
}
/** Pick a person on the trip (for IOUs and settlements), with an inline "add person". */
export function PersonPicker({
  tripId,
  label,
  value,
  onChange,
  meOption,
}: {
  tripId: string;
  label: string;
  value: string;
  onChange: (id: string) => void;
  meOption?: string;
}) {
  const { call } = useApi();
  const people = useResource("getTripParticipants", tripId);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  return (
    <View style={{ gap: 6 }}>
      <Choice
        label={label}
        value={value}
        options={[
          ...(meOption ? [{ label: meOption, value: "" }] : []),
          ...(people.data || []).map((p: any) => ({
            label: p.name,
            value: p.id,
            hint: p.userId ? "Fortuna member" : undefined,
          })),
        ]}
        onChange={onChange}
      />
      <Button title="Add a person" compact ghost icon="person-add-outline" onPress={() => setAdding(true)} />
      <Sheet
        visible={adding}
        onClose={() => setAdding(false)}
        title="Add a person"
        footer={
          <Button
            title="Add person"
            disabled={!name.trim()}
            onPress={async () => {
              try {
                const person = await call("createTripParticipant", tripId, name.trim());
                await people.reload();
                onChange(person.id);
                setName("");
                setAdding(false);
                toast(`${person.name} added`);
              } catch (e) {
                notice(e);
              }
            }}
          />
        }
      >
        <Input label="Name" value={name} onChangeText={setName} autoFocus placeholder="Who is it?" />
        <Txt muted size={13}>
          People track who paid for what. Add the Fortuna members of a shared trip from Members.
        </Txt>
      </Sheet>
    </View>
  );
}
