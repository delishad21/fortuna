import React, { useState } from "react";
import { Image, View } from "react-native";
import { useApi, useResource } from "./api";
import { Bars } from "./home";
import {
  Button,
  Card,
  Chips,
  Choice,
  confirm,
  Field,
  Form,
  Heading,
  Input,
  money,
  notice,
  Screen,
  State,
  styles,
  today,
  TransactionRow,
  Txt,
} from "./ui";
const options = (values: string[]) =>
  values.map((value) => ({ label: value.replaceAll("_", " "), value }));
export function TripsScreen({ navigation }: any) {
  const result = useResource("getTrips");
  return (
    <Screen>
      <Heading
        title="Away, with clarity"
        subtitle="Every journey. Every currency. One place."
      />
      <Button
        title="Plan a trip"
        icon="add"
        onPress={() => navigation.navigate("TripEditor", {})}
      />
      <State {...result} />
      {result.data?.length === 0 && (
        <State empty="Create a trip to organize wallets, spending and funding for your next journey." />
      )}
      {result.data?.map((trip: any) => (
        <Card key={trip.id} style={{ padding: 0, overflow: "hidden" }}>
          <Image
            source={
              trip.coverImageUrl
                ? { uri: trip.coverImageUrl }
                : require("../assets/trip-cover.jpg")
            }
            style={{ width: "100%", height: 160 }}
          />
          <View style={{ padding: 20, gap: 12 }}>
            <Txt bold size={23}>
              {trip.name}
            </Txt>
            <Txt muted>
              {trip.startDate.slice(0, 10)} · {trip.baseCurrency} ·{" "}
              {trip.status}
            </Txt>
            <Button
              title="Open trip"
              secondary
              onPress={() => navigation.navigate("Trip", { tripId: trip.id })}
            />
          </View>
        </Card>
      ))}
    </Screen>
  );
}
export function TripEditorScreen({ route, navigation }: any) {
  const { call } = useApi();
  const trip = route.params?.trip;
  return (
    <Screen>
      <Heading title={trip ? "Edit your trip" : "Where to next?"} />
      <Form
        initial={{
          name: trip?.name || "",
          startDate: trip?.startDate?.slice(0, 10) || today(),
          endDate: trip?.endDate?.slice(0, 10) || "",
          baseCurrency: trip?.baseCurrency || "SGD",
          notes: trip?.notes || "",
          coverImageUrl: trip?.coverImageUrl || "",
          status: trip?.status || "active",
        }}
        fields={[
          { key: "name", label: "Trip name", required: true },
          {
            key: "baseCurrency",
            label: "Base currency (ISO code)",
            required: true,
          },
          {
            key: "startDate",
            label: "Start date",
            type: "date",
            required: true,
          },
          { key: "endDate", label: "End date", type: "date" },
          { key: "notes", label: "Notes" },
          { key: "coverImageUrl", label: "Cover image URL" },
          ...(trip
            ? [
                {
                  key: "status",
                  label: "Status",
                  options: options(["active", "completed", "archived"]),
                },
              ]
            : []),
        ]}
        submit={trip ? "Save trip" : "Create trip"}
        onSave={async (v) => {
          if (!/^[A-Z]{3}$/.test(v.baseCurrency))
            throw new Error("Use a three-letter currency code, such as SGD");
          if (v.endDate && v.endDate < v.startDate)
            throw new Error("End date must follow start date");
          const input = {
            ...v,
            endDate: v.endDate || null,
            coverImageUrl: v.coverImageUrl || null,
          };
          if (trip) {
            await call("updateTrip", trip.id, input);
            navigation.goBack();
          } else {
            const created = await call("createTrip", input);
            navigation.replace("Trip", { tripId: created.id });
          }
        }}
      />
    </Screen>
  );
}
export function TripScreen({ route, navigation }: any) {
  const { tripId } = route.params;
  const [tab, setTab] = useState("Overview");
  const trip = useResource("getTrip", tripId);
  const analytics = useResource("getTripAnalytics", tripId);
  const wallets = useResource("getTripWalletSummaries", tripId);
  const fundings = useResource("getTripFundings", tripId);
  const { call } = useApi();
  const t = trip.data;
  const a = analytics.data;
  return (
    <Screen>
      <State {...trip} />
      {t && (
        <>
          <Heading
            title={t.name}
            subtitle={`${t.baseCurrency} · ${t.startDate.slice(0, 10)}${t.endDate ? ` — ${t.endDate.slice(0, 10)}` : ""}`}
          />
          <Chips
            values={["Overview", "Wallets", "Funding", "Details"]}
            value={tab}
            onChange={setTab}
          />
          <View style={styles.row}>
            <Button
              title="Transactions"
              secondary
              onPress={() =>
                navigation.navigate("TripEntries", { tripId, trip: t })
              }
            />
            <Button
              title="Add expense"
              icon="add"
              onPress={() =>
                navigation.navigate("TripEntry", { tripId, trip: t })
              }
            />
          </View>
          {tab === "Overview" && (
            <>
              <State {...analytics} />
              {a && (
                <>
                  <Card style={{ backgroundColor: "#5750F1" }}>
                    <Txt style={{ color: "#E6E2FF" }}>Net trip cost</Txt>
                    <Txt
                      style={[
                        styles.money,
                        { color: "#FFFFFF", fontSize: 34, lineHeight: 44 },
                      ]}
                    >
                      {money(a.totals.netTripCost, t.baseCurrency)}
                    </Txt>
                    <Txt style={{ color: "#FFFFFF" }}>
                      {money(a.totals.totalReimbursed, t.baseCurrency)}{" "}
                      reimbursed
                    </Txt>
                  </Card>
                  <Card>
                    <Txt bold size={18}>
                      The highlights
                    </Txt>
                    {Object.entries(a.highlights).map(([key, value]) => (
                      <View key={key} style={styles.between}>
                        <Txt>{key.charAt(0).toUpperCase() + key.slice(1)}</Txt>
                        <Txt>{money(value, t.baseCurrency)}</Txt>
                      </View>
                    ))}
                  </Card>
                  <Card>
                    <Txt bold size={18}>
                      By category
                    </Txt>
                    <Bars
                      rows={a.categoryBreakdown}
                      currency={t.baseCurrency}
                    />
                  </Card>
                  <Card>
                    <Txt bold size={18}>
                      Day by day
                    </Txt>
                    <Bars rows={a.dailySeries} currency={t.baseCurrency} />
                  </Card>
                </>
              )}
            </>
          )}
          {tab === "Wallets" && (
            <>
              <Button
                title="Add wallet"
                onPress={() =>
                  navigation.navigate("Wallet", { tripId, trip: t })
                }
              />
              <State {...wallets} />
              {wallets.data?.map((w: any) => (
                <Card key={w.id}>
                  <Txt bold size={20}>
                    {w.name}
                  </Txt>
                  {w.balances.map((b: any) => (
                    <Txt key={b.currency} style={styles.money}>
                      {money(b.amount, b.currency)}
                    </Txt>
                  ))}
                  <Txt muted>
                    {w.currency}
                    {w.intrinsicFxRate ? ` · FX ${w.intrinsicFxRate}` : ""}
                  </Txt>
                  <Button
                    title="Manage wallet & exchange rate"
                    secondary
                    onPress={() =>
                      navigation.navigate("Wallet", {
                        tripId,
                        trip: t,
                        wallet: w,
                      })
                    }
                  />
                  <Button
                    title="Import statement"
                    secondary
                    onPress={() =>
                      navigation.navigate("StatementImport", { tripId, walletId: w.id })
                    }
                  />
                </Card>
              ))}
            </>
          )}
          {tab === "Funding" && (
            <>
              <Button
                title="Add funding"
                icon="add"
                onPress={() =>
                  navigation.navigate("Funding", { tripId, trip: t })
                }
              />
              <Button
                title="From another trip"
                secondary
                onPress={() =>
                  navigation.navigate("BankPicker", {
                    tripId,
                    mode: "outgoing",
                  })
                }
              />
              <State {...fundings} />
              {fundings.data?.map((f: any) => (
                <Card key={f.id}>
                  <Txt bold>{f.wallet?.name || f.sourceType}</Txt>
                  <Txt>
                    {money(f.sourceAmount, f.sourceCurrency)} →{" "}
                    {money(f.destinationAmount, f.destinationCurrency)}
                  </Txt>
                  {f.suggestedBankTransaction && (
                    <Txt muted>
                      Suggested match: {f.suggestedBankTransaction.description}
                    </Txt>
                  )}
                  <Button
                    title="Review funding"
                    secondary
                    onPress={() =>
                      navigation.navigate("Funding", {
                        tripId,
                        trip: t,
                        funding: f,
                      })
                    }
                  />
                </Card>
              ))}
            </>
          )}
          {tab === "Details" && (
            <>
              <Card>
                <Txt>{t.notes || "No notes yet."}</Txt>
                <Txt muted>Status: {t.status}</Txt>
              </Card>
              <Button
                title="Edit trip"
                secondary
                onPress={() => navigation.navigate("TripEditor", { trip: t })}
              />
              <Button
                title="Add transactions from bank"
                secondary
                onPress={() =>
                  navigation.navigate("BankPicker", { tripId, mode: "entries" })
                }
              />
              <Button
                title="Delete trip"
                danger
                secondary
                onPress={() =>
                  confirm(
                    "Delete this trip?",
                    "This removes the trip and its associated wallets, entries and funding.",
                    async () => {
                      await call("deleteTrip", tripId);
                      navigation.goBack();
                    },
                  )
                }
              />
            </>
          )}
        </>
      )}
    </Screen>
  );
}
export function WalletScreen({ route, navigation }: any) {
  const { tripId, wallet, trip } = route.params;
  const { call } = useApi();
  const [result, setResult] = useState<any>(null);
  return (
    <Screen>
      <Heading
        title={wallet?.name || "A wallet for your journey"}
        subtitle={
          wallet
            ? "Recalculate spending in your base currency."
            : "Keep cash and cards organized by currency."
        }
      />
      {!wallet ? (
        <Form
          initial={{ currency: trip.baseCurrency, color: "#5750F1" }}
          fields={[
            { key: "name", label: "Wallet name", required: true },
            { key: "currency", label: "Currency (ISO code)", required: true },
            { key: "color", label: "Color (hex)" },
          ]}
          submit="Create wallet"
          onSave={async (v) => {
            await call("createWallet", tripId, v);
            navigation.goBack();
          }}
        />
      ) : (
        <>
          <Card>
            <Txt bold>{wallet.currency}</Txt>
            {wallet.balances?.map((b: any) => (
              <Txt key={b.currency}>{money(b.amount, b.currency)}</Txt>
            ))}
          </Card>
          <Form
            initial={{ mode: "weighted", fxRate: wallet.intrinsicFxRate || "" }}
            fields={[
              {
                key: "mode",
                label: "Exchange rate method",
                options: [
                  { label: "Weighted from funding", value: "weighted" },
                  { label: "Manual exchange rate", value: "manual" },
                ],
              },
              {
                key: "fxRate",
                label: `Rate to ${trip.baseCurrency}`,
                type: "number",
              },
            ]}
            submit="Recalculate entries"
            onSave={async (v) => {
              if (v.mode === "manual" && !(v.fxRate > 0))
                throw new Error("Enter a positive exchange rate");
              setResult(
                await call(
                  "recalculateWalletEntriesToBase",
                  tripId,
                  wallet.id,
                  {
                    mode: v.mode,
                    fxRate: v.mode === "manual" ? v.fxRate : null,
                  },
                ),
              );
            }}
          />
          {result && (
            <Card>
              <Txt bold>Recalculation complete</Txt>
              <Txt>
                {result.updatedCount} entries updated at {result.fxRate}.
              </Txt>
              <Propagation trace={result.propagationTrace} />
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
export function Propagation({ trace }: any) {
  if (!trace) return null;
  const traces = Array.isArray(trace) ? trace : [trace];
  return (
    <View style={{ gap: 8 }}>
      {traces.map((t: any, i: number) => (
        <View key={i}>
          <Txt muted>
            {t.totalWalletRecalculations} wallets recalculated ·{" "}
            {t.totalFundingRowsUpdated} linked funding rows updated
          </Txt>
          {t.truncated && <Txt muted>Propagation trace was truncated.</Txt>}
        </View>
      ))}
    </View>
  );
}
export function FundingScreen({ route, navigation }: any) {
  const { tripId, trip, funding } = route.params;
  const { call } = useApi();
  const wallets = useResource("getWallets", tripId);
  const fundings = useResource("getTripFundings", tripId);
  const [target, setTarget] = useState("");
  const [result, setResult] = useState<any>(null);
  const fields: Field[] = [
    {
      key: "walletId",
      label: "Destination wallet",
      options: [
        { label: "No wallet", value: null },
        ...(wallets.data || []).map((w: any) => ({
          label: w.name,
          value: w.id,
        })),
      ],
    },
    ...(!funding
      ? [
          {
            key: "sourceType",
            label: "Funding source",
            options: options(["manual", "bank", "cash"]),
          },
        ]
      : []),
    { key: "sourceCurrency", label: "Source currency", required: true },
    {
      key: "sourceAmount",
      label: "Source amount",
      type: "number",
      required: true,
    },
    {
      key: "destinationCurrency",
      label: "Destination currency",
      required: true,
    },
    {
      key: "destinationAmount",
      label: "Destination amount",
      type: "number",
      required: true,
    },
    { key: "fxRate", label: "Exchange rate", type: "number" },
    { key: "feeAmount", label: "Fee amount", type: "number" },
    { key: "feeCurrency", label: "Fee currency" },
  ];
  const initial = Object.fromEntries(
    fields.map((f) => [
      f.key,
      funding?.[f.key] ??
        (
          {
            sourceCurrency: trip.baseCurrency,
            destinationCurrency: trip.baseCurrency,
            sourceType: "manual",
            feeAmount: 0,
            feeCurrency: trip.baseCurrency,
            walletId: null,
          } as any
        )[f.key] ??
        "",
    ]),
  );
  return (
    <Screen>
      <Heading title={funding ? "Review funding" : "Fund your journey"} />
      <Form
        initial={initial}
        fields={fields}
        onSave={async (v) => {
          if (!(v.sourceAmount > 0 && v.destinationAmount > 0))
            throw new Error("Enter positive source and destination amounts");
          const input = { ...v, fxRate: v.fxRate || null };
          const r = await call(
            funding ? "updateTripFunding" : "createTripFunding",
            ...(funding ? [tripId, funding.id, input] : [tripId, input]),
          );
          setResult(r);
          if (!funding)
            navigation.replace("Funding", { tripId, trip, funding: r.funding });
        }}
      />
      {result && (
        <Card>
          <Txt bold>Funding saved</Txt>
          <Propagation trace={result.propagationTrace} />
        </Card>
      )}
      {funding && (
        <>
          {funding.bankTransaction && (
            <Card>
              <Txt bold>Linked bank transaction</Txt>
              <Txt>{funding.bankTransaction.description}</Txt>
              <Txt>
                {money(
                  funding.bankTransaction.amountOut ||
                    funding.bankTransaction.amountIn,
                )}
              </Txt>
            </Card>
          )}
          {funding.suggestedBankTransaction && (
            <Card>
              <Txt bold>Suggested bank match</Txt>
              <Txt>{funding.suggestedBankTransaction.description}</Txt>
              <Button
                title="Accept match"
                onPress={() =>
                  void call("reviewTripFundingMatch", tripId, funding.id, {
                    action: "accept",
                  })
                    .then(() => navigation.goBack())
                    .catch(notice)
                }
              />
              <Button
                title="Reject match"
                secondary
                onPress={() =>
                  void call("reviewTripFundingMatch", tripId, funding.id, {
                    action: "reject",
                  })
                    .then(() => navigation.goBack())
                    .catch(notice)
                }
              />
            </Card>
          )}
          <Button
            title="Choose bank transaction"
            secondary
            onPress={() =>
              navigation.navigate("BankPicker", {
                tripId,
                mode: "funding",
                fundingId: funding.id,
              })
            }
          />
          <Card>
            <Choice
              label="Merge into existing funding"
              value={target}
              options={(fundings.data || [])
                .filter((f: any) => f.id !== funding.id)
                .map((f: any) => ({
                  label: `${f.wallet?.name || f.sourceType} · ${money(f.destinationAmount, f.destinationCurrency)}`,
                  value: f.id,
                }))}
              onChange={setTarget}
            />
            <Button
              title="Merge funding"
              disabled={!target}
              secondary
              onPress={() =>
                confirm(
                  "Merge funding?",
                  "Combine this imported funding with the selected funding.",
                  async () => {
                    await call("mergeTripFunding", tripId, funding.id, target);
                    navigation.goBack();
                  },
                )
              }
            />
          </Card>
          <Button
            title="Delete funding"
            danger
            secondary
            onPress={() =>
              confirm(
                "Delete funding?",
                "Linked wallet values will be recalculated.",
                async () => {
                  await call("deleteTripFunding", tripId, funding.id);
                  navigation.goBack();
                },
              )
            }
          />
        </>
      )}
    </Screen>
  );
}
export function TripEntriesScreen({ route, navigation }: any) {
  const { tripId, trip } = route.params;
  const { call } = useApi();
  const [filters, setFilters] = useState<any>({});
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [category, setCategory] = useState("");
  const data = useResource("getTripEntries", tripId, {
    ...filters,
    limit: 50,
    offset,
  });
  const cats = useResource("getCategories", { scope: "trips" });
  const wallets = useResource("getWallets", tripId);
  return (
    <Screen>
      <Heading title="Trip transactions" subtitle={trip.name} />
      <View style={styles.row}>
        <Button
          title="Filters"
          secondary
          onPress={() => setShowFilters(!showFilters)}
        />
        <Button
          title={selecting ? "Done" : "Select"}
          secondary
          onPress={() => {
            setSelecting(!selecting);
            setSelected([]);
          }}
        />
      </View>
      {showFilters && (
        <Card>
          <Form
            initial={filters}
            submit="Apply filters"
            fields={[
              { key: "search", label: "Search" },
              { key: "dateFrom", label: "From", type: "date" },
              { key: "dateTo", label: "To", type: "date" },
              {
                key: "walletId",
                label: "Wallet",
                options: [
                  { label: "All", value: "" },
                  ...(wallets.data || []).map((w: any) => ({
                    label: w.name,
                    value: w.id,
                  })),
                ],
              },
              {
                key: "categoryId",
                label: "Category",
                options: [
                  { label: "All", value: "" },
                  ...(cats.data || []).map((c: any) => ({
                    label: c.name,
                    value: c.id,
                  })),
                ],
              },
              {
                key: "type",
                label: "Type",
                options: [
                  { label: "All", value: "" },
                  ...options([
                    "spending",
                    "reimbursement",
                    "funding_out",
                    "funding_in",
                  ]),
                ],
              },
            ]}
            onSave={async (v) => {
              setFilters(
                Object.fromEntries(
                  Object.entries(v).filter(([, val]) => val !== ""),
                ),
              );
              setOffset(0);
              setShowFilters(false);
            }}
          />
        </Card>
      )}
      {selecting && (
        <Card>
          <Txt bold>{selected.length} selected</Txt>
          <Choice
            label="Category"
            value={category}
            options={(cats.data || []).map((c: any) => ({
              label: c.name,
              value: c.id,
            }))}
            onChange={setCategory}
          />
          <Button
            title="Update category"
            disabled={!selected.length || !category}
            onPress={() =>
              void call("bulkUpdateTripEntriesByIds", tripId, selected, {
                categoryId: category,
              })
                .then(() => {
                  setSelected([]);
                  void data.reload();
                })
                .catch(notice)
            }
          />
          <Button
            title="Delete selected"
            danger
            secondary
            disabled={!selected.length}
            onPress={() =>
              confirm(
                "Delete trip entries?",
                `Remove ${selected.length} entries.`,
                async () => {
                  await call("bulkDeleteTripEntriesByIds", tripId, selected);
                  setSelected([]);
                  await data.reload();
                },
              )
            }
          />
        </Card>
      )}
      <State {...data} />
      {data.data?.items.map((item: any) => (
        <TransactionRow
          key={item.id}
          item={item}
          selected={selected.includes(item.id)}
          onPress={() =>
            selecting
              ? setSelected((old) =>
                  old.includes(item.id)
                    ? old.filter((i) => i !== item.id)
                    : [...old, item.id],
                )
              : navigation.navigate("TripEntry", { tripId, trip, item })
          }
        />
      ))}
      <View style={styles.between}>
        <Button
          title="Previous"
          secondary
          disabled={!offset}
          onPress={() => setOffset(offset - 50)}
        />
        <Button
          title="Next"
          secondary
          disabled={offset + 50 >= (data.data?.total || 0)}
          onPress={() => setOffset(offset + 50)}
        />
      </View>
      <Button
        title="Add from bank"
        secondary
        onPress={() =>
          navigation.navigate("BankPicker", { tripId, mode: "entries" })
        }
      />
    </Screen>
  );
}
export function TripEntryScreen({ route, navigation }: any) {
  const { tripId, trip, item } = route.params;
  const { call } = useApi();
  const cats = useResource("getCategories", { scope: "trips" });
  const wallets = useResource("getWallets", tripId);
  const trips = useResource("getTrips");
  const fields: Field[] = [
    { key: "date", label: "Date", type: "date", required: true },
    {
      key: "categoryId",
      label: "Category",
      options: [
        { label: "Uncategorized", value: null },
        ...(cats.data || []).map((c: any) => ({ label: c.name, value: c.id })),
      ],
    },
    ...(!item
      ? [
          { key: "description", label: "Description", required: true },
          { key: "label", label: "Label" },
          {
            key: "type",
            label: "Entry type",
            options: options(["spending", "reimbursement", "funding_out"]),
          },
          {
            key: "walletId",
            label: "Wallet",
            options: (wallets.data || []).map((w: any) => ({
              label: w.name,
              value: w.id,
            })),
          },
          { key: "localCurrency", label: "Local currency", required: true },
          {
            key: "localAmount",
            label: "Local amount",
            type: "number" as const,
            required: true,
          },
          {
            key: "baseAmount",
            label: `Amount in ${trip.baseCurrency}`,
            type: "number" as const,
            required: true,
          },
          { key: "fxRate", label: "Exchange rate", type: "number" as const },
          { key: "feeAmount", label: "Fee", type: "number" as const },
          { key: "feeCurrency", label: "Fee currency" },
          {
            key: "destinationType",
            label: "For outgoing funding: destination",
            options: options(["external", "bank", "trip"]),
          },
          {
            key: "destinationTripId",
            label: "Destination trip (if applicable)",
            options: [
              { label: "None", value: "" },
              ...(trips.data || [])
                .filter((t: any) => t.id !== tripId)
                .map((t: any) => ({ label: t.name, value: t.id })),
            ],
          },
          { key: "destinationCurrency", label: "Destination currency" },
          {
            key: "destinationAmount",
            label: "Destination amount",
            type: "number" as const,
          },
        ]
      : []),
  ];
  return (
    <Screen>
      <Heading
        title={item ? item.label || item.description : "Add a trip transaction"}
      />
      {item && (
        <Card>
          <Txt>
            {money(item.localAmount, item.localCurrency)} ·{" "}
            {money(item.baseAmount, trip.baseCurrency)}
          </Txt>
          <Txt muted>
            {item.type} · {item.wallet?.name}
          </Txt>
        </Card>
      )}
      <Form
        initial={
          item
            ? {
                date: item.date.slice(0, 10),
                categoryId: item.category?.id || null,
              }
            : {
                date: today(),
                type: "spending",
                localCurrency: trip.baseCurrency,
                destinationType: "external",
                feeAmount: 0,
                feeCurrency: trip.baseCurrency,
              }
        }
        fields={fields}
        onSave={async (v) => {
          if (item)
            await call("bulkUpdateTripEntriesByIds", tripId, [item.id], v);
          else {
            if (!(v.localAmount > 0 && v.baseAmount >= 0))
              throw new Error("Enter valid local and base amounts");
            const {
              destinationType,
              destinationTripId,
              destinationCurrency,
              destinationAmount,
              ...payload
            } = v;
            await call("createTripEntry", tripId, {
              ...payload,
              ...(v.type === "funding_out"
                ? {
                    fundingOut: {
                      destinationType,
                      destinationTripId: destinationTripId || null,
                      destinationCurrency:
                        destinationCurrency || v.localCurrency,
                      destinationAmount: destinationAmount || v.localAmount,
                    },
                  }
                : {}),
            });
          }
          navigation.goBack();
        }}
      />
      {item && (
        <>
          <Button
            title="Link reimbursement"
            secondary
            disabled={item.type !== "reimbursement"}
            onPress={() =>
              navigation.navigate("Reimbursement", { tripId, item })
            }
          />
          <Button
            title="Clear linkage"
            secondary
            onPress={() =>
              confirm(
                "Clear linkage?",
                "Remove links from this entry.",
                async () => {
                  await call("clearTripEntryLinkage", tripId, item.id);
                  navigation.goBack();
                },
              )
            }
          />
          <Button
            title="Delete entry"
            danger
            secondary
            onPress={() =>
              confirm(
                "Delete entry?",
                "Permanently remove this trip entry.",
                async () => {
                  await call("bulkDeleteTripEntriesByIds", tripId, [item.id]);
                  navigation.goBack();
                },
              )
            }
          />
        </>
      )}
    </Screen>
  );
}
export function BankPickerScreen({ route, navigation }: any) {
  const { tripId, mode, fundingId } = route.params;
  const { call } = useApi();
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [walletId, setWalletId] = useState("");
  const [busy, setBusy] = useState(false);
  const wallets = useResource("getWallets", tripId);
  const result = useResource(
    mode === "outgoing"
      ? "getOutgoingFundingEntryCandidates"
      : mode === "funding"
        ? "getFundingCandidates"
        : "getSourceTransactionCandidates",
    tripId,
    { search, limit: 30, offset },
  );
  return (
    <Screen>
      <Heading
        title={
          mode === "outgoing"
            ? "Funding from another trip"
            : "Choose bank transactions"
        }
      />
      <Input
        label="Search"
        value={search}
        onChangeText={(v: string) => {
          setSearch(v);
          setOffset(0);
        }}
      />
      {mode === "outgoing" && (
        <Choice
          label="Destination wallet"
          value={walletId}
          options={(wallets.data || []).map((w: any) => ({
            label: w.name,
            value: w.id,
          }))}
          onChange={setWalletId}
        />
      )}
      <State {...result} />
      {result.data?.transactions.map((item: any) => (
        <TransactionRow
          key={item.id}
          item={item}
          selected={selected.includes(item.id)}
          onPress={() =>
            setSelected((old) =>
              old.includes(item.id)
                ? old.filter((id) => id !== item.id)
                : mode === "funding"
                  ? [item.id]
                  : [...old, item.id],
            )
          }
        />
      ))}
      <View style={styles.between}>
        <Button
          title="Previous"
          secondary
          disabled={!offset}
          onPress={() => setOffset(offset - 30)}
        />
        <Button
          title="Next"
          secondary
          disabled={offset + 30 >= (result.data?.total || 0)}
          onPress={() => setOffset(offset + 30)}
        />
      </View>
      <Button
        title={busy ? "Saving…" : `Use ${selected.length} selected`}
        disabled={busy || !selected.length}
        onPress={async () => {
          setBusy(true);
          try {
            if (mode === "outgoing")
              await call("addFundingsFromOutgoingEntries", tripId, {
                sourceEntryIds: selected,
                walletId: walletId || null,
              });
            else if (mode === "funding")
              await call("reviewTripFundingMatch", tripId, fundingId, {
                action: "replace",
                bankTransactionId: selected[0],
              });
            else
              await call("addEntriesFromSourceTransactions", tripId, {
                transactionIds: selected,
                entryType: "spending",
              });
            navigation.goBack();
          } catch (e) {
            notice(e);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Screen>
  );
}
