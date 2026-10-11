import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, SectionList, View } from "react-native";
import { useApi, usePaged, useResource } from "../api";
import {
  ActionMenu,
  Banner,
  BRAND,
  Button,
  Card,
  Chips,
  Choice,
  confirm,
  DateField,
  DateHeader,
  Empty,
  Footer,
  Group,
  Heading,
  IconButton,
  Input,
  KeyValue,
  ListItem,
  money,
  notice,
  Pill,
  plural,
  Screen,
  SearchBar,
  Section,
  Segmented,
  Sheet,
  State,
  styles,
  today,
  toast,
  TransactionRow,
  Txt,
  useTheme,
} from "../ui";
import {
  buildFundingOut,
  emptyFundingOut,
  ENTRY_TYPES,
  FundingOutFields,
  fundingOutFromMetadata,
  isViewer,
  NO_WALLET,
  PersonPicker,
  SPECIAL_CATEGORIES,
  validateFundingOut,
  ViewerBanner,
} from "./common";

const toFilters = (f: any, search: string) =>
  Object.fromEntries(
    Object.entries({
      search: search || undefined,
      walletId: f.walletId,
      categoryId: f.categoryId,
      dateFrom: f.dateFrom ? `${f.dateFrom}T00:00:00` : undefined,
      dateTo: f.dateTo ? `${f.dateTo}T23:59:59` : undefined,
    }).filter(([, v]) => v),
  );
export function TripEntriesScreen({ route, navigation }: any) {
  const { tripId } = route.params;
  const { call } = useApi();
  const { colors } = useTheme();
  const trip = useResource("getTrip", tripId);
  const t = trip.data || route.params.trip;
  const base = t?.baseCurrency || "SGD";
  const viewer = isViewer(t);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<any>({});
  const [showFilters, setShowFilters] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [allFiltered, setAllFiltered] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [bulk, setBulk] = useState<"" | "category" | "date">("");
  const [bulkValue, setBulkValue] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const f = toFilters(filters, query);
  const list = usePaged(
    "getTripEntries",
    (offset, limit) => [tripId, { ...f, limit, offset }],
    (d) => ({ items: d.items || [], total: d.total || 0 }),
    [tripId, f],
    40,
  );
  const wallets = useResource("getWallets", tripId);
  const categories = useResource("getCategories", { scope: "trips" });
  const shared = useResource(t?.sharing ? "getTripSharedOverview" : "", tripId);
  const shareLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of shared.data?.entries || [])
      if (!e.isShare && e.shares?.length) map.set(e.id, `Shared with ${e.shares.map((s: any) => s.name).join(", ")}`);
    return map;
  }, [shared.data]);
  const sections = useMemo(() => {
    const out: { key: string; data: any[] }[] = [];
    for (const row of list.items) {
      const key = String(row.date || "").slice(0, 10);
      const last = out[out.length - 1];
      if (last?.key === key) last.data.push(row);
      else out.push({ key, data: [row] });
    }
    return out;
  }, [list.items]);
  const count = allFiltered ? list.total - excluded.length : selected.length;
  const isOn = (id: string) => (allFiltered ? !excluded.includes(id) : selected.includes(id));
  const toggle = (id: string) =>
    allFiltered
      ? setExcluded((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]))
      : setSelected((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const end = () => {
    setSelecting(false);
    setSelected([]);
    setAllFiltered(false);
    setExcluded([]);
  };
  const filterFor = () => toFilters(filters, query);
  const applyBulk = async (updates: any) => {
    if (allFiltered) await call("bulkUpdateTripEntriesByFilter", tripId, filterFor(), excluded, updates);
    else await call("bulkUpdateTripEntriesByIds", tripId, selected, updates);
    toast(`Updated ${plural(count, "entry", "entries")}`);
    end();
    await list.reload();
  };
  const note = (item: any) =>
    item.type === "settlement" && item.counterparty
      ? `Paid ${item.counterparty.name}`
      : item.isIou && item.counterparty
        ? `Owed to ${item.counterparty.name}`
        : shareLabels.get(item.id);
  const activeCount = ["walletId", "dateFrom", "dateTo"].filter((k) => filters[k]).length +
    (filters.categoryId && !SPECIAL_CATEGORIES[filters.categoryId] ? 1 : 0);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SectionList
        sections={sections}
        keyExtractor={(i) => i.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[styles.content, { gap: 0 }]}
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={list.loading && list.loaded} onRefresh={list.reload} />}
        ListHeaderComponent={
          <View style={[styles.stack, { marginBottom: 6 }]}>
            <Heading
              title="Trip activity"
              subtitle={`${t?.name || ""} · ${list.total} entries`}
              right={
                !viewer ? (
                  <View style={[styles.row, { gap: 8 }]}>
                    <IconButton
                      icon={selecting ? "close" : "checkmark-circle-outline"}
                      label={selecting ? "Done selecting" : "Select"}
                      onPress={() => (selecting ? end() : setSelecting(true))}
                    />
                    <ActionMenu
                      actions={[
                        { label: "Add entry", icon: "add", onPress: () => navigation.navigate("TripEntry", { tripId, trip: t }) },
                        { label: "Add from bank", icon: "business-outline", onPress: () => navigation.navigate("BankPicker", { tripId, mode: "entries" }) },
                        { label: "Import statement", icon: "cloud-upload-outline", onPress: () => navigation.navigate("TripImport", { tripId, trip: t }) },
                      ]}
                    />
                  </View>
                ) : undefined
              }
            />
            <ViewerBanner trip={t} />
            <SearchBar value={search} onChangeText={setSearch} placeholder="Search entries" />
            <View style={[styles.row, { gap: 8 }]}>
              <Button
                title={activeCount ? `Filters · ${activeCount}` : "Filters"}
                compact
                secondary={!activeCount}
                icon="options-outline"
                onPress={() => setShowFilters(true)}
              />
              <View style={{ flex: 1 }}>
                <Chips
                  values={["", ...Object.keys(SPECIAL_CATEGORIES)]}
                  labels={{ "": "All", ...SPECIAL_CATEGORIES }}
                  value={SPECIAL_CATEGORIES[filters.categoryId] ? filters.categoryId : ""}
                  onChange={(categoryId) => setFilters((o: any) => ({ ...o, categoryId: categoryId || undefined }))}
                />
              </View>
            </View>
            {selecting && (
              <Banner
                tone="purple"
                icon="checkmark-done-outline"
                title={`${count} selected`}
                message="Long-press or tap rows. You can also select everything that matches."
                action={allFiltered ? "Select none" : `Select all ${list.total} matching`}
                onAction={() => {
                  setAllFiltered(!allFiltered);
                  setExcluded([]);
                  setSelected([]);
                }}
              />
            )}
            <State {...list} data={list.loaded ? true : null} />
          </View>
        }
        renderSectionHeader={({ section }) => <DateHeader date={section.key} />}
        renderItem={({ item }) => {
          const n = note(item);
          return (
            <View
              style={{
                backgroundColor: colors.card,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: colors.line,
                marginBottom: 8,
                overflow: "hidden",
              }}
            >
              <TransactionRow
                item={item}
                baseCurrency={base}
                selectable={selecting}
                selected={selecting && isOn(item.id)}
                onLongPress={viewer || selecting ? undefined : () => {
                  setSelecting(true);
                  setSelected([item.id]);
                }}
                onPress={() => (selecting ? toggle(item.id) : navigation.navigate("TripEntry", { tripId, trip: t, item }))}
              />
              {!!n && (
                <Txt size={12} style={{ color: "#8b5cf6", marginLeft: 15, marginTop: -8, marginBottom: 8 }}>
                  {n}
                </Txt>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          list.loaded && !list.loading ? (
            <Card>
              <Empty icon="receipt-outline" title="No entries" message="Nothing matches these filters yet." />
            </Card>
          ) : null
        }
        ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ padding: 20 }} color={BRAND} /> : null}
      />
      {selecting && (
        <Footer>
          <View style={[styles.row, { gap: 8 }]}>
            <Button compact secondary icon="pricetag-outline" title="Category" style={{ flex: 1 }} disabled={!count} onPress={() => { setBulkValue(""); setBulk("category"); }} />
            <Button compact secondary icon="calendar-outline" title="Date" style={{ flex: 1 }} disabled={!count} onPress={() => { setBulkValue(""); setBulk("date"); }} />
            <IconButton
              icon="trash-outline"
              tone="red"
              label="Delete selected"
              disabled={!count}
              onPress={() =>
                confirm("Delete entries?", `Remove ${plural(count, "entry", "entries")} from this trip.`, async () => {
                  if (allFiltered) await call("bulkDeleteTripEntriesByFilter", tripId, filterFor(), excluded);
                  else await call("bulkDeleteTripEntriesByIds", tripId, selected);
                  toast(`Deleted ${plural(count, "entry", "entries")}`);
                  end();
                  await list.reload();
                }, "Delete")
              }
            />
          </View>
        </Footer>
      )}
      <Sheet
        visible={!!bulk}
        onClose={() => setBulk("")}
        title={bulk === "date" ? "Change date" : "Set category"}
        subtitle={plural(count, "entry", "entries")}
        footer={
          <Button
            title="Apply"
            disabled={!bulkValue}
            onPress={() => {
              const updates = bulk === "date" ? { date: bulkValue } : { categoryId: bulkValue };
              setBulk("");
              void applyBulk(updates).catch(notice);
            }}
          />
        }
      >
        {bulk === "date" ? (
          <DateField label="New date" value={bulkValue} onChange={setBulkValue} />
        ) : (
          <Choice
            label="Category"
            value={bulkValue}
            options={(categories.data || []).map((c: any) => ({ label: c.name, value: c.id, color: c.color }))}
            onChange={setBulkValue}
          />
        )}
      </Sheet>
      <Sheet
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        title="Filter entries"
        footer={
          <View style={styles.row}>
            <Button title="Reset" secondary style={{ flex: 1 }} onPress={() => { setFilters({}); setShowFilters(false); }} />
            <Button title="Done" style={{ flex: 2 }} onPress={() => setShowFilters(false)} />
          </View>
        }
      >
        <Choice
          label="Wallet"
          value={filters.walletId || ""}
          options={[
            { label: "All wallets", value: "" },
            ...(wallets.data || []).map((w: any) => ({ label: `${w.name} · ${w.currency}`, value: w.id, color: w.color })),
          ]}
          onChange={(walletId) => setFilters((o: any) => ({ ...o, walletId: walletId || undefined }))}
        />
        <Choice
          label="Category"
          value={filters.categoryId || ""}
          options={[
            { label: "All categories", value: "" },
            ...Object.entries(SPECIAL_CATEGORIES).map(([value, label]) => ({ label, value })),
            ...(categories.data || []).map((c: any) => ({ label: c.name, value: c.id, color: c.color })),
          ]}
          onChange={(categoryId) => setFilters((o: any) => ({ ...o, categoryId: categoryId || undefined }))}
        />
        <View style={[styles.row, { alignItems: "flex-start" }]}>
          <View style={{ flex: 1 }}>
            <DateField label="From" value={filters.dateFrom || ""} onChange={(dateFrom) => setFilters((o: any) => ({ ...o, dateFrom }))} />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label="To" value={filters.dateTo || ""} onChange={(dateTo) => setFilters((o: any) => ({ ...o, dateTo }))} />
          </View>
        </View>
      </Sheet>
    </View>
  );
}
type EntryForm = {
  walletId: string;
  type: "spending" | "reimbursement" | "funding_out" | "settlement";
  paidBy: string;
  counterpartyId: string;
  date: string;
  description: string;
  label: string;
  categoryId: string;
  localCurrency: string;
  localAmount: string;
  baseAmount: string;
  fxRate: string;
};
export function TripEntryScreen({ route, navigation }: any) {
  const { tripId, item } = route.params;
  const { call } = useApi();
  const trip = useResource("getTrip", tripId);
  const t = trip.data || route.params.trip;
  const base = t?.baseCurrency || "SGD";
  const viewer = isViewer(t);
  const wallets = useResource("getWallets", tripId);
  const categories = useResource("getCategories", { scope: "trips" });
  const editing = !!item;
  const locked = !!item?.metadata?.sourceTransactionId;
  const baseLocked = !!(item?.metadata?.baseAmountLocked || item?.metadata?.manualBaseAmount || item?.metadata?.manualFxRate);
  const initial: EntryForm = item
    ? {
        walletId: item.wallet?.id && item.wallet.id !== "__external__" ? item.wallet.id : NO_WALLET,
        type: item.type,
        paidBy: item.isIou ? item.counterparty?.id || "" : "",
        counterpartyId: item.type === "settlement" ? item.counterparty?.id || "" : "",
        date: String(item.date).slice(0, 10),
        description: item.description || "",
        label: item.label || "",
        categoryId: item.category?.id && !SPECIAL_CATEGORIES[item.category.id] ? item.category.id : "",
        localCurrency: item.localCurrency,
        localAmount: String(item.localAmount ?? ""),
        baseAmount: baseLocked ? String(item.baseAmount ?? "") : "",
        fxRate: "",
      }
    : {
        walletId: NO_WALLET,
        type: "spending",
        paidBy: "",
        counterpartyId: "",
        date: today(),
        description: "",
        label: "",
        categoryId: "",
        localCurrency: base,
        localAmount: "",
        baseAmount: "",
        fxRate: "",
      };
  const [form, setForm] = useState<EntryForm>(initial);
  const [fundingOut, setFundingOut] = useState(
    item?.metadata?.fundingOut ? fundingOutFromMetadata(item.metadata.fundingOut, base) : emptyFundingOut(base),
  );
  const [fundingOutTouched, setFundingOutTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!item && t && form.localCurrency !== t.baseCurrency && !form.localAmount)
      setForm((f) => ({ ...f, localCurrency: t.baseCurrency }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.baseCurrency]);
  const set = (patch: Partial<EntryForm>) => setForm((f) => ({ ...f, ...patch }));
  const isIou = form.type === "spending" && !!form.paidBy;
  const sameCurrency = form.localCurrency.toUpperCase() === base;
  if (item?.type === "funding_in")
    return (
      <Screen>
        <EntryHeader item={item} base={base} />
        <Banner
          tone="purple"
          icon="wallet-outline"
          title="Edit on the funding page"
          message="Funding-in rows come from a funding record. Change the amounts and bank link there."
          action="Go to funding"
          onAction={() =>
            navigation.navigate(item.metadata?.fundingId ? "Funding" : "TripFundings", {
              tripId,
              trip: t,
              fundingId: item.metadata?.fundingId,
            })
          }
        />
      </Screen>
    );
  const save = async () => {
    setError("");
    if (!form.description.trim()) return setError("Add a description");
    if (!/^[A-Za-z]{3}$/.test(form.localCurrency.trim())) return setError("Use a three-letter currency code, such as SGD");
    if (!(Number(form.localAmount) > 0)) return setError("Enter an amount above 0");
    if (form.baseAmount && !(Number(form.baseAmount) > 0)) return setError(`Enter a ${base} amount above 0, or leave it blank`);
    if (form.fxRate && !(Number(form.fxRate) > 0)) return setError("Enter a rate above 0, or leave it blank");
    if (form.type === "settlement" && !form.counterpartyId) return setError("Choose who you paid");
    if (form.type === "funding_out") {
      const problem = validateFundingOut(fundingOut, form.walletId);
      if (problem) return setError(problem);
    }
    setBusy(true);
    try {
      const walletId = isIou || form.walletId === NO_WALLET ? null : form.walletId;
      if (editing) {
        const changes: Record<string, any> = {};
        if (form.date !== initial.date) changes.date = form.date;
        if (form.description !== initial.description) changes.description = form.description.trim();
        if (form.label !== initial.label) changes.label = form.label.trim() || null;
        if (form.type === "spending" && form.categoryId !== initial.categoryId) changes.categoryId = form.categoryId || null;
        if (!locked) {
          if (form.walletId !== initial.walletId) changes.walletId = walletId;
          if (form.localCurrency !== initial.localCurrency) changes.localCurrency = form.localCurrency.toUpperCase();
          if (form.localAmount !== initial.localAmount) changes.localAmount = Number(form.localAmount);
          if (form.baseAmount && form.baseAmount !== initial.baseAmount) changes.baseAmount = Number(form.baseAmount);
          if (form.fxRate) changes.fxRate = Number(form.fxRate);
        }
        if (form.type === "funding_out" && fundingOutTouched) changes.fundingOut = buildFundingOut(fundingOut, base);
        if (Object.keys(changes).length) {
          await call("updateTripEntry", tripId, item.id, changes);
          toast("Entry saved");
        }
      } else if (isIou || form.type === "settlement") {
        await call("createTripPeopleEntry", tripId, {
          walletId,
          type: form.type,
          paidByParticipantId: isIou ? form.paidBy : null,
          counterpartyId: form.type === "settlement" ? form.counterpartyId : null,
          date: form.date,
          description: form.description.trim(),
          label: form.label.trim() || null,
          categoryId: isIou ? form.categoryId || null : null,
          localCurrency: form.localCurrency.toUpperCase(),
          localAmount: Number(form.localAmount),
          baseAmount: Number(form.baseAmount) || null,
          fxRate: Number(form.fxRate) || null,
          metadata: { source: "manual_trip_entry_modal" },
        });
        toast(form.type === "settlement" ? "Settlement added" : "IOU added");
      } else {
        await call("createTripEntry", tripId, {
          walletId,
          type: form.type,
          date: form.date,
          description: form.description.trim(),
          label: form.label.trim() || null,
          categoryId: form.type === "spending" ? form.categoryId || null : null,
          localCurrency: form.localCurrency.toUpperCase(),
          localAmount: Number(form.localAmount),
          baseAmount: Number(form.baseAmount) || null,
          fxRate: Number(form.fxRate) || null,
          feeAmount: null,
          feeCurrency: null,
          fundingOut: form.type === "funding_out" ? buildFundingOut(fundingOut, base) : null,
          metadata: { source: "manual_trip_entry_modal" },
        });
        toast("Entry added");
      }
      navigation.goBack();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const walletOptions = [
    { label: "No wallet", value: NO_WALLET, hint: "Paid from outside your trip wallets" },
    ...(wallets.data || []).map((w: any) => ({ label: `${w.name} · ${w.currency}`, value: w.id, color: w.color })),
  ];
  return (
    <Screen
      footer={
        viewer ? undefined : (
          <>
            {!!error && <Txt tone="red" size={13}>{error}</Txt>}
            <Button title={editing ? "Save entry" : "Add entry"} icon="checkmark" loading={busy} disabled={busy} onPress={() => void save()} />
          </>
        )
      }
    >
      {editing ? <EntryHeader item={item} base={base} /> : <Heading title="New entry" subtitle={t?.name} />}
      <ViewerBanner trip={t} />
      {!editing && (
        <Segmented
          values={["spending", "reimbursement", "funding_out", "settlement"]}
          labels={{ spending: "Spend", reimbursement: "Refund", funding_out: "Move out", settlement: "Settle" }}
          value={form.type}
          onChange={(type) => set({ type: type as any, categoryId: "", paidBy: "", counterpartyId: "" })}
        />
      )}
      {!editing && (
        <Txt muted size={13}>
          {form.type === "spending"
            ? "Money spent on the trip."
            : form.type === "reimbursement"
              ? "Money paid back to you."
              : form.type === "funding_out"
                ? "Money leaving a wallet: back to the bank, to another trip or wallet."
                : "Paying someone back for what they covered."}
        </Txt>
      )}
      {locked && (
        <Banner tone="blue" icon="lock-closed-outline" message="Amounts come from the bank transaction. Change them there." />
      )}
      <Card>
        {!editing && form.type === "spending" && (
          <>
            <PersonPicker tripId={tripId} label="Paid by" meOption="Me" value={form.paidBy} onChange={(paidBy) => set({ paidBy, walletId: paidBy ? NO_WALLET : form.walletId })} />
            {isIou && (
              <Txt muted size={12}>
                You owe them; it counts as spending now.
              </Txt>
            )}
          </>
        )}
        {!editing && form.type === "settlement" && (
          <PersonPicker tripId={tripId} label="Paid to" value={form.counterpartyId} onChange={(counterpartyId) => set({ counterpartyId })} />
        )}
        {editing && item?.counterparty && (
          <KeyValue label={item.type === "settlement" ? "Paid to" : "Paid by"} value={item.counterparty.name} />
        )}
        {!isIou && (
          <Choice
            label={form.type === "funding_out" ? "From wallet" : "Wallet"}
            value={form.walletId}
            options={walletOptions}
            onChange={(walletId) => {
              const w = (wallets.data || []).find((x: any) => x.id === walletId);
              set({ walletId, ...(w && !editing ? { localCurrency: w.currency } : {}) });
            }}
          />
        )}
        <DateField label="Date" value={form.date} onChange={(date) => set({ date })} />
        <Input label="Description" value={form.description} onChangeText={(description: string) => set({ description })} placeholder="What was it?" />
        <Input label="Label" value={form.label} onChangeText={(label: string) => set({ label })} placeholder="Optional" />
        {form.type === "spending" && (
          <Choice
            label="Category"
            value={form.categoryId}
            options={[
              { label: "Uncategorized", value: "" },
              ...(categories.data || []).map((c: any) => ({ label: c.name, value: c.id, color: c.color })),
            ]}
            onChange={(categoryId) => set({ categoryId })}
          />
        )}
      </Card>
      <Card>
        <View style={[styles.row, { alignItems: "flex-start" }]}>
          <View style={{ width: 96 }}>
            <Input
              label="Currency"
              value={form.localCurrency}
              editable={!locked}
              autoCapitalize="characters"
              maxLength={3}
              onChangeText={(v: string) => set({ localCurrency: v.toUpperCase() })}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label={form.type === "funding_out" ? "Amount sent" : form.type === "reimbursement" ? "Amount received" : "Amount"}
              value={form.localAmount}
              editable={!locked}
              keyboardType="decimal-pad"
              onChangeText={(localAmount: string) => set({ localAmount })}
            />
          </View>
        </View>
        {!sameCurrency && !locked && (
          <>
            <View style={[styles.row, { alignItems: "flex-start" }]}>
              <View style={{ flex: 1 }}>
                <Input label={`In ${base}`} value={form.baseAmount} keyboardType="decimal-pad" placeholder="Optional" onChangeText={(baseAmount: string) => set({ baseAmount })} />
              </View>
              <View style={{ flex: 1 }}>
                <Input label={`Rate to ${base}`} value={form.fxRate} keyboardType="decimal-pad" placeholder="Optional" onChangeText={(fxRate: string) => set({ fxRate })} />
              </View>
            </View>
            <Txt muted size={12}>
              {editing
                ? "Change only the amount and it is revalued at the wallet's rate."
                : "Leave both blank to use this wallet's average rate."}
            </Txt>
          </>
        )}
      </Card>
      {form.type === "funding_out" && (
        <Card>
          <FundingOutFields
            value={fundingOut}
            onChange={(v) => {
              setFundingOut(v);
              setFundingOutTouched(true);
            }}
            tripId={tripId}
            baseCurrency={base}
            sourceWalletId={form.walletId}
            wallets={wallets.data || []}
          />
        </Card>
      )}
      {editing && !viewer && (
        <Section title="More">
          <Group>
            {item.type === "reimbursement" && (
              <ListItem
                icon="link-outline"
                title="Reimbursement links"
                subtitle="Choose the trip spending this pays back"
                onPress={() => navigation.navigate("TripReimbursement", { tripId, trip: t, item })}
              />
            )}
            {item.type === "settlement" && (
              <ListItem
                icon="checkmark-done-outline"
                title="Choose what it pays off"
                subtitle={item.counterparty ? `IOUs with ${item.counterparty.name}` : undefined}
                onPress={() =>
                  navigation.navigate("Settle", { tripId, trip: t, settlementEntryId: item.id, participantId: item.counterparty?.id })
                }
              />
            )}
            {t?.sharing && item.type === "spending" && !item.isIou && (
              <ListItem
                icon="people-outline"
                title="Share cost…"
                subtitle="Split this with other members"
                onPress={() => navigation.navigate("ShareCost", { tripId, trip: t, item })}
              />
            )}
            {!!item.metadata?.linkage && (
              <ListItem
                icon="unlink-outline"
                title="Clear links"
                onPress={() =>
                  confirm("Clear links?", "Remove the reimbursement links from this entry.", async () => {
                    await call("clearTripEntryLinkage", tripId, item.id);
                    toast("Links cleared");
                    navigation.goBack();
                  })
                }
              />
            )}
            <ListItem
              icon="trash-outline"
              tone="red"
              titleTone="red"
              title="Delete entry"
              onPress={() =>
                confirm("Delete entry?", "Permanently remove this trip entry.", async () => {
                  await call("bulkDeleteTripEntriesByIds", tripId, [item.id]);
                  toast("Entry deleted");
                  navigation.goBack();
                }, "Delete")
              }
            />
          </Group>
        </Section>
      )}
    </Screen>
  );
}
function EntryHeader({ item, base }: any) {
  const detached = item.metadata?.sourceDetached;
  return (
    <>
      <Card style={{ alignItems: "center", gap: 6, paddingVertical: 22 }}>
        <Pill label={ENTRY_TYPES[item.type] || item.type} tone={item.type === "spending" ? "purple" : item.type === "funding_out" ? "amber" : "green"} />
        <Txt bold size={18} style={{ textAlign: "center" }}>
          {item.label || item.description}
        </Txt>
        <Txt mono style={{ fontSize: 30, lineHeight: 38 }}>
          {money(item.localAmount, item.localCurrency)}
        </Txt>
        {item.localCurrency !== base && (
          <Txt muted mono>
            ≈ {money(item.baseAmount, base)}
            {item.fxRate ? ` · rate ${Number(item.fxRate).toFixed(5)}` : ""}
          </Txt>
        )}
        <Txt muted size={13}>
          {item.wallet?.name && item.wallet.id !== "__external__" ? item.wallet.name : "No wallet"}
          {item.metadata?.sourceTransactionId ? " · From bank" : ""}
        </Txt>
      </Card>
      {detached && (
        <Banner
          tone="red"
          icon="alert-circle-outline"
          message={`Bank transaction ${detached.reason === "split" ? "was split" : detached.reason === "direction_changed" ? "changed direction" : "was removed"}. Relink or delete this entry.`}
        />
      )}
    </>
  );
}
