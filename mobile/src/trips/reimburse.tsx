import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { useApi, useResource } from "../api";
import {
  Banner,
  Button,
  Card,
  Checkbox,
  Choice,
  DateField,
  Empty,
  fmtDate,
  Group,
  Heading,
  IconButton,
  Input,
  KeyValue,
  money,
  Pill,
  Screen,
  SearchBar,
  Section,
  Sheet,
  State,
  styles,
  toast,
  Txt,
  useTheme,
} from "../ui";

const round2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;
/** Choose the trip spending a trip reimbursement pays back, in the trip's base currency. */
export function TripReimbursementScreen({ route, navigation }: any) {
  const { tripId, item } = route.params;
  const { call } = useApi();
  const { colors } = useTheme();
  const trip = useResource("getTrip", tripId);
  const base = trip.data?.baseCurrency || route.params.trip?.baseCurrency || "SGD";
  const linkage = item.metadata?.linkage || null;
  const foreign = String(item.localCurrency).toUpperCase() !== base;
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<any>({});
  const [showFilters, setShowFilters] = useState(false);
  const [sameAmount, setSameAmount] = useState(false);
  const [offset, setOffset] = useState(0);
  const [known, setKnown] = useState<Record<string, any>>({});
  const [alloc, setAlloc] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (linkage?.reimbursesAllocations || [])
        .filter((a: any) => typeof a.transactionId === "string")
        .map((a: any) => [a.transactionId, String(a.amountBase ?? a.amount)]),
    ),
  );
  const [baseAmount, setBaseAmount] = useState(
    linkage?.reimbursementBaseAmount ? String(linkage.reimbursementBaseAmount) : foreign ? "" : String(item.localAmount),
  );
  const [fxRate, setFxRate] = useState(linkage?.reimbursingFxRate ? String(linkage.reimbursingFxRate) : "");
  const [leftover, setLeftover] = useState(linkage?.leftoverCategoryId || "");
  const [sync, setSync] = useState(linkage?.syncToBankLedger === true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const wallets = useResource("getWallets", tripId);
  const categories = useResource("getCategories", { scope: "trips" });
  const total = foreign
    ? Number(baseAmount) > 0
      ? Number(baseAmount)
      : Number(fxRate) > 0
        ? Number(item.localAmount) * Number(fxRate)
        : Number(item.baseAmount)
    : Number(item.localAmount);
  const candidates = useResource("searchTripEntriesForReimbursement", tripId, {
    search: query,
    limit: 30,
    offset,
    excludeEntryId: item.id,
    ...filters,
    ...(sameAmount ? { amountBaseEquals: round2(total) } : {}),
  });
  useEffect(() => {
    const rows = candidates.data?.transactions || [];
    if (rows.length) setKnown((k) => ({ ...k, ...Object.fromEntries(rows.map((r: any) => [r.id, r])) }));
  }, [candidates.data]);
  const allocated = round2(Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0));
  const remaining = round2(total - allocated);
  const toggle = (c: any) =>
    setAlloc((o) => {
      const next = { ...o };
      if (next[c.id] !== undefined) delete next[c.id];
      else next[c.id] = String(round2(Math.max(0, Math.min(Number(c.remainingBase), remaining))));
      return next;
    });
  const save = async () => {
    setError("");
    if (foreign && !(Number(baseAmount) > 0 || Number(fxRate) > 0))
      return setError(`Enter what it's worth in ${base}, or a rate`);
    const entries = Object.entries(alloc).map(([transactionId, v]) => ({ transactionId, amountBase: round2(Number(v)) }));
    if (entries.some((e) => !(e.amountBase > 0))) return setError("Amounts must be above 0");
    if (remaining < -0.005) return setError("You've allocated more than the reimbursement");
    setBusy(true);
    try {
      await call("createTripReimbursementLink", tripId, item.id, {
        reimbursedAllocations: entries,
        leftoverCategoryId: leftover || null,
        reimbursementBaseAmount: foreign && Number(baseAmount) > 0 ? Number(baseAmount) : null,
        reimbursingFxRate: foreign && Number(fxRate) > 0 ? Number(fxRate) : null,
        syncToBankLedger: sync,
      });
      toast(entries.length ? "Reimbursement linked" : "Reimbursement saved without links");
      navigation.goBack();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const rows = candidates.data?.transactions || [];
  const activeFilters = Object.keys(filters).length;
  return (
    <Screen
      footer={
        <>
          {!!error && <Txt tone="red" size={13}>{error}</Txt>}
          <Button title="Save links" icon="link-outline" loading={busy} disabled={busy} onPress={() => void save()} />
        </>
      }
    >
      <Heading title="What does this pay back?" subtitle={`${item.label || item.description} · ${money(item.localAmount, item.localCurrency)}`} />
      {foreign && (
        <Card>
          <Txt muted size={13}>
            This came in as {item.localCurrency}. Say what it was worth in {base}.
          </Txt>
          <View style={[styles.row, { alignItems: "flex-start" }]}>
            <View style={{ flex: 1 }}>
              <Input label={`Worth in ${base}`} value={baseAmount} keyboardType="decimal-pad" onChangeText={setBaseAmount} />
            </View>
            <View style={{ flex: 1 }}>
              <Input label={`${base} per 1 ${item.localCurrency}`} value={fxRate} keyboardType="decimal-pad" onChangeText={setFxRate} />
            </View>
          </View>
        </Card>
      )}
      <Card style={{ gap: 8 }}>
        <KeyValue label="Reimbursement" mono value={money(total, base)} />
        <KeyValue label="Linked" mono value={money(allocated, base)} />
        <KeyValue label="Left over" mono tone={remaining < -0.005 ? "red" : "purple"} value={money(remaining, base)} />
        <Choice
          label="Category for what is left over"
          value={leftover}
          options={[
            { label: "Uncategorized", value: "" },
            ...(categories.data || []).map((c: any) => ({ label: c.name, value: c.id, color: c.color })),
          ]}
          onChange={setLeftover}
        />
        <View style={styles.between}>
          <Txt size={14} style={{ flex: 1 }}>
            Sync to bank ledger (mark the source bank credit as a reimbursement with no targets)
          </Txt>
          <Switch accessibilityLabel="Sync to bank ledger" value={sync} onValueChange={setSync} />
        </View>
      </Card>
      {Object.keys(alloc).length > 0 && (
        <Section title={`Linked (${Object.keys(alloc).length})`}>
          {Object.entries(alloc).map(([id, v]) => {
            const c = known[id];
            const cap = c ? round2(Math.min(Number(c.remainingBase) + (Number(v) || 0), remaining + (Number(v) || 0))) : undefined;
            return (
              <Card key={id} style={{ gap: 8, padding: 14 }}>
                <View style={styles.between}>
                  <View style={{ flex: 1 }}>
                    <Txt bold numberOfLines={1}>
                      {c ? c.label || c.description : "Linked entry"}
                    </Txt>
                    {c && (
                      <Txt muted size={12}>
                        {fmtDate(c.date)} · {money(c.baseAmount, base)}
                      </Txt>
                    )}
                  </View>
                  <IconButton icon="close" size={32} label="Remove" onPress={() => setAlloc((o) => { const n = { ...o }; delete n[id]; return n; })} />
                </View>
                <View style={[styles.row, { gap: 8 }]}>
                  <View style={{ flex: 1 }}>
                    <Input value={v} keyboardType="decimal-pad" accessibilityLabel="Amount" onChangeText={(x: string) => setAlloc((o) => ({ ...o, [id]: x }))} />
                  </View>
                  {cap != null && <Button title="Max" compact secondary onPress={() => setAlloc((o) => ({ ...o, [id]: String(Math.max(0, cap)) }))} />}
                </View>
              </Card>
            );
          })}
        </Section>
      )}
      <Section title="Trip spending">
        <View style={[styles.row, { gap: 8 }]}>
          <View style={{ flex: 1 }}>
            <SearchBar value={search} onChangeText={setSearch} placeholder="Search spending" />
          </View>
          <IconButton icon="options-outline" label="Filters" tone={activeFilters ? "purple" : "neutral"} onPress={() => setShowFilters(true)} />
        </View>
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: sameAmount }} onPress={() => setSameAmount(!sameAmount)} style={[styles.row, { gap: 8 }]}>
          <Checkbox checked={sameAmount} />
          <Txt size={14}>Same amount as this reimbursement</Txt>
        </Pressable>
        <State {...candidates} />
        {candidates.data && rows.length === 0 && (
          <Card>
            <Empty icon="search-outline" title="No matching spending" />
          </Card>
        )}
        <Group>
          {rows.map((c: any) => {
            const on = alloc[c.id] !== undefined;
            const full = Number(c.remainingBase) <= 0.005 && !on;
            return (
              <Pressable
                key={c.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: full }}
                accessibilityLabel={c.label || c.description}
                disabled={full}
                onPress={() => toggle(c)}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, opacity: full ? 0.5 : 1, backgroundColor: on ? colors.tint : "transparent" }}
              >
                <Checkbox checked={on} />
                <View style={{ flex: 1 }}>
                  <Txt bold numberOfLines={1}>
                    {c.label || c.description}
                  </Txt>
                  <Txt muted size={12}>
                    {fmtDate(c.date)} · {c.wallet?.name || "No wallet"}
                    {c.category?.name ? ` · ${c.category.name}` : ""}
                  </Txt>
                </View>
                <View style={{ alignItems: "flex-end", gap: 2 }}>
                  <Txt mono size={13}>
                    {money(c.baseAmount, base)}
                  </Txt>
                  {full ? <Pill label="Fully allocated" /> : <Txt muted size={11}>{money(c.remainingBase, base)} free</Txt>}
                </View>
              </Pressable>
            );
          })}
        </Group>
        {candidates.data && candidates.data.total > 30 && (
          <View style={styles.row}>
            <Button title="Previous" compact secondary style={{ flex: 1 }} disabled={!offset} onPress={() => setOffset(Math.max(0, offset - 30))} />
            <Button title="Next" compact secondary style={{ flex: 1 }} disabled={offset + 30 >= candidates.data.total} onPress={() => setOffset(offset + 30)} />
          </View>
        )}
      </Section>
      <Sheet
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        title="Filter spending"
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
          options={[{ label: "All wallets", value: "" }, ...(wallets.data || []).map((w: any) => ({ label: w.name, value: w.id, color: w.color }))]}
          onChange={(walletId) => setFilters(({ walletId: _, ...o }: any) => (walletId ? { ...o, walletId } : o))}
        />
        <Choice
          label="Category"
          value={filters.categoryId || ""}
          options={[{ label: "All categories", value: "" }, ...(categories.data || []).map((c: any) => ({ label: c.name, value: c.id, color: c.color }))]}
          onChange={(categoryId) => setFilters(({ categoryId: _, ...o }: any) => (categoryId ? { ...o, categoryId } : o))}
        />
        <DateField label="From" value={filters.dateFrom || ""} onChange={(dateFrom) => setFilters(({ dateFrom: _, ...o }: any) => (dateFrom ? { ...o, dateFrom } : o))} />
        <DateField label="To" value={filters.dateTo || ""} onChange={(dateTo) => setFilters(({ dateTo: _, ...o }: any) => (dateTo ? { ...o, dateTo } : o))} />
      </Sheet>
    </Screen>
  );
}
