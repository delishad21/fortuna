import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useApi, useResource } from "../api";
import {
  Banner,
  Button,
  Card,
  Checkbox,
  Choice,
  Empty,
  fmtDate,
  Group,
  Heading,
  ListItem,
  money,
  notice,
  Screen,
  SearchBar,
  Section,
  Segmented,
  State,
  styles,
  toast,
  Txt,
} from "../ui";
import {
  buildFundingOut,
  emptyFundingOut,
  FundingOutFields,
  PersonPicker,
  validateFundingOut,
} from "./common";

type Mode = "entries" | "funding" | "outgoing";
const TITLES: Record<Mode, [string, string]> = {
  entries: ["Add from bank", "Bring bank transactions into this trip."],
  funding: ["Choose bank transaction", "Link the bank transaction that paid for this funding."],
  outgoing: ["From another trip", "Turn money sent out of another trip into funding here."],
};
export function BankPickerScreen({ route, navigation }: any) {
  const { tripId, fundingId } = route.params;
  const mode: Mode = route.params.mode || "entries";
  const { call } = useApi();
  const trip = useResource("getTrip", tripId);
  const base = trip.data?.baseCurrency || "SGD";
  const wallets = useResource("getWallets", tripId);
  const categories = useResource(mode === "entries" ? "getCategories" : "", { scope: "trips" });
  const trips = useResource(mode === "outgoing" ? "getTrips" : "");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [entryType, setEntryType] = useState("spending");
  const [categoryId, setCategoryId] = useState("");
  const [counterpartyId, setCounterpartyId] = useState("");
  const [walletId, setWalletId] = useState("");
  const [sourceTripId, setSourceTripId] = useState("");
  const [fundingOut, setFundingOut] = useState(emptyFundingOut(base));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => setFundingOut(emptyFundingOut(base)), [base]);
  const result = useResource(
    mode === "outgoing" ? "getOutgoingFundingEntryCandidates" : mode === "funding" ? "getFundingCandidates" : "getSourceTransactionCandidates",
    tripId,
    { search: query, limit: 30, offset, ...(mode === "outgoing" && sourceTripId ? { sourceTripId } : {}) },
  );
  const outflow = entryType === "spending" || entryType === "settlement";
  const rows = (result.data?.transactions || []).filter((c: any) =>
    mode !== "entries" ? true : outflow ? Number(c.amountOut || 0) > 0 : Number(c.amountIn || 0) > 0,
  );
  const submit = async () => {
    setError("");
    if (!selected.length) return;
    setBusy(true);
    try {
      if (mode === "outgoing") {
        const r = await call("addFundingsFromOutgoingEntries", tripId, { sourceEntryIds: selected, walletId: walletId || null });
        toast(`${r?.created ?? selected.length} funding rows added`);
      } else if (mode === "funding") {
        await call("reviewTripFundingMatch", tripId, fundingId, { action: "replace", bankTransactionId: selected[0] });
        toast("Bank transaction linked");
      } else if (entryType === "settlement") {
        if (!counterpartyId) throw new Error("Choose who you paid");
        const r = await call("addBankSettlements", tripId, { transactionIds: selected, counterpartyId });
        toast(`${r?.created ?? selected.length} settlements added`);
      } else {
        if (entryType === "funding_out") {
          const problem = validateFundingOut(fundingOut);
          if (problem) throw new Error(problem);
        }
        const r = await call("addEntriesFromSourceTransactions", tripId, {
          transactionIds: selected,
          categoryId: entryType === "spending" ? categoryId || null : null,
          entryType,
          fundingOut: entryType === "funding_out" ? buildFundingOut(fundingOut, base) : null,
        });
        toast(`${r?.created ?? selected.length} transaction${selected.length === 1 ? "" : "s"} added to this trip`);
      }
      navigation.goBack();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const [title, subtitle] = TITLES[mode];
  return (
    <Screen
      footer={
        <>
          {!!error && <Txt tone="red" size={13}>{error}</Txt>}
          <Button
            title={mode === "funding" ? "Link transaction" : `Add ${selected.length || ""} selected`.replace("  ", " ")}
            icon="checkmark"
            loading={busy}
            disabled={busy || !selected.length}
            onPress={() => void submit()}
          />
        </>
      }
    >
      <Heading title={title} subtitle={subtitle} />
      {mode === "entries" && (
        <Card>
          <Segmented
            values={["spending", "reimbursement", "funding_out", "settlement"]}
            labels={{ spending: "Spend", reimbursement: "Refund", funding_out: "Move out", settlement: "Settle" }}
            value={entryType}
            onChange={(v) => {
              setEntryType(v);
              setSelected([]);
            }}
          />
          <Txt muted size={12}>
            {outflow ? "Showing money out of your bank." : "Showing money into your bank."}
          </Txt>
          {entryType === "spending" && (
            <Choice
              label="Trip category"
              value={categoryId}
              options={[{ label: "Uncategorized", value: "" }, ...(categories.data || []).map((c: any) => ({ label: c.name, value: c.id, color: c.color }))]}
              onChange={setCategoryId}
            />
          )}
          {entryType === "settlement" && (
            <PersonPicker tripId={tripId} label="Paid to" value={counterpartyId} onChange={setCounterpartyId} />
          )}
        </Card>
      )}
      {mode === "entries" && entryType === "funding_out" && (
        <Card>
          <FundingOutFields value={fundingOut} onChange={setFundingOut} tripId={tripId} baseCurrency={base} wallets={wallets.data || []} />
        </Card>
      )}
      {mode === "outgoing" && (
        <Card>
          <Choice
            label="From trip"
            value={sourceTripId}
            options={[{ label: "Any trip", value: "" }, ...(trips.data || []).filter((t: any) => t.id !== tripId).map((t: any) => ({ label: t.name, value: t.id }))]}
            onChange={(v) => {
              setSourceTripId(v);
              setSelected([]);
            }}
          />
          <Choice
            label="Into wallet"
            value={walletId}
            options={[{ label: "Match by currency", value: "" }, ...(wallets.data || []).map((w: any) => ({ label: `${w.name} · ${w.currency}`, value: w.id, color: w.color }))]}
            onChange={setWalletId}
          />
        </Card>
      )}
      <Section title={selected.length ? `${selected.length} selected` : "Transactions"}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search" />
        <State {...result} />
        {result.data && rows.length === 0 && (
          <Card>
            <Empty icon="search-outline" title="Nothing to add" message="No matching transactions that aren't already in a trip." />
          </Card>
        )}
        <Group>
          {rows.map((c: any) => {
            const on = selected.includes(c.id);
            const amountIn = Number(c.amountIn || 0);
            return (
              <ListItem
                key={c.id}
                left={<Checkbox checked={on} />}
                title={c.label || c.description}
                subtitle={`${fmtDate(c.date)}${c.accountIdentifier ? ` · ${c.accountIdentifier}` : ""}${c.trip?.name ? ` · ${c.trip.name}` : ""}`}
                value={c.localAmount != null ? money(c.localAmount, c.localCurrency) : `${amountIn > 0 ? "+" : "−"}${money(amountIn || c.amountOut)}`}
                valueTone={amountIn > 0 ? "green" : undefined}
                chevron={false}
                onPress={() =>
                  setSelected((o) => (on ? o.filter((x) => x !== c.id) : mode === "funding" ? [c.id] : [...o, c.id]))
                }
              />
            );
          })}
        </Group>
        {result.data && result.data.total > 30 && (
          <View style={styles.row}>
            <Button title="Previous" compact secondary style={{ flex: 1 }} disabled={!offset} onPress={() => setOffset(Math.max(0, offset - 30))} />
            <Button title="Next" compact secondary style={{ flex: 1 }} disabled={offset + 30 >= result.data.total} onPress={() => setOffset(offset + 30)} />
          </View>
        )}
      </Section>
      {mode === "entries" && (
        <Banner tone="neutral" icon="information-circle-outline" message="A bank transaction can back only one trip record across all your trips." />
      )}
    </Screen>
  );
}
