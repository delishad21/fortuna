import React, { useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useApi, useResource } from "../api";
import {
  ActionMenu,
  Card,
  confirm,
  Empty,
  fmtDate,
  Group,
  IconBubble,
  ListItem,
  money,
  Screen,
  Section,
  Segmented,
  Stat,
  StatGrid,
  State,
  styles,
  tap,
  toast,
  TransactionRow,
  Txt,
  useTheme,
} from "../ui";
import { AreaChart, Donut } from "../charts";
import { isViewer, RolePill, roleOf, TripCover, tripDates, ViewerBanner } from "./common";

function Action({ icon, label, onPress }: any) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => ({ alignItems: "center", gap: 6, width: 76, opacity: pressed ? 0.6 : 1 })}
    >
      <IconBubble icon={icon} size={48} />
      <Txt size={12} bold numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  );
}
export function WalletCard({ wallet, base, onPress }: any) {
  const { colors } = useTheme();
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={wallet.name}
      style={{ width: 220, padding: 16, gap: 8, borderLeftWidth: 5, borderLeftColor: wallet.color || colors.purple }}
    >
      <View style={styles.between}>
        <Txt bold numberOfLines={1} style={{ flex: 1 }}>
          {wallet.name}
        </Txt>
        <Txt muted size={12}>
          {wallet.currency}
        </Txt>
      </View>
      {(wallet.balances || []).length === 0 && <Txt muted size={13}>No balance yet</Txt>}
      {(wallet.balances || []).map((b: any) => (
        <Txt key={b.currency} mono size={18} tone={b.amount < 0 ? "red" : undefined} numberOfLines={1} adjustsFontSizeToFit>
          {money(b.amount, b.currency)}
        </Txt>
      ))}
      {wallet.intrinsicBaseValue != null && wallet.currency !== base && (
        <Txt muted size={12}>
          ≈ {money(wallet.intrinsicBaseValue, base)}
        </Txt>
      )}
    </Card>
  );
}
export function TripScreen({ route, navigation }: any) {
  const { tripId } = route.params;
  const { call } = useApi();
  const [tab, setTab] = useState("Overview");
  const trip = useResource("getTrip", tripId);
  const analytics = useResource("getTripAnalytics", tripId);
  const wallets = useResource("getTripWalletSummaries", tripId);
  const recent = useResource("getTripEntries", tripId, { limit: 6 });
  const balances = useResource("getTripBalances", tripId);
  const fundings = useResource("getTripFundings", tripId);
  const t = trip.data;
  const a = analytics.data;
  const base = t?.baseCurrency || "SGD";
  const viewer = isViewer(t);
  const pendingReviews = (fundings.data || []).filter(
    (f: any) =>
      !f.bankTransactionId &&
      (f.metadata?.detachedBankTransaction ||
        (["imported_topup", "opening_balance"].includes(f.sourceType) &&
          ["pending", "unmatched", undefined].includes(f.metadata?.matchReviewStatus))),
  ).length;
  const reload = () =>
    Promise.all([trip.reload(), analytics.reload(), wallets.reload(), recent.reload(), balances.reload(), fundings.reload()]);
  const params = { tripId, trip: t };
  const people = balances.data?.people || [];
  const owed = people.reduce((s: number, p: any) => s + Number(p.openBase || 0), 0);
  return (
    <Screen refreshControl={<RefreshControl refreshing={trip.loading && !!t} onRefresh={() => void reload()} />}>
      <State {...trip} />
      {t && (
        <>
          <TripCover trip={t} height={190}>
            <View style={[styles.between, { alignItems: "flex-end" }]}>
              <View style={{ flex: 1, gap: 4 }}>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <RolePill trip={t} />
                </View>
                <Txt style={{ fontFamily: "Montserrat_700Bold", fontSize: 26, lineHeight: 32, color: "#FFFFFF" }} numberOfLines={2}>
                  {t.name}
                </Txt>
                <Txt size={13} style={{ color: "#E6E2FF" }}>
                  {tripDates(t)} · {base}
                </Txt>
              </View>
              <ActionMenu
                title={t.name}
                actions={[
                  { label: "Trip details", icon: "create-outline", onPress: () => navigation.navigate("TripEditor", { trip: t }) },
                  { label: "Members & sharing", icon: "people-outline", onPress: () => navigation.navigate("Members", params) },
                  t.sharing && { label: "Shared overview", icon: "globe-outline", onPress: () => navigation.navigate("SharedOverview", params) },
                  { label: "Funding", icon: "wallet-outline", onPress: () => navigation.navigate("TripFundings", params) },
                  !viewer && {
                    label: `Funding review${pendingReviews ? ` (${pendingReviews})` : ""}`,
                    icon: "git-compare-outline",
                    onPress: () => navigation.navigate("FundingReview", params),
                  },
                  { label: "Wallets", icon: "card-outline", onPress: () => navigation.navigate("Wallets", params) },
                  { label: "People & IOUs", icon: "person-outline", onPress: () => navigation.navigate("People", params) },
                  !viewer && { label: "Import statement", icon: "cloud-upload-outline", onPress: () => navigation.navigate("TripImport", params) },
                  roleOf(t) === "owner" && {
                    label: "Delete trip",
                    icon: "trash-outline",
                    danger: true,
                    onPress: () =>
                      confirm("Delete this trip?", "This removes the trip and its wallets, entries and funding.", async () => {
                        await call("deleteTrip", tripId);
                        toast("Trip deleted");
                        navigation.goBack();
                      }, "Delete"),
                  },
                ]}
              />
            </View>
          </TripCover>
          <ViewerBanner trip={t} />
          {!viewer && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
              <Action icon="add" label="Add entry" onPress={() => navigation.navigate("TripEntry", params)} />
              <Action icon="business-outline" label="From bank" onPress={() => navigation.navigate("BankPicker", { tripId, mode: "entries" })} />
              <Action icon="cloud-upload-outline" label="Import" onPress={() => navigation.navigate("TripImport", params)} />
              <Action icon="wallet-outline" label="Funding" onPress={() => navigation.navigate("TripFundings", params)} />
              <Action icon="people-outline" label="Members" onPress={() => navigation.navigate("Members", params)} />
            </ScrollView>
          )}
          {pendingReviews > 0 && !viewer && (
            <Card onPress={() => navigation.navigate("FundingReview", params)} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <IconBubble icon="git-compare-outline" tone="amber" />
              <View style={{ flex: 1 }}>
                <Txt bold>{pendingReviews} funding {pendingReviews === 1 ? "row needs" : "rows need"} a bank match</Txt>
                <Txt muted size={13}>Link top-ups to the bank transactions that paid for them.</Txt>
              </View>
            </Card>
          )}
          <Segmented values={["Overview", "Wallets", "People"]} value={tab} onChange={setTab} />
          {tab === "Overview" && (
            <>
              <State {...analytics} />
              {a && (
                <>
                  <StatGrid>
                    <Stat icon="airplane-outline" label="Net trip cost" value={money(a.totals.netTripCost, base)} />
                    <Stat icon="cart-outline" tone="red" label="Total spent" value={money(a.totals.totalSpent, base)} />
                    <Stat
                      icon="arrow-down"
                      tone="green"
                      label="Funding in"
                      value={money(a.totals.totalFundingIn ?? a.totals.totalFunding, base)}
                      onPress={() => navigation.navigate("TripFundings", params)}
                    />
                    <Stat icon="arrow-up" tone="amber" label="Funding out" value={money(a.totals.totalFundingOut || 0, base)} />
                  </StatGrid>
                  {a.totals.totalReimbursed > 0 && (
                    <Txt muted size={13} style={{ paddingHorizontal: 4 }}>
                      {money(a.totals.totalReimbursed, base)} reimbursed so far.
                    </Txt>
                  )}
                  {a.categoryBreakdown?.length > 0 && (
                    <Section title="Spending by category">
                      <Card>
                        <Donut
                          currency={base}
                          centerLabel="Spent"
                          limit={7}
                          data={a.categoryBreakdown.map((c: any, i: number) => ({
                            key: c.category?.id || `none-${i}`,
                            label: c.category?.name || "Uncategorized",
                            value: c.totalOut,
                            color: c.category?.color || "#94a3b8",
                          }))}
                        />
                      </Card>
                    </Section>
                  )}
                  {a.dailySeries?.length > 1 && (
                    <Section title="Day by day">
                      <Card>
                        <AreaChart
                          currency={base}
                          color="#F23030"
                          data={a.dailySeries.map((d: any) => ({
                            key: d.date,
                            label: fmtDate(d.date, false),
                            value: d.spending,
                          }))}
                        />
                      </Card>
                    </Section>
                  )}
                  <Section title="Highlights">
                    <Group>
                      {[
                        ["flights", "Flights", "airplane-outline"],
                        ["accommodations", "Accommodation", "bed-outline"],
                        ["attractions", "Attractions", "ticket-outline"],
                      ].map(([key, label, icon]) => (
                        <View key={key}>
                          <ListItem icon={icon} title={label} value={money(a.highlights[key], base)} />
                          {(a.highlightTransactions?.[key] || []).map((h: any) => (
                            <ListItem
                              key={h.id}
                              left={<View style={{ width: 36 }} />}
                              title={<Txt size={14}>{h.label || h.description}</Txt>}
                              subtitle={`${fmtDate(h.date, false)} · ${h.walletName}`}
                              value={money(h.localAmount, h.localCurrency)}
                            />
                          ))}
                        </View>
                      ))}
                    </Group>
                  </Section>
                </>
              )}
              <Section title="Recent activity" action="See all" onAction={() => navigation.navigate("TripEntries", params)}>
                <Card style={{ paddingVertical: 6, gap: 0 }}>
                  {recent.data?.items?.length === 0 && (
                    <Empty icon="receipt-outline" title="No entries yet" message="Add spending, import a statement or bring transactions in from your bank." />
                  )}
                  {(recent.data?.items || []).map((item: any) => (
                    <TransactionRow
                      key={item.id}
                      item={item}
                      baseCurrency={base}
                      onPress={() => navigation.navigate("TripEntry", { ...params, item })}
                    />
                  ))}
                </Card>
              </Section>
            </>
          )}
          {tab === "Wallets" && (
            <>
              <State {...wallets} />
              {wallets.data?.length === 0 && (
                <Card>
                  <Empty
                    icon="wallet-outline"
                    title="No wallets yet"
                    message="Wallets are created when you import a statement, add funding or carry money over from another trip."
                  />
                </Card>
              )}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                {(wallets.data || []).map((w: any) => (
                  <WalletCard key={w.id} wallet={w} base={base} onPress={() => navigation.navigate("Wallet", { ...params, walletId: w.id })} />
                ))}
              </ScrollView>
              <Group>
                <ListItem icon="card-outline" title="Manage wallets" subtitle="Rename, link accounts, merge and revalue" onPress={() => navigation.navigate("Wallets", params)} />
                <ListItem icon="wallet-outline" title="Funding" subtitle={`${fundings.data?.length || 0} funding rows`} onPress={() => navigation.navigate("TripFundings", params)} />
                {!viewer && (
                  <ListItem icon="return-up-forward-outline" title="Carry over from another trip" onPress={() => navigation.navigate("CarryOver", params)} />
                )}
              </Group>
            </>
          )}
          {tab === "People" && (
            <>
              <Card style={{ gap: 6 }}>
                <Txt muted size={13}>
                  Open IOUs
                </Txt>
                <Txt mono size={26}>
                  {money(owed, base)}
                </Txt>
                <Txt muted size={13}>
                  {people.length} {people.length === 1 ? "person" : "people"} on this trip
                </Txt>
              </Card>
              <Group>
                {people.map((p: any) => (
                  <ListItem
                    key={p.participantId}
                    icon="person-outline"
                    title={p.name}
                    subtitle={p.openBase > 0 ? `You owe ${money(p.openBase, base)}` : p.paidBase > 0 ? "Settled up" : "Nothing owed"}
                    valueTone={p.openBase > 0 ? "red" : "green"}
                    onPress={() => navigation.navigate("People", params)}
                  />
                ))}
                <ListItem icon="people-outline" title="People & IOUs" subtitle="Add people, record who paid and settle up" onPress={() => navigation.navigate("People", params)} />
                <ListItem icon="share-social-outline" title="Members & sharing" subtitle={t.sharing ? `${t.sharing.memberCount} members` : "Share this trip with other Fortuna users"} onPress={() => navigation.navigate("Members", params)} />
                {t.sharing && <ListItem icon="globe-outline" title="Shared overview" subtitle="Who paid, who owes, settle up" onPress={() => navigation.navigate("SharedOverview", params)} />}
              </Group>
            </>
          )}
        </>
      )}
    </Screen>
  );
}
