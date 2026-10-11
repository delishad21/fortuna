import React, { useEffect, useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { useApi, useResource } from "../api";
import {
  ActionMenu,
  Banner,
  Button,
  Card,
  Checkbox,
  Choice,
  confirm,
  Empty,
  fmtDate,
  Group,
  Heading,
  humanize,
  IconBubble,
  Input,
  KeyValue,
  ListItem,
  money,
  notice,
  Pill,
  Screen,
  SearchBar,
  Section,
  Segmented,
  State,
  styles,
  toast,
  Txt,
  useTheme,
} from "../ui";
import { normalizeFundingEditInput } from "../../../frontend/shared/fundingMath";
import { isViewer, positiveOrNull, ViewerBanner } from "./common";

export const isPendingReview = (f: any) => {
  if (f.bankTransactionId) return false;
  if (f.metadata?.detachedBankTransaction) return true;
  if (!["imported_topup", "opening_balance"].includes(f.sourceType)) return false;
  const status = String(f.metadata?.matchReviewStatus || "pending");
  return status === "pending" || status === "unmatched";
};
const fundingTitle = (f: any) =>
  f.metadata?.originalDescription ||
  (f.sourceType === "opening_balance"
    ? "Opening balance"
    : f.sourceType === "imported_topup"
      ? "Imported top-up"
      : f.sourceType === "manual"
        ? "Manual funding"
        : f.sourceType === "wallet_conversion"
          ? "Wallet conversion"
          : "Funding");
export function FundingPropagation({ trace }: any) {
  if (!trace) return null;
  const traces = Array.isArray(trace) ? trace : [trace];
  const wallets = traces.reduce((s: number, t: any) => s + Number(t.totalWalletRecalculations || 0), 0);
  const rows = traces.reduce((s: number, t: any) => s + Number(t.totalFundingRowsUpdated || 0), 0);
  if (!wallets && !rows) return null;
  return (
    <Banner
      tone="blue"
      icon="git-network-outline"
      message={`${wallets} wallet${wallets === 1 ? "" : "s"} revalued · ${rows} linked funding row${rows === 1 ? "" : "s"} updated${traces.some((t: any) => t.truncated) ? " (trace truncated)" : ""}.`}
    />
  );
}
function FundingRow({ f, onPress }: any) {
  const pending = isPendingReview(f);
  return (
    <ListItem
      icon={f.bankTransactionId ? "business-outline" : "wallet-outline"}
      tone={pending ? "amber" : "green"}
      title={fundingTitle(f)}
      subtitle={`${fmtDate(f.metadata?.originalDate || f.bankTransaction?.date || f.createdAt)} · ${f.wallet?.name || "No wallet"}${f.metadata?.detachedBankTransaction ? " · bank row removed" : pending ? " · needs a bank match" : f.bankTransaction ? " · linked" : ""}`}
      value={`+${money(f.destinationAmount, f.destinationCurrency)}`}
      valueTone="green"
      detail={f.sourceCurrency !== f.destinationCurrency ? money(f.sourceAmount, f.sourceCurrency) : undefined}
      onPress={onPress}
    />
  );
}
export function FundingListScreen({ route, navigation }: any) {
  const { tripId } = route.params;
  const trip = useResource("getTrip", tripId);
  const t = trip.data || route.params.trip;
  const viewer = isViewer(t);
  const fundings = useResource("getTripFundings", tripId);
  const outs = useResource("getTripEntries", tripId, { type: "funding_out", limit: 200 });
  const pending = (fundings.data || []).filter(isPendingReview).length;
  const params = { tripId, trip: t };
  return (
    <Screen refreshControl={<RefreshControl refreshing={fundings.loading && !!fundings.data} onRefresh={() => { void fundings.reload(); void outs.reload(); }} />}>
      <Heading
        title="Funding"
        subtitle="Money moving into and out of your trip wallets."
        right={
          !viewer ? (
            <ActionMenu
              icon="add"
              label="Add funding"
              title="Add funding"
              actions={[
                { label: "Manual funding", icon: "create-outline", onPress: () => navigation.navigate("Funding", { ...params, mode: "manual" }) },
                { label: "From bank transactions", icon: "business-outline", onPress: () => navigation.navigate("Funding", { ...params, mode: "bank" }) },
                { label: "From another trip", icon: "airplane-outline", onPress: () => navigation.navigate("BankPicker", { tripId, mode: "outgoing" }) },
              ]}
            />
          ) : undefined
        }
      />
      <ViewerBanner trip={t} />
      {pending > 0 && !viewer && (
        <Banner
          tone="amber"
          icon="git-compare-outline"
          title={`${pending} funding ${pending === 1 ? "row needs" : "rows need"} review`}
          message="Match imported top-ups and opening balances to bank transactions."
          action="Start review"
          onAction={() => navigation.navigate("FundingReview", params)}
        />
      )}
      <State {...fundings} />
      <Section title="Funding in">
        {fundings.data?.length === 0 && (
          <Card>
            <Empty icon="wallet-outline" title="No funding yet" message="Record the money you moved into trip wallets." />
          </Card>
        )}
        {(fundings.data || []).length > 0 && (
          <Group>
            {fundings.data.map((f: any) => (
              <FundingRow key={f.id} f={f} onPress={() => navigation.navigate("Funding", { ...params, fundingId: f.id })} />
            ))}
          </Group>
        )}
      </Section>
      <Section title="Funding out">
        {(outs.data?.items || []).length === 0 ? (
          <Card>
            <Empty icon="arrow-up-outline" title="Nothing moved out" message="Funding out shows money sent back to the bank or to other trips and wallets." />
          </Card>
        ) : (
          <Group>
            {outs.data.items.map((e: any) => (
              <ListItem
                key={e.id}
                icon="arrow-up-outline"
                tone="amber"
                title={e.label || e.description}
                subtitle={`${fmtDate(e.date)} · ${e.wallet?.name || "No wallet"}${e.metadata?.fundingOut?.destinationType ? ` → ${humanize(e.metadata.fundingOut.destinationType)}` : ""}`}
                value={`−${money(e.localAmount, e.localCurrency)}`}
                onPress={() => navigation.navigate("TripEntry", { ...params, item: e })}
              />
            ))}
          </Group>
        )}
      </Section>
    </Screen>
  );
}
type FeeMode = "none" | "amount" | "percent";
export function FundingScreen({ route, navigation }: any) {
  const { tripId, fundingId } = route.params;
  const fundings = useResource("getTripFundings", tripId);
  const trip = useResource("getTrip", tripId);
  const t = trip.data || route.params.trip;
  const funding = fundingId ? (fundings.data || []).find((f: any) => f.id === fundingId) : null;
  if (fundingId && !funding)
    return (
      <Screen>
        <State {...fundings} empty={fundings.data ? "This funding row no longer exists." : undefined} />
      </Screen>
    );
  if (!t)
    return (
      <Screen>
        <State {...trip} />
      </Screen>
    );
  return funding ? (
    <FundingDetail funding={funding} trip={t} tripId={tripId} fundings={fundings} navigation={navigation} />
  ) : (
    <FundingCreate trip={t} tripId={tripId} initialMode={route.params.mode || "manual"} navigation={navigation} />
  );
}
function FundingCreate({ trip, tripId, initialMode, navigation }: any) {
  const { call } = useApi();
  const base = trip.baseCurrency;
  const wallets = useResource("getWallets", tripId);
  const [mode, setMode] = useState(initialMode);
  const [walletId, setWalletId] = useState("");
  const [sourceCurrency, setSourceCurrency] = useState(base);
  const [sourceAmount, setSourceAmount] = useState("");
  const [inputMode, setInputMode] = useState<"amount" | "fxRate">("amount");
  const [destinationAmount, setDestinationAmount] = useState("");
  const [fxRate, setFxRate] = useState("");
  const [baseAmount, setBaseAmount] = useState("");
  const [feeMode, setFeeMode] = useState<FeeMode>("none");
  const [feeValue, setFeeValue] = useState("");
  const [feeCurrency, setFeeCurrency] = useState("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [trace, setTrace] = useState<any>(null);
  const candidates = useResource(mode === "bank" ? "getFundingCandidates" : "", tripId, { search, limit: 30 });
  const wallet = (wallets.data || []).find((w: any) => w.id === walletId);
  const destCurrency = wallet?.currency || "";
  const srcCurrency = mode === "bank" ? base : sourceCurrency.toUpperCase();
  const needsBase = !!destCurrency && srcCurrency !== base && destCurrency !== base;
  const submit = async () => {
    setError("");
    if (!wallet) return setError("Choose the wallet the money went into");
    const sources =
      mode === "bank"
        ? picked.map((c) => ({ id: c.id, amount: Math.abs(Number(c.amountOut ?? c.amountIn ?? 0)) }))
        : [{ id: null, amount: Number(sourceAmount) }];
    if (!sources.length) return setError("Choose at least one bank transaction");
    if (sources.some((s) => !(s.amount > 0))) return setError("Enter a source amount above 0");
    if (needsBase && !(Number(baseAmount) > 0)) return setError(`Enter the ${base} value`);
    if (needsBase && sources.length > 1) return setError(`Add one bank transaction at a time when a ${base} value is needed`);
    setBusy(true);
    try {
      const traces: any[] = [];
      for (const s of sources) {
        const fee =
          feeMode === "amount" ? Number(feeValue) || 0 : feeMode === "percent" ? (s.amount * (Number(feeValue) || 0)) / 100 : 0;
        let dest: number;
        let fx: number;
        if (inputMode === "fxRate") {
          fx = Number(fxRate);
          if (!(fx > 0)) throw new Error("Enter an exchange rate above 0");
          dest = s.amount / fx;
        } else {
          dest = Number(destinationAmount) || s.amount;
          fx = srcCurrency === destCurrency ? 1 : s.amount / dest;
        }
        const result = await call("createTripFunding", tripId, {
          walletId: wallet.id,
          bankTransactionId: s.id,
          sourceType: mode === "bank" ? "transfer" : "manual",
          sourceCurrency: srcCurrency,
          sourceAmount: s.amount,
          destinationCurrency: destCurrency,
          destinationAmount: dest,
          fxRate: fx,
          baseAmount: needsBase ? Number(baseAmount) : null,
          feeAmount: fee > 0 ? fee : null,
          feeCurrency: feeMode === "none" || !(fee > 0) ? null : (feeCurrency || base).toUpperCase(),
        });
        traces.push(result?.propagationTrace);
      }
      toast(sources.length > 1 ? `${sources.length} fundings added` : "Funding added");
      setTrace(traces);
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
          <Button title="Add funding" icon="add" loading={busy} disabled={busy} onPress={() => void submit()} />
        </>
      }
    >
      <Heading title="Fund your journey" subtitle="Record money moved into a trip wallet." />
      <Segmented values={["manual", "bank"]} labels={{ manual: "Manual", bank: "From bank" }} value={mode} onChange={setMode} />
      <Card>
        <Choice
          label="Into wallet"
          value={walletId}
          options={(wallets.data || []).map((w: any) => ({ label: `${w.name} · ${w.currency}`, value: w.id, color: w.color }))}
          onChange={setWalletId}
        />
        {(wallets.data || []).length === 0 && (
          <Txt muted size={12}>No wallets yet. Import a statement or carry money over to create one.</Txt>
        )}
        {mode === "manual" && (
          <View style={[styles.row, { alignItems: "flex-start" }]}>
            <View style={{ width: 96 }}>
              <Input label="From" value={sourceCurrency} autoCapitalize="characters" maxLength={3} onChangeText={(v: string) => setSourceCurrency(v.toUpperCase())} />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="Amount sent" value={sourceAmount} keyboardType="decimal-pad" onChangeText={setSourceAmount} />
            </View>
          </View>
        )}
        {!!destCurrency && (
          <>
            <Segmented
              values={["amount", "fxRate"]}
              labels={{ amount: "Amount received", fxRate: "Exchange rate" }}
              value={inputMode}
              onChange={(v) => setInputMode(v as any)}
            />
            {inputMode === "amount" ? (
              <Input
                label={`Received in ${destCurrency}`}
                value={destinationAmount}
                keyboardType="decimal-pad"
                hint="Leave blank if it's the same as the amount sent."
                onChangeText={setDestinationAmount}
              />
            ) : (
              <Input
                label={`${srcCurrency} per 1 ${destCurrency}`}
                value={fxRate}
                keyboardType="decimal-pad"
                onChangeText={setFxRate}
              />
            )}
          </>
        )}
        {needsBase && (
          <Input label={`Value in ${base}`} value={baseAmount} keyboardType="decimal-pad" hint={`Neither currency is ${base}, so enter what it cost you.`} onChangeText={setBaseAmount} />
        )}
      </Card>
      <Card>
        <Txt bold>Fee</Txt>
        <Segmented values={["none", "amount", "percent"]} labels={{ none: "No fee", amount: "Amount", percent: "Percent" }} value={feeMode} onChange={(v) => setFeeMode(v as FeeMode)} />
        {feeMode !== "none" && (
          <View style={[styles.row, { alignItems: "flex-start" }]}>
            <View style={{ flex: 1 }}>
              <Input label={feeMode === "percent" ? "Fee %" : "Fee"} value={feeValue} keyboardType="decimal-pad" onChangeText={setFeeValue} />
            </View>
            <View style={{ width: 110 }}>
              <Input label="Currency" value={feeCurrency} placeholder={base} autoCapitalize="characters" maxLength={3} onChangeText={(v: string) => setFeeCurrency(v.toUpperCase())} />
            </View>
          </View>
        )}
      </Card>
      {mode === "bank" && (
        <Section title={`Bank transactions${picked.length ? ` · ${picked.length} chosen` : ""}`}>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search bank transactions" />
          <State {...candidates} />
          <Group>
            {(candidates.data?.transactions || []).map((c: any) => {
              const on = picked.some((p) => p.id === c.id);
              return (
                <ListItem
                  key={c.id}
                  left={<Checkbox checked={on} />}
                  title={c.label || c.description}
                  subtitle={`${fmtDate(c.date)}${c.accountIdentifier ? ` · ${c.accountIdentifier}` : ""}`}
                  value={money(c.amountOut || c.amountIn)}
                  chevron={false}
                  onPress={() => setPicked((old) => (on ? old.filter((p) => p.id !== c.id) : [...old, c]))}
                />
              );
            })}
          </Group>
        </Section>
      )}
      <FundingPropagation trace={trace} />
    </Screen>
  );
}
function FundingDetail({ funding: f, trip, tripId, fundings, navigation }: any) {
  const { call } = useApi();
  const base = trip.baseCurrency;
  const viewer = isViewer(trip);
  const wallets = useResource("getWallets", tripId);
  const bankLinked = !!f.bankTransactionId;
  const canAttach = !bankLinked && (f.sourceType === "imported_topup" || !!f.metadata?.detachedBankTransaction);
  const [walletId, setWalletId] = useState(f.walletId || "");
  const [sourceCurrency, setSourceCurrency] = useState(f.sourceCurrency);
  const [sourceAmount, setSourceAmount] = useState(String(Number(f.sourceAmount)));
  const [destinationCurrency, setDestinationCurrency] = useState(f.destinationCurrency);
  const [inputMode, setInputMode] = useState<"amount" | "fxRate">("amount");
  const [destinationAmount, setDestinationAmount] = useState(String(Number(f.destinationAmount)));
  const [fxRate, setFxRate] = useState(f.fxRate ? String(Number(f.fxRate)) : "");
  const [feeAmount, setFeeAmount] = useState(f.feeAmount ? String(Number(f.feeAmount)) : "");
  const [feeCurrency, setFeeCurrency] = useState(f.feeCurrency || f.sourceCurrency);
  const [baseAmount, setBaseAmount] = useState(f.baseAmount != null ? String(Number(f.baseAmount)) : "");
  const [merge, setMerge] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [trace, setTrace] = useState<any>(null);
  useEffect(() => {
    const w = (wallets.data || []).find((x: any) => x.id === walletId);
    if (w) setDestinationCurrency(w.currency);
  }, [walletId, wallets.data]);
  const needsBase = sourceCurrency.toUpperCase() !== base && destinationCurrency.toUpperCase() !== base;
  const save = async () => {
    setError("");
    try {
      const n = normalizeFundingEditInput({
        sourceCurrency,
        sourceAmount: Number(sourceAmount),
        destinationCurrency,
        destinationAmountInput: Number(destinationAmount),
        fxRateInput: Number(fxRate),
        inputMode,
        feeAmount: Number(feeAmount) || null,
        feeCurrency: feeCurrency || null,
      });
      if (needsBase && !(Number(baseAmount) > 0)) throw new Error(`Enter the ${base} value`);
      setBusy(true);
      const result = await call("updateTripFunding", tripId, f.id, {
        baseAmount: needsBase ? Number(baseAmount) : null,
        walletId: walletId || null,
        sourceCurrency: n.sourceCurrency,
        sourceAmount: n.sourceAmount,
        destinationCurrency: n.destinationCurrency,
        destinationAmount: n.destinationAmount,
        fxRate: n.fxRate,
        feeAmount: n.feeAmount,
        feeCurrency: n.feeCurrency,
      });
      setTrace(result?.propagationTrace);
      toast("Funding saved");
      await fundings.reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const review = (action: string, bankTransactionId?: string) =>
    void call("reviewTripFundingMatch", tripId, f.id, { action, ...(bankTransactionId ? { bankTransactionId } : {}) })
      .then(() => {
        toast(action === "reject" ? "Match rejected" : "Bank transaction linked");
        return fundings.reload();
      })
      .catch(notice);
  return (
    <Screen
      footer={
        viewer ? undefined : (
          <>
            {!!error && <Txt tone="red" size={13}>{error}</Txt>}
            <Button title="Save funding" icon="checkmark" loading={busy} disabled={busy} onPress={() => void save()} />
          </>
        )
      }
    >
      <Card style={{ alignItems: "center", gap: 6, paddingVertical: 22 }}>
        <Pill label={humanize(f.sourceType)} tone="purple" />
        <Txt bold size={17} style={{ textAlign: "center" }}>
          {fundingTitle(f)}
        </Txt>
        <Txt mono style={{ fontSize: 28, lineHeight: 36 }} tone="green">
          +{money(f.destinationAmount, f.destinationCurrency)}
        </Txt>
        <Txt muted mono size={13}>
          from {money(f.sourceAmount, f.sourceCurrency)}
          {f.fxRate ? ` · rate ${Number(f.fxRate).toFixed(6)}` : ""}
        </Txt>
        {f.baseAmount != null && f.destinationCurrency !== base && (
          <Txt muted size={13}>≈ {money(f.baseAmount, base)}</Txt>
        )}
      </Card>
      <ViewerBanner trip={trip} />
      {f.metadata?.detachedBankTransaction && (
        <Banner tone="red" icon="alert-circle-outline" message="The linked bank transaction was removed. Link another one or delete this funding." />
      )}
      <Section title="Bank transaction">
        {f.bankTransaction ? (
          <Group>
            <ListItem
              icon="business-outline"
              tone="green"
              title={f.bankTransaction.description}
              subtitle={fmtDate(f.bankTransaction.date)}
              value={money(f.bankTransaction.amountOut || f.bankTransaction.amountIn)}
              onPress={() => navigation.navigate("Transaction", { id: f.bankTransaction.id })}
            />
          </Group>
        ) : (
          <Card>
            <Txt muted>Not linked to a bank transaction.</Txt>
          </Card>
        )}
        {f.suggestedBankTransaction && !viewer && (
          <Card style={{ gap: 10 }}>
            <Txt bold>Suggested match</Txt>
            <Txt>{f.suggestedBankTransaction.description}</Txt>
            <Txt muted size={13}>
              {fmtDate(f.suggestedBankTransaction.date)} · {money(f.suggestedBankTransaction.amountOut || f.suggestedBankTransaction.amountIn)}
            </Txt>
            <View style={styles.row}>
              <Button title="Accept" compact icon="checkmark" style={{ flex: 1 }} onPress={() => review("accept")} />
              <Button title="Reject" compact secondary style={{ flex: 1 }} onPress={() => review("reject")} />
            </View>
          </Card>
        )}
        {!viewer && (canAttach || f.suggestedBankTransaction) && (
          <Button
            title="Choose bank transaction"
            secondary
            icon="search-outline"
            onPress={() => navigation.navigate("BankPicker", { tripId, mode: "funding", fundingId: f.id })}
          />
        )}
      </Section>
      {!viewer && (
        <Section title="Edit">
          <Card>
            {bankLinked && (
              <Txt muted size={12}>
                The source comes from the bank transaction. The destination currency follows the wallet.
              </Txt>
            )}
            <Choice
              label="Wallet"
              value={walletId}
              options={[
                { label: "No wallet", value: "" },
                ...(wallets.data || []).map((w: any) => ({ label: `${w.name} · ${w.currency}`, value: w.id, color: w.color })),
              ]}
              onChange={setWalletId}
            />
            <View style={[styles.row, { alignItems: "flex-start" }]}>
              <View style={{ width: 96 }}>
                <Input label="From" value={sourceCurrency} editable={!bankLinked} autoCapitalize="characters" maxLength={3} onChangeText={(v: string) => setSourceCurrency(v.toUpperCase())} />
              </View>
              <View style={{ flex: 1 }}>
                <Input label="Amount sent" value={sourceAmount} editable={!bankLinked} keyboardType="decimal-pad" onChangeText={setSourceAmount} />
              </View>
            </View>
            <View style={[styles.row, { alignItems: "flex-start" }]}>
              <View style={{ width: 96 }}>
                <Input label="To" value={destinationCurrency} editable={!bankLinked && !walletId} autoCapitalize="characters" maxLength={3} onChangeText={(v: string) => setDestinationCurrency(v.toUpperCase())} />
              </View>
              <View style={{ flex: 1 }}>
                {inputMode === "amount" ? (
                  <Input label="Amount received" value={destinationAmount} keyboardType="decimal-pad" onChangeText={setDestinationAmount} />
                ) : (
                  <Input label="Exchange rate" value={fxRate} keyboardType="decimal-pad" onChangeText={setFxRate} />
                )}
              </View>
            </View>
            <Segmented values={["amount", "fxRate"]} labels={{ amount: "Edit amount", fxRate: "Edit rate" }} value={inputMode} onChange={(v) => setInputMode(v as any)} />
            <View style={[styles.row, { alignItems: "flex-start" }]}>
              <View style={{ flex: 1 }}>
                <Input label="Fee" value={feeAmount} keyboardType="decimal-pad" placeholder="0" onChangeText={setFeeAmount} />
              </View>
              <View style={{ flex: 1 }}>
                <Choice
                  label="Fee currency"
                  value={feeCurrency}
                  options={[...new Set([sourceCurrency, destinationCurrency])].map((c) => ({ label: c, value: c }))}
                  onChange={setFeeCurrency}
                />
              </View>
            </View>
            {needsBase && (
              <Input label={`Value in ${base}`} value={baseAmount} keyboardType="decimal-pad" onChangeText={setBaseAmount} />
            )}
          </Card>
          <FundingPropagation trace={trace} />
        </Section>
      )}
      {!viewer && (
        <Section title="Merge">
          <Card>
            <Choice
              label="Merge this into another funding"
              value={merge}
              options={(fundings.data || [])
                .filter((x: any) => x.id !== f.id)
                .map((x: any) => ({
                  label: `${fundingTitle(x)} · ${money(x.destinationAmount, x.destinationCurrency)}`,
                  value: x.id,
                  hint: x.wallet?.name,
                }))}
              onChange={setMerge}
            />
            <Button
              title="Merge funding"
              compact
              secondary
              disabled={!merge}
              onPress={() =>
                confirm("Merge funding?", "Combine this funding with the one you chose. This one is removed.", async () => {
                  await call("mergeTripFunding", tripId, f.id, merge);
                  toast("Funding merged");
                  navigation.goBack();
                })
              }
            />
          </Card>
        </Section>
      )}
      {!viewer && (
        <Button
          title="Delete funding"
          danger
          secondary
          icon="trash-outline"
          onPress={() =>
            confirm("Delete funding?", "Wallet values that depend on it are recalculated.", async () => {
              await call("deleteTripFunding", tripId, f.id);
              toast("Funding deleted");
              navigation.goBack();
            }, "Delete")
          }
        />
      )}
    </Screen>
  );
}
export function FundingReviewScreen({ route, navigation }: any) {
  const { tripId } = route.params;
  const { call } = useApi();
  const { colors } = useTheme();
  const fundings = useResource("getTripFundings", tripId);
  const trip = useResource("getTrip", tripId);
  const base = trip.data?.baseCurrency || "SGD";
  const queue = (fundings.data || []).filter(isPendingReview);
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const current = queue[Math.min(index, Math.max(queue.length - 1, 0))];
  const used = new Set((fundings.data || []).map((f: any) => f.bankTransactionId).filter(Boolean));
  const detachedId = current?.metadata?.detachedBankTransaction?.id;
  const groups = current
    ? [
        ["Identified in the funding list", current.metadata?.autoMatchCandidates?.inFundingList || []],
        ["Identified outside the funding list", current.metadata?.autoMatchCandidates?.outsideFundingList || []],
      ].map(([title, rows]: any) => [title, rows.filter((c: any) => !used.has(c.id) && c.id !== detachedId)])
    : [];
  const recommended = current?.metadata?.autoMatchedBankTransactionId || "";
  useEffect(() => setChoice(recommended), [current?.id, recommended]);
  const resolve = async (action: string, bankTransactionId?: string) => {
    setBusy(true);
    try {
      await call("reviewTripFundingMatch", tripId, current.id, { action, ...(bankTransactionId ? { bankTransactionId } : {}) });
      toast(action === "reject" ? "Skipped" : "Linked");
      await fundings.reload();
    } catch (e) {
      notice(e);
    } finally {
      setBusy(false);
    }
  };
  const opening = current?.sourceType === "opening_balance";
  return (
    <Screen
      footer={
        current ? (
          <>
            {opening ? (
              <Button title="Add opening balance funding" loading={busy} disabled={busy} onPress={() => void resolve("accept")} />
            ) : (
              <Button
                title={choice && choice !== recommended ? "Link selected candidate" : "Accept recommended"}
                icon="link-outline"
                loading={busy}
                disabled={busy || !choice}
                onPress={() => void resolve(choice === recommended ? "accept" : "replace", choice)}
              />
            )}
            <Button
              title={opening ? "Skip opening balance" : current.sourceType === "imported_topup" ? "Skip (keep top-up as funding)" : "Skip (keep funding)"}
              ghost
              disabled={busy}
              onPress={() => void resolve("reject")}
            />
          </>
        ) : undefined
      }
    >
      <Heading title="Funding review" subtitle={queue.length ? `Reviewing ${Math.min(index, queue.length - 1) + 1} of ${queue.length}` : undefined} />
      <State {...fundings} />
      {fundings.data && !queue.length && (
        <Card>
          <Empty icon="checkmark-done-outline" title="Review complete" message="No funding rows are waiting for a bank match." action="Back to trip" onAction={() => navigation.goBack()} />
        </Card>
      )}
      {current && (
        <>
          <Card style={{ gap: 8 }}>
            <View style={styles.row}>
              <IconBubble icon={opening ? "flag-outline" : "wallet-outline"} tone="amber" />
              <View style={{ flex: 1 }}>
                <Txt bold>{fundingTitle(current)}</Txt>
                <Txt muted size={13}>
                  {current.wallet?.name || "No wallet"} · {fmtDate(current.metadata?.basisTransactionDate || current.metadata?.originalDate || current.createdAt)}
                </Txt>
              </View>
            </View>
            <KeyValue label="Received" mono value={money(current.destinationAmount, current.destinationCurrency)} />
            <KeyValue label="Paid" mono value={money(current.sourceAmount, current.sourceCurrency)} />
            {current.fxRate && <KeyValue label="Rate" mono value={Number(current.fxRate).toFixed(6)} />}
            {current.feeAmount && <KeyValue label="Fee" mono value={money(current.feeAmount, current.feeCurrency || base)} />}
            {current.metadata?.detachedBankTransaction && (
              <Txt size={13} tone="red">
                Its bank transaction was removed. Choose another.
              </Txt>
            )}
          </Card>
          {queue.length > 1 && (
            <View style={styles.row}>
              <Button title="Previous" compact secondary style={{ flex: 1 }} disabled={index === 0} onPress={() => setIndex(index - 1)} />
              <Button title="Next" compact secondary style={{ flex: 1 }} disabled={index >= queue.length - 1} onPress={() => setIndex(index + 1)} />
            </View>
          )}
          {!opening &&
            groups.map(([title, rows]: any) => (
              <Section key={title} title={title}>
                {rows.length === 0 ? (
                  <Txt muted size={13} style={{ paddingHorizontal: 4 }}>
                    No candidates.
                  </Txt>
                ) : (
                  <Group>
                    {rows.map((c: any) => (
                      <Pressable
                        key={c.id}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: choice === c.id }}
                        onPress={() => setChoice(c.id)}
                        style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: choice === c.id ? colors.tint : "transparent" }}
                      >
                        <Checkbox checked={choice === c.id} />
                        <View style={{ flex: 1 }}>
                          <Txt bold numberOfLines={1}>
                            {c.description}
                          </Txt>
                          <Txt muted size={12}>
                            {fmtDate(c.date)}
                            {c.id === recommended ? " · recommended" : ""}
                          </Txt>
                        </View>
                        <Txt mono size={13}>
                          {money(c.amountOut || c.amountIn)}
                        </Txt>
                      </Pressable>
                    ))}
                  </Group>
                )}
              </Section>
            ))}
          {!opening && (
            <Button
              title="Search the bank ledger"
              secondary
              icon="search-outline"
              onPress={() => navigation.navigate("BankPicker", { tripId, mode: "funding", fundingId: current.id })}
            />
          )}
        </>
      )}
    </Screen>
  );
}
