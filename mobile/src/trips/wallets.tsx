import React, { useEffect, useState } from "react";
import { RefreshControl, View } from "react-native";
import { useApi, useResource } from "../api";
import {
  Banner,
  Button,
  Card,
  Checkbox,
  Choice,
  ColorField,
  confirm,
  DateField,
  Empty,
  fmtDate,
  Group,
  Heading,
  Input,
  KeyValue,
  ListItem,
  money,
  notice,
  PALETTE,
  Pill,
  Screen,
  SearchBar,
  Section,
  Segmented,
  Sheet,
  Stat,
  StatGrid,
  State,
  styles,
  toast,
  Txt,
} from "../ui";
import { isViewer, ViewerBanner } from "./common";
import { FundingPropagation } from "./funding";
import { WalletCard } from "./trip";

export function WalletsScreen({ route, navigation }: any) {
  const { tripId } = route.params;
  const trip = useResource("getTrip", tripId);
  const t = trip.data || route.params.trip;
  const summaries = useResource("getTripWalletSummaries", tripId);
  const wallets = useResource("getTripWallets", tripId);
  const base = t?.baseCurrency || "SGD";
  const viewer = isViewer(t);
  const accountOf = (id: string) => (wallets.data || []).find((w: any) => w.id === id)?.accountName;
  return (
    <Screen refreshControl={<RefreshControl refreshing={summaries.loading && !!summaries.data} onRefresh={() => { void summaries.reload(); void wallets.reload(); }} />}>
      <Heading title="Wallets" subtitle={t?.name} />
      <ViewerBanner trip={t} />
      {!viewer && (
        <View style={styles.row}>
          <Button title="Carry over" compact secondary icon="return-up-forward-outline" style={{ flex: 1 }} onPress={() => navigation.navigate("CarryOver", { tripId, trip: t })} />
          <Button title="Accounts" compact secondary icon="albums-outline" style={{ flex: 1 }} onPress={() => navigation.navigate("WalletAccounts", { tripId })} />
        </View>
      )}
      <State {...summaries} />
      {summaries.data?.length === 0 && (
        <Card>
          <Empty icon="wallet-outline" title="No wallets yet" message="Wallets are created by statement imports, funding and carry-over." />
        </Card>
      )}
      {(summaries.data || []).map((w: any) => (
        <Card key={w.id} onPress={() => navigation.navigate("Wallet", { tripId, trip: t, walletId: w.id })} accessibilityLabel={w.name} style={{ borderLeftWidth: 3, borderLeftColor: w.color }}>
          <View style={styles.between}>
            <View style={{ flex: 1 }}>
              <Txt bold size={17}>
                {w.name}
              </Txt>
              <Txt muted size={13}>
                {w.currency} · {accountOf(w.id) ? `${accountOf(w.id)} account` : "No account"}
              </Txt>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              {(w.balances || []).map((b: any) => (
                <Txt key={b.currency} mono size={16} tone={b.amount < 0 ? "red" : undefined}>
                  {money(b.amount, b.currency)}
                </Txt>
              ))}
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {w.intrinsicFxRate != null && w.currency !== base && <Pill label={`FX ${Number(w.intrinsicFxRate).toFixed(6)}`} />}
            {w.intrinsicBaseValue != null && <Pill tone="purple" label={`≈ ${money(w.intrinsicBaseValue, base)}`} />}
          </View>
        </Card>
      ))}
    </Screen>
  );
}
export function WalletScreen({ route, navigation }: any) {
  const { tripId, walletId } = route.params;
  const { call } = useApi();
  const trip = useResource("getTrip", tripId);
  const t = trip.data || route.params.trip;
  const base = t?.baseCurrency || "SGD";
  const viewer = isViewer(t);
  const summaries = useResource("getTripWalletSummaries", tripId);
  const wallets = useResource("getTripWallets", tripId);
  const accounts = useResource("getWalletAccounts");
  const fundings = useResource("getTripFundings", tripId);
  const entries = useResource("getTripEntries", tripId, { walletId, limit: 200 });
  const summary = (summaries.data || []).find((w: any) => w.id === walletId);
  const wallet = (wallets.data || []).find((w: any) => w.id === walletId);
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [accountId, setAccountId] = useState<string>("");
  const [newAccount, setNewAccount] = useState("");
  const [mode, setMode] = useState<"weighted" | "manual">("weighted");
  const [rate, setRate] = useState("");
  const [result, setResult] = useState<any>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [topUp, setTopUp] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (wallet) {
      setName(wallet.name);
      setColor(wallet.color);
      setAccountId(wallet.accountId || "");
    }
  }, [wallet?.id, wallet?.name, wallet?.color, wallet?.accountId]);
  if (!wallet || !summary)
    return (
      <Screen>
        <State {...wallets} />
      </Screen>
    );
  const linkedFundings = (fundings.data || []).filter((f: any) => f.walletId === walletId);
  const fundingOuts = (entries.data?.items || []).filter((e: any) => e.type === "funding_out");
  const entryCount = (entries.data?.items || []).filter((e: any) => e.type !== "funding_in").length;
  const inUse = entryCount + linkedFundings.length > 0;
  const changed =
    name.trim() !== wallet.name || color !== wallet.color || (accountId || "") !== (wallet.accountId || "");
  const reload = async () => {
    await Promise.all([summaries.reload(), wallets.reload(), fundings.reload(), entries.reload(), accounts.reload()]);
  };
  const saveSettings = async () => {
    setBusy(true);
    try {
      let target = accountId;
      if (accountId === "__new__") {
        if (!newAccount.trim()) throw new Error("Name the new account");
        const created = await call("createWalletAccount", { name: newAccount.trim(), color });
        target = created.id;
      }
      await call("updateTripWallet", tripId, walletId, {
        ...(name.trim() !== wallet.name ? { name: name.trim() } : {}),
        ...(color !== wallet.color ? { color } : {}),
        ...((target || "") !== (wallet.accountId || "") ? { accountId: target || null } : {}),
      });
      setNewAccount("");
      toast("Wallet saved");
      await reload();
    } catch (e) {
      notice(e);
    } finally {
      setBusy(false);
    }
  };
  const recalc = async () => {
    if (mode === "manual" && !(Number(rate) > 0)) return notice(new Error("Enter a rate above 0"));
    setBusy(true);
    try {
      const r = await call("recalculateWalletEntriesToBase", tripId, walletId, {
        mode,
        fxRate: mode === "manual" ? Number(rate) : null,
      });
      setResult(r);
      toast(`Updated ${r.updatedCount} entries`);
      await reload();
    } catch (e) {
      notice(e);
    } finally {
      setBusy(false);
    }
  };
  const sameCurrency = (wallets.data || []).filter((w: any) => w.id !== walletId && w.currency === wallet.currency);
  return (
    <Screen refreshControl={<RefreshControl refreshing={false} onRefresh={() => void reload()} />}>
      <WalletCard wallet={summary} base={base} />
      <ViewerBanner trip={t} />
      <StatGrid>
        <Stat
          label={`Rate to ${base}`}
          value={summary.intrinsicFxRate != null ? Number(summary.intrinsicFxRate).toFixed(6) : "—"}
          detail="Weighted from funding"
        />
        <Stat
          tone="green"
          label="Value"
          value={summary.intrinsicBaseValue != null ? money(summary.intrinsicBaseValue, base) : "—"}
          detail={`In ${base}`}
        />
      </StatGrid>
      {!viewer && (
        <Section title="Settings">
          <Card>
            <Input label="Name" value={name} onChangeText={setName} />
            <KeyValue label="Currency" value={wallet.currency} />
            <Choice
              label="Account"
              value={accountId}
              options={[
                { label: "No account", value: "" },
                ...(accounts.data || [])
                  .filter((a: any) => !a.archivedAt || a.id === wallet.accountId)
                  .map((a: any) => ({ label: `${a.name}${a.archivedAt ? " (archived)" : ""}`, value: a.id, color: a.color })),
                { label: "New account…", value: "__new__" },
              ]}
              onChange={setAccountId}
            />
            {accountId === "__new__" && <Input label="New account name" value={newAccount} onChangeText={setNewAccount} placeholder="e.g. Revolut" />}
            <ColorField label="Color" value={color} onChange={setColor} />
            <Button title="Save wallet" compact loading={busy} disabled={busy || (!changed && accountId !== "__new__")} onPress={() => void saveSettings()} />
          </Card>
        </Section>
      )}
      {!viewer && (
        <Section title="Revalue spending" hint={`Recalculates this wallet's spending in ${base}. Entries with a locked value keep it.`}>
          <Card>
            <Segmented values={["weighted", "manual"]} labels={{ weighted: "From funding", manual: "Manual rate" }} value={mode} onChange={(v) => setMode(v as any)} />
            {mode === "manual" && (
              <Input label={`${base} per 1 ${wallet.currency}`} value={rate} keyboardType="decimal-pad" onChangeText={setRate} />
            )}
            <Button title="Recalculate" compact secondary icon="refresh" loading={busy} disabled={busy} onPress={() => void recalc()} />
            {result && (
              <>
                <Txt size={13}>
                  Updated {result.updatedCount} entries at {Number(result.fxRate).toFixed(6)}.
                </Txt>
                <FundingPropagation trace={result.propagationTrace} />
              </>
            )}
          </Card>
        </Section>
      )}
      <Section title="Funding in" action={viewer ? undefined : "Top up from bank"} onAction={() => setTopUp(true)}>
        {linkedFundings.length === 0 ? (
          <Card>
            <Empty icon="wallet-outline" title="No funding linked" />
          </Card>
        ) : (
          <Group>
            {linkedFundings.map((f: any) => (
              <ListItem
                key={f.id}
                icon="arrow-down"
                tone="green"
                title={f.metadata?.originalDescription || f.bankTransaction?.description || "Funding"}
                subtitle={`${fmtDate(f.metadata?.originalDate || f.createdAt)} · ${money(f.sourceAmount, f.sourceCurrency)} → ${money(f.destinationAmount, f.destinationCurrency)}${f.metadata?.detachedBankTransaction ? " · bank row removed" : ""}`}
                onPress={() => navigation.navigate("Funding", { tripId, trip: t, fundingId: f.id })}
              />
            ))}
          </Group>
        )}
      </Section>
      {fundingOuts.length > 0 && (
        <Section title="Funding out">
          <Group>
            {fundingOuts.map((e: any) => (
              <ListItem
                key={e.id}
                icon="arrow-up"
                tone="amber"
                title={e.label || e.description}
                subtitle={fmtDate(e.date)}
                value={`−${money(e.localAmount, e.localCurrency)}`}
                onPress={() => navigation.navigate("TripEntry", { tripId, trip: t, item: e })}
              />
            ))}
          </Group>
        </Section>
      )}
      {!viewer && (
        <Section title="Merge or delete">
          <Card>
            <Choice
              label={`Merge into another ${wallet.currency} wallet`}
              value={mergeTarget}
              options={sameCurrency.map((w: any) => ({ label: w.name, value: w.id, color: w.color }))}
              onChange={setMergeTarget}
            />
            {sameCurrency.length === 0 && <Txt muted size={12}>No other {wallet.currency} wallet to merge into.</Txt>}
            <Button
              title="Merge wallet"
              compact
              secondary
              disabled={!mergeTarget}
              onPress={() => {
                const target = sameCurrency.find((w: any) => w.id === mergeTarget);
                confirm(
                  "Merge wallets?",
                  `All entries and funding in ${wallet.name} move to ${target?.name}, and ${wallet.name} is deleted. ${target?.name}'s rate is then recalculated.`,
                  async () => {
                    await call("mergeTripWallet", tripId, walletId, mergeTarget);
                    toast("Wallets merged");
                    navigation.goBack();
                  },
                  "Merge",
                );
              }}
            />
            <Button
              title="Delete wallet"
              compact
              secondary
              danger
              icon="trash-outline"
              disabled={inUse || entries.loading}
              onPress={() =>
                confirm("Delete wallet?", `${wallet.name} will be removed.`, async () => {
                  await call("deleteTripWallet", tripId, walletId);
                  toast("Wallet deleted");
                  navigation.goBack();
                }, "Delete")
              }
            />
            {inUse && (
              <Txt muted size={12}>
                This wallet has {entryCount} entries and {linkedFundings.length} fundings. Merge it into another wallet instead.
              </Txt>
            )}
          </Card>
        </Section>
      )}
      <TopUpSheet
        visible={topUp}
        onClose={() => setTopUp(false)}
        tripId={tripId}
        wallet={wallet}
        base={base}
        onDone={async () => {
          setTopUp(false);
          await reload();
        }}
      />
    </Screen>
  );
}
/** Add funding from one bank debit, then revalue the wallet at its weighted rate. */
function TopUpSheet({ visible, onClose, tripId, wallet, base, onDone }: any) {
  const { call } = useApi();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<any>(null);
  const [inputMode, setInputMode] = useState<"amount" | "fxRate">("amount");
  const [dest, setDest] = useState("");
  const [fx, setFx] = useState("");
  const [fee, setFee] = useState("");
  const [feeCurrency, setFeeCurrency] = useState("");
  const [busy, setBusy] = useState(false);
  const candidates = useResource(visible ? "getSourceTransactionCandidates" : "", tripId, { search, limit: 30 });
  const rows = (candidates.data?.transactions || []).filter((c: any) => Number(c.amountOut || 0) > 0);
  const submit = async () => {
    if (!picked) return notice(new Error("Choose a bank transaction"));
    const source = Number(picked.amountOut);
    const destination = inputMode === "fxRate" ? source / Number(fx) : Number(dest) || source;
    if (!(destination > 0) || !Number.isFinite(destination)) return notice(new Error("Enter the amount received or a rate"));
    if (Number(fee) < 0) return notice(new Error("The fee cannot be negative"));
    setBusy(true);
    try {
      await call("createTripFunding", tripId, {
        walletId: wallet.id,
        bankTransactionId: picked.id,
        sourceType: "bank_wallet_topup",
        sourceCurrency: base,
        sourceAmount: source,
        destinationCurrency: wallet.currency,
        destinationAmount: destination,
        fxRate: base === wallet.currency ? 1 : source / destination,
        feeAmount: Number(fee) > 0 ? Number(fee) : null,
        feeCurrency: Number(fee) > 0 ? (feeCurrency || base).toUpperCase() : null,
        metadata: { linkedFrom: "wallet_page" },
      });
      await call("recalculateWalletEntriesToBase", tripId, wallet.id, { mode: "weighted" });
      toast("Funding added and wallet revalued");
      setPicked(null);
      await onDone();
    } catch (e) {
      notice(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={`Top up ${wallet.name}`}
      subtitle="Pick the bank debit that paid for it."
      footer={<Button title="Add funding + rebalance" loading={busy} disabled={busy || !picked} onPress={() => void submit()} />}
    >
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search bank transactions" />
      <Group>
        {rows.slice(0, 30).map((c: any) => (
          <ListItem
            key={c.id}
            left={<Checkbox checked={picked?.id === c.id} />}
            title={c.label || c.description}
            subtitle={fmtDate(c.date)}
            value={money(c.amountOut, base)}
            chevron={false}
            onPress={() => setPicked(c)}
          />
        ))}
      </Group>
      {rows.length === 0 && !candidates.loading && <Txt muted>No unused bank debits found.</Txt>}
      {picked && (
        <Card>
          <Segmented values={["amount", "fxRate"]} labels={{ amount: "Amount received", fxRate: "Rate" }} value={inputMode} onChange={(v) => setInputMode(v as any)} />
          {inputMode === "amount" ? (
            <Input label={`Received in ${wallet.currency}`} value={dest} keyboardType="decimal-pad" placeholder={String(picked.amountOut)} onChangeText={setDest} />
          ) : (
            <Input label={`${base} per 1 ${wallet.currency}`} value={fx} keyboardType="decimal-pad" onChangeText={setFx} />
          )}
          <View style={[styles.row, { alignItems: "flex-start" }]}>
            <View style={{ flex: 1 }}>
              <Input label="Fee" value={fee} keyboardType="decimal-pad" placeholder="0" onChangeText={setFee} />
            </View>
            <View style={{ width: 110 }}>
              <Input label="Currency" value={feeCurrency} placeholder={base} autoCapitalize="characters" maxLength={3} onChangeText={(v: string) => setFeeCurrency(v.toUpperCase())} />
            </View>
          </View>
        </Card>
      )}
    </Sheet>
  );
}
export function WalletAccountsScreen() {
  const { call } = useApi();
  const accounts = useResource("getWalletAccounts");
  const [editing, setEditing] = useState<any>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const open = (a: any) => {
    setEditing(a || { id: "" });
    setName(a?.name || "");
    setColor(a?.color || PALETTE[Math.floor(Math.random() * PALETTE.length)]);
  };
  const save = async () => {
    try {
      if (editing.id) await call("updateWalletAccount", editing.id, { name: name.trim(), color });
      else await call("createWalletAccount", { name: name.trim(), color });
      toast("Account saved");
      setEditing(null);
      await accounts.reload();
    } catch (e) {
      notice(e);
    }
  };
  return (
    <Screen>
      <Heading
        title="Wallet accounts"
        right={<Button title="Add" compact icon="add" onPress={() => open(null)} />}
      />
      <State {...accounts} />
      {accounts.data?.length === 0 && (
        <Card>
          <Empty icon="albums-outline" title="No accounts yet" message="Add one for each card or app you travel with, like Revolut or YouTrip." />
        </Card>
      )}
      <Group>
        {(accounts.data || []).map((a: any) => (
          <ListItem
            key={a.id}
            icon="albums-outline"
            color={a.color}
            title={a.name}
            subtitle={`${a.walletCount} wallet${a.walletCount === 1 ? "" : "s"}${a.archivedAt ? " · archived" : ""}`}
            onPress={() => open(a)}
          />
        ))}
      </Group>
      <Sheet
        visible={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Edit account" : "New account"}
        footer={
          <>
            <Button title="Save" disabled={!name.trim()} onPress={() => void save()} />
            {editing?.id && (
              <Button
                title={editing.archivedAt ? "Unarchive" : "Archive"}
                ghost
                onPress={() =>
                  void call("updateWalletAccount", editing.id, { archived: !editing.archivedAt })
                    .then(() => {
                      toast(editing.archivedAt ? "Account restored" : "Account archived");
                      setEditing(null);
                      return accounts.reload();
                    })
                    .catch(notice)
                }
              />
            )}
          </>
        }
      >
        <Input label="Name" value={name} onChangeText={setName} placeholder="e.g. Revolut" />
        <ColorField label="Color" value={color} onChange={setColor} />
        {editing?.id && <Txt muted size={12}>Renaming an account can rename its wallets too.</Txt>}
      </Sheet>
    </Screen>
  );
}
export function CarryOverScreen({ route, navigation }: any) {
  const { tripId } = route.params;
  const { call } = useApi();
  const trip = useResource("getTrip", tripId);
  const t = trip.data || route.params.trip;
  const trips = useResource("getTrips");
  const [source, setSource] = useState(route.params.sourceTripId || "");
  const [date, setDate] = useState("");
  const [rows, setRows] = useState<Record<string, { on: boolean; amount: string; fxRate: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const candidates = useResource(source ? "getCarryOverCandidates" : "", tripId, source);
  useEffect(() => {
    if (!date && t?.startDate) setDate(String(t.startDate).slice(0, 10));
  }, [t?.startDate, date]);
  useEffect(() => {
    setRows(
      Object.fromEntries(
        (candidates.data?.candidates || []).map((c: any) => [c.sourceWalletId, { on: true, amount: String(c.balance), fxRate: "" }]),
      ),
    );
  }, [candidates.data]);
  const base = t?.baseCurrency || "SGD";
  const list: any[] = candidates.data?.candidates || [];
  const submit = async () => {
    setError("");
    const items = [];
    for (const c of list) {
      const r = rows[c.sourceWalletId];
      if (!r?.on) continue;
      const amount = Number(r.amount);
      if (!(amount > 0)) return setError(`Enter an amount above 0 for ${c.name}`);
      if (amount > Number(c.balance) + 0.005) return setError(`${c.name} only holds ${money(c.balance, c.currency)}`);
      if (c.fxRate === null && !(Number(r.fxRate) > 0)) return setError(`Enter a rate for ${c.name}`);
      items.push({
        sourceWalletId: c.sourceWalletId,
        amount,
        destinationWalletId: c.destinationWalletId,
        fxRate: c.fxRate === null ? Number(r.fxRate) : null,
      });
    }
    if (!items.length) return setError("Choose at least one wallet");
    setBusy(true);
    try {
      const result = await call("carryOverWallets", tripId, { sourceTripId: source, date: date || null, items });
      toast(`Carried over ${result.created?.length || items.length} wallet${items.length === 1 ? "" : "s"}`);
      navigation.goBack();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen
      footer={
        <>
          {!!error && <Txt tone="red" size={13}>{error}</Txt>}
          <Button title="Carry over" icon="return-up-forward-outline" loading={busy} disabled={busy || !list.length || candidates.data?.sameBaseCurrency === false} onPress={() => void submit()} />
        </>
      }
    >
      <Heading title="Bring leftover money" subtitle={`Move unspent wallet balances into ${t?.name || "this trip"}.`} />
      <Card>
        <Choice
          label="From trip"
          value={source}
          options={(trips.data || [])
            .filter((x: any) => x.id !== tripId)
            .map((x: any) => ({ label: x.name, value: x.id, hint: `${x.baseCurrency} · ${fmtDate(x.startDate)}` }))}
          onChange={setSource}
        />
        <DateField label="Date" value={date} onChange={setDate} />
      </Card>
      {source && <State {...candidates} />}
      {candidates.data?.sameBaseCurrency === false && (
        <Banner tone="amber" icon="alert-circle-outline" message="Carry-over only works between trips with the same base currency." />
      )}
      {candidates.data && list.length === 0 && (
        <Card>
          <Empty icon="wallet-outline" title="Nothing left over" message="That trip's wallets are empty." />
        </Card>
      )}
      {list.map((c) => {
        const r = rows[c.sourceWalletId] || { on: false, amount: "", fxRate: "" };
        const set = (patch: any) => setRows((o) => ({ ...o, [c.sourceWalletId]: { ...r, ...patch } }));
        return (
          <Card key={c.sourceWalletId} style={{ opacity: r.on ? 1 : 0.6 }}>
            <View style={styles.row}>
              <Checkbox checked={r.on} label={`Carry over ${c.name}`} onChange={(on) => set({ on })} />
              <View style={{ flex: 1 }}>
                <Txt bold>{c.name}</Txt>
                <Txt muted size={12}>
                  {money(c.balance, c.currency)}
                  {c.baseValue != null && c.currency !== base ? ` ≈ ${money(c.baseValue, base)}` : ""}
                </Txt>
              </View>
            </View>
            <Txt muted size={12}>
              {c.currency === base ? "Base currency" : c.fxRate !== null ? `1 ${c.currency} = ${Number(c.fxRate).toFixed(6)} ${base}` : "No funding to value it, so enter a rate"} ·{" "}
              {c.destinationWalletId ? "Goes into the matching wallet" : `Creates a new ${c.currency} wallet`}
            </Txt>
            {r.on && (
              <View style={[styles.row, { alignItems: "flex-start" }]}>
                <View style={{ flex: 1 }}>
                  <Input label={`Amount (${c.currency})`} value={r.amount} keyboardType="decimal-pad" onChangeText={(amount: string) => set({ amount })} />
                </View>
                {c.fxRate === null && (
                  <View style={{ flex: 1 }}>
                    <Input label={`${base} per 1 ${c.currency}`} value={r.fxRate} keyboardType="decimal-pad" onChangeText={(fxRate: string) => set({ fxRate })} />
                  </View>
                )}
              </View>
            )}
          </Card>
        );
      })}
    </Screen>
  );
}
